import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { fetchWorkspaceConditions } from '../api/conditions';
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
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import { fetchWorkspaceFunctions } from '../api/functions';
import type { WorkspaceFunction } from '../api/functions';
import { fetchWorkspaceObjects } from '../api/objects';
import type { WorkflowObject } from '../api/objects';
import { IconField } from './IconField';

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

  const [objects, setObjects] = useState<WorkflowObject[]>([]);
  const [functions, setFunctions] = useState<WorkspaceFunction[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  /** What the server says it can deliver; anything else is not worth offering. */
  const [deliverable, setDeliverable] = useState<TriggerAction[]>([]);
  const [connections, setConnections] = useState<WorkspaceConnection[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const complete =
    name.trim() !== '' &&
    (incoming
      ? connectionId !== ''
      : webhook
        ? webhookPath.trim() !== '' && objectId !== '' && (authType !== 'FUNCTION' || authFunctionId !== '')
        : cron.trim() !== '');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const settings = {
        name: name.trim(),
        connectionId: incoming ? connectionId : undefined,
        action: incoming ? action : undefined,
        cron: incoming || webhook ? undefined : cron.trim(),
        timezone: incoming || webhook ? undefined : timezone,
        webhookPath: webhook ? webhookPath.trim() : undefined,
        objectId: webhook ? objectId : undefined,
        authType: webhook ? authType : undefined,
        authFunctionId: webhook && authType === 'FUNCTION' ? authFunctionId : null,
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
              <label className={styles.label} htmlFor="trigger-webhook-path">
                URL
              </label>
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
              <p className={styles.fieldHint}>
                Where this installation answers. One trigger per path, across every workspace.
              </p>
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
                <label className={styles.label} htmlFor="trigger-object">
                  Expected object
                </label>
                {objectId !== '' && (
                  <Link
                    className={styles.jump}
                    to={`/workspace/${workspaceId}/objects/${objectId}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Opens the object's definition in a new tab"
                  >
                    Open definition &#8599;
                  </Link>
                )}
              </span>
              <div className={styles.inputWrapper}>
                <select
                  id="trigger-object"
                  name="objectId"
                  className={`${styles.input} ${styles.select}`}
                  value={objectId}
                  onChange={(event) => setObjectId(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select object&hellip;
                  </option>
                  {objects.map((shape) => (
                    <option key={shape.id} value={shape.id}>
                      {shape.name} &middot; {shape.propertyCount} fields
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </div>
              <p className={styles.fieldHint}>
                What a request has to contain. Anything else is answered 404 &mdash; and what does
                match is what the workflow can rely on being handed.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="trigger-auth">
                Authentication
              </label>
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
              <p className={styles.fieldHint}>
                A caller the function turns down is answered 401, and the refusal is written into
                this trigger&apos;s history.
              </p>
            </div>

            {authType === 'FUNCTION' && (
              <div className={styles.field}>
                {/* The same reason as the object above: this is a definition, and it opens. */}
                <span className={styles.labelRow}>
                  <label className={styles.label} htmlFor="trigger-auth-function">
                    Function
                  </label>
                  {authFunctionId !== '' && (
                    <Link
                      className={styles.jump}
                      to={`/workspace/${workspaceId}/functions/${authFunctionId}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Opens the function in a new tab"
                    >
                      Open definition &#8599;
                    </Link>
                  )}
                </span>
                <div className={styles.inputWrapper}>
                  <select
                    id="trigger-auth-function"
                    name="authFunctionId"
                    className={`${styles.input} ${styles.select}`}
                    value={authFunctionId}
                    onChange={(event) => setAuthFunctionId(event.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select function&hellip;
                    </option>
                    {functions.map((held) => (
                      <option key={held.id} value={held.id}>
                        {held.name}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
                <p className={styles.fieldHint}>
                  {functions.length === 0
                    ? 'No function here returns true or false yet; one that does can be chosen here.'
                    : 'Handed the request by name — body, rawBody, headers, path — then its own external parameters, which is where a stored secret comes from.'}
                </p>
              </div>
            )}
          </>
        )}

        {webhook ? null : incoming ? (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="trigger-connection">
                Connection
              </label>
              <div className={styles.inputWrapper}>
                <select
                  id="trigger-connection"
                  name="connectionId"
                  className={`${styles.input} ${styles.select}`}
                  value={connectionId}
                  onChange={(event) => setConnectionId(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select connection...
                  </option>
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name}
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </div>
              <p className={styles.fieldHint}>Select the connection that will trigger this event.</p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="trigger-action">
                Action
              </label>
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
              <p className={styles.fieldHint}>The specific event that activates this trigger.</p>
            </div>
          </>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="trigger-cron">
                Schedule
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="trigger-cron"
                  name="cron"
                  className={`${styles.input} ${styles.inputMono} ${styles.inputCron}`}
                  type="text"
                  placeholder="0 2 * * *"
                  value={cron}
                  onChange={(event) => setCron(event.target.value)}
                  required
                />
              </div>
              <p className={styles.fieldHint}>A cron expression defining when the trigger fires.</p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="trigger-timezone">
                Timezone
              </label>
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
              <p className={styles.fieldHint}>The timezone used to resolve the cron schedule.</p>
            </div>
          </>
        )}

        <div className={styles.field}>
          {/* A condition is a definition too, and reading it is how somebody decides. */}
          <span className={styles.labelRow}>
            <label className={styles.label} htmlFor="trigger-condition">
              Condition
            </label>
            {conditionId !== '' && (
              <Link
                className={styles.jump}
                to={`/workspace/${workspaceId}/conditions/${conditionId}`}
                target="_blank"
                rel="noreferrer"
                title="Opens the condition in a new tab"
              >
                Open definition &#8599;
              </Link>
            )}
          </span>
          <div className={styles.inputWrapper}>
            <select
              id="trigger-condition"
              name="condition"
              className={`${styles.input} ${styles.select}`}
              value={conditionId}
              onChange={(event) => setConditionId(event.target.value)}
            >
              <option value="">Fire on everything</option>
              {conditions.map((condition) => (
                <option key={condition.id} value={condition.id}>
                  {condition.name}
                </option>
              ))}
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </div>
          <p className={styles.fieldHint}>
            Asked before anything starts, so an event it turns down leaves no run behind.
          </p>
        </div>

        <IconField
          value={icon}
          onChange={setIcon}
          hint="Nodes drawn from this trigger start with it; each node can change its own."
        />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="trigger-payload">
            Payload
          </label>
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
          <p className={styles.fieldHint}>
            {incoming
              ? 'JSON added underneath the event, for values the event does not carry.'
              : webhook
                ? 'JSON added underneath the request, for values the caller does not send.'
                : 'JSON handed to the run. The clock carries no data, so this is what the workflow works on.'}
          </p>
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
  );
}
