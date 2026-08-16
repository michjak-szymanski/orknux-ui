import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

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
  ActionSubtype,
  ActionType,
  ArgumentMapping,
  ConnectionActionKind,
  MessageTarget,
} from '../api/actions';
import { fetchWorkspaceConditions } from '../api/conditions';
import type { Condition } from '../api/conditions';
import { fetchWorkspaceFunctions } from '../api/functions';
import type { WorkspaceFunction } from '../api/functions';
import { fetchWorkspaceConnections } from '../api/integrations';
import type { WorkspaceConnection } from '../api/integrations';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import { IconField } from './IconField';
import styles from './Dialog.module.css';

export interface ActionDialogProps {
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
export function ActionDialog({ open, workspaceId, action, onClose, onSaved, onDeleted }: ActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<ActionType>('EXECUTE');
  const [subtype, setSubtype] = useState<ActionSubtype>('OUTGOING_CONNECTION');
  const [connectionId, setConnectionId] = useState('');
  const [connectionAction, setConnectionAction] = useState<ConnectionActionKind>('SEND_MESSAGE');
  const [content, setContent] = useState('');
  const [target, setTarget] = useState<MessageTarget>('CHANNEL');
  const [targetName, setTargetName] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [headers, setHeaders] = useState('');
  const [functionId, setFunctionId] = useState('');
  const [mappings, setMappings] = useState<ArgumentMapping[]>([]);
  const [conditionExpression, setConditionExpression] = useState('');
  const [conditionId, setConditionId] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState('3600');
  const [retryIntervalSeconds, setRetryIntervalSeconds] = useState('30');
  const [durationSeconds, setDurationSeconds] = useState('60');
  const [icon, setIcon] = useState<string | null>(null);

  const [connections, setConnections] = useState<WorkspaceConnection[]>([]);
  const [functions, setFunctions] = useState<WorkspaceFunction[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setUrl(action?.url ?? '');
      setMethod(action?.method ?? 'GET');
      setHeaders(action?.headers ?? '');
      setFunctionId(action?.functionId ?? '');
      setMappings(action?.mappings ?? []);
      setConditionExpression(action?.conditionExpression ?? '');
      setConditionId(action?.conditionId ?? '');
      setTimeoutSeconds(String(action?.timeoutSeconds ?? 3600));
      setRetryIntervalSeconds(String(action?.retryIntervalSeconds ?? 30));
      setDurationSeconds(String(action?.durationSeconds ?? 60));
      setIcon(action?.icon ?? null);
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, action]);

  useEffect(() => {
    if (!open || workspaceId === '') return;

    fetchWorkspaceConnections(workspaceId)
      .then((held) => {
        setConnections(held);
        setConnectionId((current) => (current === '' ? (held[0]?.id ?? '') : current));
      })
      .catch(() => setConnections([]));

    fetchWorkspaceFunctions(workspaceId, 0, FUNCTION_PAGE_SIZE)
      .then((page) => setFunctions(page.content))
      .catch(() => setFunctions([]));

    fetchWorkspaceConditions(workspaceId, 0, FUNCTION_PAGE_SIZE)
      .then((page) => setConditions(page.content))
      .catch(() => setConditions([]));
  }, [open, workspaceId]);

  const chosenFunction = useMemo(
    () => functions.find((candidate) => candidate.id === functionId) ?? null,
    [functions, functionId],
  );

  // The arguments to map are the chosen function's, in the order it takes them.
  // Empty by default: an argument nobody fills in is taken from the field of
  // that name, which is what a workflow wants nearly every time.
  useEffect(() => {
    if (subtype !== 'FUNCTION' || chosenFunction === null) return;
    setMappings((current) =>
      chosenFunction.params.map((param) => ({
        argument: param.name,
        expression: current.find((mapping) => mapping.argument === param.name)?.expression ?? '',
      })),
    );
  }, [subtype, chosenFunction]);

  function changeType(next: ActionType) {
    setType(next);
    setSubtype(SUBTYPES_BY_TYPE[next][0]);
  }

  const complete =
    name.trim() !== '' &&
    (subtype === 'OUTGOING_CONNECTION'
      ? connectionId !== ''
      : subtype === 'HTTP_REQUEST'
        ? url.trim() !== ''
        : subtype === 'FUNCTION'
          ? functionId !== ''
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
    const settings = {
      name: name.trim(),
      subtype,
      connectionId: subtype === 'OUTGOING_CONNECTION' ? connectionId : null,
      connectionAction: subtype === 'OUTGOING_CONNECTION' ? connectionAction : null,
      content: subtype === 'OUTGOING_CONNECTION' ? content : null,
      target: subtype === 'OUTGOING_CONNECTION' ? target : null,
      targetName: subtype === 'OUTGOING_CONNECTION' ? targetName : null,
      url: subtype === 'HTTP_REQUEST' ? url.trim() : null,
      method: subtype === 'HTTP_REQUEST' ? method : null,
      headers: subtype === 'HTTP_REQUEST' ? headers : null,
      functionId: subtype === 'FUNCTION' ? functionId : null,
      mappings: subtype === 'FUNCTION' ? mappings : [],
      conditionExpression: subtype === 'INLINE_CONDITION' ? conditionExpression.trim() : null,
      conditionId: subtype === 'CONDITION' ? conditionId : null,
      timeoutSeconds: subtype === 'CONDITION' || subtype === 'INLINE_CONDITION' ? Number(timeoutSeconds) : null,
      retryIntervalSeconds:
        subtype === 'CONDITION' || subtype === 'INLINE_CONDITION' ? Number(retryIntervalSeconds) : null,
      durationSeconds: subtype === 'TIME' ? Number(durationSeconds) : null,
      icon,
    };

    try {
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
      className={`${styles.dialog} ${styles.dialogWide}`}
      onCancel={onClose}
      onClose={onClose}
    >
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{editing ? 'Action Settings' : 'Create Action'}</h2>
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
                <label className={styles.label} htmlFor="action-connection">
                  Connection
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="action-connection"
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
                <label className={styles.label} htmlFor="action-content">
                  Content
                </label>
                <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
                  <textarea
                    id="action-content"
                    className={`${styles.input} ${styles.textarea}`}
                    placeholder="Your request has been approved"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                  />
                </div>
                <p className={styles.fieldHint}>
                  Sent exactly as written. Leave it empty and each node says what to send.
                </p>
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
                    onChange={(event) => setTargetName(event.target.value)}
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

              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-headers">
                  Headers
                </label>
                <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
                  <textarea
                    id="action-headers"
                    className={`${styles.input} ${styles.textarea} ${styles.inputMono}`}
                    placeholder={'{ "Authorization": "Bearer …" }'}
                    value={headers}
                    onChange={(event) => setHeaders(event.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {subtype === 'FUNCTION' && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-function">
                  Function
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="action-function"
                    className={`${styles.input} ${styles.select}`}
                    value={functionId}
                    onChange={(event) => setFunctionId(event.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select function...
                    </option>
                    {functions.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>

              <div className={styles.field}>
                <p className={styles.paramHeading}>Parameters Mapping</p>
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
                  {mappings.length === 0 && (
                    <p className={styles.fieldHint}>This function takes no arguments.</p>
                  )}
                </div>
                <p className={styles.fieldHint}>
                  Left empty, an argument is taken from the field of that name. Anything typed here is
                  passed as it stands.
                </p>
              </div>
            </>
          )}

          {subtype === 'CONDITION' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="action-saved-condition">
                Condition
              </label>
              <div className={styles.inputWrapper}>
                <select
                  id="action-saved-condition"
                  className={`${styles.input} ${styles.select}`}
                  value={conditionId}
                  onChange={(event) => setConditionId(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select condition...
                  </option>
                  {conditions.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </div>
              <p className={styles.fieldHint}>Select a condition defined in Conditions</p>
            </div>
          )}

          {(subtype === 'CONDITION' || subtype === 'INLINE_CONDITION') && (
            <>
              {subtype === 'INLINE_CONDITION' && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="action-condition">
                  Expression
                </label>
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
                <p className={styles.fieldHint}>JavaScript over what the previous node produced.</p>
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
    </dialog>
  );
}

/** What the action needs or produces, read off its settings by the server. */
function ParamList({ params }: { params: string[] }) {
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
