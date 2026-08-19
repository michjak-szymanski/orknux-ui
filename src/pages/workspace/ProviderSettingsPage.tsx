import { useEffect, useState } from 'react';
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
import infoIcon from '../../assets/info.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './ProviderSettingsPage.module.css';

export interface ProviderSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PROVIDER_TYPES: ProviderType[] = [
  'OPENAI',
  'ANTHROPIC',
  'AZURE_OPENAI',
  'GOOGLE_AI',
  'OLLAMA',
  'CUSTOM',
];

/** The versions Azure OpenAI is commonly pinned to; the field still accepts any. */
const API_VERSIONS = ['2024-06-01', '2024-08-01-preview', '2024-10-21', '2025-01-01-preview'];

/** Stands in for a stored credential until the caller asks to see it. */
const MASK = '••••••••••••••••';

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
    case 'GOOGLE_AI':
      return 'https://generativelanguage.googleapis.com';
    case 'OLLAMA':
      return 'http://localhost:11434';
    case 'CUSTOM':
      return 'https://…';
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
  // Null while a stored credential is untouched, so saving leaves it alone.
  const [secret, setSecret] = useState<string | null>(adding ? '' : null);
  const [revealed, setRevealed] = useState(false);

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
          setLoadError('That provider does not exist, or you do not have access to it.');
          return;
        }
        apply(found);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the provider.');
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
    setSecret(null);
    setRevealed(false);
  }

  const azure = type === 'AZURE_OPENAI';
  const entra = azure && authMethod === 'ENTRA_ID';

  function values() {
    return {
      name: name.trim(),
      type,
      endpoint: endpoint.trim(),
      // Only Azure OpenAI offers Entra ID, so anything else is a key.
      authMethod: azure ? authMethod : ('API_KEY' as ProviderAuthMethod),
      ...(secret === null ? {} : { secret }),
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
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the provider.');
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
      setSaveError(cause instanceof Error ? cause.message : 'Could not check the provider.');
    } finally {
      setTesting(false);
    }
  }

  async function handleReveal() {
    if (providerId === undefined) return;
    try {
      const stored = await revealProviderSecret(providerId);
      setSecret(stored ?? '');
      setRevealed(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not reveal the credentials.');
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
      setSaveError(cause instanceof Error ? cause.message : 'Could not remove the provider.');
    }
  }

  const secretLabel = entra ? 'Client Secret' : 'API Key';

  return (
    <AppShell
      title={adding ? 'New provider' : provider?.name}
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="models" />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={`/workspace/${workspaceId}/models`} label="Models" />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/models`}>
            Models
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{adding ? 'Add Provider' : (provider?.name ?? '…')}</span>
        </p>
        <h1 className={styles.pageTitle}>{adding ? 'Add Provider' : (provider?.name ?? 'Provider')}</h1>
        <p className={styles.subtitle}>Configure a new LLM provider for your workspace</p>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Provider</h2>
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
                  placeholder="Azure OpenAI Production"
                  required
                />
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{azure ? 'Azure Configuration' : 'Endpoint'}</h2>
            <div className={styles.divider} />
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="provider-endpoint">
                  {azure ? 'Azure Endpoint' : 'API Endpoint'} <span className={styles.required}>*</span>
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
                  <div className={styles.selectWrapper}>
                    <select
                      id="api-version"
                      className={`${styles.input} ${styles.select}`}
                      value={apiVersion}
                      onChange={(event) => setApiVersion(event.target.value)}
                    >
                      {API_VERSIONS.map((version) => (
                        <option key={version} value={version}>
                          {version}
                        </option>
                      ))}
                    </select>
                    <img className={styles.chevron} src={chevronDown12Icon} alt="" width={12} height={12} />
                  </div>
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
                    placeholder="East US"
                  />
                </div>
              </div>
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Authentication</h2>
            <div className={styles.divider} />

            {/* Only Azure OpenAI has a second way in, so only it offers a choice. */}
            {azure && (
              <div className={styles.field}>
                <span className={styles.label}>Authentication Method</span>
                <div className={styles.segmented} role="tablist" aria-label="Authentication method">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authMethod === 'API_KEY'}
                    className={authMethod === 'API_KEY' ? styles.segmentActive : styles.segment}
                    onClick={() => setAuthMethod('API_KEY')}
                  >
                    API Key
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authMethod === 'ENTRA_ID'}
                    className={authMethod === 'ENTRA_ID' ? styles.segmentActive : styles.segment}
                    onClick={() => setAuthMethod('ENTRA_ID')}
                  >
                    Service Principal
                  </button>
                </div>
                <p className={styles.hint}>
                  {entra
                    ? 'Signs in as an Entra ID service principal: the app registration and its secret are exchanged for a token on each call. No key is stored against the resource.'
                    : 'Sends one of the keys from the Azure OpenAI resource on every request.'}
                </p>
              </div>
            )}

            {entra && (
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="tenant-id">
                    Directory (tenant) ID
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
                    Application (client) ID
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

            <div className={styles.field}>
              <label className={styles.label} htmlFor="provider-secret">
                {secretLabel} <span className={styles.required}>*</span>
              </label>
              <div className={styles.secretRow}>
                <input
                  id="provider-secret"
                  className={`${styles.input} ${styles.inputMono}`}
                  type={revealed || secret === '' ? 'text' : 'password'}
                  value={secret ?? MASK}
                  onChange={(event) => setSecret(event.target.value)}
                  onFocus={() => {
                    // Typing replaces the stored one rather than editing a mask.
                    if (secret === null) setSecret('');
                  }}
                  placeholder={entra ? 'Client secret' : 'sk-…'}
                />
                {!adding && provider?.secretSet === true && !revealed && (
                  <button type="button" className={styles.revealButton} onClick={() => void handleReveal()}>
                    Reveal
                  </button>
                )}
              </div>
              <p className={styles.hintRow}>
                <img src={infoIcon} alt="" width={14} height={14} />
                {entra
                  ? 'Register an app in Azure AD → App registrations → Certificates & secrets'
                  : azure
                    ? 'Found in Azure Portal → Resource → Keys and Endpoint'
                    : 'The key the provider issued for this workspace.'}
              </p>
            </div>

            {entra && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="scope">
                  Scope
                </label>
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
                        ? 'Connection successful'
                        : providerStatusLabel(provider.status))}
                  </span>
                </>
              ) : (
                saved && <span className={styles.statusConnected}>Saved.</span>
              )}
            </div>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleTest()}
                disabled={testing || name.trim() === '' || endpoint.trim() === ''}
              >
                {testing ? 'Checking…' : 'Test Connection'}
              </button>
              <button type="submit" className={styles.primaryButton} disabled={saving}>
                {saving ? 'Saving…' : adding ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      )}

      <section className={styles.dangerCard}>
        <h2 className={styles.dangerHeading}>Danger Zone</h2>
        <div className={styles.divider} />
        <div className={styles.dangerRow}>
          <div className={styles.dangerText}>
            <span className={styles.dangerTitle}>{adding ? 'Discard Changes' : 'Remove Provider'}</span>
            <span className={styles.dangerNote}>
              {adding
                ? 'Cancel provider setup and return to Models'
                : 'Remove this provider, and every model reached through it'}
            </span>
          </div>
          <button type="button" className={styles.dangerButton} onClick={() => void handleDiscard()}>
            {adding ? 'Discard' : 'Remove Provider'}
          </button>
        </div>
      </section>
    </AppShell>
  );
}
