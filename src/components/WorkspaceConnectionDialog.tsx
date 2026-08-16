import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { authTypeLabel, createWorkspaceConnection } from '../api/integrations';
import type { AuthType, ConnectionType, HttpHeader, WorkspaceConnection } from '../api/integrations';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './Dialog.module.css';
import { HeaderRowsEditor } from './HeaderRowsEditor';
import { RevealToggle } from './RevealToggle';

export interface WorkspaceConnectionDialogProps {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (connection: WorkspaceConnection) => void;
}

const TYPES: ConnectionType[] = ['SLACK_SOCKET_MODE', 'SLACK', 'GITHUB', 'JIRA', 'WEBHOOK'];
const AUTH_TYPES: AuthType[] = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC'];

const TYPE_LABELS: Record<ConnectionType, string> = {
  SLACK_SOCKET_MODE: 'Slack (Socket Mode)',
  SLACK: 'Slack (outgoing only)',
  GITHUB: 'GitHub',
  JIRA: 'Jira',
  WEBHOOK: 'Webhook',
};

/** Socket Mode always talks to the same place, so the URL is not asked for. */
const SLACK_API = 'https://slack.com/api';

/**
 * Add Connection, from the connection modals frame: the workspace's own connection.
 *
 * Slack over Socket Mode asks for what the listener actually needs — a bot
 * token to call the API with and an app-level token to open the websocket —
 * rather than the generic auth type and single secret, which cannot hold two
 * credentials.
 */
export function WorkspaceConnectionDialog({ open, workspaceId, onClose, onCreated }: WorkspaceConnectionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<ConnectionType | ''>('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<AuthType>('BEARER_TOKEN');
  const [secret, setSecret] = useState('');
  const [appToken, setAppToken] = useState('');
  /**
   * Whether the credentials are readable while they are being typed.
   *
   * A token is pasted more often than typed, and a dotted field hides a paste
   * that went wrong as effectively as it hides the token. Off by default,
   * because the dialog can be open on a shared screen.
   */
  // One per field: revealing a pasted bot token to check it says nothing about
  // wanting the app-level token on screen beside it.
  const [showSecret, setShowSecret] = useState(false);
  const [showAppToken, setShowAppToken] = useState(false);
  const [headers, setHeaders] = useState<HttpHeader[]>([{ name: '', value: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      setName('');
      setType('');
      setUrl('');
      setAuthType('BEARER_TOKEN');
      setSecret('');
      setAppToken('');
      setHeaders([{ name: '', value: '' }]);
      // Opened fresh, and hiding again: the last person to reveal a token did
      // not decide it for the next one.
      setShowSecret(false);
      setShowAppToken(false);
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const socketMode = type === 'SLACK_SOCKET_MODE';
  const complete =
    name.trim() !== '' &&
    type !== '' &&
    (socketMode ? secret.trim() !== '' && appToken.trim() !== '' : url.trim() !== '');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const created = await createWorkspaceConnection({
        workspaceId,
        name: name.trim(),
        type,
        url: socketMode ? SLACK_API : url.trim(),
        // Socket Mode calls the Web API with the bot token, which is a bearer.
        authType: socketMode ? 'BEARER_TOKEN' : authType,
        secret: secret.trim() || undefined,
        appToken: socketMode ? appToken.trim() : undefined,
        headers: socketMode ? [] : headers.filter((header) => header.name.trim() !== ''),
      });
      onCreated(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the connection.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.dialogWide}`} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>Add Connection</h2>
        </header>

        <p className={styles.dialogMessage}>Add a new connection to this workspace</p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-connection-name">
              Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="workspace-connection-name"
                name="connectionName"
                className={styles.input}
                type="text"
                placeholder="e.g. Slack"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-connection-type">
              Type
            </label>
            <div className={styles.inputWrapper}>
              <select
                id="workspace-connection-type"
                name="connectionType"
                className={`${styles.input} ${styles.select}`}
                value={type}
                onChange={(event) => setType(event.target.value as ConnectionType | '')}
                required
              >
                <option value="" disabled>
                  Select type...
                </option>
                {TYPES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {TYPE_LABELS[candidate]}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>

          {!socketMode && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-connection-url">
              URL
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="workspace-connection-url"
                name="connectionUrl"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder="https://"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required={!socketMode}
              />
            </div>
          </div>
          )}

          {socketMode && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="workspace-connection-bot-token">
                  Bot Token
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="workspace-connection-bot-token"
                    name="botToken"
                    className={`${styles.input} ${styles.inputMono}`}
                    type={showSecret ? 'text' : 'password'}
                    placeholder="xoxb-..."
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    required
                  />
                  <RevealToggle
                    shown={showSecret}
                    onToggle={() => setShowSecret((on) => !on)}
                    label="bot token"
                  />
                </div>
                <p className={styles.fieldHint}>
                  From OAuth &amp; Permissions. It needs app_mentions:read to see mentions, and
                  chat:write to answer them.
                </p>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="workspace-connection-app-token">
                  App-Level Token
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="workspace-connection-app-token"
                    name="appToken"
                    className={`${styles.input} ${styles.inputMono}`}
                    type={showAppToken ? 'text' : 'password'}
                    placeholder="xapp-..."
                    value={appToken}
                    onChange={(event) => setAppToken(event.target.value)}
                    required
                  />
                  <RevealToggle
                    shown={showAppToken}
                    onToggle={() => setShowAppToken((on) => !on)}
                    label="app-level token"
                  />
                </div>
                <p className={styles.fieldHint}>
                  From Basic Information, with connections:write. This is what opens the websocket
                  orknux listens on.
                </p>
              </div>
            </>
          )}

          {!socketMode && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-connection-auth">
              Auth Type
            </label>
            <div className={styles.inputWrapper}>
              <select
                id="workspace-connection-auth"
                name="authType"
                className={`${styles.input} ${styles.select}`}
                value={authType}
                onChange={(event) => setAuthType(event.target.value as AuthType)}
              >
                {AUTH_TYPES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {authTypeLabel(candidate)}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>
          )}

          {!socketMode && authType !== 'NONE' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="workspace-connection-secret">
                Token / Key
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="workspace-connection-secret"
                  name="secret"
                  className={styles.input}
                  type={showSecret ? 'text' : 'password'}
                  placeholder="Enter token or key..."
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                />
                <RevealToggle
                  shown={showSecret}
                  onToggle={() => setShowSecret((on) => !on)}
                  label="token"
                />
              </div>
            </div>
          )}


          {!socketMode && <HeaderRowsEditor headers={headers} onChange={setHeaders} compact />}
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className={styles.filled} disabled={!complete || submitting}>
            {submitting ? 'Adding…' : 'Add Connection'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
