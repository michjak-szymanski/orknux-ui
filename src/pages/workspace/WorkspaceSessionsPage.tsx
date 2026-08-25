import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchLlmSessions } from '../../api/llmSessions';
import type { LlmSessionOrder, LlmSessionPage } from '../../api/llmSessions';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import searchIcon from '../../assets/search.svg';
import { AppShell } from '../../components/AppShell';
import { CompactPagination } from '../../components/CompactPagination';
import { Loader } from '../../components/Loader';
import { FieldHint } from '../../components/FieldHint';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceSessionsPage.module.css';
import { t } from '../../i18n';

export interface WorkspaceSessionsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 12;
const SEARCH_PAUSE_MS = 300;

/**
 * Asked of the server rather than sorted here, for the reason every paged list
 * has: sorting the twelve rows on screen orders the page and not the workspace.
 */
const ORDERS: { label: string; order: LlmSessionOrder }[] = [
  { label: t('Last spoken in'), order: 'LAST_EVENT' },
  { label: 'Opened', order: 'CREATED' },
  { label: 'Key', order: 'KEY' },
];

/**
 * The conversations this workspace's agents have kept.
 *
 * There is nothing to create here and no button that says otherwise: a session
 * comes into being when an agent node carrying a `sessionKey` runs, and what a
 * person does with this list is find one and read it.
 */
export function WorkspaceSessionsPage({ session, onSignOut }: WorkspaceSessionsPageProps) {
  const { workspaceId = '' } = useParams();

  const [sessions, setSessions] = useState<LlmSessionPage | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [order, setOrder] = useState<LlmSessionOrder>('LAST_EVENT');
  const [ascending, setAscending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), SEARCH_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, order, ascending]);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchLlmSessions(workspaceId, {
      search: debouncedSearch || undefined,
      page: page - 1,
      size: PAGE_SIZE,
      order,
      ascending,
    })
      .then((found) => {
        setSessions(found);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setSessions(null);
        setError(cause instanceof Error ? cause.message : t('Could not load the sessions.'));
        setLoading(false);
      });
  }, [workspaceId, debouncedSearch, page, order, ascending]);

  useEffect(load, [load]);

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.titleHeader}>
        <h1 className={styles.title}>{t('Sessions')}</h1>
        <p className={styles.subtitle}>
          {t('What the agents have said, kept by key so it outlives the run that started it')}
        </p>
      </header>

      <div className={styles.filterBar}>
        <div className={styles.searchInput}>
          <img src={searchIcon} alt="" width={14} height={14} />
          <input
            className={styles.searchField}
            type="search"
            placeholder={t('Search keys and prefixes…')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t('Search sessions')}
          />
        </div>

        <div className={styles.sortRow}>
          <label className={styles.sortLabel} htmlFor="session-order">{t('Sort')}</label>
          <span className={styles.selectWrapper}>
            <select
              id="session-order"
              className={styles.sortSelect}
              value={order}
              onChange={(event) => setOrder(event.target.value as LlmSessionOrder)}
            >
              {ORDERS.map((one) => (
                <option key={one.order} value={one.order}>
                  {one.label}
                </option>
              ))}
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </span>
          {/* A direction has two states, so it is a switch. The arrow says which
              way it is now, not which way pressing it would go. */}
          <button
            type="button"
            className={styles.sortDirection}
            onClick={() => setAscending((held) => !held)}
            title={ascending ? t('Ascending - press for descending') : t('Descending - press for ascending')}
            aria-label={ascending ? t('Sorted ascending') : t('Sorted descending')}
          >
            {ascending ? '↑' : '↓'}
          </button>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colKey}>{t('Session')}</span>
          <span className={styles.colPrefix}>{t('Prefix')}</span>
          <span className={styles.colCount}>{t('Lines')}</span>
          <span className={styles.colOpened}>{t('Opened')}</span>
          <span className={styles.colSpoken}>{t('Last spoken in')}</span>
        </div>

        {loading && sessions === null && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && (
          <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
            {error}
          </p>
        )}

        {/*
          An empty list split the way the rules split one.

          "No sessions yet." is the state of the thing being looked at and stays
          in the open. What a session *is* and how one appears is teaching - it
          is behind the (?) beside that line, because a workspace that has had
          sessions for a year still draws this page and nobody needs the
          definition again.

          The (?) is beside the status line because there is no field here to put
          it beside. It is not dropped: this is a list nobody can create a row
          in, so the note is the only thing on the page that says how a row ever
          appears, and losing it would leave somebody in front of an empty table
          with nowhere to go.
        */}
        {!loading && error === null && sessions?.content.length === 0 && (
          <div className={styles.empty}>
            {debouncedSearch.trim() === '' ? (
              <p className={styles.emptyTitle}>
                <span className={styles.labelWithHint}>
                  {t('No sessions yet.')}
                  <FieldHint label={t('No sessions yet')}>
                    A session is one running conversation — what was put to an agent, what it
                    answered, the tools it called on the way — kept apart from any single run.
                    Nobody creates one here. One appears the first time an agent node with a{' '}
                    <strong>sessionKey</strong> runs, and every later node that computes the same key
                    writes into the same conversation. Give an agent node a key in the workflow
                    editor and run it, and it will be on this list.
                  </FieldHint>
                </span>
              </p>
            ) : (
              <p className={styles.emptyTitle}>{t('No session\'s key or prefix matches that.')}</p>
            )}
          </div>
        )}

        {sessions?.content.map((one) => (
          <Link
            key={one.id}
            className={styles.row}
            to={`/workspace/${workspaceId}/sessions/${one.id}`}
          >
            <span className={`${styles.colKey} ${styles.key}`}>{one.key}</span>
            <span className={`${styles.colPrefix} ${styles.muted}`}>
              {one.keyPrefix ?? <span className={styles.nothing}>—</span>}
            </span>
            <span className={`${styles.colCount} ${styles.muted}`}>{one.eventCount}</span>
            <span className={`${styles.colOpened} ${styles.muted}`}>{timeAgo(one.createdAt)}</span>
            <span className={`${styles.colSpoken} ${styles.muted}`}>
              {/* Null is a session opened and never spoken in, which sorts last
                  either way round and should read as itself rather than as a dash. */}
              {one.lastEventAt === null ? (
                <span className={styles.nothing}>{t('nothing said yet')}</span>
              ) : (
                timeAgo(one.lastEventAt)
              )}
            </span>
          </Link>
        ))}

        {sessions !== null && sessions.totalElements > 0 && (
          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={sessions.totalElements}
            unit="sessions"
            onPageChange={setPage}
          />
        )}
      </section>
    </AppShell>
  );
}
