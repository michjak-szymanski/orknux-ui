import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  createProvider,
  fetchProvider,
  providerStatusLabel,
  providerTypeLabel,
  removeProvider,
  revealProviderSecret,
  testProvider,
  updateProvider,
} from '../../api/models';
import type { ModelProvider, ProviderAuthMethod, ProviderType } from '../../api/models';
import type { SessionUser } from '../../api/session';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { SecretField, useSecretField } from '../../components/SecretField';
import type { SecretSource } from '../../components/SecretField';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import { useWorkspaceVariables } from './workspaceVariables';
import styles from './ProviderSettingsPage.module.css';
import { t } from '../../i18n';

export interface ProviderSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

// The type says what the endpoint speaks, not who is answering at it, which is
// why there is no entry here for a provider we have not heard of. Anything that
// speaks the OpenAI shape at an address of its own - a local server, a gateway,
// Google's OpenAI-compatible surface - is OpenAI with its own endpoint typed
// below, and that is exactly what the "Custom" this replaces was sending.
const PROVIDER_TYPES: ProviderType[] = [
  'OPENAI',
  'ANTHROPIC',
  'AZURE_OPENAI',
  'OLLAMA',
];

/** The versions Azure OpenAI is commonly pinned to; the field still accepts any. */
// Offered, not imposed. Azure ships a new API version every few months and a
// model released after this list was written is only reachable on one that is
// not in it - so these are suggestions on a field that takes anything, and the
// provider column has always been free text. A closed list here was the whole
// reason a new deployment answered 404 with no way to say otherwise.
const API_VERSIONS = ['2024-06-01', '2024-08-01-preview', '2024-10-21', '2025-01-01-preview'];

const DEFAULT_SCOPE = 'https://cognitiveservices.azure.com/.default';

/** What each type's endpoint usually looks like, as a hint and nothing more. */
function endpointHint(type: ProviderType): string {
  switch (type) {
    case 'OPENAI':
      return 'https://api.openai.com/v1';
    case 'ANTHROPIC':
      return 'https://api.anthropic.com/v1';
    case 'AZURE_OPENAI':
      return 'https://myinstance.openai.azure.com';
    case 'OLLAMA':
      // The OpenAI-compatible half of Ollama, which is the half this talks to:
      // `/v1/models` and `/v1/chat/completions`. The bare port serves Ollama's
      // own API at `/api/...` and 404s on both of those.
      return 'http://localhost:11434/v1';
  }
}

/**
 * Adds a provider, and edits one afterwards — the same form either way, because
 * what it asks for does not change once the provider exists.
 */
export function ProviderSettingsPage({ session, onSignOut }: ProviderSettingsPageProps) {
  const { workspaceId = '', providerId } = useParams();
  const navigate = useNavigate();
  const adding = providerId === undefined;
  const { variables, refresh: refreshVariables } = useWorkspaceVariables(workspaceId);

  const [provider, setProvider] = useState<ModelProvider | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<ProviderType>('OPENAI');
  const [endpoint, setEndpoint] = useState('');
  const [authMethod, setAuthMethod] = useState<ProviderAuthMethod>('API_KEY');
  const [apiVersion, setApiVersion] = useState(API_VERSIONS[0]);
  const [deploymentName, setDeploymentName] = useState('');
  const [region, setRegion] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [scope, setScope] = useState(DEFAULT_SCOPE);
  /**
   * The one secret this provider has, whatever it is called this minute.
   *
   * A provider keeps a single secret column, serving the API key or the Entra
   * client secret and never both at once — so there is one of these here. It is
   * a handle rather than four pieces of state on this page because a card with
   * two secrets is two calls to `useSecretField` and nothing else: a Slack
   * connection's bot token and app token would each get their own, each
   * answering for itself.
   */
  const key = useSecretField({ stored: !adding });

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  /**
   * The provider this page created, before anyone pressed Create.
   *
   * Test Connection has to save first — a check runs against what is stored, not
   * against what is typed — but saving is not finishing. Remembering the id here
   * keeps the page in the create it is in the middle of: the button still says
   * Create, and pressing it updates that row rather than making a second one.
   */
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (providerId === undefined) return;
    fetchProvider(providerId)
      .then((found) => {
        if (found === null) {
          setLoadError(t('That provider does not exist, or you do not have access to it.'));
          return;
        }
        apply(found);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : t('Could not load the provider.'));
      });
  }, [providerId]);

  /**
   * Saving a provider makes the server check it, on its own thread so the form
   * does not wait. The answer therefore lands just after the save returns, and
   * this is what picks it up — otherwise the page would say "Not checked" until
   * something else made it reload, which is the thing the automatic check was
   * meant to stop.
   *
   * It gives up rather than polling forever: if no check has landed in ten
   * seconds, the status on the screen is the true one.
   */
  useEffect(() => {
    if (providerId === undefined) return;
    if (provider === null || provider.status !== 'NOT_CHECKED') return;

    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > 5) {
        clearInterval(timer);
        return;
      }
      fetchProvider(providerId)
        .then((found) => {
          if (found !== null && found.status !== 'NOT_CHECKED') {
            clearInterval(timer);
            setProvider(found);
          }
        })
        .catch(() => clearInterval(timer));
    }, 2000);

    return () => clearInterval(timer);
  }, [providerId, provider]);

  function apply(found: ModelProvider) {
    setProvider(found);
    setName(found.name);
    setType(found.type);
    setEndpoint(found.endpoint);
    setAuthMethod(found.authMethod);
    setApiVersion(found.apiVersion ?? API_VERSIONS[0]);
    setDeploymentName(found.deploymentName ?? '');
    setRegion(found.region ?? '');
    setTenantId(found.tenantId ?? '');
    setClientId(found.clientId ?? '');
    setScope(found.scope ?? DEFAULT_SCOPE);
    key.reset({ stored: found.secretSet, variable: found.secretVariableId });
  }

  /** Which of the two the key field is, and what it costs this form. */
  function chooseSource(next: SecretSource) {
    key.choose(next);
    // Reaching for the list is a reason to read it again: somebody about to
    // point a provider at a secret has often just been to Variables to make it.
    if (next === 'VARIABLE') refreshVariables();
    setSaveError(null);
    setSaved(false);
  }

  const azure = type === 'AZURE_OPENAI';
  const entra = azure && authMethod === 'ENTRA_ID';
  /*
   * What the one secret field is called, which the authentication method
   * decides. The choice of where it comes from is that field's whatever it is
   * called this minute, so the label goes to the field and the field names the
   * control - rather than a card-level word standing in for both.
   */
  const secretLabel = entra ? t('Client Secret') : t('API Key');

  /**
   * The secrets this workspace keeps, and only those.
   *
   * A VALUE is read with the variable listing, and a value on a listing is a
   * value on a screen - so a provider may not be pointed at one, and the server
   * refuses it. Filtered here rather than left to that refusal: an option
   * offered and then rejected teaches the rule at the cost of a save, and the
   * rule is knowable before the choice is made.
   */
  const secrets = useMemo(
    () =>
      variables
        .filter((variable) => variable.kind === 'SECRET')
        .map((variable) => ({
          value: variable.id,
          label: variable.name,
          hint: variable.catalogName,
        })),
    [variables],
  );

  /*
   * The one it already reads, kept in the list even before the list arrives.
   *
   * The provider carries the variable's name and catalog with it precisely so a
   * screen need not ask twice; without this row the picker would sit on its
   * placeholder for as long as the variable list is in flight, which reads as a
   * provider that has chosen nothing.
   */
  const offered = useMemo(() => {
    const held = provider?.secretVariableId ?? null;
    const called = provider?.secretVariableName ?? null;
    if (held === null || called === null) return secrets;
    if (secrets.some((option) => option.value === held)) return secrets;
    return [{ value: held, label: called, hint: provider?.secretVariableCatalog ?? '' }, ...secrets];
  }, [provider, secrets]);

  /** What the form will not send, said before it is sent rather than after. */
  function refused(): string | null {
    if (key.unchosen) return `Choose the workspace secret this provider reads its ${secretLabel} from.`;
    return null;
  }

  function values() {
    const sending = key.sending;
    return {
      name: name.trim(),
      type,
      endpoint: endpoint.trim(),
      // Only Azure OpenAI offers Entra ID, so anything else is a key.
      authMethod: azure ? authMethod : ('API_KEY' as ProviderAuthMethod),
      /*
       * The key field's answer, in the names this mutation gives it.
       *
       * One of the two, never both and never neither by accident. A variable
       * sent drops any copy the provider held and a key sent drops any
       * reference, so the exclusivity is the server's rule as much as this
       * form's - and sending the pair is a BAD_REQUEST rather than something
       * resolved by precedence. Which of the three it is - the variable, a new
       * key, or nothing at all - is the field's own to work out, because that
       * is the rule a second secret field on a card would otherwise write out a
       * second time and slightly differently. Nothing sent is what says "leave
       * the stored one alone", and it is the easiest thing here to break.
       */
      ...(sending === null
        ? {}
        : 'variable' in sending
          ? { secretVariableId: sending.variable }
          : { secret: sending.value }),
      apiVersion: azure ? apiVersion : null,
      deploymentName: azure ? deploymentName.trim() || null : null,
      region: azure ? region.trim() || null : null,
      tenantId: entra ? tenantId.trim() || null : null,
      clientId: entra ? clientId.trim() || null : null,
      scope: entra ? scope.trim() || null : null,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '' || endpoint.trim() === '' || saving) return;

    const wrong = refused();
    if (wrong !== null) {
      setSaveError(wrong);
      setSaved(false);
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      if (adding) {
        // Created, or finished off the one Test Connection had to save.
        if (createdId === null) await createProvider(workspaceId, values());
        else await updateProvider(createdId, values());
        // Back to the list it was started from: the provider is made, and the
        // form has nothing left to say.
        navigate(`/workspace/${workspaceId}/models`);
        return;
      }
      apply(await updateProvider(providerId, values()));
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not save the provider.'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * A check runs against what is stored, so an unsaved provider is saved first
   * rather than checked against something it no longer is.
   */
  async function handleTest() {
    if (testing) return;

    const wrong = refused();
    if (wrong !== null) {
      setSaveError(wrong);
      return;
    }

    setTesting(true);
    setSaveError(null);
    try {
      const target = adding
        ? createdId === null
          ? await createProvider(workspaceId, values())
          : await updateProvider(createdId, values())
        : await updateProvider(providerId, values());
      const checked = await testProvider(target.id);
      apply(checked);
      // Stay on the form. Navigating to the saved provider here is what turned
      // a half-finished create into an edit, and the button into Save Changes.
      if (adding) setCreatedId(checked.id);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not check the provider.'));
    } finally {
      setTesting(false);
    }
  }

  async function handleReveal() {
    if (providerId === undefined) return;
    try {
      key.show((await revealProviderSecret(providerId)) ?? '');
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not reveal the credentials.'));
    }
  }

  async function handleDiscard() {
    // Abandoning a create leaves nothing behind — including the row Test
    // Connection had to save to have something to check.
    const remove = adding ? createdId : providerId;
    if (remove === undefined || remove === null) {
      navigate(`/workspace/${workspaceId}/models`);
      return;
    }
    try {
      await removeProvider(remove);
      navigate(`/workspace/${workspaceId}/models`);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not remove the provider.'));
    }
  }


  return (
    <AppShell
      title={adding ? t('New provider') : provider?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={`/workspace/${workspaceId}/models`} label={t('Models')} />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/models`}>
            {t('Models')}
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{adding ? t('Add Provider') : (provider?.name ?? '…')}</span>
        </p>
        <h1 className={styles.pageTitle}>{adding ? t('Add Provider') : (provider?.name ?? 'Provider')}</h1>
        <p className={styles.subtitle}>{t('Configure a new LLM provider for your workspace')}</p>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : !adding && provider === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{t('Provider')}</h2>
            <div className={styles.divider} />
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="provider-type">
                  Provider Type <span className={styles.required}>*</span>
                </label>
                <div className={styles.selectWrapper}>
                  <select
                    id="provider-type"
                    className={`${styles.input} ${styles.select}`}
                    value={type}
                    onChange={(event) => setType(event.target.value as ProviderType)}
                  >
                    {PROVIDER_TYPES.map((option) => (
                      <option key={option} value={option}>
                        {providerTypeLabel(option)}
                      </option>
                    ))}
                  </select>
                  <img className={styles.chevron} src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="provider-name">
                  Display Name <span className={styles.required}>*</span>
                </label>
                <input
                  id="provider-name"
                  className={styles.input}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("Azure OpenAI Production")}
                  required
                />
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{azure ? t('Azure Configuration') : 'Endpoint'}</h2>
            <div className={styles.divider} />
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="provider-endpoint">
                  {azure ? t('Azure Endpoint') : t('API Endpoint')} <span className={styles.required}>*</span>
                </label>
                <input
                  id="provider-endpoint"
                  className={`${styles.input} ${styles.inputMono}`}
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder={endpointHint(type)}
                  required
                />
              </div>
              {azure && (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="api-version">
                    API Version <span className={styles.required}>*</span>
                  </label>
                  <input
                    id="api-version"
                    className={`${styles.input} ${styles.inputMono}`}
                    list="api-versions"
                    value={apiVersion}
                    onChange={(event) => setApiVersion(event.target.value)}
                    placeholder={API_VERSIONS[API_VERSIONS.length - 1]}
                    required
                  />
                  <datalist id="api-versions">
                    {API_VERSIONS.map((version) => (
                      <option key={version} value={version} />
                    ))}
                  </datalist>
                </div>
              )}
            </div>

            {azure && (
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="deployment-name">
                    Deployment Name <span className={styles.required}>*</span>
                  </label>
                  <input
                    id="deployment-name"
                    className={`${styles.input} ${styles.inputMono}`}
                    value={deploymentName}
                    onChange={(event) => setDeploymentName(event.target.value)}
                    placeholder="gpt-4o-deployment"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="region">
                    Region <span className={styles.required}>*</span>
                  </label>
                  <input
                    id="region"
                    className={styles.input}
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                    placeholder={t("East US")}
                  />
                </div>
              </div>
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{t('Authentication')}</h2>
            <div className={styles.divider} />

            {/* Only Azure OpenAI has a second way in, so only it offers a choice. */}
            {azure && (
              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <span className={styles.label}>{t('Authentication Method')}</span>
                  {/*
                    What the method chosen actually does, said about whichever
                    is chosen - the field is a pair of tabs, so the answer to
                    "what is this" changes with the tab and the (?) follows it.
                  */}
                  <FieldHint label={t('Authentication Method')}>
                    {entra
                      ? t('Signs in as an Entra ID service principal: the app registration and its secret are exchanged for a token on each call. No key is stored against the resource.')
                      : t('Sends one of the keys from the Azure OpenAI resource on every request.')}
                  </FieldHint>
                </span>
                <div className={styles.segmented} role="tablist" aria-label={t('Authentication method')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authMethod === 'API_KEY'}
                    className={authMethod === 'API_KEY' ? styles.segmentActive : styles.segment}
                    onClick={() => setAuthMethod('API_KEY')}
                  >{t('API Key')}</button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authMethod === 'ENTRA_ID'}
                    className={authMethod === 'ENTRA_ID' ? styles.segmentActive : styles.segment}
                    onClick={() => setAuthMethod('ENTRA_ID')}
                  >Service Principal</button>
                </div>
              </div>
            )}

            {entra && (
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="tenant-id">
                    {t('Directory (tenant) ID')}
                  </label>
                  <input
                    id="tenant-id"
                    className={`${styles.input} ${styles.inputMono}`}
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="client-id">
                    {t('Application (client) ID')}
                  </label>
                  <input
                    id="client-id"
                    className={`${styles.input} ${styles.inputMono}`}
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
              </div>
            )}

            {/*
              The key, and where it comes from - one field, asked for one way at
              a time.

              The choice used to be a pair of tabs above this card, and it read
              as a mode of the card because that is where it was. That is
              harmless here by accident: a provider keeps one secret, serving
              whichever of the two names this field has. It would be useless on
              a card with two, so the control has moved onto the field it
              governs and is named after it. See components/SecretField.tsx.
            */}
            <SecretField
              id="provider-secret"
              label={secretLabel}
              required
              field={key}
              options={offered}
              variablesPath={`/workspace/${workspaceId}/variables`}
              placeholder={entra ? t('Client secret') : 'sk-…'}
              hint={
                entra
                  ? t('Register an app in Azure AD → App registrations → Certificates & secrets.')
                  : azure
                    ? t('Found in Azure Portal → Resource → Keys and Endpoint.')
                    : t('The key the provider issued for this workspace.')
              }
              onSource={chooseSource}
              onValue={() => {
                setSaveError(null);
                setSaved(false);
              }}
              onVariable={() => {
                setSaveError(null);
                setSaved(false);
              }}
              /* There is nothing stored to reveal until the provider exists. */
              onReveal={adding ? undefined : () => void handleReveal()}
              /*
                A reference pointing at nothing, said in words about the
                variable and inside the field that holds it.

                It is an error and stays in the open - see UI-DESIGN-RULES.md.
                The sentence names the secret as the thing that is wrong and
                says the endpoint is not, because the failure this replaces is a
                provider reporting "check the endpoint" for a reason that has
                nothing to do with the endpoint, which is what issue #211 was.
              */
              broken={
                provider?.secretVariableMissing === true
                  ? `The workspace secret this ${secretLabel} was read from is gone, so this provider has nothing to call with. Its endpoint is fine. Point this field at another secret, or give it a key of its own.`
                  : null
              }
            />

            {entra && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="scope">{t('Scope')}</label>
                <input
                  id="scope"
                  className={`${styles.input} ${styles.inputMono}`}
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                  placeholder={DEFAULT_SCOPE}
                />
              </div>
            )}
          </section>

          <div className={styles.footer}>
            <div className={styles.status}>
              {saveError !== null ? (
                <span className={styles.statusFailed} role="alert">
                  {saveError}
                </span>
              ) : provider !== null ? (
                <>
                  <span
                    className={`${styles.dot} ${
                      provider.status === 'CONNECTED'
                        ? styles.dotConnected
                        : provider.status === 'FAILED'
                          ? styles.dotFailed
                          : styles.dotIdle
                    }`}
                    aria-hidden="true"
                  />
                  <span
                    className={
                      provider.status === 'CONNECTED'
                        ? styles.statusConnected
                        : provider.status === 'FAILED'
                          ? styles.statusFailed
                          : styles.statusIdle
                    }
                  >
                    {/* What the check found, in its own words. A hardcoded
                        "Connection successful" over the top of it is how an
                        answer of 415 gets reported as a working provider. */}
                    {provider.lastCheckMessage ??
                      (provider.status === 'CONNECTED'
                        ? t('Connection successful')
                        : providerStatusLabel(provider.status))}
                  </span>
                </>
              ) : (
                saved && <span className={styles.statusConnected}>{t('Saved.')}</span>
              )}
            </div>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleTest()}
                disabled={testing || name.trim() === '' || endpoint.trim() === ''}
              >
                {testing ? 'Checking…' : t('Test Connection')}
              </button>
              <button type="submit" className={styles.primaryButton} disabled={saving}>
                {saving ? t('Saving…') : adding ? 'Create' : t('Save Changes')}
              </button>
            </div>
          </div>
        </form>
      )}

      <section className={styles.dangerCard}>
        <h2 className={styles.dangerHeading}>{t('Danger Zone')}</h2>
        <div className={styles.divider} />
        <div className={styles.dangerRow}>
          <div className={styles.dangerText}>
            <span className={styles.dangerTitle}>{adding ? t('Discard Changes') : t('Remove Provider')}</span>
            <span className={styles.dangerNote}>
              {adding
                ? t('Cancel provider setup and return to Models')
                : t('Remove this provider, and every model reached through it')}
            </span>
          </div>
          <button type="button" className={styles.dangerButton} onClick={() => void handleDiscard()}>
            {adding ? 'Discard' : t('Remove Provider')}
          </button>
        </div>
      </section>
    </AppShell>
  );
}
