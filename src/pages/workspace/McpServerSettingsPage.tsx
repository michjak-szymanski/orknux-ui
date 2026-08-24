import { useEffect, useMemo, useState } from 'react';
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
import { Loader } from '../../components/Loader';
import { SecretField, useSecretField } from '../../components/SecretField';
import type { SecretSource } from '../../components/SecretField';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import { useWorkspaceVariables } from './workspaceVariables';
import styles from './IntegrationSettings.module.css';

export interface McpServerSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const AUTH_TYPES: AuthType[] = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC'];

export function McpServerSettingsPage({ session, onSignOut }: McpServerSettingsPageProps) {
  const { workspaceId = '', serverId = '' } = useParams();
  const navigate = useNavigate();

  const [server, setServer] = useState<McpServer | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [authType, setAuthType] = useState<AuthType>('NONE');
  const [headers, setHeaders] = useState<HttpHeader[]>([]);
  /**
   * The credential: this server's own copy, or a workspace secret it reads.
   *
   * A handle rather than four pieces of state, because these move together and
   * the ways they move are the dangerous part - and because a card that grows a
   * second credential is a second call to this and nothing else.
   */
  const secret = useSecretField();
  const { variables, refresh: refreshVariables } = useWorkspaceVariables(workspaceId);
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
        secret.reset({ stored: found.secretSet, variable: found.secretVariableId });
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the server.');
      });
  }, [serverId]);

  async function handleReveal() {
    try {
      secret.show((await revealMcpServerSecret(serverId)) ?? '');
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not reveal the credentials.');
    }
  }

  /**
   * The secrets this workspace keeps, and only those. A VALUE is read with the
   * variable listing, and a value on a listing is a value on a screen, so the
   * server refuses one - and offering it here would teach that at the cost of a
   * save.
   */
  const secrets = useMemo(
    () =>
      variables
        .filter((variable) => variable.kind === 'SECRET')
        .map((variable) => ({ value: variable.id, label: variable.name, hint: variable.catalogName })),
    [variables],
  );

  /** The one it already reads, kept in the list even before the list arrives. */
  const offered = useMemo(() => {
    const held = server?.secretVariableId ?? null;
    const called = server?.secretVariableName ?? null;
    if (held === null || called === null) return secrets;
    if (secrets.some((option) => option.value === held)) return secrets;
    return [{ value: held, label: called, hint: server?.secretVariableCatalog ?? '' }, ...secrets];
  }, [server, secrets]);

  function chooseSource(next: SecretSource) {
    secret.choose(next);
    // Reaching for the list is a reason to read it again: somebody about to
    // point this at a secret has often just been to Variables to make it.
    if (next === 'VARIABLE') refreshVariables();
    setSaveError(null);
    setSaved(false);
  }

  function touched() {
    setSaveError(null);
    setSaved(false);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '' || address.trim() === '' || saving) return;

    if (secret.unchosen) {
      setSaveError('Choose the workspace secret this server reads its token from.');
      setSaved(false);
      return;
    }
    const sending = secret.sending;

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await updateMcpServer(serverId, {
        name: name.trim(),
        address: address.trim(),
        authType,
        /*
         * One of the two, never both. A variable sent drops any copy this
         * server held and a token sent drops any reference; sending the pair is
         * refused rather than resolved by precedence, and sending neither is
         * what says "leave the stored one alone".
         */
        ...(sending === null
          ? {}
          : 'variable' in sending
            ? { secretVariableId: sending.variable }
            : { secret: sending.value }),
        headers: headers.filter((header) => header.name.trim() !== ''),
      });
      setServer(updated);
      setHeaders(updated.headers);
      secret.reset({ stored: updated.secretSet, variable: updated.secretVariableId });
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
      title={server?.name}
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
      ) : server === null ? (
        <section className={styles.card}>
          <Loader />
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
              /*
                The token, and where it comes from - one field, asked for one
                way at a time. The choice belongs beside this field's own name
                rather than above the card: a card-level switch happens to be
                unambiguous where there is one credential and says nothing at
                all where there are two. See components/SecretField.tsx.
              */
              <SecretField
                id="server-secret"
                label="Token / Key"
                field={secret}
                options={offered}
                variablesPath={`/workspace/${workspaceId}/variables`}
                placeholder="Enter token or key..."
                hint="Whatever the server expects, sent the way the authentication method above says."
                onSource={chooseSource}
                onValue={touched}
                onVariable={touched}
                onReveal={() => void handleReveal()}
                broken={
                  server.secretVariableMissing
                    ? 'The workspace secret this token was read from is gone, so this server has nothing to authenticate with. Its address is fine. Point this field at another secret, or give it a value of its own.'
                    : null
                }
              />
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
