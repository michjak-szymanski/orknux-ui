import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import { fetchWorkspaces } from '../../api/workspaces';
import checkCircleIcon from '../../assets/check-circle.svg';
import layersIcon from '../../assets/layers.svg';
import monitorIcon from '../../assets/monitor.svg';
import plusIcon from '../../assets/plus.svg';
import serverIcon from '../../assets/server.svg';
import settingsIcon from '../../assets/settings.svg';
import { AppShell } from '../../components/AppShell';
import { CreateWorkspaceDialog } from '../../components/CreateWorkspaceDialog';
import { AdminSidebar } from '../../components/AdminSidebar';
import { Loader } from '../../components/Loader';
import { Pagination } from '../../components/Pagination';
import { shellUser } from '../../session/user';
import styles from './AdminPage.module.css';
import { t } from '../../i18n';

export interface AdminPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const WORKSPACES_PAGE_SIZE = 4;

export function AdminPage({ session, onSignOut }: AdminPageProps) {
  const [workspacesPage, setWorkspacesPage] = useState(1);
  const [creating, setCreating] = useState(false);
  // Bumped after a write so both tables refetch, audit log included.
  const [reloadToken, setReloadToken] = useState(0);

  const workspaces = useLoadedPage(() => fetchWorkspaces(workspacesPage - 1, WORKSPACES_PAGE_SIZE), [workspacesPage, reloadToken]);

  // The section links need somewhere to go; the first workspace listed is the sensible default.
  const firstWorkspace = workspaces.data?.content[0];
  const workspacePath = firstWorkspace === undefined ? undefined : `/workspace/${firstWorkspace.id}`;

  function handleCreated() {
    setCreating(false);
    setWorkspacesPage(1);
    setReloadToken((token) => token + 1);
  }

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={workspacePath}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="workspaces" />}
    >
      <section className={styles.card}>
        <header className={styles.workspacesHeader}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{t('Workspaces')}</h1>
            <p className={styles.subtitle}>
              {t('Manage workspace membership, access, and ownership.')}
            </p>
          </div>
          <button type="button" className={styles.createWorkspace} onClick={() => setCreating(true)}>
            <span
              className={styles.createWorkspaceIcon}
              style={{ maskImage: `url("${plusIcon}")`, WebkitMaskImage: `url("${plusIcon}")` }}
              aria-hidden="true"
            />
            {t('Create Workspace')}
          </button>
        </header>

        <div className={styles.table}>
          <div className={`${styles.row} ${styles.tableHeader}`}>
            <span className={styles.colGrow}>{t('Workspace')}</span>
            <span className={styles.colDescription}>{t('Description')}</span>
            <span className={styles.colActions} aria-hidden="true" />
          </div>

          <TableState state={workspaces} emptyMessage={t("No workspaces yet.")} />

          {workspaces.data?.content.map((workspace) => (
            <div key={workspace.id} className={styles.row}>
              <div className={styles.workspaceName}>
                <span className={styles.workspaceIcon}>
                  <img src={workspaceIcon(workspace.name)} alt="" width={16} height={16} />
                </span>
                <Link className={styles.workspaceLabel} to={`/workspace/${workspace.id}`}>
                  {workspace.name}
                </Link>
              </div>
              <span className={`${styles.colDescription} ${styles.description}`}>{workspace.description ?? '—'}</span>
              <span className={styles.colActions}>
                <Link
                  className={styles.rowAction}
                  to={`/admin/workspaces/${workspace.id}/settings`}
                  aria-label={`Settings for ${workspace.name}`}
                  title={`Settings for ${workspace.name}`}
                >
                  <img src={settingsIcon} alt="" width={16} height={16} />
                </Link>
              </span>
            </div>
          ))}
        </div>

        <Pagination
          page={workspacesPage}
          pageSize={WORKSPACES_PAGE_SIZE}
          totalItems={workspaces.data?.totalElements ?? 0}
          onPageChange={setWorkspacesPage}
          label={t('workspaces')}
        />
      </section>

      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={handleCreated} />
    </AppShell>
  );
}

interface LoadState<T> {
  data: PageOf<T> | null;
  loading: boolean;
  error: string | null;
}

function useLoadedPage<T>(load: () => Promise<PageOf<T>>, deps: unknown[]): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    let current = true;
    setState((previous) => ({ ...previous, loading: true, error: null }));

    load()
      .then((data) => {
        if (current) setState({ data, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (!current) return;
        const message = cause instanceof Error ? cause.message : t('Could not load data.');
        setState({ data: null, loading: false, error: message });
      });

    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

function TableState<T>({ state, emptyMessage }: { state: LoadState<T>; emptyMessage: string }) {
  if (state.loading) {
    return <p className={styles.tableNotice}><Loader /></p>;
  }
  if (state.error !== null) {
    return <p className={`${styles.tableNotice} ${styles.tableError}`}>{state.error}</p>;
  }
  if (state.data !== null && state.data.content.length === 0) {
    return <p className={styles.tableNotice}>{emptyMessage}</p>;
  }
  return null;
}

/**
 * The server has no per-workspace icon, so one is picked from the design's set in a
 * way that stays stable for a given workspace name. Presentational only.
 */
const WORKSPACE_ICONS = [layersIcon, monitorIcon, serverIcon, checkCircleIcon];

function workspaceIcon(name: string): string {
  const hash = [...name].reduce((total, character) => total + character.charCodeAt(0), 0);
  return WORKSPACE_ICONS[hash % WORKSPACE_ICONS.length];
}
