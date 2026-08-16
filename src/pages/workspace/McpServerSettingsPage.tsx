import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  authTypeLabel,
  fetchMcpServer,
  removeMcpServer,
  revealMcpServerSecret,
  updateMcpServer,
} from '../../api/integrations';
import type { AuthType, HttpHeader, McpServer } from '../../api/integrations';
import type { SessionUser } from '../../api/session';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import penIcon from '../../assets/pen.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { HeaderRowsEditor } from '../../components/HeaderRowsEditor';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './IntegrationSettings.module.css';

export interface McpServerSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const AUTH_TYPES: AuthType[] = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC'];

/** Stands in for a stored secret until the caller asks to see it. */
const MASK = '••••••••••••••••••••';

export function McpServerSettingsPage({ session, onSignOut }: McpServerSettingsPageProps) {
  const { workspaceId = '', serverId = '' } = useParams();
  const navigate = useNavigate();

  const [server, setServer] = useState<McpServer | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [authType, setAuthType] = useState<AuthType>('NONE');
  const [headers, setHeaders] = useState<HttpHeader[]>([]);
  // Null while the stored secret is untouched, so saving leaves it alone.
  const [secret, setSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (serverId === '') return;
    fetchMcpServer(serverId)
      .then((found) => {
        if (found === null) {
          setLoadError('That MCP server does not exist, or you do not have access to it.');
          return;
        }
        setServer(found);
        setName(found.name);
        setAddress(found.address);
        setAuthType(found.authType);
        setHeaders(found.headers);
        setSecret(null);
        setRevealed(false);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the server.');
      });
  }, [serverId]);

  async function handleReveal() {
    try {
      const stored = await revealMcpServerSecret(serverId);
      setSecret(stored ?? '');
      setRevealed(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not reveal the credentials.');
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '' || address.trim() === '' || saving) return;

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await updateMcpServer(serverId, {
        name: name.trim(),
        address: address.trim(),
        authType,
        secret: secret ?? undefined,
        headers: headers.filter((header) => header.name.trim() !== ''),
      });
      setServer(updated);
      setHeaders(updated.headers);
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the server.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    await removeMcpServer(serverId);
    navigate(`/workspace/${workspaceId}/integrations`);
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="integrations" />}
    >
      <header className={styles.contentHeader}>
        <p className={styles.breadcrumb}>
          <BackLink to={`/workspace/${workspaceId}/integrations`} label="Integrations" />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/integrations`}>
            Integrations
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{server?.name ?? '…'}</span>
        </p>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{server?.name ?? '…'}</h1>
          <img src={penIcon} alt="" width={12} height={12} />
        </div>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : (
        <>
          <form className={styles.card} onSubmit={handleSave}>
            <h2 className={styles.cardTitle}>General</h2>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="server-name">
                Name
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="server-name"
                  name="serverName"
                  className={`${styles.input} ${styles.inputMono}`}
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="server-address">
                Address
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="server-address"
                  name="serverAddress"
                  className={`${styles.input} ${styles.inputMono}`}
                  type="text"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="server-auth">
                Auth Type
              </label>
              <div className={styles.inputWrapper}>
                <select
                  id="server-auth"
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

            {authType !== 'NONE' && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="server-secret">
                  Token / Key
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="server-secret"
                    name="secret"
                    className={`${styles.input} ${styles.inputMono}`}
                    type="text"
                    placeholder="Enter token or key..."
                    value={secret ?? (server?.secretSet === true ? MASK : '')}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                  {server?.secretSet === true && !revealed && secret === null && (
                    <button type="button" className={styles.reveal} onClick={handleReveal}>
                      Reveal
                    </button>
                  )}
                </div>
              </div>
            )}

            <hr className={styles.divider} />

            <HeaderRowsEditor headers={headers} onChange={setHeaders} />

            {saveError !== null && (
              <p className={styles.error} role="alert">
                {saveError}
              </p>
            )}

            <div className={styles.actionRow}>
              {saved && saveError === null && <p className={styles.savedNote}>Saved.</p>}
              <button
                type="submit"
                className={styles.save}
                disabled={name.trim() === '' || address.trim() === '' || saving}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>

          <section className={`${styles.card} ${styles.dangerCard}`}>
            <h2 className={styles.dangerHeading}>Danger Zone</h2>
            <div className={styles.dangerRow}>
              <div className={styles.dangerText}>
                <p className={styles.dangerTitle}>Remove MCP Server</p>
                <p className={styles.dangerMessage}>
                  Remove this server from the workspace. This will not delete the server configuration.
                </p>
              </div>
              <button type="button" className={styles.dangerAction} onClick={handleRemove}>
                Remove
              </button>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
