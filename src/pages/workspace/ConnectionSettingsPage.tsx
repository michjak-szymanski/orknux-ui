import { useEffect, useMemo, useState } from 'react';
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
import { fetchSlackBotUsers } from '../../api/triggers';
import type { SlackBotUser } from '../../api/triggers';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import lockIcon from '../../assets/lock-keyhole.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { FieldHint } from '../../components/FieldHint';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { Loader } from '../../components/Loader';
import { SecretField, useSecretField } from '../../components/SecretField';
import type { SecretFieldHandle, SecretSource } from '../../components/SecretField';
import { shellUser } from '../../session/user';
import { useWorkspaceVariables } from './workspaceVariables';
import styles from './IntegrationSettings.module.css';
import { t } from '../../i18n';

export interface ConnectionSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const AUTH_TYPES: AuthType[] = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC'];

/** How the session with a mail server is secured, and the port that goes with it. */
const SECURITY: { value: MailSecurity; label: string; port: number }[] = [
  { value: 'STARTTLS', label: 'STARTTLS', port: 587 },
  { value: 'TLS', label: t('TLS (implicit)'), port: 465 },
  { value: 'NONE', label: t('None'), port: 25 },
];

/**
 * A connection as one workspace holds it. What the admin defines stays locked;
 * the credentials and the endpoint override are the workspace's own.
 */
/**
 * The kinds a connection may be, in the order the form that creates one offers
 * them - so choosing here and choosing there are the same list in the same
 * order rather than two lists that drift.
 */
const CONNECTION_TYPES: ConnectionType[] = ['SLACK', 'SMTP', 'HTTP'];

/**
 * What this field is called, which is what the service filling it calls it.
 *
 * Not one name for the shared column: Slack calls its own the bot token, and a
 * mail server has a password. "API Token" is left for the kinds where that is
 * genuinely the word - whatever the endpoint at the other end expects.
 */
function secretLabel(kind: ConnectionType | null): string {
  switch (kind) {
    case 'SMTP':
      return 'Password';
    case 'SLACK':
      return t('Bot token');
    default:
      return t('API Token');
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
          <strong>{t('OAuth & Permissions')}</strong>, as the Bot User OAuth Token. Not the app-level
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
  /**
   * The two credentials, each holding its own answer to the same question.
   *
   * This is the whole of #244. One switch above the card cannot say "the bot
   * token is a workspace secret and the app-level token is this connection's
   * own", because that sentence is about two fields; two handles can, and each
   * carries its own box, its own picker, its own reveal and its own rule about
   * what an emptied box means.
   */
  const secret = useSecretField();
  const appToken = useSecretField();
  const { variables, refresh: refreshVariables } = useWorkspaceVariables(workspaceId);
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
          setLoadError(t('That connection does not exist, or you do not have access to it.'));
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
        secret.reset({ stored: found.secretSet, variable: found.secretVariableId });
        appToken.reset({ stored: found.appTokenSet, variable: found.appTokenVariableId });
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : t('Could not load the connection.'));
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

  /**
   * What Slack said this token can do, where this connection is a Slack one.
   *
   * Asked of the workspace and read for one row, because that is the only shape
   * the query has - and it costs nothing extra: the server keeps each
   * connection's answer for ten minutes against the token's own fingerprint, so
   * opening this page after the trigger list that sent somebody here asks Slack
   * nothing at all.
   *
   * Only for a Slack connection. An SMTP server has no bot user and no scopes,
   * and a page that asked anyway would be spending a round trip to be told so.
   */
  const [botUser, setBotUser] = useState<SlackBotUser | null>(null);

  useEffect(() => {
    if (!slack || workspaceId === '' || connectionId === '') return;
    let current = true;
    fetchSlackBotUsers(workspaceId)
      .then((bots) => {
        if (current) setBotUser(bots.find((held) => held.connectionId === connectionId) ?? null);
      })
      .catch(() => {
        if (current) setBotUser(null);
      });
    return () => {
      current = false;
    };
  }, [slack, workspaceId, connectionId]);

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
      appToken.show((await revealWorkspaceConnectionAppToken(connectionId)) ?? '');
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not reveal the app-level token.'));
    }
  }

  async function handleReveal() {
    try {
      secret.show((await revealWorkspaceConnectionSecret(connectionId)) ?? '');
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not reveal the credentials.'));
    }
  }

  /**
   * The secrets this workspace keeps, and only those.
   *
   * A VALUE is read with the variable listing, and a value on a listing is a
   * value on a screen - so a credential may not be pointed at one, and the
   * server refuses it. Filtered here rather than left to that refusal: an
   * option offered and then rejected teaches the rule at the cost of a save.
   */
  const secrets = useMemo(
    () =>
      variables
        .filter((variable) => variable.kind === 'SECRET')
        .map((variable) => ({ value: variable.id, label: variable.name, hint: variable.catalogName })),
    [variables],
  );

  /**
   * The list one field offers, with whatever it already reads kept in it even
   * before the variables arrive.
   *
   * The connection carries each variable's name and catalog precisely so a
   * screen need not ask twice; without this row the picker would sit on its
   * placeholder while the list is in flight, which reads as a field that has
   * chosen nothing.
   */
  function offered(held: string | null, called: string | null, catalog: string | null) {
    if (held === null || called === null) return secrets;
    if (secrets.some((option) => option.value === held)) return secrets;
    return [{ value: held, label: called, hint: catalog ?? '' }, ...secrets];
  }

  /** Which of the two a field is, and what that costs this form. */
  function chooseSource(field: SecretFieldHandle, next: SecretSource) {
    field.choose(next);
    // Reaching for the list is a reason to read it again: somebody about to
    // point a field at a secret has often just been to Variables to make it.
    if (next === 'VARIABLE') refreshVariables();
    setSaveError(null);
    setSaved(false);
  }

  /** Cleared as soon as either field is touched, whichever way it was touched. */
  function touched() {
    setSaveError(null);
    setSaved(false);
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
      setNameError(cause instanceof Error ? cause.message : t('Could not rename the connection.'));
    } finally {
      setSavingName(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    // Said before the save rather than after it: a picker left on its
    // placeholder is a field that has not been answered.
    if (secret.unchosen) {
      setSaveError(`Choose the workspace secret this connection reads its ${secretLabel(kind)} from.`);
      setSaved(false);
      return;
    }
    if (slack && appToken.unchosen) {
      setSaveError(t('Choose the workspace secret this connection reads its app-level token from.'));
      setSaved(false);
      return;
    }

    const sendingSecret = secret.sending;
    const sendingAppToken = appToken.sending;

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
        /*
         * Each field's answer, in the names this mutation gives it.
         *
         * One of the two, never both and never neither by accident. A variable
         * sent drops any copy that field held and a value sent drops any
         * reference, so the exclusivity is the server's rule as much as this
         * form's - and sending the pair is a BAD_REQUEST rather than something
         * resolved by precedence. Nothing sent is what says "leave the stored
         * one alone", which is what a masked box means and is the easiest thing
         * on this page to break.
         */
        ...(sendingSecret === null
          ? {}
          : 'variable' in sendingSecret
            ? { secretVariableId: sendingSecret.variable }
            : { secret: sendingSecret.value }),
        ...(sendingAppToken === null
          ? {}
          : 'variable' in sendingAppToken
            ? { appTokenVariableId: sendingAppToken.variable }
            : { appToken: sendingAppToken.value }),
        urlOverride: slack ? undefined : urlOverride.trim(),
        // Only for a mail connection: sending these for a Slack one would write
        // settings nothing reads and clear what somebody typed elsewhere.
        smtpPort: mail ? Number(smtpPort) : undefined,
        smtpUsername: mail ? smtpUsername.trim() : undefined,
        smtpFrom: mail ? smtpFrom.trim() : undefined,
        smtpSecurity: mail ? smtpSecurity : undefined,
      });
      setConnection(updated);
      secret.reset({ stored: updated.secretSet, variable: updated.secretVariableId });
      appToken.reset({ stored: updated.appTokenSet, variable: updated.appTokenVariableId });
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not save the credentials.'));
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
      setSaveError(cause instanceof Error ? cause.message : t('Could not check the connection.'));
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
          <BackLink to={`/workspace/${workspaceId}/integrations`} label={t('Integrations')} />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/integrations`}>
            {t('Integrations')}
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{connection?.name ?? '…'}</span>
        </p>
        <h1 className={styles.title}>{t('Connection Settings')}</h1>
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
              <h2 className={styles.cardTitle}>{t('General')}</h2>
              <p className={styles.cardSubtitle}>
                {locked
                  ? t('Connection settings inherited from admin defaults')
                  : t('Connection settings for this workspace')}
              </p>
            </div>

            {/*
              An inherited connection's name belongs to the admin default, so it
              stays read-only. A workspace's own is the workspace's to change —
              the API has always accepted it; there was simply nowhere to type.
            */}
            {locked ? (
              <ReadOnlyField label={t('Integration Name')} value={connection?.name ?? ''} locked />
            ) : (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="connection-name">
                  {t('Integration Name')}
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="connection-name"
                    className={styles.input}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('Name this connection')}
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
                label={t('Type')}
                value={connection === null ? '' : connectionTypeLabel(connection.type)}
                locked={locked}
              />
            ) : (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="connection-type">{t('Type')}</label>
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
              label={mail ? t('Mail Server') : t('Default API Host URL')}
              value={connection?.url ?? ''}
              locked={locked}
            />

            {!locked && (
              <div className={styles.actionRow}>
                {namedSaved && nameError === null && <p className={styles.savedNote}>{t('Saved.')}</p>}
                {nameError !== null && <p className={styles.savedNote}>{nameError}</p>}
                <button
                  type="button"
                  className={styles.save}
                  onClick={() => void handleSaveName()}
                  disabled={savingName || name.trim() === '' || name.trim() === connection?.name}
                >
                  {savingName ? t('Saving…') : t('Save Name')}
                </button>
              </div>
            )}
          </section>

          <form className={styles.card} onSubmit={handleSave}>
            <h2 className={styles.cardTitle}>{t('Active Credentials')}</h2>

            {/*
              * Not for Slack, which authenticates one way. The server sets
              * BEARER_TOKEN on every save regardless of what arrives, so a
              * chooser here offers four answers and keeps one.
              */}
            {!slack && !mail && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="connection-auth">{t('Auth Type')}</label>
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
                      {t('From Address')}
                    </label>
                    <FieldHint label={t('From Address')}>
                      {t('Every mail this connection sends is from this address, and a provider that has not authorised it refuses the message however good the password is.')}
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
                    {t('Security')}
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
                  <label className={styles.label} htmlFor="connection-smtp-port">{t('Port')}</label>
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
                    {t('Username')}
                  </label>
                  <div className={styles.inputWrapper}>
                    <input
                      id="connection-smtp-username"
                      name="smtpUsername"
                      className={styles.input}
                      type="text"
                      placeholder={t('Leave empty to send without authenticating')}
                      value={smtpUsername}
                      onChange={(event) => setSmtpUsername(event.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {/*
              Each credential, and where it comes from - the choice standing
              beside that field's own name rather than above the card.

              A connection is exactly the shape that makes the difference
              visible. A Slack one holds two credentials, and "this connection
              uses a workspace secret" cannot mean one of them without meaning
              the other; two of these can, because each is named after the field
              it governs and each has one input under it. See
              components/SecretField.tsx.
            */}
            <SecretField
              id="connection-secret"
              label={secretLabel(kind)}
              field={secret}
              options={offered(
                connection?.secretVariableId ?? null,
                connection?.secretVariableName ?? null,
                connection?.secretVariableCatalog ?? null,
              )}
              variablesPath={`/workspace/${workspaceId}/variables`}
              placeholder={mail ? t('Enter password...') : t('Enter token or key...')}
              hint={secretHint(kind)}
              onSource={(next) => chooseSource(secret, next)}
              onValue={touched}
              onVariable={touched}
              onReveal={() => void handleReveal()}
              broken={
                connection?.secretVariableMissing === true
                  ? `The workspace secret this ${secretLabel(kind).toLowerCase()} was read from is gone, so this connection has nothing to authenticate with. Its address is fine. Point this field at another secret, or give it a value of its own.`
                  : null
              }
            />

            {slack && (
              <SecretField
                id="connection-app-token"
                label={t('App-Level Token')}
                field={appToken}
                options={offered(
                  connection.appTokenVariableId,
                  connection.appTokenVariableName,
                  connection.appTokenVariableCatalog,
                )}
                variablesPath={`/workspace/${workspaceId}/variables`}
                placeholder="xapp-..."
                hint={
                  <>
                    Optional, and beginning <code>xapp-</code>. From Basic Information, with
                    connections:write. Given one, orknux listens for mentions and runs the triggers
                    waiting on them; left empty, this connection only sends.
                  </>
                }
                onSource={(next) => chooseSource(appToken, next)}
                onValue={touched}
                onVariable={touched}
                onReveal={() => void handleRevealAppToken()}
                broken={
                  connection.appTokenVariableMissing
                    ? t('The workspace secret this app-level token was read from is gone, so this connection cannot listen. Point this field at another secret, or give it a value of its own.')
                    : null
                }
              />
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
                {t('URL Override')}
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

            {/*
              What this token cannot do, beside what it is.

              A connection can be green - the credential is real, Slack answered
              it - and still be one no message will ever arrive on, because a
              bot token set up only to post carries no history scope. That is a
              fact about the token and belongs on the token's page, in the words
              the server already uses for it.

              `receives === false` and never `!receives`: null is Slack having
              said nothing about scopes, and a page that warned on it would send
              somebody to rebuild an installation that is fine.
            */}
            {botUser?.receives === false && botUser.message !== '' && (
              <p className={styles.cannotReceive} id="connection-receives">
                {botUser.message}
              </p>
            )}

            {/* Checking and saving are the two things to do here, so they sit together. */}
            <div className={styles.actionRow}>
              {saved && saveError === null && <p className={styles.savedNote}>{t('Saved.')}</p>}
              <button type="button" className={styles.testButton} onClick={handleTest} disabled={testing}>
                {testing ? 'Checking…' : t('Test Connection')}
              </button>
              <button type="submit" className={styles.save} disabled={saving}>
                {saving ? t('Saving…') : t('Save Credentials')}
              </button>
            </div>
          </form>

          <section className={`${styles.card} ${styles.dangerCard}`}>
            <h2 className={styles.dangerHeading}>{t('Danger Zone')}</h2>
            <div className={styles.dangerRow}>
              <div className={styles.dangerText}>
                <p className={styles.dangerTitle}>Disconnect {connection?.name ?? ''}</p>
                <p className={styles.dangerMessage}>
                  {locked
                    ? t('Clear the credentials this workspace stored and reset to admin defaults.')
                    : t('Permanently remove this custom integration connection from the workspace.')}
                </p>
              </div>
              <button type="button" className={styles.dangerActionFilled} onClick={handleDisconnect}>
                {t('Disconnect')}
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
        {locked && <img src={lockIcon} alt={t("Managed by the admin")} width={12} height={12} />}
      </div>
    </div>
  );
}
