import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  fetchModels,
  modelKindLabel,
  fetchProviders,
  providerStatusLabel,
  setModelEnabled,
} from '../../api/models';
import type { Model, ModelProvider, ProviderStatus } from '../../api/models';
import type { SessionUser } from '../../api/session';
import settingsIcon from '../../assets/settings-14.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { ModelDialog } from '../../components/ModelDialog';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceModelsPage.module.css';
import { t } from '../../i18n';

export interface WorkspaceModelsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** Green once a check reached the provider, red when one failed, grey until then. */
function statusDot(status: ProviderStatus): string {
  switch (status) {
    case 'CONNECTED':
      return styles.dotConnected;
    case 'FAILED':
      return styles.dotFailed;
    default:
      return styles.dotIdle;
  }
}

export function WorkspaceModelsPage({ session, onSignOut }: WorkspaceModelsPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [providers, setProviders] = useState<ModelProvider[] | null>(null);
  const [models, setModels] = useState<Model[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingModel, setAddingModel] = useState(false);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setError(null);
    Promise.all([fetchProviders(workspaceId), fetchModels(workspaceId)])
      .then(([loadedProviders, loadedModels]) => {
        setProviders(loadedProviders);
        setModels(loadedModels);
      })
      .catch((cause: unknown) => {
        setProviders(null);
        setModels(null);
        setError(cause instanceof Error ? cause.message : t('Could not load the models.'));
      });
  }, [workspaceId]);

  useEffect(load, [load]);

  async function toggle(model: Model) {
    try {
      await setModelEnabled(model.id, !model.enabled);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not change the model.'));
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.contentHeader}>
        <h1 className={styles.title}>{t('Models')}</h1>
        <p className={styles.subtitle}>
          {t('Manage LLM providers and available models for your workspace')}
        </p>
      </header>

      {error !== null && (
        <p className={styles.pageError} role="alert">
          {error}
        </p>
      )}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{t('Providers')}</h2>
          <Link className={styles.addButton} to={`/workspace/${workspaceId}/models/providers/new`}>
            {t('+ Add Provider')}
          </Link>
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colProvider}>{t('Provider')}</span>
          <span className={styles.colGrow}>{t('API Endpoint')}</span>
          <span className={styles.colStatus}>{t('Status')}</span>
          <span className={styles.colActions}>{t('Actions')}</span>
        </div>

        {providers === null && error === null && <p className={styles.notice}><Loader /></p>}
        {providers?.length === 0 && <p className={styles.notice}>{t('No providers yet.')}</p>}

        {providers?.map((provider) => (
          // The whole row opens it, the way a connection's row does on
          // Integrations: a cog at the far right is a small target for the only
          // thing anybody wants from a row. The name is a real link, so the row
          // is reachable by keyboard and announced as somewhere to go — the
          // click on the row is a wider target for the mouse and nothing more.
          <div
            key={provider.id}
            className={`${styles.row} ${styles.rowOpens}`}
            onClick={() => navigate(`/workspace/${workspaceId}/models/providers/${provider.id}`)}
          >
            <span className={`${styles.colProvider} ${styles.providerName}`}>
              <Link
                className={styles.openName}
                to={`/workspace/${workspaceId}/models/providers/${provider.id}`}
              >
                {provider.name}
              </Link>
              {/*
                Where this provider's key comes from, where that is not "its
                own" - which is the state of the thing being looked at rather
                than an explanation of it, so it is printed.

                The broken one is said in words about the secret and says the
                endpoint is not the problem, because a provider that has lost
                its credential fails a check exactly the way an unreachable one
                does, and the row is where that gets read as an address to go
                and fix. That is issue #211 in its other clothes.
              */}
              {provider.secretVariableMissing ? (
                <span className={styles.secretGone} data-secret-missing="">
                  {t('Its workspace secret is gone — not its endpoint')}
                </span>
              ) : provider.secretVariableName !== null ? (
                <span className={styles.secretFrom} data-secret-variable="">
                  Reads {provider.secretVariableName} · {provider.secretVariableCatalog}
                </span>
              ) : null}
            </span>
            <span className={`${styles.colGrow} ${styles.endpoint}`}>{provider.endpoint}</span>
            <span className={styles.colStatus}>
              <span
                className={`${styles.dot} ${statusDot(provider.status)}`}
                aria-hidden="true"
                title={provider.lastCheckMessage ?? undefined}
              />
              {providerStatusLabel(provider.status)}
            </span>
            <span className={styles.colActions}>
              <Link
                className={styles.rowAction}
                to={`/workspace/${workspaceId}/models/providers/${provider.id}`}
                aria-label={`Settings for ${provider.name}`}
                title={`Settings for ${provider.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </span>
          </div>
        ))}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{t('Available Models')}</h2>
          {/* A model belongs to a provider, so there is nothing to add without one. */}
          <button
            type="button"
            className={styles.addButton}
            onClick={() => setAddingModel(true)}
            disabled={providers === null || providers.length === 0}
          >{t('+ Add Model')}</button>
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colModel}>{t('Model')}</span>
          <span className={styles.colProviderName}>{t('Provider')}</span>
          <span className={styles.colKind}>{t('Type')}</span>
          <span className={styles.colToggle}>{t('Status')}</span>
          <span className={styles.colGrow} />
          <span className={styles.colActions}>{t('Actions')}</span>
        </div>

        {models === null && error === null && <p className={styles.notice}><Loader /></p>}
        {models?.length === 0 && (
          <p className={styles.notice}>
            {providers?.length === 0
              ? t('Add a provider first; models belong to one.')
              : t('No models yet.')}
          </p>
        )}

        {models?.map((model) => (
          // As above. Both lists on this page behave the same way; a page where
          // half the rows open and half do not is worse than neither.
          <div
            key={model.id}
            className={`${styles.row} ${styles.rowOpens}`}
            onClick={() => navigate(`/workspace/${workspaceId}/models/${model.id}`)}
          >
            <Link className={`${styles.colModel} ${styles.openName}`} to={`/workspace/${workspaceId}/models/${model.id}`}>
              {model.name}
            </Link>
            <span className={`${styles.colProviderName} ${styles.providerCell}`}>{model.providerName}</span>
            {/* What it is for: a chat model and a transcription one are chosen in
                different places, and the list is where that is checked. */}
            <span className={`${styles.colKind} ${styles.providerCell}`}>{modelKindLabel(model.kind)}</span>
            <span className={styles.colToggle}>
              <button
                type="button"
                className={styles.toggle}
                /*
                 * The switch stops the click reaching the row, which would
                 * otherwise open the model's page from under the finger that
                 * only meant to turn it off.
                 */
                onClick={(event) => {
                  event.stopPropagation();
                  void toggle(model);
                }}
                role="switch"
                aria-checked={model.enabled}
                aria-label={`${model.enabled ? 'Deactivate' : 'Activate'} ${model.name}`}
                title={model.enabled ? 'Deactivate' : 'Activate'}
              >
                <img src={model.enabled ? toggleOnIcon : toggleOffIcon} alt="" width={36} height={20} data-keeps-colour />
              </button>
              <span className={styles.toggleLabel}>{model.enabled ? 'Active' : 'Inactive'}</span>
            </span>
            <span className={styles.colGrow} />
            <span className={styles.colActions}>
              <Link
                className={styles.rowAction}
                to={`/workspace/${workspaceId}/models/${model.id}`}
                aria-label={`Settings for ${model.name}`}
                title={`Settings for ${model.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </span>
          </div>
        ))}
      </section>

      <ModelDialog
        open={addingModel}
        workspaceId={workspaceId}
        providers={providers ?? []}
        onClose={() => setAddingModel(false)}
        onCreated={() => {
          setAddingModel(false);
          load();
        }}
      />
    </AppShell>
  );
}
