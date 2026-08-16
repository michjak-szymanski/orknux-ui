import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import {
  createFunction,
  duplicateFunction,
  fetchWorkspaceFunctions,
  timeAgo,
  valueTypeLabel,
} from '../../api/functions';
import type { WorkspaceFunction } from '../../api/functions';
import type { SessionUser } from '../../api/session';
import copyIcon from '../../assets/copy.svg';
import settingsIcon from '../../assets/settings-14.svg';
import { AppShell } from '../../components/AppShell';
import { CompactPagination } from '../../components/CompactPagination';
import { CreateFunctionDialog } from '../../components/CreateFunctionDialog';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceFunctionsPage.module.css';

export interface WorkspaceFunctionsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 5;

/** Named JavaScript functions callable from workflow actions. */
export function WorkspaceFunctionsPage({ session, onSignOut }: WorkspaceFunctionsPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [functions, setFunctions] = useState<PageOf<WorkspaceFunction> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** The function being copied, so the row buttons can be held while it happens. */
  const [copying, setCopying] = useState<string | null>(null);

  /**
   * Copies a function and opens the copy.
   *
   * Straight to the editor, the way creating one does: a duplicate exists to be
   * changed, and the list would only show a second row with a similar name.
   */
  async function onDuplicate(fn: WorkspaceFunction) {
    if (copying !== null) return;
    setCopying(fn.id);
    setError(null);
    try {
      const copy = await duplicateFunction(fn);
      navigate(`/workspace/${workspaceId}/functions/${copy.id}`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : `Could not duplicate ${fn.name}.`);
    } finally {
      setCopying(null);
    }
  }

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspaceFunctions(workspaceId, page - 1, PAGE_SIZE)
      .then((result) => {
        setFunctions(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setFunctions(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the functions.');
        setLoading(false);
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
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="functions" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Functions</h1>
            <p className={styles.subtitle}>Named JavaScript functions callable from workflow actions.</p>
          </div>
          <button type="button" className={styles.createFunction} onClick={() => setCreating(true)}>
            + Create Function
          </button>
        </header>

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colName}>Name</span>
            <span className={styles.colParams}>Parameters</span>
            <span className={styles.colReturn}>Return Type</span>
            <span className={styles.colModified}>Last Modified</span>
            <span className={styles.colActions}>Actions</span>
          </div>

          {loading && <p className={styles.notice}><Loader /></p>}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {!loading && error === null && functions?.content.length === 0 && (
            <p className={styles.notice}>No functions yet.</p>
          )}

          {functions?.content.map((fn) => (
            <div key={fn.id} className={styles.row}>
              <Link
                className={`${styles.colName} ${styles.name} ${styles.nameLink}`}
                to={`/workspace/${workspaceId}/functions/${fn.id}`}
              >
                {fn.name}
              </Link>
              <span className={`${styles.colParams} ${styles.mono}`} title={fn.signature}>
                {fn.signature}
              </span>
              <span className={styles.colReturn}>
                <span className={styles.badge}>{valueTypeLabel(fn.returnType)}</span>
              </span>
              <span className={`${styles.colModified} ${styles.muted}`}>{timeAgo(fn.lastModifiedAt)}</span>
              <span className={styles.colActions}>
                {/*
                  Not offered for a function a plugin declared: the copy would be
                  of the note explaining that the implementation lives in the
                  plugin, which is not something anybody wants a copy of.
                */}
                {fn.editable && (
                  <button
                    type="button"
                    className={styles.rowAction}
                    disabled={copying !== null}
                    onClick={() => void onDuplicate(fn)}
                    aria-label={`Duplicate ${fn.name}`}
                    title={`Duplicate ${fn.name}`}
                  >
                    <img src={copyIcon} alt="" width={14} height={14} />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.rowAction}
                  onClick={() => navigate(`/workspace/${workspaceId}/functions/${fn.id}`)}
                  aria-label={`Open ${fn.name}`}
                  title={`Open ${fn.name}`}
                >
                  <img src={settingsIcon} alt="" width={14} height={14} />
                </button>
              </span>
            </div>
          ))}

          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={functions?.totalElements ?? 0}
            onPageChange={setPage}
            unit="functions"
          />
        </div>
      </section>

      <CreateFunctionDialog
        open={creating}
        workspaceId={workspaceId}
        onClose={() => setCreating(false)}
        onCreated={async (name, description, returnType, params, externalVariableIds) => {
          const created = await createFunction({
            workspaceId,
            name,
            description,
            returnType,
            params,
            externalVariableIds,
          });
          setCreating(false);
          // A new function is empty, so the editor is where it is useful.
          navigate(`/workspace/${workspaceId}/functions/${created.id}`);
        }}
      />
    </AppShell>
  );
}
