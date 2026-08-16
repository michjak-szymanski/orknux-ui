import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ACTION_TYPE_LABEL, fetchAction, fetchWorkspaceActions, paramSummary } from '../../api/actions';
import type { Action } from '../../api/actions';
import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import settingsIcon from '../../assets/settings-14.svg';
import { ActionDialog } from '../../components/ActionDialog';
import { AppShell } from '../../components/AppShell';
import { CompactPagination } from '../../components/CompactPagination';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceActionsPage.module.css';

export interface WorkspaceActionsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 6;

/** The workspace's action catalogue: the blocks its workflows are built from. */
export function WorkspaceActionsPage({ session, onSignOut }: WorkspaceActionsPageProps) {
  const { workspaceId = '', actionId } = useParams();
  const navigate = useNavigate();

  const [actions, setActions] = useState<PageOf<Action> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Action | null>(null);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspaceActions(workspaceId, page - 1, PAGE_SIZE)
      .then((result) => {
        setActions(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setActions(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the actions.');
        setLoading(false);
      });
  }, [workspaceId, page]);

  useEffect(load, [load]);

  /** `/actions/:actionId` opens that action straight away — where a run links to. */
  useEffect(() => {
    if (actionId === undefined) return;
    let current = true;
    fetchAction(actionId)
      .then((action) => {
        if (!current) return;
        if (action === null) setError('That action no longer exists.');
        else setEditing(action);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Could not open the action.');
      });
    return () => {
      current = false;
    };
  }, [actionId]);

  const closeDialog = useCallback(() => {
    setCreating(false);
    setEditing(null);
    if (actionId !== undefined) navigate(`/workspace/${workspaceId}/actions`, { replace: true });
  }, [actionId, navigate, workspaceId]);

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="actions" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Actions</h1>
            <p className={styles.subtitle}>Reusable action blocks used inside workflows.</p>
          </div>
          <button type="button" className={styles.createAction} onClick={() => setCreating(true)}>
            + Create Action
          </button>
        </header>

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colName}>Name</span>
            <span className={styles.colType}>Type</span>
            <span className={styles.colSubtype}>Subtype</span>
            <span className={styles.colInput}>Input Params</span>
            <span className={styles.colOutput}>Output Params</span>
            <span className={styles.colActions}>Actions</span>
          </div>

          {loading && <p className={styles.notice}><Loader /></p>}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {!loading && error === null && actions?.content.length === 0 && (
            <p className={styles.notice}>No actions yet.</p>
          )}

          {actions?.content.map((action) => (
            <div key={action.id} className={styles.row}>
              <button
                type="button"
                className={`${styles.colName} ${styles.name} ${styles.nameButton}`}
                onClick={() => setEditing(action)}
                title={`Settings for ${action.name}`}
              >
                {action.name}
              </button>
              <span className={styles.colType}>
                <span className={styles.badge}>{ACTION_TYPE_LABEL[action.type]}</span>
              </span>
              <span className={`${styles.colSubtype} ${styles.muted}`}>{action.subtypeLabel}</span>
              <span className={`${styles.colInput} ${styles.mono}`} title={paramSummary(action.inputParams)}>
                {paramSummary(action.inputParams)}
              </span>
              <span className={`${styles.colOutput} ${styles.mono}`} title={paramSummary(action.outputParams)}>
                {paramSummary(action.outputParams)}
              </span>
              <span className={styles.colActions}>
                <button
                  type="button"
                  className={styles.rowAction}
                  onClick={() => setEditing(action)}
                  aria-label={`Settings for ${action.name}`}
                  title={`Settings for ${action.name}`}
                >
                  <img src={settingsIcon} alt="" width={14} height={14} />
                </button>
              </span>
            </div>
          ))}

          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={actions?.totalElements ?? 0}
            onPageChange={setPage}
            unit="actions"
          />
        </div>
      </section>

      <ActionDialog
        open={creating || editing !== null}
        workspaceId={workspaceId}
        action={editing}
        onClose={closeDialog}
        onSaved={() => {
          closeDialog();
          load();
        }}
        onDeleted={() => {
          closeDialog();
          setPage(1);
          load();
        }}
      />
    </AppShell>
  );
}
