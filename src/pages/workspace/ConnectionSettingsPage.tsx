import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  authTypeLabel,
  connectionTypeLabel,
  disconnectWorkspaceConnection,
  fetchWorkspaceConnection,
  revealWorkspaceConnectionAppToken,
  revealWorkspaceConnectionSecret,
  statusLabel,
  testWorkspaceConnection,
  updateWorkspaceConnection,
} from '../../api/integrations';
import type { AuthType, ConnectionStatus, ConnectionType, MailSecurity, WorkspaceConnection } from '../../api/integrations';
import type { SessionUser } from '../../api/session';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import lockIcon from '../../assets/lock-keyhole.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { FieldHint } from '../../components/FieldHint';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { Loader } from '../../components/Loader';
import { RevealToggle } from '../../components/RevealToggle';
import { shellUser } from '../../session/user';
import styles from './IntegrationSettings.module.css';

export interface ConnectionSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const AUTH_TYPES: AuthType[] = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC'];

/** How the session with a mail server is secured, and the port that goes with it. */
const SECURITY: { value: MailSecurity; label: string; port: number }[] = [
  { value: 'STARTTLS', label: 'STARTTLS', port: 587 },
  { value: 'TLS', label: 'TLS (implicit)', port: 465 },
  { value: 'NONE', label: 'None', port: 25 },
];

/** Stands in for a stored secret until the caller asks to see it. */
const MASK = '••••••••••••••••••••••••••••••••';

/**
 * A connection as one workspace holds it. What the admin defines stays locked;
 * the credentials and the endpoint override are the workspace's own.
 */
/**
 * The kinds a connection may be, in the order the form that creates one offers
 * them - so choosing here and choosing there are the same list in the same
 * order rather than two lists that drift.
 */
const CONNECTION_TYPES: ConnectionType[] = ['SLACK', 'SMTP', 'GITHUB', 'JIRA', 'WEBHOOK'];

/**
 * What this field is called, which is what the service filling it calls it.
 *
 * Not one name for the shared column: Slack calls its own the bot token, and a
 * mail server has a password. "API Token" is left for the kinds where that is
 * genuinely the word - a GitHub or Jira token, or whatever a webhook wants.
 */
function secretLabel(kind: ConnectionType | null): string {
  switch (kind) {
    case 'SMTP':
      return 'Password';
    case 'SLACK':
      return 'Bot token';
    default:
      return 'API Token';
  }
}

/**
 * Which credential this field wants, named for the service it belongs to.
 *
 * Written per kind rather than as one sentence about tokens in general: the
 * whole difficulty is that Slack hands you three different strings and only one
 * of them belongs here.
 */
function secretHint(kind: ConnectionType | null) {
  switch (kind) {
    case 'SLACK':
      return (
        <>
          The <strong>bot</strong> token, beginning <code>xoxb-</code>. In your Slack app under{' '}
          <strong>OAuth &amp; Permissions</strong>, as the Bot User OAuth Token. Not the app-level
          <code> xapp-</code> token, which has its own field below, and not the signing secret.
        </>
      );
    case 'SMTP':
      return (
        <>
          The password for the mailbox above. Where the provider offers one, use an app password
          rather than the account&apos;s own - it can be withdrawn on its own.
        </>
      );
    case 'GITHUB':
      return (
        <>
          A personal access token, or a fine-grained token with access to the repositories this
          workspace should reach.
        </>
      );
    case 'JIRA':
      return (
        <>
          An API token from your Atlassian account, paired with the account&apos;s email address as
          the username.
        </>
      );
    default:
      return <>Whatever the endpoint expects, sent the way the authentication method above says.</>;
  }
}

export function ConnectionSettingsPage({ session, onSignOut }: ConnectionSettingsPageProps) {
  /** True while the export is being confirmed; the name once it has happened. */
  const { workspaceId = '', connectionId = '' } = useParams();
  const navigate = useNavigate();

  const [connection, setConnection] = useState<WorkspaceConnection | null>(null);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [namedSaved, setNamedSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [authType, setAuthType] = useState<AuthType>('NONE');
  /**
   * The kind being chosen, which is not always the kind that is stored.
   *
   * The fields below follow this rather than the saved connection, so picking
   * Slack shows the app-level token straight away instead of after a save - and
   * the token is what somebody came here to type.
   */
  const [type, setType] = useState<ConnectionType | null>(null);
  // Null while the stored secret is untouched, so saving leaves it alone.
  const [secret, setSecret] = useState<string | null>(null);
  const [appToken, setAppToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  /**
   * What was revealed, kept so it can be put back out of sight.
   *
   * Hiding is only offered while the field still holds exactly this. Once it
   * has been typed into, covering it again would either throw the typing away
   * or leave an edit pending behind a row of dots - and a secret that is
   * hidden but not what is stored is the worst of the three.
   */
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  /** The same pair for the other credential a Slack connection holds. */
  const [appRevealed, setAppRevealed] = useState(false);
  const [appRevealedValue, setAppRevealedValue] = useState<string | null>(null);
  const [urlOverride, setUrlOverride] = useState('');
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpSecurity, setSmtpSecurity] = useState<MailSecurity>('STARTTLS');
  const [smtpPort, setSmtpPort] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (connectionId === '') return;
    fetchWorkspaceConnection(connectionId)
      .then((found) => {
        if (found === null) {
          setLoadError('That connection does not exist, or you do not have access to it.');
          return;
        }
        setConnection(found);
        setName(found.name);
        setAuthType(found.authType);
        setUrlOverride(found.urlOverride ?? '');
        setSmtpUsername(found.smtpUsername ?? '');
        setSmtpFrom(found.smtpFrom ?? '');
        setSmtpSecurity(found.smtpSecurity);
        setSmtpPort(found.smtpPort === null ? '' : String(found.smtpPort));
        setSecret(null);
        setAppToken(null);
        setRevealed(false);
        setRevealedValue(null);
        setAppRevealed(false);
        setAppRevealedValue(null);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the connection.');
      });
  }, [connectionId]);

  /** What is on the page now: the choice if one has been made, else what is stored. */
  const kind = type ?? connection?.type ?? null;
  const mail = kind === 'SMTP';
  /*
   * One Slack kind, where there were two.
   *
   * This page asked for `SLACK` while the form that creates a connection asked
   * for `SLACK_SOCKET_MODE` - opposite values, so the one kind that needed an
   * app-level token was the one kind that could never be shown the field. The
   * two kinds have since been collapsed into this one, which holds the
   * app-level token when it is meant to listen and leaves it empty when it is
   * only meant to send.
   */
  const slack = kind === 'SLACK';

  /** Changing how the session is secured moves the port with it, until it is typed over. */
  function changeSecurity(next: MailSecurity) {
    const previous = SECURITY.find((candidate) => candidate.value === smtpSecurity);
    setSmtpSecurity(next);
    if (smtpPort === '' || smtpPort === String(previous?.port)) {
      setSmtpPort(String(SECURITY.find((candidate) => candidate.value === next)?.port ?? ''));
    }
  }

  async function handleRevealAppToken() {
    try {
      const stored = await revealWorkspaceConnectionAppToken(connectionId);
      setAppToken(stored ?? '');
      setAppRevealedValue(stored ?? '');
      setAppRevealed(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not reveal the app-level token.');
    }
  }

  async function handleReveal() {
    try {
      const stored = await revealWorkspaceConnectionSecret(connectionId);
      setSecret(stored ?? '');
      setRevealedValue(stored ?? '');
      setRevealed(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not reveal the credentials.');
    }
  }

  /**
   * Saved on its own, because the name is not a credential: pressing "Save
   * Credentials" to rename something would be a surprise, and renaming should
   * not ask for the secret to be re-entered.
   */
  async function handleSaveName() {
    if (savingName) return;

    setSavingName(true);
    setNameError(null);
    setNamedSaved(false);
    try {
      const updated = await updateWorkspaceConnection(connectionId, { name: name.trim() });
      setConnection(updated);
      setName(updated.name);
      setNamedSaved(true);
    } catch (cause) {
      setNameError(cause instanceof Error ? cause.message : 'Could not rename the connection.');
    } finally {
      setSavingName(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await updateWorkspaceConnection(connectionId, {
        // Only when it has actually been changed, so opening the page and
        // saving a credential does not also rewrite the kind.
        type: type !== null && type !== connection?.type ? type : undefined,
        // Not for Slack, whose controls are gone: the server overwrites
        // authType on every save, and a Slack connection has nowhere else to
        // point. Sending them would write settings the form no longer shows.
        authType: slack ? undefined : authType,
        secret: secret ?? undefined,
        appToken: appToken ?? undefined,
        urlOverride: slack ? undefined : urlOverride.trim(),
        // Only for a mail connection: sending these for a Slack one would write
        // settings nothing reads and clear what somebody typed elsewhere.
        smtpPort: mail ? Number(smtpPort) : undefined,
        smtpUsername: mail ? smtpUsername.trim() : undefined,
        smtpFrom: mail ? smtpFrom.trim() : undefined,
        smtpSecurity: mail ? smtpSecurity : undefined,
      });
      setConnection(updated);
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the credentials.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (testing) return;

    setTesting(true);
    setSaveError(null);
    try {
      setConnection(await testWorkspaceConnection(connectionId));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not check the connection.');
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    await disconnectWorkspaceConnection(connectionId);
    navigate(`/workspace/${workspaceId}/integrations`);
  }

  const locked = connection?.inherited ?? false;

  return (
    <AppShell
      title={connection?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.contentHeader}>
        <p className={styles.breadcrumb}>
          <BackLink to={`/workspace/${workspaceId}/integrations`} label="Integrations" />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/integrations`}>
            Integrations
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{connection?.name ?? '…'}</span>
        </p>
        <h1 className={styles.title}>Connection Settings</h1>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : connection === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <>
          <section className={styles.card}>
            <div className={styles.cardTitles}>
              <h2 className={styles.cardTitle}>General</h2>
              <p className={styles.cardSubtitle}>
                {locked
                  ? 'Connection settings inherited from admin defaults'
                  : 'Connection settings for this workspace'}
              </p>
            </div>

            {/*
              An inherited connection's name belongs to the admin default, so it
              stays read-only. A workspace's own is the workspace's to change —
              the API has always accepted it; there was simply nowhere to type.
            */}
            {locked ? (
              <ReadOnlyField label="Integration Name" value={connection?.name ?? ''} locked />
            ) : (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="connection-name">
                  Integration Name
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="connection-name"
                    className={styles.input}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Name this connection"
                  />
                </div>
              </div>
            )}
            {/*
              Editable, where the connection is this workspace's own.

              An inherited one follows the installation's default and is shown
              rather than offered, as everything else on it is. The server has
              always accepted a change of kind; only this page refused to make
              one, so a connection created as the wrong kind had to be deleted
              and built again, taking its credentials with it.
            */}
            {locked || connection === null ? (
              <ReadOnlyField
                label="Type"
                value={connection === null ? '' : connectionTypeLabel(connection.type)}
                locked={locked}
              />
            ) : (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="connection-type">
                  Type
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="connection-type"
                    name="type"
                    className={styles.input}
                    value={kind ?? connection.type}
                    onChange={(event) => setType(event.target.value as ConnectionType)}
                  >
                    {CONNECTION_TYPES.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {connectionTypeLabel(candidate)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <ReadOnlyField
              label={mail ? 'Mail Server' : 'Default API Host URL'}
              value={connection?.url ?? ''}
              locked={locked}
            />

            {!locked && (
              <div className={styles.actionRow}>
                {namedSaved && nameError === null && <p className={styles.savedNote}>Saved.</p>}
                {nameError !== null && <p className={styles.savedNote}>{nameError}</p>}
                <button
                  type="button"
                  className={styles.save}
                  onClick={() => void handleSaveName()}
                  disabled={savingName || name.trim() === '' || name.trim() === connection?.name}
                >
                  {savingName ? 'Saving…' : 'Save Name'}
                </button>
              </div>
            )}
          </section>

          <form className={styles.card} onSubmit={handleSave}>
            <h2 className={styles.cardTitle}>Active Credentials</h2>

            {/*
              * Not for Slack, which authenticates one way. The server sets
              * BEARER_TOKEN on every save regardless of what arrives, so a
              * chooser here offers four answers and keeps one.
              */}
            {!slack && !mail && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="connection-auth">
                Auth Type
              </label>
              <div className={styles.inputWrapper}>
                <select
                  id="connection-auth"
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

            {mail && (
              <>
                <div className={styles.field}>
                  <span className={styles.labelWithHint}>
                    <label className={styles.label} htmlFor="connection-smtp-from">
                      From Address
                    </label>
                    <FieldHint label="From Address">
                      Every mail this connection sends is from this address, and a provider that has not
                      authorised it refuses the message however good the password is.
                    </FieldHint>
                  </span>
                  <div className={styles.inputWrapper}>
                    <input
                      id="connection-smtp-from"
                      name="smtpFrom"
                      className={styles.input}
                      type="email"
                      placeholder="orknux@example.com"
                      value={smtpFrom}
                      onChange={(event) => setSmtpFrom(event.target.value)}
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="connection-smtp-security">
                    Security
                  </label>
                  <div className={styles.inputWrapper}>
                    <select
                      id="connection-smtp-security"
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
                  <label className={styles.label} htmlFor="connection-smtp-port">
                    Port
                  </label>
                  <div className={styles.inputWrapper}>
                    <input
                      id="connection-smtp-port"
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
                  <label className={styles.label} htmlFor="connection-smtp-username">
                    Username
                  </label>
                  <div className={styles.inputWrapper}>
                    <input
                      id="connection-smtp-username"
                      name="smtpUsername"
                      className={styles.input}
                      type="text"
                      placeholder="Leave empty to send without authenticating"
                      value={smtpUsername}
                      onChange={(event) => setSmtpUsername(event.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            <div className={styles.field}>
              <span className={styles.labelWithHint}>
                <label className={styles.label} htmlFor="connection-secret">
                  {/*
                    One column underneath, three names on top of it - because the
                    column being shared is a fact about the schema and not about
                    the person filling the field in, who has several tokens in
                    front of them and needs to be told which one this wants.
                    Slack hands out three, so Slack gets told; "API Token" stays
                    for the kinds where the service really does call it that.
                  */}
                  {secretLabel(kind)}
                </label>
                <FieldHint label={secretLabel(kind)}>{secretHint(kind)}</FieldHint>
              </span>
              <div className={styles.inputWrapper}>
                <input
                  id="connection-secret"
                  name="secret"
                  className={`${styles.input} ${styles.inputMono}`}
                  type="text"
                  placeholder={mail ? 'Enter password...' : 'Enter token or key...'}
                  value={secret ?? (connection?.secretSet === true ? MASK : '')}
                  onChange={(event) => setSecret(event.target.value)}
                />
                {/*
                  One control, two states. This was a pair of green words -
                  Reveal, then Hide - which is the same gesture the variables
                  page offers as an eye, and the owner picked the eye: the field
                  beside it is already a row of dots, so the row is about the
                  value rather than about prose, and a word inside a control
                  holding a secret reads as part of the secret.

                  Offered only while the field still holds what is stored or
                  what was revealed; once it has been typed into, it is an edit
                  like any other and there is nothing to hide.
                */}
                {connection?.secretSet === true &&
                  (secret === null || (revealed && secret === revealedValue)) && (
                    <RevealToggle
                      shown={revealed && secret === revealedValue}
                      label={secretLabel(kind).toLowerCase()}
                      onToggle={() => {
                        if (revealed && secret === revealedValue) {
                          // Back to untouched, not to empty: null is what tells
                          // the save to leave the stored credential alone.
                          setSecret(null);
                          setRevealed(false);
                          setRevealedValue(null);
                        } else {
                          void handleReveal();
                        }
                      }}
                    />
                  )}
              </div>
            </div>

            {slack && (
              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="connection-app-token">
                    App-Level Token
                  </label>
                  <FieldHint label="App-Level Token">
                    Optional, and beginning <code>xapp-</code>. From Basic Information, with
                    connections:write. Given one, orknux listens for mentions and runs the triggers
                    waiting on them; left empty, this connection only sends.
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <input
                    id="connection-app-token"
                    name="appToken"
                    className={`${styles.input} ${styles.inputMono}`}
                    type="text"
                    placeholder="xapp-..."
                    value={appToken ?? (connection.appTokenSet ? MASK : '')}
                    onChange={(event) => setAppToken(event.target.value)}
                  />
                  {/*
                    The same pair the bot token beside it has always had. This
                    one had neither: it could be written and never read back, so
                    there was no way to check which token was in there, compare
                    it against Slack, or see whether it had been rotated.
                  */}
                  {connection.appTokenSet &&
                    (appToken === null || (appRevealed && appToken === appRevealedValue)) && (
                      <RevealToggle
                        shown={appRevealed && appToken === appRevealedValue}
                        label="app-level token"
                        onToggle={() => {
                          if (appRevealed && appToken === appRevealedValue) {
                            setAppToken(null);
                            setAppRevealed(false);
                            setAppRevealedValue(null);
                          } else {
                            void handleRevealAppToken();
                          }
                        }}
                      />
                    )}
                </div>
              </div>
            )}

            {/*
              * Nor for Slack. There is one Slack and one Web API base under it;
              * every Slack connection sends, and an app-level token is what
              * additionally makes it listen. Neither of those is a webhook
              * pointed somewhere else, so there is no Slack connection for
              * which an override here means anything.
              */}
            {!slack && !mail && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="connection-url-override">
                Webhook URL Override
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="connection-url-override"
                  name="urlOverride"
                  className={styles.input}
                  type="text"
                  placeholder={connection?.url ?? 'https://'}
                  value={urlOverride}
                  onChange={(event) => setUrlOverride(event.target.value)}
                />
              </div>
            </div>
            )}

            {saveError !== null && (
              <p className={styles.error} role="alert">
                {saveError}
              </p>
            )}

            <div className={styles.statusRow}>
              <span className={statusClass(connection?.status)} aria-hidden="true" />
              <span className={styles.statusLabel}>
                {connection === null ? '…' : statusLabel(connection.status)}
              </span>
              {connection?.lastCheckMessage != null && (
                <span className={styles.statusDetail}>{connection.lastCheckMessage}</span>
              )}
            </div>

            {/* Checking and saving are the two things to do here, so they sit together. */}
            <div className={styles.actionRow}>
              {saved && saveError === null && <p className={styles.savedNote}>Saved.</p>}
              <button type="button" className={styles.testButton} onClick={handleTest} disabled={testing}>
                {testing ? 'Checking…' : 'Test Connection'}
              </button>
              <button type="submit" className={styles.save} disabled={saving}>
                {saving ? 'Saving…' : 'Save Credentials'}
              </button>
            </div>
          </form>

          <section className={`${styles.card} ${styles.dangerCard}`}>
            <h2 className={styles.dangerHeading}>Danger Zone</h2>
            <div className={styles.dangerRow}>
              <div className={styles.dangerText}>
                <p className={styles.dangerTitle}>Disconnect {connection?.name ?? ''}</p>
                <p className={styles.dangerMessage}>
                  {locked
                    ? 'Clear the credentials this workspace stored and reset to admin defaults.'
                    : 'Permanently remove this custom integration connection from the workspace.'}
                </p>
              </div>
              <button type="button" className={styles.dangerActionFilled} onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}

/** Green once the service answered, red when the check failed, grey until then. */
function statusClass(status: ConnectionStatus | undefined): string {
  switch (status) {
    case 'CONNECTED':
      return `${styles.statusDot} ${styles.statusConnected}`;
    case 'FAILED':
      return `${styles.statusDot} ${styles.statusFailed}`;
    default:
      return `${styles.statusDot} ${styles.statusIdle}`;
  }
}

/** A field the admin owns: shown, but not the workspace's to change. */
function ReadOnlyField({ label, value, locked }: { label: string; value: string; locked: boolean }) {
  return (
    <div className={styles.field}>
      <p className={styles.label}>{label}</p>
      <div className={locked ? `${styles.inputWrapper} ${styles.inputWrapperLocked}` : styles.inputWrapper}>
        <span className={`${styles.input} ${styles.inputMono}`}>{value}</span>
        {locked && <img src={lockIcon} alt="Managed by the admin" width={12} height={12} />}
      </div>
    </div>
  );
}
