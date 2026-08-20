import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { authTypeLabel, createWorkspaceConnection } from '../api/integrations';
import type { AuthType, ConnectionType, HttpHeader, MailSecurity, WorkspaceConnection } from '../api/integrations';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './Dialog.module.css';
import { FieldHint } from './FieldHint';
import { HeaderRowsEditor } from './HeaderRowsEditor';
import { RevealToggle } from './RevealToggle';

export interface WorkspaceConnectionDialogProps {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (connection: WorkspaceConnection) => void;
}

const TYPES: ConnectionType[] = ['SLACK', 'SMTP', 'GITHUB', 'JIRA', 'WEBHOOK'];
const AUTH_TYPES: AuthType[] = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC'];

const TYPE_LABELS: Record<ConnectionType, string> = {
  SLACK: 'Slack',
  SMTP: 'Email (SMTP)',
  GITHUB: 'GitHub',
  JIRA: 'Jira',
  WEBHOOK: 'Webhook',
};

/**
 * How the session is secured, and the port each one is listened for on.
 *
 * The port follows the choice rather than being asked for from nothing: somebody
 * who knows their server does STARTTLS knows it is 587, and the field is still
 * there to type over for the deployment where it is not.
 */
const SECURITY: { value: MailSecurity; label: string; port: number }[] = [
  { value: 'STARTTLS', label: 'STARTTLS', port: 587 },
  { value: 'TLS', label: 'TLS (implicit)', port: 465 },
  { value: 'NONE', label: 'None', port: 25 },
];

/**
 * Add Connection, from the connection modals frame: the workspace's own connection.
 *
 * Slack asks for what Slack actually needs — a bot token to call the API with,
 * and optionally an app-level token to open a websocket on — rather than the
 * generic auth type and single secret, which cannot hold two credentials.
 *
 * There used to be two Slack entries here, one that could only send and one that
 * could also listen, and choosing between them meant knowing which of Slack's
 * tokens you had before you had looked. There is one now: the app-level token is
 * what separates them, so leaving it out is how you say you only want to send.
 *
 * The URL, the auth type and the custom headers are not asked for either. The
 * server writes all three itself for a Slack connection and ignores whatever
 * arrives in them, so a form that demanded a URL was demanding it for nothing.
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
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpSecurity, setSmtpSecurity] = useState<MailSecurity>('STARTTLS');
  const [smtpPort, setSmtpPort] = useState('587');
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
      setSmtpUsername('');
      setSmtpFrom('');
      setSmtpSecurity('STARTTLS');
      setSmtpPort('587');
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

  const slack = type === 'SLACK';
  const mail = type === 'SMTP';
  const complete =
    name.trim() !== '' &&
    type !== '' &&
    (slack
      ? // The bot token alone. An app-level token is what makes the connection
        // listen as well as send, and a connection that only sends is a whole
        // half of what people use this for.
        secret.trim() !== ''
      : // A mail server has to be told who it sends as. The login is not
        // required: a relay inside a network often authenticates nobody.
        mail
        ? url.trim() !== '' && smtpFrom.trim() !== ''
        : url.trim() !== '');

  /** Changing how the session is secured moves the port with it, until it is typed over. */
  function changeSecurity(next: MailSecurity) {
    const previous = SECURITY.find((candidate) => candidate.value === smtpSecurity);
    setSmtpSecurity(next);
    if (smtpPort === '' || smtpPort === String(previous?.port)) {
      setSmtpPort(String(SECURITY.find((candidate) => candidate.value === next)?.port ?? ''));
    }
  }

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
        // Neither is sent for Slack: the server fills the URL and the auth type
        // in itself, last, so anything sent here would only be overwritten. A
        // mail server has a login of its own and no auth type to choose.
        url: slack ? undefined : url.trim(),
        authType: slack ? undefined : mail ? 'NONE' : authType,
        secret: secret.trim() || undefined,
        // Empty is a real answer here, and it means send-only.
        appToken: slack ? appToken.trim() || undefined : undefined,
        smtpPort: mail ? Number(smtpPort) : undefined,
        smtpUsername: mail ? smtpUsername.trim() || undefined : undefined,
        smtpFrom: mail ? smtpFrom.trim() : undefined,
        smtpSecurity: mail ? smtpSecurity : undefined,
        headers: slack || mail ? [] : headers.filter((header) => header.name.trim() !== ''),
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

          {!slack && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-connection-url">
              {/* A mail server is named, not addressed: there is no URL to type. */}
              {mail ? 'SMTP Host' : 'URL'}
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="workspace-connection-url"
                name="connectionUrl"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder={mail ? 'smtp.example.com' : 'https://'}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
            </div>
          </div>
          )}

          {mail && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="workspace-connection-security">
                  Security
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="workspace-connection-security"
                    name="smtpSecurity"
                    className={`${styles.input} ${styles.select}`}
                    value={smtpSecurity}
                    onChange={(event) => changeSecurity(event.target.value as MailSecurity)}
                  >
                    {SECURITY.map((candidate) => (
                      <option key={candidate.value} value={candidate.value}>
                        {candidate.label}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="workspace-connection-port">
                  Port
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="workspace-connection-port"
                    name="smtpPort"
                    className={`${styles.input} ${styles.inputMono}`}
                    type="number"
                    min={1}
                    max={65535}
                    value={smtpPort}
                    onChange={(event) => setSmtpPort(event.target.value)}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="workspace-connection-from">
                    From Address
                  </label>
                  <FieldHint label="From Address">
                    Every mail this connection sends is from this address, and a provider that has not
                    authorised it refuses the message however good the password is.
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <input
                    id="workspace-connection-from"
                    name="smtpFrom"
                    className={styles.input}
                    type="email"
                    placeholder="orknux@example.com"
                    value={smtpFrom}
                    onChange={(event) => setSmtpFrom(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="workspace-connection-username">
                  Username
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="workspace-connection-username"
                    name="smtpUsername"
                    className={styles.input}
                    type="text"
                    placeholder="Leave empty to send without authenticating"
                    value={smtpUsername}
                    onChange={(event) => setSmtpUsername(event.target.value)}
                  />
                </div>
              </div>

              {smtpUsername.trim() !== '' && (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="workspace-connection-password">
                    Password
                  </label>
                  <div className={styles.inputWrapper}>
                    <input
                      id="workspace-connection-password"
                      name="smtpPassword"
                      className={styles.input}
                      type={showSecret ? 'text' : 'password'}
                      placeholder="Enter password..."
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                    />
                    <RevealToggle
                      shown={showSecret}
                      onToggle={() => setShowSecret((on) => !on)}
                      label="password"
                    />
                  </div>
                  {/*
                    Printed rather than behind the (?): both halves are things to
                    know before typing, not afterwards. That it is never shown
                    again is why somebody keeps their own copy, and an account
                    password typed where an app password was wanted is refused by
                    the provider without saying which of the two it wanted.
                  */}
                  <p className={styles.fieldHint}>
                    Stored encrypted, and never shown again in the list. Many providers want an app
                    password here rather than the account&apos;s own.
                  </p>
                </div>
              )}
            </>
          )}

          {slack && (
            <>
              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="workspace-connection-bot-token">
                    Bot token
                  </label>
                  {/* Named the way the connection's own settings page names it,
                      and saying which of Slack's several tokens this is: the
                      whole difficulty is that they all look like tokens. */}
                  <FieldHint label="Bot token">
                    The <strong>bot</strong> token, beginning <code>xoxb-</code>. In your Slack app
                    under <strong>OAuth &amp; Permissions</strong>, as the Bot User OAuth Token. Not
                    the app-level <code>xapp-</code> token, which has its own field below. It needs
                    app_mentions:read to see mentions, and chat:write to answer them.
                  </FieldHint>
                </span>
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
              </div>

              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="workspace-connection-app-token">
                    App-Level Token
                  </label>
                  {/* The same words the connection's own settings page puts
                      behind its (?), so the dialog and the page agree. */}
                  <FieldHint label="App-Level Token">
                    Optional, and beginning <code>xapp-</code>. From Basic Information, with
                    connections:write. Giving one is what lets Slack mentions start workflows:
                    without it this connection sends and does not listen.
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <input
                    id="workspace-connection-app-token"
                    name="appToken"
                    className={`${styles.input} ${styles.inputMono}`}
                    type={showAppToken ? 'text' : 'password'}
                    placeholder="xapp-... (optional)"
                    value={appToken}
                    onChange={(event) => setAppToken(event.target.value)}
                  />
                  <RevealToggle
                    shown={showAppToken}
                    onToggle={() => setShowAppToken((on) => !on)}
                    label="app-level token"
                  />
                </div>
              </div>
            </>
          )}

          {!slack && !mail && (
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

          {!slack && !mail && authType !== 'NONE' && (
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


          {!slack && !mail && <HeaderRowsEditor headers={headers} onChange={setHeaders} compact />}
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
