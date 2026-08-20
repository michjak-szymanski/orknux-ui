import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import { fetchWorkspaceConditions } from '../../api/conditions';
import type { Condition } from '../../api/conditions';
import type { SessionUser } from '../../api/session';
import settingsIcon from '../../assets/settings-14.svg';
import { AppShell } from '../../components/AppShell';
import { CompactPagination } from '../../components/CompactPagination';
import {
  ExportComponentButton,
  ImportComponentsButton,
  SaveAsTemplateButton,
  UseTemplateButton,
  transferStyles,
} from '../../components/ComponentTransfer';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceConditionsPage.module.css';

export interface WorkspaceConditionsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 5;

/**
 * Reusable conditions for workflow branching and action triggers.
 *
 * A list and nothing else. Making one and opening one both go to the
 * condition's own page (issue #87), so every way out of here is a real link:
 * ctrl-clicking a row opens it in a tab, which is what somebody comparing two
 * conditions wants and what a button could never give them.
 */
export function WorkspaceConditionsPage({ session, onSignOut }: WorkspaceConditionsPageProps) {
  const { workspaceId = '' } = useParams();

  const [conditions, setConditions] = useState<PageOf<Condition> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Conditions</h1>
            <p className={styles.subtitle}>
              Define reusable conditions for workflow branching and action triggers.
            </p>
          </div>
          <div className={transferStyles.headerActions}>
            <ImportComponentsButton workspaceId={workspaceId} onImported={load} />
            <UseTemplateButton workspaceId={workspaceId} kind="CONDITION" onImported={load} />
            <Link className={styles.createCondition} to={`/workspace/${workspaceId}/conditions/new`}>
              + Create Condition
            </Link>
          </div>
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
              <Link
                className={`${styles.colName} ${styles.name} ${styles.nameLink}`}
                to={`/workspace/${workspaceId}/conditions/${condition.id}`}
                title={`Settings for ${condition.name}`}
              >
                {condition.name}
              </Link>
              <span className={styles.colType}>
                <span className={styles.badge}>{condition.typeLabel}</span>
              </span>
              <span className={`${styles.colDescription} ${styles.muted}`}>{condition.description}</span>
              <span className={styles.colActions}>
                <ExportComponentButton
                  workspaceId={workspaceId}
                  kind="CONDITION"
                  id={condition.id}
                  name={condition.name}
                />
                <SaveAsTemplateButton
                  workspaceId={workspaceId}
                  kind="CONDITION"
                  id={condition.id}
                  name={condition.name}
                  canPublish={session.admin}
                />
                <Link
                  className={styles.rowAction}
                  to={`/workspace/${workspaceId}/conditions/${condition.id}`}
                  aria-label={`Settings for ${condition.name}`}
                  title={`Settings for ${condition.name}`}
                >
                  <img src={settingsIcon} alt="" width={14} height={14} />
                </Link>
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
    </AppShell>
  );
}
