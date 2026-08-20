import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  exportWorkspaceConnectionAsDefault,
  authTypeLabel,
  connectionTypeLabel,
  disconnectWorkspaceConnection,
  fetchWorkspaceConnection,
  revealWorkspaceConnectionSecret,
  statusLabel,
  testWorkspaceConnection,
  updateWorkspaceConnection,
} from '../../api/integrations';
import type { AuthType, ConnectionStatus, MailSecurity, WorkspaceConnection } from '../../api/integrations';
import type { SessionUser } from '../../api/session';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import lockIcon from '../../assets/lock-keyhole.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import dialogStyles from '../../components/Dialog.module.css';
import { Loader } from '../../components/Loader';
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
export function ConnectionSettingsPage({ session, onSignOut }: ConnectionSettingsPageProps) {
  /** True while the export is being confirmed; the name once it has happened. */
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const { workspaceId = '', connectionId = '' } = useParams();
  const navigate = useNavigate();

  const [connection, setConnection] = useState<WorkspaceConnection | null>(null);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [namedSaved, setNamedSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [authType, setAuthType] = useState<AuthType>('NONE');
  // Null while the stored secret is untouched, so saving leaves it alone.
  const [secret, setSecret] = useState<string | null>(null);
  const [appToken, setAppToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
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
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the connection.');
      });
  }, [connectionId]);

  const mail = connection?.type === 'SMTP';

  /** Changing how the session is secured moves the port with it, until it is typed over. */
  function changeSecurity(next: MailSecurity) {
    const previous = SECURITY.find((candidate) => candidate.value === smtpSecurity);
    setSmtpSecurity(next);
    if (smtpPort === '' || smtpPort === String(previous?.port)) {
      setSmtpPort(String(SECURITY.find((candidate) => candidate.value === next)?.port ?? ''));
    }
  }

  async function handleReveal() {
    try {
      const stored = await revealWorkspaceConnectionSecret(connectionId);
      setSecret(stored ?? '');
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
        authType,
        secret: secret ?? undefined,
        appToken: appToken ?? undefined,
        urlOverride: urlOverride.trim(),
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
            <ReadOnlyField
              label="Type"
              value={connection === null ? '' : connectionTypeLabel(connection.type)}
              locked={locked}
            />
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

            {!mail && (
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
                  <label className={styles.label} htmlFor="connection-smtp-from">
                    From Address
                  </label>
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
                  <p className={styles.fieldHint}>
                    Every mail this connection sends is from this address, and a provider that has
                    not authorised it refuses the message however good the password is.
                  </p>
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
              <label className={styles.label} htmlFor="connection-secret">
                {/* The same column, and for a mail server it holds the password. */}
                {mail ? 'Password' : 'API Token'}
              </label>
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
                {connection?.secretSet === true && !revealed && secret === null && (
                  <button type="button" className={styles.reveal} onClick={handleReveal}>
                    Reveal
                  </button>
                )}
              </div>
            </div>

            {connection?.type === 'SLACK' && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="connection-app-token">
                  App-Level Token
                </label>
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
                </div>
                <p className={styles.fieldHint}>
                  Slack&apos;s Socket Mode token, with connections:write. Given one, orknux listens for
                  mentions and runs the triggers waiting on them.
                </p>
              </div>
            )}

            {!mail && (
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

          {/*
            Where a connection is set up is where it is worth offering to
            everybody: whoever is on this screen has just decided it works.
          */}
          {session.admin && connection !== null && (
            <section className={styles.card}>
              <h2 className={styles.sectionHeading}>Share</h2>
              <div className={styles.shareRow}>
                <div className={styles.shareText}>
                  <p className={styles.shareTitle}>Export as default</p>
                  <p className={styles.shareMessage}>
                    {exported !== null
                      ? `${exported} is now an admin default; new workspaces are provisioned with it.`
                      : 'Makes this an admin default, so new workspaces are provisioned with it. Its name, kind and URL are shared; the credentials stay here.'}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.testButton}
                  onClick={() => {
                    setExported(null);
                    setExporting(true);
                  }}
                  disabled={exported !== null}
                >
                  Export as default
                </button>
              </div>
            </section>
          )}

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
      <ExportConnectionDialog
        connection={exporting ? connection : null}
        onClose={() => setExporting(false)}
        onExported={(name) => {
          setExporting(false);
          setExported(name);
        }}
      />
    </AppShell>
  );
}

/**
 * Asks before a connection becomes everybody's.
 *
 * Two things are worth saying out loud: that no credential travels with it, and
 * that it can be handed to the workspaces that already exist as well as the ones
 * that come later — which is the difference between a catalogue entry and a
 * change every workspace sees today.
 */
function ExportConnectionDialog({
  connection,
  onClose,
  onExported,
}: {
  connection: WorkspaceConnection | null;
  onClose: () => void;
  onExported: (name: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [toExisting, setToExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (connection !== null && !dialog.open) {
      setToExisting(false);
      setError(null);
      setBusy(false);
      dialog.showModal();
    } else if (connection === null && dialog.open) {
      dialog.close();
    }
  }, [connection]);

  async function handleExport() {
    if (connection === null) return;
    setBusy(true);
    setError(null);
    try {
      const created = await exportWorkspaceConnectionAsDefault(connection.id, toExisting);
      onExported(created.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export the connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={dialogStyles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={dialogStyles.body}>
        <header className={dialogStyles.header}>
          <h2 className={dialogStyles.title}>Export as default</h2>
        </header>
        <p className={dialogStyles.dialogMessage}>
          {connection?.name} becomes an admin default: new workspaces are provisioned with it. Its
          name, kind and URL are shared; the credentials stay in this workspace, as they do for
          every default.
        </p>

        <label className={dialogStyles.checkboxField}>
          <input
            type="checkbox"
            checked={toExisting}
            onChange={(event) => setToExisting(event.target.checked)}
          />
          Also add it to the workspaces that already exist
        </label>

        {error !== null && <p className={dialogStyles.error}>{error}</p>}

        <footer className={dialogStyles.actions}>
          <button type="button" className={dialogStyles.ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={dialogStyles.filled} onClick={handleExport} disabled={busy}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </footer>
      </div>
    </dialog>
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
