import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { authTypeLabel, createWorkspaceConnection } from '../api/integrations';
import type { AuthType, ConnectionType, HttpHeader, MailSecurity, WorkspaceConnection } from '../api/integrations';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './Dialog.module.css';
import { FieldHint } from './FieldHint';
import { HeaderRowsEditor } from './HeaderRowsEditor';
import { SecretField, useSecretField } from './SecretField';
import type { SecretFieldHandle, SecretSource } from './SecretField';
import { useWorkspaceVariables } from '../pages/workspace/workspaceVariables';
import { t } from '../i18n';

export interface WorkspaceConnectionDialogProps {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (connection: WorkspaceConnection) => void;
}

const TYPES: ConnectionType[] = ['SLACK', 'SMTP', 'HTTP'];
const AUTH_TYPES: AuthType[] = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC'];

const TYPE_LABELS: Record<ConnectionType, string> = {
  SLACK: 'Slack',
  SMTP: t('Email (SMTP)'),
  HTTP: t('HTTP endpoint'),
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
  { value: 'TLS', label: t('TLS (implicit)'), port: 465 },
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
  /**
   * The credentials, one handle each.
   *
   * `secret` is whichever of the three names the chosen kind gives it - the
   * mail password, Slack's bot token, an HTTP endpoint's token - because it is
   * one column underneath and only ever one of them is on screen. `appToken` is
   * a second credential and therefore a second handle, which is the whole of
   * #244: a Slack connection can read its bot token from a workspace secret
   * while keeping its app-level token of its own, and one switch above the
   * dialog could not say that.
   */
  const secret = useSecretField();
  const appToken = useSecretField();
  const { variables, refresh: refreshVariables } = useWorkspaceVariables(workspaceId);
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
      secret.clear();
      appToken.clear();
      setSmtpUsername('');
      setSmtpFrom('');
      setSmtpSecurity('STARTTLS');
      setSmtpPort('587');
      setHeaders([{ name: '', value: '' }]);
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
    // A picker left on its placeholder is a field that has not been answered,
    // whichever of them it is.
    !secret.unchosen &&
    !appToken.unchosen &&
    (slack
      ? // The bot token alone, from either source. An app-level token is what
        // makes the connection listen as well as send, and a connection that
        // only sends is a whole half of what people use this for.
        secret.answered
      : // A mail server has to be told who it sends as. The login is not
        // required: a relay inside a network often authenticates nobody.
        mail
        ? url.trim() !== '' && smtpFrom.trim() !== ''
        : url.trim() !== '');

  /**
   * The secrets this workspace keeps, and only those: a VALUE is read with the
   * variable listing, so the server refuses one as a credential and offering it
   * here would teach that at the cost of a save.
   */
  const secrets = useMemo(
    () =>
      variables
        .filter((variable) => variable.kind === 'SECRET')
        .map((variable) => ({ value: variable.id, label: variable.name, hint: variable.catalogName })),
    [variables],
  );

  /** Which of the two a field is, and reading the list again as it is reached for. */
  function chooseSource(field: SecretFieldHandle, next: SecretSource) {
    field.choose(next);
    if (next === 'VARIABLE') refreshVariables();
    setError(null);
  }

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

    const sendingSecret = secret.sending;
    const sendingAppToken = appToken.sending;

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
        /*
         * Each field's answer, in the names this mutation gives it: one of the
         * two, never both. Sending the pair is refused rather than resolved by
         * precedence, and sending neither leaves that credential unset.
         */
        ...(sendingSecret === null
          ? {}
          : 'variable' in sendingSecret
            ? { secretVariableId: sendingSecret.variable }
            : { secret: sendingSecret.value.trim() || undefined }),
        // Empty is a real answer here, and it means send-only.
        ...(!slack || sendingAppToken === null
          ? {}
          : 'variable' in sendingAppToken
            ? { appTokenVariableId: sendingAppToken.variable }
            : { appToken: sendingAppToken.value.trim() || undefined }),
        smtpPort: mail ? Number(smtpPort) : undefined,
        smtpUsername: mail ? smtpUsername.trim() || undefined : undefined,
        smtpFrom: mail ? smtpFrom.trim() : undefined,
        smtpSecurity: mail ? smtpSecurity : undefined,
        headers: slack || mail ? [] : headers.filter((header) => header.name.trim() !== ''),
      });
      onCreated(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not add the connection.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.dialogWide}`} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t('Add Connection')}</h2>
        </header>

        <p className={styles.dialogMessage}>{t('Add a new connection to this workspace')}</p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-connection-name">{t('Name')}</label>
            <div className={styles.inputWrapper}>
              <input
                id="workspace-connection-name"
                name="connectionName"
                className={styles.input}
                type="text"
                placeholder={t('e.g. Slack')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-connection-type">{t('Type')}</label>
            <div className={styles.inputWrapper}>
              <select
                id="workspace-connection-type"
                name="connectionType"
                className={`${styles.input} ${styles.select}`}
                value={type}
                onChange={(event) => setType(event.target.value as ConnectionType | '')}
                required
              >
                <option value="" disabled>{t('Select type...')}</option>
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
              {mail ? t('SMTP Host') : 'URL'}
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
                  {t('Security')}
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
                  {t('Port')}
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
                    {t('From Address')}
                  </label>
                  <FieldHint label={t('From Address')}>
                    {t('Every mail this connection sends is from this address, and a provider that has not authorised it refuses the message however good the password is.')}
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
                  {t('Username')}
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="workspace-connection-username"
                    name="smtpUsername"
                    className={styles.input}
                    type="text"
                    placeholder={t('Leave empty to send without authenticating')}
                    value={smtpUsername}
                    onChange={(event) => setSmtpUsername(event.target.value)}
                  />
                </div>
              </div>

              {smtpUsername.trim() !== '' && (
                <SecretField
                  id="workspace-connection-password"
                  label={t('Password')}
                  field={secret}
                  options={secrets}
                  variablesPath={`/workspace/${workspaceId}/variables`}
                  placeholder={t('Enter password...')}
                  hint={
                    <>
                      Stored encrypted, and never shown again in the list. Many providers want an app
                      password here rather than the account&apos;s own.
                    </>
                  }
                  onSource={(next) => chooseSource(secret, next)}
                  onValue={() => setError(null)}
                  onVariable={() => setError(null)}
                />
              )}
            </>
          )}

          {slack && (
            <>
              {/* Two credentials, each answering for itself. This is the pair
                  that made a card-level switch untenable: "this connection uses
                  a workspace secret" cannot mean the bot token without also
                  meaning the app-level token. */}
              <SecretField
                id="workspace-connection-bot-token"
                label={t('Bot token')}
                field={secret}
                options={secrets}
                variablesPath={`/workspace/${workspaceId}/variables`}
                placeholder="xoxb-..."
                hint={
                  <>
                    The <strong>bot</strong> token, beginning <code>xoxb-</code>. In your Slack app
                    under <strong>OAuth &amp; Permissions</strong>, as the Bot User OAuth Token. Not
                    the app-level <code>xapp-</code> token, which has its own field below. It needs
                    app_mentions:read to see mentions, and chat:write to answer them.
                  </>
                }
                onSource={(next) => chooseSource(secret, next)}
                onValue={() => setError(null)}
                onVariable={() => setError(null)}
              />

              <SecretField
                id="workspace-connection-app-token"
                label={t('App-Level Token')}
                field={appToken}
                options={secrets}
                variablesPath={`/workspace/${workspaceId}/variables`}
                placeholder={t('xapp-... (optional)')}
                hint={
                  <>
                    Optional, and beginning <code>xapp-</code>. From Basic Information, with
                    connections:write. Giving one is what lets Slack mentions start workflows:
                    without it this connection sends and does not listen.
                  </>
                }
                onSource={(next) => chooseSource(appToken, next)}
                onValue={() => setError(null)}
                onVariable={() => setError(null)}
              />
            </>
          )}

          {!slack && !mail && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-connection-auth">
              {t('Auth Type')}
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
            <SecretField
              id="workspace-connection-secret"
              label={t('Token / Key')}
              field={secret}
              options={secrets}
              variablesPath={`/workspace/${workspaceId}/variables`}
              placeholder={t('Enter token or key...')}
              hint={t("Whatever the endpoint expects, sent the way the authentication method above says.")}
              onSource={(next) => chooseSource(secret, next)}
              onValue={() => setError(null)}
              onVariable={() => setError(null)}
            />
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
            {t('Cancel')}
          </button>
          <button type="submit" className={styles.filled} disabled={!complete || submitting}>
            {submitting ? t('Adding…') : t('Add Connection')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
