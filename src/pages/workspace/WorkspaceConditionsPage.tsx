import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import { fetchCondition, fetchWorkspaceConditions } from '../../api/conditions';
import type { Condition } from '../../api/conditions';
import type { SessionUser } from '../../api/session';
import settingsIcon from '../../assets/settings-14.svg';
import { AppShell } from '../../components/AppShell';
import { CompactPagination } from '../../components/CompactPagination';
import { ConditionDialog } from '../../components/ConditionDialog';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceConditionsPage.module.css';

export interface WorkspaceConditionsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 5;

/** Reusable conditions for workflow branching and action triggers. */
export function WorkspaceConditionsPage({ session, onSignOut }: WorkspaceConditionsPageProps) {
  const { workspaceId = '', conditionId } = useParams();
  const navigate = useNavigate();

  const [conditions, setConditions] = useState<PageOf<Condition> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Condition | null>(null);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspaceConditions(workspaceId, page - 1, PAGE_SIZE)
      .then((result) => {
        setConditions(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setConditions(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the conditions.');
        setLoading(false);
      });
  }, [workspaceId, page]);

  useEffect(load, [load]);

  /**
   * `/conditions/:conditionId` opens that condition straight away — it is where a
   * run links to when it says which question it asked. The condition is fetched
   * by id rather than looked up in the list, which may be showing another page.
   */
  useEffect(() => {
    if (conditionId === undefined) return;
    let current = true;
    fetchCondition(conditionId)
      .then((condition) => {
        if (!current) return;
        if (condition === null) setError('That condition no longer exists.');
        else setEditing(condition);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Could not open the condition.');
      });
    return () => {
      current = false;
    };
  }, [conditionId]);

  /** Closing the dialog leaves the deep link behind, so the list is a list again. */
  const closeDialog = useCallback(() => {
    setCreating(false);
    setEditing(null);
    if (conditionId !== undefined) navigate(`/workspace/${workspaceId}/conditions`, { replace: true });
  }, [conditionId, navigate, workspaceId]);

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="conditions" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Conditions</h1>
            <p className={styles.subtitle}>
              Define reusable conditions for workflow branching and action triggers.
            </p>
          </div>
          <button type="button" className={styles.createCondition} onClick={() => setCreating(true)}>
            + Create Condition
          </button>
        </header>

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colName}>Name</span>
            <span className={styles.colType}>Type</span>
            <span className={styles.colDescription}>Description</span>
            <span className={styles.colActions}>Actions</span>
          </div>

          {loading && <p className={styles.notice}><Loader /></p>}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {!loading && error === null && conditions?.content.length === 0 && (
            <p className={styles.notice}>No conditions yet.</p>
          )}

          {conditions?.content.map((condition) => (
            <div key={condition.id} className={styles.row}>
              <button
                type="button"
                className={`${styles.colName} ${styles.name} ${styles.nameButton}`}
                onClick={() => setEditing(condition)}
                title={`Settings for ${condition.name}`}
              >
                {condition.name}
              </button>
              <span className={styles.colType}>
                <span className={styles.badge}>{condition.typeLabel}</span>
              </span>
              <span className={`${styles.colDescription} ${styles.muted}`}>{condition.description}</span>
              <span className={styles.colActions}>
                <button
                  type="button"
                  className={styles.rowAction}
                  onClick={() => setEditing(condition)}
                  aria-label={`Settings for ${condition.name}`}
                  title={`Settings for ${condition.name}`}
                >
                  <img src={settingsIcon} alt="" width={14} height={14} />
                </button>
              </span>
            </div>
          ))}

          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={conditions?.totalElements ?? 0}
            onPageChange={setPage}
            unit="conditions"
          />
        </div>
      </section>

      <ConditionDialog
        open={creating || editing !== null}
        workspaceId={workspaceId}
        condition={editing}
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
