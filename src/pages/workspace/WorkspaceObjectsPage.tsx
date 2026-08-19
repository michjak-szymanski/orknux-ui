import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import { createObject, fetchWorkspaceObjects } from '../../api/objects';
import type { WorkflowObject } from '../../api/objects';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import settingsIcon from '../../assets/settings-14.svg';
import { AppShell } from '../../components/AppShell';
import { CompactPagination } from '../../components/CompactPagination';
import {
  ExportComponentButton,
  ImportComponentsButton,
  transferStyles,
} from '../../components/ComponentTransfer';
import { Loader } from '../../components/Loader';
import { NameDialog } from '../../components/NameDialog';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './CatalogueTable.module.css';

export interface WorkspaceObjectsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 10;

/**
 * The workspace's objects.
 *
 * The same table as Skills, without the status column: an object describes data
 * rather than doing anything, so there is nothing to switch off — a shape
 * nothing points at is simply unused, not disabled.
 */
export function WorkspaceObjectsPage({ session, onSignOut }: WorkspaceObjectsPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [objects, setObjects] = useState<PageOf<WorkflowObject> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setError(null);
    fetchWorkspaceObjects(workspaceId, page - 1, PAGE_SIZE)
      .then(setObjects)
      .catch((cause: unknown) => {
        setObjects(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the objects.');
      });
  }, [workspaceId, page]);

  useEffect(load, [load]);

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="objects" />}
    >
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Objects</h1>
          <p className={styles.subtitle}>Named data structures the workspace's workflows pass around.</p>
        </div>
        <div className={transferStyles.headerActions}>
          <ImportComponentsButton workspaceId={workspaceId} onImported={load} />
          <button type="button" className={styles.createButton} onClick={() => setCreating(true)}>
            + Create Object
          </button>
        </div>
      </header>

      {error !== null && (
        <p className={styles.pageError} role="alert">
          {error}
        </p>
      )}

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colName}>Name</span>
          <span className={styles.colDescription}>Description</span>
          <span className={styles.colStatus}>Properties</span>
          <span className={styles.colModified}>Last Modified</span>
          <span className={styles.colActions}>Actions</span>
        </div>

        {objects === null && error === null && <p className={styles.notice}><Loader /></p>}
        {objects?.content.length === 0 && (
          <p className={styles.notice}>
            No objects yet. An object names a shape — what a trigger emits, or what a function takes —
            so a mapping can be offered instead of typed blind.
          </p>
        )}

        {objects?.content.map((held) => (
          <div key={held.id} className={styles.row}>
            <Link className={`${styles.colName} ${styles.name}`} to={`/workspace/${workspaceId}/objects/${held.id}`}>
              {held.name}
            </Link>
            <span
              className={`${styles.colDescription} ${held.description === null ? styles.noDescription : styles.description}`}
            >
              {held.description ?? 'No description'}
            </span>
            {/* Where Skills shows a switch: a count, because there is nothing to switch. */}
            <span className={`${styles.colStatus} ${styles.modified}`}>{held.propertyCount}</span>
            <span className={`${styles.colModified} ${styles.modified}`}>{timeAgo(held.lastModifiedAt)}</span>
            <span className={styles.colActions}>
              <ExportComponentButton workspaceId={workspaceId} kind="OBJECT" id={held.id} name={held.name} />
              <Link
                className={styles.rowAction}
                to={`/workspace/${workspaceId}/objects/${held.id}`}
                aria-label={`Open ${held.name}`}
                title={`Open ${held.name}`}
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </span>
          </div>
        ))}

        {objects !== null && (
          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={objects.totalElements}
            unit="objects"
            onPageChange={setPage}
          />
        )}
      </section>

      <NameDialog
        open={creating}
        title="Create Object"
        message="An object names a shape, so a mapping can be offered rather than typed blind."
        nameLabel="Name"
        namePlaceholder="SlackMessage"
        descriptionPlaceholder="Represents an incoming Slack message with metadata"
        submitLabel="Create Object"
        onClose={() => setCreating(false)}
        onSubmit={async (name, description) => {
          const created = await createObject(workspaceId, { name, description: description || undefined });
          navigate(`/workspace/${workspaceId}/objects/${created.id}`);
        }}
      />
    </AppShell>
  );
}
