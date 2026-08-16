import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

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
        setError(cause instanceof Error ? cause.message : 'Could not load the models.');
      });
  }, [workspaceId]);

  useEffect(load, [load]);

  async function toggle(model: Model) {
    try {
      await setModelEnabled(model.id, !model.enabled);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the model.');
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="models" />}
    >
      <header className={styles.contentHeader}>
        <h1 className={styles.title}>Models</h1>
        <p className={styles.subtitle}>Manage LLM providers and available models for your workspace</p>
      </header>

      {error !== null && (
        <p className={styles.pageError} role="alert">
          {error}
        </p>
      )}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Providers</h2>
          <Link className={styles.addButton} to={`/workspace/${workspaceId}/models/providers/new`}>
            + Add Provider
          </Link>
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colProvider}>Provider</span>
          <span className={styles.colGrow}>API Endpoint</span>
          <span className={styles.colStatus}>Status</span>
          <span className={styles.colActions}>Actions</span>
        </div>

        {providers === null && error === null && <p className={styles.notice}><Loader /></p>}
        {providers?.length === 0 && <p className={styles.notice}>No providers yet.</p>}

        {providers?.map((provider) => (
          <div key={provider.id} className={styles.row}>
            <span className={`${styles.colProvider} ${styles.providerName}`}>{provider.name}</span>
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
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </span>
          </div>
        ))}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Available Models</h2>
          {/* A model belongs to a provider, so there is nothing to add without one. */}
          <button
            type="button"
            className={styles.addButton}
            onClick={() => setAddingModel(true)}
            disabled={providers === null || providers.length === 0}
          >
            + Add Model
          </button>
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colModel}>Model</span>
          <span className={styles.colProviderName}>Provider</span>
          <span className={styles.colKind}>Type</span>
          <span className={styles.colToggle}>Status</span>
          <span className={styles.colGrow} />
          <span className={styles.colActions}>Actions</span>
        </div>

        {models === null && error === null && <p className={styles.notice}><Loader /></p>}
        {models?.length === 0 && (
          <p className={styles.notice}>
            {providers?.length === 0
              ? 'Add a provider first; models belong to one.'
              : 'No models yet.'}
          </p>
        )}

        {models?.map((model) => (
          <div key={model.id} className={styles.row}>
            <Link className={`${styles.colModel} ${styles.modelName}`} to={`/workspace/${workspaceId}/models/${model.id}`}>
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
                onClick={() => void toggle(model)}
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
