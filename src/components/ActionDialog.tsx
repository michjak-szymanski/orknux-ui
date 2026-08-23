import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import {
  ACTION_SUBTYPE_LABEL,
  ACTION_TYPE_LABEL,
  CONNECTION_ACTIONS,
  CONNECTION_ACTION_LABEL,
  HTTP_METHODS,
  SUBTYPES_BY_TYPE,
  createAction,
  deleteAction,
  updateAction,
} from '../api/actions';
import type {
  Action,
  ActionHeaderInput,
  ActionSubtype,
  ActionType,
  ArgumentMapping,
  ConnectionActionKind,
  MessageTarget,
} from '../api/actions';
import { NEW_CONDITION, fetchWorkspaceConditions } from '../api/conditions';
import type { Condition } from '../api/conditions';
import {
  NEW_FUNCTION,
  NEW_FUNCTION_NAME,
  createFunction,
  fetchWorkspaceFunctions,
  validFunctionName,
} from '../api/functions';
import type { WorkspaceFunction } from '../api/functions';
import { fetchWorkspaceConnections } from '../api/integrations';
import type { WorkspaceConnection } from '../api/integrations';
import { fetchVariables } from '../api/variables';
import type { Variable } from '../api/variables';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import { CatalogueNote, useCatalogue } from './Catalogue';
import { ConditionDialog } from './ConditionDialog';
import { DefinitionPicker } from './DefinitionPicker';
import { FieldHint } from './FieldHint';
import { HeaderRowsEditor } from './HeaderRowsEditor';
import type { HeaderRow } from './HeaderRowsEditor';
import { IconField } from './IconField';
import { OpenDefinitionIcon } from './OpenDefinitionIcon';
import { PanelClose, panelEscape } from './PanelClose';
import { SlackTargetAnswer } from './SlackTargetAnswer';
import styles from './Dialog.module.css';

export interface ActionDialogProps {
  /**
   * Whether this stands over the page or beside it.
   *
   * A modal is right when what somebody is doing has nothing to do with what
   * is behind it; making a component for the node they are editing is the
   * opposite, so the workflow editor asks for a panel and keeps its graph.
   */
  placement?: 'modal' | 'panel';
  open: boolean;
  workspaceId: string;
  /** Null creates one; an action edits it, with its type fixed. */
  action: Action | null;
  onClose: () => void;
  onSaved: (action: Action) => void;
  onDeleted?: () => void;
}

const FUNCTION_PAGE_SIZE = 100;

/**
 * How many of the workspace's variables a header may be pointed at.
 *
 * The same number the plugins page asks for, and for the same reason: the picker
 * searches what it was handed rather than the server, so a workspace holding
 * more than this would have variables the search could not find.
 */
const VARIABLE_PAGE_SIZE = 500;

/**
 * The rows on their way to the server: named ones only, and one source each.
 *
 * A row with no name is what Add leaves behind when somebody changes their mind,
 * and every other row builder here drops those on save too. The source is
 * decided by whether a variable was chosen, so a row half-switched - Reference
 * pressed, nothing picked yet - goes as the empty literal it looks like rather
 * than as a reference to nothing, which the server would refuse.
 */
/**
 * The stored headers as rows the editor can hold.
 *
 * A reference arrives with no value - that is the point of it - and the editor's
 * inputs are controlled, so the empty string stands in for the value it does not
 * have and will never be sent for a row that names a variable.
 */
function loadedRows(action: Action | null): HeaderRow[] {
  return (action?.headerRows ?? []).map((header) => ({
    name: header.name,
    value: header.value ?? '',
    variableId: header.variableId,
    variableName: header.variableName,
  }));
}

function sentRows(rows: HeaderRow[]): ActionHeaderInput[] {
  return rows
    .filter((row) => row.name.trim() !== '')
    .map((row) =>
      (row.variableId ?? '') === ''
        ? { name: row.name.trim(), value: row.value }
        : { name: row.name.trim(), variableId: row.variableId },
    );
}

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

/**
 * Create Action, and the same form again for editing one.
 *
 * What it asks for follows the type and the subtype, which is the whole of the
 * design: an outgoing connection wants a connection and something to say, an
 * HTTP request wants a URL, a function wants arguments, a wait wants a
 * condition or a duration.
 *
 * The parameters at the bottom are not asked for — the server reads them off
 * these settings — so they appear as the form is filled in.
 */
export function ActionDialog({ open, workspaceId, action, onClose, onSaved, onDeleted, placement = 'modal' }: ActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<ActionType>('EXECUTE');
  const [subtype, setSubtype] = useState<ActionSubtype>('OUTGOING_CONNECTION');
  const [connectionId, setConnectionId] = useState('');
  const [connectionAction, setConnectionAction] = useState<ConnectionActionKind>('SEND_MESSAGE');
  const [content, setContent] = useState('');
  const [target, setTarget] = useState<MessageTarget>('CHANNEL');
  const [targetName, setTargetName] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailReplyTo, setEmailReplyTo] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  /**
   * The headers as rows, which is the only way this form edits them.
   *
   * They used to be a JSON textarea, which put two problems on one control: a
   * missing comma was an action that failed when it ran, and a bearer token had
   * nowhere to go but into the text - unencrypted, in a column that is not a
   * credential column, legible to anybody who can open the action. A row that
   * names one of the workspace's variables is the answer to the second, and it
   * only exists once the value is a field rather than a fragment of JSON.
   */
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([]);
  /**
   * The stored text, and whether anybody could read it as rows.
   *
   * False is an action whose headers are a blob - truncated, smart-quoted, half
   * pasted. Taking the only editor away from one of those would leave somebody
   * looking at a broken action with no way to mend it, so the textarea comes
   * back for exactly that case and goes again as soon as the text parses.
   */
  const [headers, setHeaders] = useState('');
  const [headersReadable, setHeadersReadable] = useState(true);
  const [functionId, setFunctionId] = useState('');
  /**
   * What to call the function this action is about to bring into existence.
   *
   * Only read when the picker is on "New function". An action is very often the
   * reason a function is wanted at all, and the alternative was leaving a
   * half-filled dialog to go and make one on another screen.
   */
  const [newFunctionName, setNewFunctionName] = useState(NEW_FUNCTION_NAME);
  const [mappings, setMappings] = useState<ArgumentMapping[]>([]);
  const [conditionExpression, setConditionExpression] = useState('');
  const [conditionId, setConditionId] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState('3600');
  const [retryIntervalSeconds, setRetryIntervalSeconds] = useState('30');
  const [durationSeconds, setDurationSeconds] = useState('60');
  const [icon, setIcon] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether Create Condition is open on top of this dialog.
   *
   * A condition is a property, a check and a list of values, so there is nothing
   * to be gained from asking for it in a corner of this form the way a function's
   * name is asked for - the dialog that asks properly already exists, and it
   * comes back with something this picker can point at.
   */
  const [makingCondition, setMakingCondition] = useState(false);

  const editing = action !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      setName(action?.name ?? '');
      setType(action?.type ?? 'EXECUTE');
      setSubtype(action?.subtype ?? 'OUTGOING_CONNECTION');
      setConnectionId(action?.connectionId ?? '');
      setConnectionAction(action?.connectionAction ?? 'SEND_MESSAGE');
      setContent(action?.content ?? '');
      setTarget(action?.target ?? 'CHANNEL');
      setTargetName(action?.targetName ?? '');
      setEmailTo(action?.emailTo ?? '');
      setEmailCc(action?.emailCc ?? '');
      setEmailSubject(action?.emailSubject ?? '');
      setEmailReplyTo(action?.emailReplyTo ?? '');
      setUrl(action?.url ?? '');
      setMethod(action?.method ?? 'GET');
      setHeaders(action?.headers ?? '');
      setHeaderRows(loadedRows(action));
      setHeadersReadable(action?.headersReadable ?? true);
      setFunctionId(action?.functionId ?? '');
      setNewFunctionName(NEW_FUNCTION_NAME);
      setMappings(action?.mappings ?? []);
      setConditionExpression(action?.conditionExpression ?? '');
      setConditionId(action?.conditionId ?? '');
      setTimeoutSeconds(String(action?.timeoutSeconds ?? 3600));
      setRetryIntervalSeconds(String(action?.retryIntervalSeconds ?? 30));
      setDurationSeconds(String(action?.durationSeconds ?? 60));
      setIcon(action?.icon ?? null);
      setError(null);
      setSubmitting(false);
      if (placement === 'panel') dialog.show();
      else dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, action]);

  /*
   * The three catalogues this dialog picks from, asked for when it opens.
   *
   * All three used to end `.catch(() => setX([]))`, so a dialog opened against
   * a server that had stopped answering said *None set up yet* under every
   * picker - an invitation to go and make what the workspace already has.
   */
  const idle = !open || workspaceId === '';
  const connectionCatalogue = useCatalogue(
    'connections',
    () => fetchWorkspaceConnections(workspaceId),
    [open, workspaceId],
    {
      skip: idle,
      // The first one is the default, but only where nothing has been picked.
      onLoaded: (held) => setConnectionId((current) => (current === '' ? (held[0]?.id ?? '') : current)),
    },
  );
  const functionCatalogue = useCatalogue<WorkspaceFunction>(
    'functions',
    async () => (await fetchWorkspaceFunctions(workspaceId, 0, FUNCTION_PAGE_SIZE)).content,
    [open, workspaceId],
    { skip: idle },
  );
  const conditionCatalogue = useCatalogue<Condition>(
    'conditions',
    async () => (await fetchWorkspaceConditions(workspaceId, 0, FUNCTION_PAGE_SIZE)).content,
    [open, workspaceId],
    { skip: idle },
  );
  /*
   * The fourth, and only for a request: a header value may name one of these
   * instead of holding a token, and nothing else in this form can. Asked for
   * when the subtype is one, so opening a Send Email costs no query for a list
   * it would never offer.
   */
  const variableCatalogue = useCatalogue<Variable>(
    'variables',
    async () => (await fetchVariables(workspaceId, { size: VARIABLE_PAGE_SIZE })).content,
    [open, workspaceId, subtype],
    { skip: idle || subtype !== 'HTTP_REQUEST' },
  );

  const connections: WorkspaceConnection[] = connectionCatalogue.items;
  const functions: WorkspaceFunction[] = functionCatalogue.items;
  const conditions: Condition[] = conditionCatalogue.items;
  const variables: Variable[] = variableCatalogue.items;

  /**
   * The connections a mail may go through, which is the mail servers and nothing
   * else. Offering a Slack connection here would save cleanly and be refused by
   * the server, which is a slower way to learn the same thing.
   */
  const mailConnections = useMemo(
    () => connections.filter((candidate) => candidate.type === 'SMTP'),
    [connections],
  );

  const chosenFunction = useMemo(
    () => functions.find((candidate) => candidate.id === functionId) ?? null,
    [functions, functionId],
  );

  /*
   * What each picker offers, with a second line saying which one this is.
   *
   * The hint is searched alongside the name, so a function can be found by an
   * argument it takes and a condition by what it asks - which is how somebody
   * who has forgotten the name still knows the one they mean.
   */
  const connectionOptions = useMemo(
    () => connections.map((held) => ({ value: held.id, label: held.name, hint: held.effectiveUrl })),
    [connections],
  );

  const mailConnectionOptions = useMemo(
    () => mailConnections.map((held) => ({ value: held.id, label: held.name, hint: held.effectiveUrl })),
    [mailConnections],
  );

  const functionOptions = useMemo(
    () => functions.map((held) => ({ value: held.id, label: held.name, hint: held.signature })),
    [functions],
  );

  const conditionOptions = useMemo(
    () => conditions.map((held) => ({ value: held.id, label: held.name, hint: held.description })),
    [conditions],
  );

  // The arguments to map are the chosen function's, in the order it takes them.
  // Empty by default: an argument nobody fills in is taken from the field of
  // that name, which is what a workflow wants nearly every time.
  useEffect(() => {
    if (subtype !== 'FUNCTION') return;
    if (chosenFunction === null) {
      // A function still being named takes nothing, so the rows belonging to
      // whatever was picked before it would otherwise be saved against it.
      if (functionId === NEW_FUNCTION) setMappings([]);
      return;
    }
    setMappings((current) =>
      chosenFunction.params.map((param) => ({
        argument: param.name,
        expression: current.find((mapping) => mapping.argument === param.name)?.expression ?? '',
      })),
    );
  }, [subtype, chosenFunction, functionId]);

  function changeType(next: ActionType) {
    setType(next);
    setSubtype(SUBTYPES_BY_TYPE[next][0]);
  }

  /**
   * Whether the connection picked is one this subtype can use.
   *
   * The picker remembers what was chosen when the subtype changes, so switching
   * from a Slack send to a mail leaves a Slack connection selected against a
   * field that no longer offers it.
   */
  const connectionUsable =
    connectionId !== '' &&
    (subtype !== 'SEND_EMAIL' || mailConnections.some((candidate) => candidate.id === connectionId));

  /* ------------------------------------------- what the connection can see */

  /**
   * The Slack connection this action would send through, or null.
   *
   * Only Slack is asked. The server answers about any connection - it says a
   * mail server is a mail server and that only Slack can be asked about a user
   * or a channel - but that is a sentence about the picker two fields up, under
   * a field it is not about, fetched afresh on every keystroke to say the same
   * thing each time.
   */
  const slackConnection = useMemo(
    () => connections.find((held) => held.id === connectionId && held.type === 'SLACK') ?? null,
    [connections, connectionId],
  );

  /**
   * Whether this field is one that can be asked about at all.
   *
   * Read here as well as inside the box, because the field points its
   * `aria-describedby` at a box that is only there when there is something to
   * describe it with.
   */
  const asking = subtype === 'OUTGOING_CONNECTION' && slackConnection !== null;

  const complete =
    name.trim() !== '' &&
    (subtype === 'OUTGOING_CONNECTION' || subtype === 'SEND_EMAIL'
      ? connectionUsable
      : subtype === 'HTTP_REQUEST'
        ? url.trim() !== ''
        : subtype === 'FUNCTION'
          ? functionId !== '' && (functionId !== NEW_FUNCTION || validFunctionName(newFunctionName))
          : subtype === 'INLINE_CONDITION'
            ? conditionExpression.trim() !== ''
            : subtype === 'CONDITION'
              ? conditionId !== ''
              : Number(durationSeconds) > 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      /*
       * Named in the picker, made here, before the action that points at it.
       *
       * An action holding the id of something that does not exist is a broken
       * action, so the function goes in first and the action gets a real id or
       * nothing at all. It starts from the server's stub, which runs and returns
       * a map - enough for a workflow to be drawn through it, with the code
       * written afterwards in the function editor.
       */
      let chosen = functionId;
      if (subtype === 'FUNCTION' && functionId === NEW_FUNCTION) {
        chosen = (await createFunction({ workspaceId, name: newFunctionName.trim() })).id;
      }

      const settings = {
        name: name.trim(),
        subtype,
        connectionId: subtype === 'OUTGOING_CONNECTION' || subtype === 'SEND_EMAIL' ? connectionId : null,
        connectionAction: subtype === 'OUTGOING_CONNECTION' ? connectionAction : null,
        // A mail's body is the same column a message's text is, which is why one
        // field feeds both.
        content: subtype === 'OUTGOING_CONNECTION' || subtype === 'SEND_EMAIL' ? content : null,
        target: subtype === 'OUTGOING_CONNECTION' ? target : null,
        targetName: subtype === 'OUTGOING_CONNECTION' ? targetName : null,
        emailTo: subtype === 'SEND_EMAIL' ? emailTo : null,
        emailCc: subtype === 'SEND_EMAIL' ? emailCc : null,
        emailSubject: subtype === 'SEND_EMAIL' ? emailSubject : null,
        emailReplyTo: subtype === 'SEND_EMAIL' ? emailReplyTo : null,
        url: subtype === 'HTTP_REQUEST' ? url.trim() : null,
        method: subtype === 'HTTP_REQUEST' ? method : null,
        /*
         * Rows when the form was editing rows, the text when it was editing
         * text. Only one of the two is ever sent, so mending a blob by hand
         * cannot be undone by a set of rows the form never showed, and saving
         * rows cannot quietly restore a blob nobody meant to keep.
         */
        headers: subtype === 'HTTP_REQUEST' && !headersReadable ? headers : null,
        headerRows: subtype === 'HTTP_REQUEST' && headersReadable ? sentRows(headerRows) : undefined,
        functionId: subtype === 'FUNCTION' ? chosen : null,
        mappings: subtype === 'FUNCTION' ? mappings : [],
        conditionExpression: subtype === 'INLINE_CONDITION' ? conditionExpression.trim() : null,
        conditionId: subtype === 'CONDITION' ? conditionId : null,
        timeoutSeconds:
          subtype === 'CONDITION' || subtype === 'INLINE_CONDITION' ? Number(timeoutSeconds) : null,
        retryIntervalSeconds:
          subtype === 'CONDITION' || subtype === 'INLINE_CONDITION' ? Number(retryIntervalSeconds) : null,
        durationSeconds: subtype === 'TIME' ? Number(durationSeconds) : null,
        icon,
      };

      const saved = editing
        ? await updateAction(action.id, settings)
        : await createAction({ workspaceId, type, ...settings });
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the action.');
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (action === null) return;
    setSubmitting(true);
    try {
      await deleteAction(action.id);
      onDeleted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the action.');
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.dialogWide} ${placement === 'panel' ? styles.dialogPanel : ''}`}
      onCancel={onClose}
      onClose={onClose}
      onKeyDown={panelEscape(placement, onClose)}
    >
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{editing ? 'Action Settings' : 'Create Action'}</h2>
          {placement === 'panel' && <PanelClose onClose={onClose} />}
        </header>

        <p className={styles.dialogMessage}>Define a reusable action block for workflows.</p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="action-name">
              Action Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="action-name"
                name="actionName"
                className={styles.input}
                type="text"
                placeholder="e.g. Send Slack Notification"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <IconField
            value={icon}
            onChange={setIcon}
            hint="Nodes drawn from this action start with it; each node can change its own."
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="action-type">
              Type
            </label>
            <div className={styles.inputWrapper}>
              <select
                id="action-type"
                name="type"
                className={`${styles.input} ${styles.select}`}
                value={type}
                onChange={(event) => changeType(event.target.value as ActionType)}
                // What an action is does not change; its settings do.
                disabled={editing}
              >
                {(['EXECUTE', 'WAIT'] as ActionType[]).map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {ACTION_TYPE_LABEL[candidate]}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="action-subtype">
              {type === 'EXECUTE' ? 'Execute Type' : 'Until'}
            </label>
            <div className={styles.inputWrapper}>
              <select
                id="action-subtype"
                name="subtype"
                className={`${styles.input} ${styles.select}`}
                value={subtype}
                onChange={(event) => setSubtype(event.target.value as ActionSubtype)}
              >
                {SUBTYPES_BY_TYPE[type].map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {ACTION_SUBTYPE_LABEL[candidate]}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>

          {subtype === 'OUTGOING_CONNECTION' && (
            <>
              <div className={styles.field}>
                {/*
                  A connection is a definition, and the picker only says its
                  name: whether this is the right one is a question about the
                  URL and the credentials behind it, which are on its own page.
                  A tab of its own, so going to check does not throw away a form
                  that has not been saved.
                */}
                <span className={styles.labelRow}>
                  <span className={styles.labelWithHint}>
                    <label className={styles.label} htmlFor="action-connection">
                      Connection
                    </label>
                    <FieldHint label="Connection">
                      A connection set up under this workspace&apos;s Integrations, which is where the
                      credentials for it live. This picks which one the message goes through.
                    </FieldHint>
                  </span>
                  {connectionId !== '' && (
                    <Link
                      className={styles.jump}
                      to={`/workspace/${workspaceId}/integrations/connections/${connectionId}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Opens the connection in a new tab"
                      aria-label="Open the connection's definition"
                    >
                      <OpenDefinitionIcon />
                    </Link>
                  )}
                </span>
                <DefinitionPicker
                  id="action-connection"
                  value={connectionId}
                  options={connectionOptions}
                  onChoose={setConnectionId}
                  placeholder="Select connection…"
                  searchPlaceholder="Search connections…"
                  failure={connectionCatalogue.failure}
                />
                {/* Nothing to make from here: a connection is a URL, a token and a
                    handshake with the service, none of which can be got from a
                    name. What is left printed is the empty state - what the field
                    has instead of contents - and where they come from went behind
                    the (?), which is a question rather than a fact about now. */}
                <CatalogueNote catalogue={connectionCatalogue} className={styles.fieldHint} empty="None set up yet." />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-connection-action">
                  Action
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="action-connection-action"
                    className={`${styles.input} ${styles.select}`}
                    value={connectionAction}
                    onChange={(event) => setConnectionAction(event.target.value as ConnectionActionKind)}
                  >
                    {CONNECTION_ACTIONS.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {CONNECTION_ACTION_LABEL[candidate]}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="action-content">
                    Content
                  </label>
                  <FieldHint label="Content">
                    Sent exactly as written. Leave it empty and each node says what to send.
                  </FieldHint>
                </span>
                <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
                  <textarea
                    id="action-content"
                    className={`${styles.input} ${styles.textarea}`}
                    placeholder="Your request has been approved"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-target">
                  Target
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="action-target"
                    className={`${styles.input} ${styles.select}`}
                    value={target}
                    onChange={(event) => setTarget(event.target.value as MessageTarget)}
                  >
                    <option value="CHANNEL">Channel</option>
                    <option value="USER">User</option>
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-target-name">
                  {target === 'CHANNEL' ? 'Channel Name' : 'User'}
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="action-target-name"
                    className={styles.input}
                    type="text"
                    placeholder={target === 'CHANNEL' ? '#notifications' : '@someone'}
                    value={targetName}
                    aria-describedby={asking ? 'action-target-answer' : undefined}
                    onChange={(event) => setTargetName(event.target.value)}
                  />
                </div>
                {/*
                  What the connection can see, under the field, as it is typed.

                  In the open rather than behind the (?) for the reason the cron
                  reading is: an explanation of a field is teaching and hides,
                  while this is the result of what somebody just typed, which
                  the rules file keeps visible beside an error and a status.

                  The box itself is shared with the workflow editor's node
                  panel, which asks the same question about the `target` one
                  step binds. Everything that had to be alike in the two - the
                  server's sentence printed as it arrives, the three colours,
                  the pause, the room kept for the answer - is alike by being
                  one piece of code rather than by being remembered twice.

                  None of it refuses anything. `complete` above does not read
                  this, the field stays free text, and Save stays live on every
                  outcome - because a NOT_FOUND is as often a private channel
                  this bot was never invited to, or somebody who joined a minute
                  ago, as it is a typo.
                */}
                <SlackTargetAnswer
                  id="action-target-answer"
                  className={styles.fieldHint}
                  connectionId={asking ? slackConnection?.id ?? null : null}
                  target={target}
                  name={targetName}
                />
              </div>
            </>
          )}

          {subtype === 'SEND_EMAIL' && (
            <>
              <div className={styles.field}>
                {/* The same reason as the connection above: this is a definition,
                    and the host, the port and the from-address it sends under are
                    on its page rather than in this list. Only while the picker is
                    on one this subtype can use - the field shows nothing when a
                    Slack connection is left over from another subtype, and a link
                    to what is not selected would point somewhere nobody chose. */}
                <span className={styles.labelRow}>
                  <span className={styles.labelWithHint}>
                    <label className={styles.label} htmlFor="action-mail-connection">
                      Mail Server
                    </label>
                    <FieldHint label="Mail Server">
                      An SMTP connection from this workspace&apos;s integrations. The from-address is
                      the connection&apos;s, so every mail sent through it agrees about who it is from.
                    </FieldHint>
                  </span>
                  {connectionUsable && (
                    <Link
                      className={styles.jump}
                      to={`/workspace/${workspaceId}/integrations/connections/${connectionId}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Opens the mail server's connection in a new tab"
                      aria-label="Open the mail server's definition"
                    >
                      <OpenDefinitionIcon />
                    </Link>
                  )}
                </span>
                {/* Nothing to make from here: a mail server is a host, a port and
                    credentials, none of which can be got from a name - so this
                    says where they are set up instead. */}
                <DefinitionPicker
                  id="action-mail-connection"
                  value={connectionUsable ? connectionId : ''}
                  options={mailConnectionOptions}
                  onChoose={setConnectionId}
                  placeholder={
                    mailConnections.length === 0
                      ? 'No mail connection in this workspace'
                      : 'Select connection…'
                  }
                  searchPlaceholder="Search mail servers…"
                  failure={connectionCatalogue.failure}
                />
              </div>

              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="action-mail-to">
                    To
                  </label>
                  <FieldHint label="To">
                    Sent exactly as written. Leave it empty and each node says who the mail goes to.
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <input
                    id="action-mail-to"
                    className={styles.input}
                    type="text"
                    placeholder="someone@example.com, someone-else@example.com"
                    value={emailTo}
                    onChange={(event) => setEmailTo(event.target.value)}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-mail-subject">
                  Subject
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="action-mail-subject"
                    className={styles.input}
                    type="text"
                    placeholder="Your request has been approved"
                    value={emailSubject}
                    onChange={(event) => setEmailSubject(event.target.value)}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="action-mail-body">
                    Body
                  </label>
                  <FieldHint label="Body">
                    Plain text. Leave it empty and each node says what the mail says.
                  </FieldHint>
                </span>
                <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
                  <textarea
                    id="action-mail-body"
                    className={`${styles.input} ${styles.textarea}`}
                    placeholder="Your request has been approved."
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-mail-cc">
                  Cc
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="action-mail-cc"
                    className={styles.input}
                    type="text"
                    placeholder="Optional"
                    value={emailCc}
                    onChange={(event) => setEmailCc(event.target.value)}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-mail-reply-to">
                  Reply To
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="action-mail-reply-to"
                    className={styles.input}
                    type="text"
                    placeholder="Optional; answers go to the from-address otherwise"
                    value={emailReplyTo}
                    onChange={(event) => setEmailReplyTo(event.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {subtype === 'HTTP_REQUEST' && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-url">
                  URL
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="action-url"
                    className={styles.input}
                    type="text"
                    placeholder="https://api.example.com/data"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-method">
                  Method
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="action-method"
                    className={`${styles.input} ${styles.select}`}
                    value={method}
                    onChange={(event) => setMethod(event.target.value)}
                  >
                    {HTTP_METHODS.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {candidate}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>

              {/*
                Rows, with a source per row - the connection dialog's builder and
                the plugin parameters' switch, which both already existed. The
                textarea it replaces asked somebody to type JSON by hand and gave
                a bearer token nowhere to live but in the clear.

                Unless nobody can read what is stored. Then the text itself is
                offered back, because the row editor cannot show a blob and an
                action nobody can mend is worse than a textarea.
              */}
              <div className={styles.field}>
                {headersReadable ? (
                  <HeaderRowsEditor
                    headers={headerRows}
                    onChange={setHeaderRows}
                    heading="Headers"
                    variables={variables}
                    compact
                  />
                ) : (
                  <>
                    <span className={styles.labelRow}>
                      <label className={styles.label} htmlFor="action-headers">
                        Headers
                      </label>
                      <FieldHint label="Headers">
                        What is stored for this action is not readable as JSON, so it sends no headers at all -
                        which is what it has been doing. Correct it here and it becomes rows the next time this
                        opens; empty it and the action sends none on purpose.
                      </FieldHint>
                    </span>
                    <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
                      <textarea
                        id="action-headers"
                        className={`${styles.input} ${styles.textarea} ${styles.inputMono}`}
                        placeholder={'{ "Authorization": "Bearer …" }'}
                        value={headers}
                        onChange={(event) => setHeaders(event.target.value)}
                      />
                    </div>
                  </>
                )}
                <CatalogueNote catalogue={variableCatalogue} className={styles.fieldHint} />
              </div>
            </>
          )}

          {subtype === 'FUNCTION' && (
            <>
              <div className={styles.field}>
                {/* The code this action runs, which the picker names and the
                    signature beside it summarises. Nothing to open while the
                    picker is on a name: the function is created when the action
                    is saved, not before. */}
                <span className={styles.labelRow}>
                  <label className={styles.label} htmlFor="action-function">
                    Function
                  </label>
                  {functionId !== '' && functionId !== NEW_FUNCTION && (
                    <Link
                      className={styles.jump}
                      to={`/workspace/${workspaceId}/functions/${functionId}`}
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
                  id="action-function"
                  value={functionId}
                  options={functionOptions}
                  onChoose={setFunctionId}
                  placeholder="Select function…"
                  searchPlaceholder="Search functions…"
                  create={NEW_FUNCTION_ROW}
                  failure={functionCatalogue.failure}
                />
                {functionId === NEW_FUNCTION && (
                  <>
                    <div className={styles.inputWrapper}>
                      <input
                        id="action-new-function"
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
                    {/*
                      Printed rather than behind the (?), for two reasons. It is
                      a consequence - saving this form writes a function into the
                      workspace, which is worth knowing before pressing Create
                      rather than after wondering where it came from. And the box
                      it belongs to has no visible label to hang a (?) on: the
                      only label above it says Function, which is the picker's.
                    */}
                    <p className={styles.fieldHint}>
                      Created with this action, taking nothing and returning a map. Open it in Functions to
                      write what it does.
                    </p>
                  </>
                )}
              </div>

              <div className={styles.field}>
                {/*
                  On the heading, because the block below it is a row per
                  argument rather than one field: there is no single label the
                  rule about empty rows belongs to.
                */}
                <p className={styles.paramHeading}>
                  <span className={styles.labelWithHint}>
                    Parameters Mapping
                    <FieldHint label="Parameters Mapping">
                      Left empty, an argument is taken from the field of that name. Anything typed
                      here is passed as it stands.
                    </FieldHint>
                  </span>
                </p>
                <div className={styles.mappingList}>
                  {mappings.map((mapping, index) => (
                    <div key={mapping.argument} className={styles.mappingRow}>
                      <span className={styles.mappingArgument}>{mapping.argument}</span>
                      <div className={styles.inputWrapper}>
                        <input
                          className={`${styles.input} ${styles.inputMono}`}
                          type="text"
                          value={mapping.expression}
                          aria-label={`Value for ${mapping.argument}`}
                          onChange={(event) =>
                            setMappings((current) =>
                              current.map((row, at) =>
                                at === index ? { ...row, expression: event.target.value } : row,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                  {/* A reading of the function that was chosen, not a note about
                      the block: it is what these rows have instead of contents. */}
                  {mappings.length === 0 && (
                    <p className={styles.fieldHint}>This function takes no arguments.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {subtype === 'CONDITION' && (
            <div className={styles.field}>
              {/* What this action waits for is a definition, and what it
                  actually checks is on its page: the picker only has room for a
                  name and a description. */}
              <span className={styles.labelRow}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="action-saved-condition">
                    Condition
                  </label>
                  <FieldHint label="Condition">
                    A condition defined in Conditions, or one made here. The action waits until it
                    holds, checking again every retry interval until the timeout runs out.
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
                id="action-saved-condition"
                value={conditionId}
                options={conditionOptions}
                onChoose={(picked) => {
                  // The row is an instruction rather than an answer: nothing is
                  // stored until the dialog it opens comes back with a real id.
                  if (picked === NEW_CONDITION) setMakingCondition(true);
                  else setConditionId(picked);
                }}
                placeholder="Select condition…"
                searchPlaceholder="Search conditions…"
                create={NEW_CONDITION_ROW}
                failure={conditionCatalogue.failure}
              />
              {/* The empty state stays where the missing contents would be; what
                  the field is for went behind the (?) above it. */}
              <CatalogueNote
                catalogue={conditionCatalogue}
                className={styles.fieldHint}
                empty="None defined yet. Make one here."
              />
            </div>
          )}

          {(subtype === 'CONDITION' || subtype === 'INLINE_CONDITION') && (
            <>
              {subtype === 'INLINE_CONDITION' && (
              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="action-condition">
                    Expression
                  </label>
                  <FieldHint label="Expression">
                    JavaScript over what the previous node produced.
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <input
                    id="action-condition"
                    className={`${styles.input} ${styles.inputMono}`}
                    type="text"
                    placeholder="input.approved === true"
                    value={conditionExpression}
                    onChange={(event) => setConditionExpression(event.target.value)}
                    required
                  />
                </div>
              </div>
              )}

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-timeout">
                  Timeout
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="action-timeout"
                    className={styles.input}
                    type="number"
                    min={1}
                    value={timeoutSeconds}
                    onChange={(event) => setTimeoutSeconds(event.target.value)}
                  />
                </div>
                {/*
                  The unit stays printed, here and on the two below it. A number
                  box says nothing about what its number counts, and these three
                  lines are the only thing that does - behind a hover, somebody
                  types 30 meaning minutes and finds out half a minute later.
                */}
                <p className={styles.fieldHint}>Timeout in seconds</p>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-retry">
                  Retry Interval
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="action-retry"
                    className={styles.input}
                    type="number"
                    min={1}
                    value={retryIntervalSeconds}
                    onChange={(event) => setRetryIntervalSeconds(event.target.value)}
                  />
                </div>
                <p className={styles.fieldHint}>Seconds between condition checks</p>
              </div>
            </>
          )}

          {subtype === 'TIME' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="action-duration">
                Duration
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="action-duration"
                  className={styles.input}
                  type="number"
                  min={1}
                  value={durationSeconds}
                  onChange={(event) => setDurationSeconds(event.target.value)}
                  required
                />
              </div>
              <p className={styles.fieldHint}>How long to wait, in seconds</p>
            </div>
          )}

          {editing && (
            <>
              <div className={styles.field}>
                <p className={styles.paramHeading}>Input Parameters</p>
                <ParamList params={action.inputParams.map((param) => param.display)} />
              </div>
              <div className={styles.field}>
                <p className={styles.paramHeading}>Output Parameters</p>
                <ParamList params={action.outputParams.map((param) => param.display)} />
              </div>
            </>
          )}
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          {editing && (
            <button
              type="button"
              className={styles.danger}
              onClick={handleDelete}
              disabled={submitting}
            >
              Delete
            </button>
          )}
          <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className={styles.filled} disabled={!complete || submitting}>
            {submitting ? 'Saving…' : editing ? 'Save Changes' : 'Create Action'}
          </button>
        </div>
      </form>

      {/*
        Beside the form rather than inside it, and only while it is open.
        A form nested in a form is not something a browser will keep apart: the
        inner dialog's submit would bubble into this one's handler and save the
        action somebody is still filling in.
      */}
      {makingCondition && (
        <ConditionDialog
          open
          workspaceId={workspaceId}
          condition={null}
          onClose={() => setMakingCondition(false)}
          onSaved={(made) => {
            // Into this dialog's own list as well as into the field: the picker
            // has to be able to show what was just chosen, and nothing is going
            // to fetch the conditions again while this stays open.
            conditionCatalogue.add(made);
            setConditionId(made.id);
            setMakingCondition(false);
          }}
        />
      )}
    </dialog>
  );
}

/** What the action needs or produces, read off its settings by the server. */
function ParamList({ params }: { params: string[] }) {
  // An empty state: what the list has instead of rows, so it stays where the
  // rows would have been.
  if (params.length === 0) return <p className={styles.fieldHint}>None.</p>;
  return (
    <ul className={styles.paramList}>
      {params.map((param) => (
        <li key={param} className={styles.paramRow}>
          {param}
        </li>
      ))}
    </ul>
  );
}
