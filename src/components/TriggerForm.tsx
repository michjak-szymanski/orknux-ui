import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { NEW_CONDITION, fetchWorkspaceConditions } from '../api/conditions';
import type { Condition } from '../api/conditions';
import { fetchWorkspaceConnections } from '../api/integrations';
import type { WorkspaceConnection } from '../api/integrations';
import {
  TRIGGER_ACTIONS,
  TRIGGER_ACTION_LABEL,
  createTrigger,
  fetchSupportedTriggerActions,
  updateTrigger,
} from '../api/triggers';
import type { Trigger, TriggerAction, TriggerType, WebhookAuthType } from '../api/triggers';
import { OpenDefinitionIcon } from './OpenDefinitionIcon';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import {
  NEW_FUNCTION,
  NEW_FUNCTION_NAME,
  createFunction,
  fetchWorkspaceFunctions,
  refusingFunction,
  validFunctionName,
} from '../api/functions';
import type { WorkspaceFunction } from '../api/functions';
import { NEW_OBJECT, createObject, fetchWorkspaceObjects } from '../api/objects';
import type { WorkflowObject } from '../api/objects';
import { ConditionDialog } from './ConditionDialog';
import { CRON_FIELDS, describeCron } from './cronText';
import { DefinitionPicker } from './DefinitionPicker';
import { FieldHint } from './FieldHint';
import { IconField } from './IconField';
import { NameDialog } from './NameDialog';
import own from './TriggerForm.module.css';

/**
 * The class names the form paints itself with.
 *
 * Handed in rather than imported, because this form is shown in two places that
 * are not the same surface: a modal panel while a trigger is being created, and
 * a card on its own page once it exists. The fields are identical in both — so
 * there is one form — and the look belongs to whichever frame is holding it.
 */
export interface TriggerFormStyles {
  /** The form itself: a modal's body, or a settings card. */
  body: string;
  fields: string;
  field: string;
  labelRow: string;
  label: string;
  /** The link out of a field, to what the field is pointing at. */
  jump: string;
  input: string;
  select: string;
  inputWrapper: string;
  inputWrapperTall: string;
  textarea: string;
  inputMono: string;
  inputCron: string;
  prefix: string;
  /**
   * What a field has to say for itself where that is not an explanation of it.
   *
   * What a field means is behind the (?) beside its label, which the form draws
   * for itself. What is left under a field is what the (?) must not swallow: an
   * empty state, a consequence of what saving is about to do, and a reading of
   * what has just been chosen.
   */
  fieldHint: string;
  message: string;
  error: string;
  actions: string;
  ghost: string;
  filled: string;
}

export interface TriggerFormProps {
  workspaceId: string;
  /** Null creates one; a trigger edits it, with its type fixed. */
  trigger?: Trigger | null;
  styles: TriggerFormStyles;
  onSaved: (trigger: Trigger) => void;
  /** Left out where the frame already offers a way back, as a page's breadcrumb does. */
  onCancel?: () => void;
}

/** The zones the form offers; anything else can be typed into the server. */
const TIMEZONES = ['UTC', 'Europe/Warsaw', 'Europe/London', 'America/New_York', 'America/Los_Angeles'];

/** The whole of a workspace's shapes fits in the picker. */
const OBJECT_PAGE_SIZE = 100;

/*
 * The rows that make a definition instead of choosing one.
 *
 * Held still rather than written into the JSX, because the picker treats a new
 * row object as a new list and puts its cursor back to the top - which, from a
 * form that re-renders on every keystroke, would be a picker nobody can arrow
 * down through.
 */
const NEW_FUNCTION_ROW = { value: NEW_FUNCTION, label: '+ New function' };
const NEW_CONDITION_ROW = { value: NEW_CONDITION, label: '+ New condition' };
const NEW_OBJECT_ROW = { value: NEW_OBJECT, label: '+ New object' };

/** Choosing nothing is a real answer here, so it is a row like any other. */
const ANY_EVENT_ROW = { value: '', label: 'Fire on everything' };

/**
 * What a trigger waits for and what it hands on. The form changes with the type:
 * an incoming connection asks which connection and which event, a scheduled one
 * asks for a cron expression and the zone it is read in, a webhook asks for the
 * path it answers on and the shape a caller has to send.
 *
 * It asks for no workflow: this defines a catalogue entry, and a workflow picks
 * one up by pointing a trigger node at it in the editor.
 *
 * Nothing here resets: the state is read from `trigger` as it mounts, and the
 * frames mount it fresh — the dialog renders it only while open, the page keys it
 * by which trigger is being edited. An effect that put the fields back would be a
 * second answer to the same question, and the two would eventually disagree.
 */
export function TriggerForm({ workspaceId, trigger = null, styles, onSaved, onCancel }: TriggerFormProps) {
  const [name, setName] = useState(trigger?.name ?? '');
  const [type, setType] = useState<TriggerType>(trigger?.type ?? 'INCOMING_CONNECTION');
  const [connectionId, setConnectionId] = useState(trigger?.connectionId ?? '');
  const [action, setAction] = useState<TriggerAction>(trigger?.action ?? 'MENTION');
  const [cron, setCron] = useState(trigger?.cron ?? '0 2 * * *');
  const [timezone, setTimezone] = useState(trigger?.timezone ?? 'UTC');
  const [payload, setPayload] = useState(trigger?.payload ?? '');
  /** Empty asks nothing, which is what a trigger does unless told otherwise. */
  const [conditionId, setConditionId] = useState(trigger?.conditionId ?? '');
  const [icon, setIcon] = useState<string | null>(trigger?.icon ?? null);
  const [webhookPath, setWebhookPath] = useState(trigger?.webhookPath ?? '');
  const [objectId, setObjectId] = useState(trigger?.objectId ?? '');
  const [authType, setAuthType] = useState<WebhookAuthType>(trigger?.authType ?? 'NONE');
  const [authFunctionId, setAuthFunctionId] = useState(trigger?.authFunctionId ?? '');
  /**
   * What to call the function this trigger is about to bring into existence.
   *
   * Only read when the picker is on "New function". A webhook guarded by a
   * function is very often the reason that function is wanted at all, and a
   * workspace with none had nothing to choose here but a dead end.
   */
  const [newFunctionName, setNewFunctionName] = useState(NEW_FUNCTION_NAME);

  const [objects, setObjects] = useState<WorkflowObject[]>([]);
  const [functions, setFunctions] = useState<WorkspaceFunction[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  /** What the server says it can deliver; anything else is not worth offering. */
  const [deliverable, setDeliverable] = useState<TriggerAction[]>([]);
  const [connections, setConnections] = useState<WorkspaceConnection[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which dialog is open on top of this form, if any.
   *
   * A condition and an object are both more than a name, and both already have
   * something that asks for the rest properly - the condition dialog, and the
   * same name-and-description step the Objects list uses before it opens the
   * editor. Neither is worth rebuilding in a corner of this form; what matters
   * is that going to make one does not cost the half-filled trigger.
   */
  const [makingCondition, setMakingCondition] = useState(false);
  const [makingObject, setMakingObject] = useState(false);

  const editing = trigger !== null;

  useEffect(() => {
    if (workspaceId === '') return;

    fetchWorkspaceConnections(workspaceId)
      .then((held) => {
        setConnections(held);
        setConnectionId((current) => (current === '' ? (held[0]?.id ?? '') : current));
      })
      .catch(() => setConnections([]));

    // The whole catalogue fits the picker, and a workspace with none simply
    // offers nothing to ask.
    fetchWorkspaceConditions(workspaceId, 0, OBJECT_PAGE_SIZE)
      .then((page) => setConditions(page.content))
      .catch(() => setConditions([]));

    fetchSupportedTriggerActions()
      .then(setDeliverable)
      .catch(() => setDeliverable([]));

    fetchWorkspaceObjects(workspaceId, 0, OBJECT_PAGE_SIZE)
      .then((page) => setObjects(page.content))
      .catch(() => setObjects([]));

    // Only the ones that can answer the question: a webhook is let in or kept
    // out, and a function returning an object has no opinion on that.
    fetchWorkspaceFunctions(workspaceId, 0, OBJECT_PAGE_SIZE)
      .then((page) => setFunctions(page.content.filter((held) => held.returnType === 'BOOLEAN')))
      .catch(() => setFunctions([]));
  }, [workspaceId]);

  const incoming = type === 'INCOMING_CONNECTION';
  const webhook = type === 'WEBHOOK';

  /*
   * What each picker offers, with a second line saying which one this is.
   *
   * The hint is searched alongside the name, so an object can be found by how
   * many fields it has and a condition by what it asks - which is how somebody
   * who has forgotten the name still knows the one they mean.
   */
  const connectionOptions = useMemo(
    () => connections.map((held) => ({ value: held.id, label: held.name, hint: held.effectiveUrl })),
    [connections],
  );

  const objectOptions = useMemo(
    () =>
      objects.map((shape) => ({
        value: shape.id,
        label: shape.name,
        hint: `${shape.propertyCount} ${shape.propertyCount === 1 ? 'field' : 'fields'}`,
      })),
    [objects],
  );

  const functionOptions = useMemo(
    () => functions.map((held) => ({ value: held.id, label: held.name, hint: held.signature })),
    [functions],
  );

  const conditionOptions = useMemo(
    () => [
      ANY_EVENT_ROW,
      ...conditions.map((held) => ({ value: held.id, label: held.name, hint: held.description })),
    ],
    [conditions],
  );

  /*
   * What the schedule in the box actually does, said back in English.
   *
   * Derived rather than kept in state, and derived from `cron` itself, so it
   * cannot lag the field by a keystroke: a reading that describes what was
   * typed a moment ago is a reading that is wrong exactly when somebody is
   * relying on it. Memoised on the string only because it is recomputed on
   * every render of a form with a dozen other fields in it.
   */
  const reading = useMemo(() => describeCron(cron), [cron]);

  const complete =
    name.trim() !== '' &&
    (incoming
      ? connectionId !== ''
      : webhook
        ? webhookPath.trim() !== '' &&
          objectId !== '' &&
          (authType !== 'FUNCTION' ||
            (authFunctionId !== '' &&
              (authFunctionId !== NEW_FUNCTION || validFunctionName(newFunctionName))))
        : cron.trim() !== '');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      /*
       * Named in the picker, made here, before the trigger that points at it.
       *
       * A trigger holding the id of something that does not exist would answer
       * every caller 401 for a reason nobody could look up, so the function goes
       * in first and the trigger gets a real id or nothing at all. What it starts
       * as turns everybody away, which is the safe half of a guard nobody has
       * written yet. Boolean, because letting a caller in or keeping it out is the
       * whole question, and the picker only lists functions that answer it.
       *
       * Kept in this form's own list as well: this is a settings page as often as
       * it is a dialog, and the picker it leaves behind has to be able to show
       * what was just chosen.
       */
      let chosenFunction = authFunctionId;
      if (webhook && authType === 'FUNCTION' && authFunctionId === NEW_FUNCTION) {
        const called = newFunctionName.trim();
        const made = await createFunction({
          workspaceId,
          name: called,
          returnType: 'BOOLEAN',
          ...refusingFunction(called),
        });
        setFunctions((current) => [...current, made]);
        setAuthFunctionId(made.id);
        chosenFunction = made.id;
      }

      const settings = {
        name: name.trim(),
        connectionId: incoming ? connectionId : undefined,
        action: incoming ? action : undefined,
        cron: incoming || webhook ? undefined : cron.trim(),
        timezone: incoming || webhook ? undefined : timezone,
        webhookPath: webhook ? webhookPath.trim() : undefined,
        objectId: webhook ? objectId : undefined,
        authType: webhook ? authType : undefined,
        authFunctionId: webhook && authType === 'FUNCTION' ? chosenFunction : null,
        payload: payload.trim(),
        // Undefined would leave the condition alone; the form has to be able to
        // take it off, so an empty pick is sent as null.
        conditionId: conditionId === '' ? null : conditionId,
        icon,
      };
      const saved = editing
        ? await updateTrigger(trigger.id, settings)
        : await createTrigger({ workspaceId, type, ...settings });
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the trigger.');
      setSubmitting(false);
    }
  }

  return (
    <>
      <form className={styles.body} onSubmit={handleSubmit}>
        <p className={styles.message}>
          {incoming
            ? 'Set up a trigger to execute your workflow automatically when events occur.'
            : webhook
              ? 'Give something outside a URL to call, and say what it has to send.'
              : 'Set up a trigger to execute your workflow automatically on a schedule.'}
        </p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="trigger-name">
              Trigger Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="trigger-name"
                name="triggerName"
                className={styles.input}
                type="text"
                placeholder={incoming ? 'e.g. Slack Mention Handler' : 'e.g. Midnight Cleanup Job'}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="trigger-type">
              Type
            </label>
            <div className={styles.inputWrapper}>
              <select
                id="trigger-type"
                name="triggerType"
                className={`${styles.input} ${styles.select}`}
                value={type}
                onChange={(event) => setType(event.target.value as TriggerType)}
                // What a trigger waits for does not change; its settings do.
                disabled={editing}
              >
                <option value="INCOMING_CONNECTION">Incoming Connection</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="WEBHOOK">Webhook</option>
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>

          {webhook && (
            <>
              <div className={styles.field}>
                <span className={own.labelWithHint}>
                  <label className={styles.label} htmlFor="trigger-webhook-path">
                    URL
                  </label>
                  <FieldHint label="URL">
                    Where this installation answers. One trigger per path, across every workspace.
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <span className={styles.prefix}>/api/webhooks/</span>
                  <input
                    id="trigger-webhook-path"
                    name="webhookPath"
                    className={`${styles.input} ${styles.inputMono}`}
                    type="text"
                    placeholder="build/finished"
                    value={webhookPath}
                    onChange={(event) => setWebhookPath(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                {/*
                  What the picker points at is a definition somebody may need to
                  read or change while deciding — a webhook stands or falls on
                  whether the caller's JSON matches this shape. Opened in a tab of
                  its own so that going to look at it does not throw away a form
                  that has not been saved yet.
                */}
                <span className={styles.labelRow}>
                  <span className={own.labelWithHint}>
                    <label className={styles.label} htmlFor="trigger-object">
                      Expected object
                    </label>
                    <FieldHint label="Expected object">
                      What a request has to contain. Anything else is answered 404 &mdash; and what does
                      match is what the workflow can rely on being handed.
                    </FieldHint>
                  </span>
                  {objectId !== '' && (
                    <Link
                      className={styles.jump}
                      to={`/workspace/${workspaceId}/objects/${objectId}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Opens the object's definition in a new tab"
                      aria-label="Open the expected object's definition"
                    >
                      <OpenDefinitionIcon />
                    </Link>
                  )}
                </span>
                <DefinitionPicker
                  id="trigger-object"
                  value={objectId}
                  options={objectOptions}
                  onChoose={(picked) => {
                    // The row is an instruction rather than an answer: nothing is
                    // stored until the dialog it opens comes back with a real id.
                    if (picked === NEW_OBJECT) setMakingObject(true);
                    else setObjectId(picked);
                  }}
                  placeholder="Select object…"
                  searchPlaceholder="Search objects…"
                  create={NEW_OBJECT_ROW}
                />
                {/* Said out loud rather than behind the (?), because an object made
                    from here starts empty and an empty shape demands nothing - which
                    is the opposite of what somebody choosing an expected object is
                    usually after. It is a reading of what has just been chosen, and
                    it is only there while that is what is chosen. */}
                {objects.find((shape) => shape.id === objectId)?.propertyCount === 0 && (
                  <p className={styles.fieldHint}>
                    This one has no fields yet, so any JSON matches it. Open it in Objects to say what a
                    caller has to send.
                  </p>
                )}
              </div>

              <div className={styles.field}>
                <span className={own.labelWithHint}>
                  <label className={styles.label} htmlFor="trigger-auth">
                    Authentication
                  </label>
                  {/*
                    Behind the (?), and the two options are not: what each one is
                    stays written into the rows themselves, where it is the only
                    thing telling them apart.
                  */}
                  <FieldHint label="Authentication">
                    A caller the function turns down is answered 401, and the refusal is written into
                    this trigger&apos;s history.
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <select
                    id="trigger-auth"
                    name="authType"
                    className={`${styles.input} ${styles.select}`}
                    value={authType}
                    onChange={(event) => setAuthType(event.target.value as WebhookAuthType)}
                  >
                    <option value="NONE">Open &mdash; the URL is the secret</option>
                    <option value="FUNCTION">Function &mdash; ask one of this workspace&apos;s functions</option>
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>

              {authType === 'FUNCTION' && (
                <div className={styles.field}>
                  {/* The same reason as the object above: this is a definition, and it opens. */}
                  <span className={styles.labelRow}>
                    <span className={own.labelWithHint}>
                      <label className={styles.label} htmlFor="trigger-auth-function">
                        Function
                      </label>
                      <FieldHint label="Function">
                        Handed the request by name &mdash; <code>body</code>, <code>rawBody</code>,{' '}
                        <code>headers</code>, <code>path</code> &mdash; then its own external parameters,
                        which is where a stored secret comes from.
                      </FieldHint>
                    </span>
                    {/* Nothing to open while the picker is on a name: the function
                        is created when the trigger is saved, not before. */}
                    {authFunctionId !== '' && authFunctionId !== NEW_FUNCTION && (
                      <Link
                        className={styles.jump}
                        to={`/workspace/${workspaceId}/functions/${authFunctionId}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Opens the function in a new tab"
                        aria-label="Open the function's definition"
                      >
                        <OpenDefinitionIcon />
                      </Link>
                    )}
                  </span>
                  {/* The way to make one sits above the list and outlasts the search:
                      a workspace's functions fill a hundred rows, and typing a name
                      that matches none of them is exactly when it is wanted. */}
                  <DefinitionPicker
                    id="trigger-auth-function"
                    value={authFunctionId}
                    options={functionOptions}
                    onChoose={setAuthFunctionId}
                    placeholder="Select function…"
                    searchPlaceholder="Search functions…"
                    create={NEW_FUNCTION_ROW}
                  />
                  {authFunctionId === NEW_FUNCTION && (
                    <div className={styles.inputWrapper}>
                      <input
                        id="trigger-new-function"
                        name="newFunctionName"
                        className={`${styles.input} ${styles.inputMono}`}
                        type="text"
                        aria-label="New function name"
                        placeholder={NEW_FUNCTION_NAME}
                        value={newFunctionName}
                        // Selected on focus, as the function editor does it: the box
                        // arrives with a name in it, so typing over it is one gesture.
                        onFocus={(event) => event.target.select()}
                        onChange={(event) => setNewFunctionName(event.target.value)}
                      />
                    </div>
                  )}
                  {/*
                    What the field is handed went behind the (?); these two did
                    not. The first is what saving is about to do — make a function
                    that turns every caller away — and a consequence read after the
                    fact is one that has already happened. The second is an empty
                    state: it is what this field has instead of anything to choose.
                  */}
                  {authFunctionId === NEW_FUNCTION ? (
                    <p className={styles.fieldHint}>
                      Created with this trigger, turning every caller away. Open it in Functions to say
                      who may call.
                    </p>
                  ) : functions.length === 0 ? (
                    <p className={styles.fieldHint}>
                      No function here returns true or false yet; one that does can be chosen here, or
                      made above.
                    </p>
                  ) : null}
                </div>
              )}
            </>
          )}

          {webhook ? null : incoming ? (
            <>
              <div className={styles.field}>
                <span className={own.labelWithHint}>
                  <label className={styles.label} htmlFor="trigger-connection">
                    Connection
                  </label>
                  <FieldHint label="Connection">Select the connection that will trigger this event.</FieldHint>
                </span>
                {/* Nothing to make from here: a connection is a URL, a token and a
                    handshake with the service, none of which can be got from a name
                    - so this says where they are instead of offering a row that
                    would only lead to a half-made one. */}
                <DefinitionPicker
                  id="trigger-connection"
                  value={connectionId}
                  options={connectionOptions}
                  onChoose={setConnectionId}
                  placeholder="Select connection…"
                  searchPlaceholder="Search connections…"
                />
                {/*
                  The empty state stays where the missing contents would be. A
                  workspace with no connections has nothing to pick, and where to
                  go about that is not an explanation of the field - it is the
                  only thing this field can say for itself.
                */}
                {connections.length === 0 && (
                  <p className={styles.fieldHint}>
                    None set up yet. Connections carry credentials, so they are added under the
                    workspace&apos;s Integrations and chosen here afterwards.
                  </p>
                )}
              </div>

              <div className={styles.field}>
                <span className={own.labelWithHint}>
                  <label className={styles.label} htmlFor="trigger-action">
                    Action
                  </label>
                  <FieldHint label="Action">The specific event that activates this trigger.</FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <select
                    id="trigger-action"
                    name="action"
                    className={`${styles.input} ${styles.select}`}
                    value={action}
                    onChange={(event) => setAction(event.target.value as TriggerAction)}
                  >
                    {TRIGGER_ACTIONS.filter((candidate) => deliverable.includes(candidate)).map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {TRIGGER_ACTION_LABEL[candidate]}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={styles.field}>
                <span className={own.labelWithHint}>
                  <label className={styles.label} htmlFor="trigger-cron">
                    Schedule
                  </label>
                  <FieldHint label="Schedule">
                    A cron expression defining when the trigger fires. Six fields, in this order:
                    <span className={own.cronLegend}>
                      {CRON_FIELDS.map((field) => (
                        <span key={field.position} className={own.cronLegendRow}>
                          <span className={own.cronLegendAt}>{field.position}</span>
                          <span className={own.cronLegendLabel}>{field.label}</span>
                          <span className={own.cronLegendAccepts}>{field.accepts}</span>
                        </span>
                      ))}
                    </span>
                    Five fields are read from the minute, with the second at zero — so{' '}
                    <code>0 2 * * *</code> and <code>0 0 2 * * *</code> are the same schedule. Both{' '}
                    <code>0</code> and <code>7</code> are Sunday.
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <input
                    id="trigger-cron"
                    name="cron"
                    className={`${styles.input} ${styles.inputMono} ${styles.inputCron}`}
                    type="text"
                    placeholder="0 2 * * *"
                    value={cron}
                    aria-describedby="trigger-cron-reading"
                    onChange={(event) => setCron(event.target.value)}
                    required
                  />
                </div>
                {/*
                  What the expression does, under the expression.

                  In the open rather than behind the (?), because it is not an
                  explanation of the field - it is the result of what was just
                  typed into it, which the rules file keeps in the open for the
                  same reason an error stays in the open.

                  One line, always, whatever it says. It is recomputed on every
                  keystroke, and a hint that grows to two lines and back pushes
                  the Timezone select and the buttons below it up and down under
                  the pointer - which is precisely what makes a live reading feel
                  broken rather than helpful. The full sentence is on the title
                  for the rare one long enough to be clipped.
                */}
                <p
                  id="trigger-cron-reading"
                  className={`${styles.fieldHint} ${own.cronReading} ${
                    reading.state === 'unreadable' || reading.state === 'unreachable' ? own.cronReadingWrong : ''
                  }`}
                  title={reading.text}
                >
                  {reading.text}
                </p>
              </div>

              <div className={styles.field}>
                <span className={own.labelWithHint}>
                  <label className={styles.label} htmlFor="trigger-timezone">
                    Timezone
                  </label>
                  <FieldHint label="Timezone">The timezone used to resolve the cron schedule.</FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <select
                    id="trigger-timezone"
                    name="timezone"
                    className={`${styles.input} ${styles.select}`}
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                  >
                    {TIMEZONES.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>
            </>
          )}

          <div className={styles.field}>
            {/* A condition is a definition too, and reading it is how somebody decides. */}
            <span className={styles.labelRow}>
              <span className={own.labelWithHint}>
                <label className={styles.label} htmlFor="trigger-condition">
                  Condition
                </label>
                <FieldHint label="Condition">
                  Asked before anything starts, so an event it turns down leaves no run behind.
                </FieldHint>
              </span>
              {conditionId !== '' && (
                <Link
                  className={styles.jump}
                  to={`/workspace/${workspaceId}/conditions/${conditionId}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Opens the condition in a new tab"
                  aria-label="Open the condition's definition"
                >
                  <OpenDefinitionIcon />
                </Link>
              )}
            </span>
            <DefinitionPicker
              id="trigger-condition"
              value={conditionId}
              options={conditionOptions}
              onChoose={(picked) => {
                // The row is an instruction rather than an answer: nothing is
                // stored until the dialog it opens comes back with a real id.
                if (picked === NEW_CONDITION) setMakingCondition(true);
                else setConditionId(picked);
              }}
              placeholder="Fire on everything"
              searchPlaceholder="Search conditions…"
              create={NEW_CONDITION_ROW}
            />
          </div>

          <IconField
            value={icon}
            onChange={setIcon}
            hint="Nodes drawn from this trigger start with it; each node can change its own."
          />

          <div className={styles.field}>
            <span className={own.labelWithHint}>
              <label className={styles.label} htmlFor="trigger-payload">
                Payload
              </label>
              <FieldHint label="Payload">
                {incoming
                  ? 'JSON added underneath the event, for values the event does not carry.'
                  : webhook
                    ? 'JSON added underneath the request, for values the caller does not send.'
                    : 'JSON handed to the run. The clock carries no data, so this is what the workflow works on.'}
              </FieldHint>
            </span>
            <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
              <textarea
                id="trigger-payload"
                name="payload"
                className={`${styles.input} ${styles.textarea} ${styles.inputMono}`}
                placeholder={'{ "format": "compact" }'}
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
              />
            </div>
          </div>
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          {onCancel !== undefined && (
            <button type="button" className={styles.ghost} onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
          )}
          <button type="submit" className={styles.filled} disabled={!complete || submitting}>
            {submitting ? 'Saving…' : editing ? 'Save Changes' : 'Create Trigger'}
          </button>
        </div>
      </form>

      {/*
        Beside the form rather than inside it, and only while open.
        A form nested in a form is not something a browser will keep apart: the
        inner dialog's submit would bubble into this one's handler and save the
        trigger somebody is still filling in.
      */}
      {makingCondition && (
        <ConditionDialog
          open
          workspaceId={workspaceId}
          condition={null}
          onClose={() => setMakingCondition(false)}
          onSaved={(made) => {
            // Into this form's own list as well as into the field: this is a
            // settings page as often as it is a dialog, and nothing is going to
            // fetch the conditions again while it stays open.
            setConditions((current) => [...current, made]);
            setConditionId(made.id);
            setMakingCondition(false);
          }}
        />
      )}

      {makingObject && (
        <NameDialog
          open
          title="Create Object"
          message="Name the shape a caller has to send. Its fields are written in Objects."
          nameLabel="Object Name"
          namePlaceholder="e.g. BuildFinished"
          descriptionPlaceholder="What this describes"
          submitLabel="Create Object"
          onClose={() => setMakingObject(false)}
          onSubmit={async (called, description) => {
            const made = await createObject(workspaceId, { name: called, description });
            setObjects((current) => [...current, made]);
            setObjectId(made.id);
            setMakingObject(false);
          }}
        />
      )}
    </>
  );
}
