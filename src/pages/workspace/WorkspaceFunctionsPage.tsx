import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import {
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
import {
  ExportComponentButton,
  ImportComponentsButton,
  transferStyles,
} from '../../components/ComponentTransfer';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceFunctionsPage.module.css';

export interface WorkspaceFunctionsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 5;

/**
 * Enough of a workspace's functions to find one among them.
 *
 * Asked for once, to work out which page a just-made function is on. A
 * workspace with more than this has a function somewhere past the end of it,
 * and then the list opens where it always did rather than somewhere wrong.
 */
const ALL_OF_THEM = 200;

/** Named JavaScript functions callable from workflow actions. */
export function WorkspaceFunctionsPage({ session, onSignOut }: WorkspaceFunctionsPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [functions, setFunctions] = useState<PageOf<WorkspaceFunction> | null>(null);
  const [page, setPage] = useState(1);
  /*
   * A function just made, arriving from the editor as `?made=<id>`.
   *
   * The list is five to a page and sorted by name, so something created a
   * moment ago is usually not on the page this opens at - and a list that does
   * not show what you just made reads as a list that did not get it. Where it
   * is gets worked out once, here, rather than by asking somebody to go
   * looking through the pages for it.
   */
  const [query, setQuery] = useSearchParams();
  const made = query.get('made');
  const [findingMade, setFindingMade] = useState(made !== null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  /*
   * Turn to the page the new one is on.
   *
   * One request for the whole list, only when arriving from a create, and only
   * once: the position is a property of the sorted list, and the alternative -
   * asking the server for the index of a row - is a query nothing else needs.
   */
  useEffect(() => {
    if (made === null || workspaceId === '') return;
    let current = true;
    fetchWorkspaceFunctions(workspaceId, 0, ALL_OF_THEM)
      .then((all) => {
        if (!current) return;
        const at = all.content.findIndex((fn) => fn.id === made);
        if (at >= 0) setPage(Math.floor(at / PAGE_SIZE) + 1);
      })
      .catch(() => undefined)
      .finally(() => {
        if (current) setFindingMade(false);
      });
    return () => {
      current = false;
    };
  }, [made, workspaceId]);

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
          {/*
            Straight to the editor, the way duplicating one goes.

            It used to open a form of its own that could say less than the editor
            it handed you to a moment later - no code, no removing a parameter, no
            naming the object a parameter meant. There is one form now.
          */}
          <div className={transferStyles.headerActions}>
            <ImportComponentsButton workspaceId={workspaceId} onImported={load} />
            <button
              type="button"
              className={styles.createFunction}
              onClick={() => navigate(`/workspace/${workspaceId}/functions/new`)}
            >
              + Create Function
            </button>
          </div>
        </header>

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colName}>Name</span>
            <span className={styles.colParams}>Parameters</span>
            <span className={styles.colReturn}>Return Type</span>
            <span className={styles.colModified}>Last Modified</span>
            <span className={styles.colActions}>Actions</span>
          </div>

          {/* Also while the page a new one is on is being worked out, or the
              list would show the wrong page for a moment and then jump. */}
          {(loading || findingMade) && <p className={styles.notice}><Loader /></p>}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {!loading && !findingMade && error === null && functions?.content.length === 0 && (
            <p className={styles.notice}>No functions yet.</p>
          )}

          {!findingMade &&
            functions?.content.map((fn) => (
            <div key={fn.id} className={fn.id === made ? `${styles.row} ${styles.rowMade}` : styles.row}>
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
                {/*
                  A plugin's function is not the workspace's to take a copy of.
                  Exporting one would write a file that imports as a workspace
                  function nobody can point back at the plugin.
                */}
                {fn.editable && (
                  <ExportComponentButton
                    workspaceId={workspaceId}
                    kind="FUNCTION"
                    id={fn.id}
                    name={fn.name}
                  />
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
            onPageChange={(next) => {
              setPage(next);
              // Turning a page by hand ends the arrival: the highlight belongs
              // to the moment of coming back, not to the list from then on.
              if (query.has('made')) setQuery({}, { replace: true });
            }}
            unit="functions"
          />
        </div>
      </section>

    </AppShell>
  );
}
