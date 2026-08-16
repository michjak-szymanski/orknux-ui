import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { fetchActivityUsers, fetchWorkspaceActivity } from '../../api/activity';
import type { ActivityCategory, ActivityEntry } from '../../api/activity';
import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import bookIcon from '../../assets/book.svg';
import botBadgeIcon from '../../assets/bot-badge.svg';
import boxIcon from '../../assets/box.svg';
import calendarIcon from '../../assets/calendar.svg';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import databaseIcon from '../../assets/database.svg';
import gitBranchBadgeIcon from '../../assets/git-branch-badge.svg';
import messageSquareIcon from '../../assets/message-square.svg';
import plugIcon from '../../assets/plug.svg';
import refreshIcon from '../../assets/refresh-cw.svg';
import searchIcon from '../../assets/search.svg';
import shieldIcon from '../../assets/shield.svg';
import { AppShell } from '../../components/AppShell';
import { AutoRefresh } from '../../components/AutoRefresh';
import { CompactPagination } from '../../components/CompactPagination';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceAuditPage.module.css';

export interface WorkspaceAuditPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 8;
const SEARCH_DEBOUNCE_MS = 300;

const CATEGORY_ICON: Record<ActivityCategory, string> = {
  WORKFLOW: gitBranchBadgeIcon,
  AGENT: botBadgeIcon,
  WORKSPACE: shieldIcon,
  INTEGRATION: plugIcon,
  MODEL: databaseIcon,
  MEMORY: bookIcon,
  OBJECT: boxIcon,
  CHAT: messageSquareIcon,
};

export function WorkspaceAuditPage({ session, onSignOut }: WorkspaceAuditPageProps) {
  const { workspaceId = '' } = useParams();

  const [entries, setEntries] = useState<PageOf<ActivityEntry> | null>(null);
  const [users, setUsers] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState<ActivityCategory | ''>('');
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState<number | ''>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchActivityUsers(workspaceId)
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [workspaceId]);

  // Typing shouldn't fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, category, userId, days]);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspaceActivity(workspaceId, page - 1, PAGE_SIZE, {
      search: debouncedSearch || undefined,
      category: category || undefined,
      userId: userId || undefined,
      days: days === '' ? undefined : days,
    })
      .then((result) => {
        setEntries(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setEntries(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the audit log.');
        setLoading(false);
      });
  }, [workspaceId, page, debouncedSearch, category, userId, days]);

  useEffect(load, [load]);

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="audit" />}
    >
      <header className={styles.titleHeader}>
        <h1 className={styles.title}>Audit Log</h1>
        <p className={styles.subtitle}>Track all actions and changes within the workspace</p>
      </header>

      <div className={styles.filterBar}>
        <div className={styles.searchInput}>
          <img src={searchIcon} alt="" width={14} height={14} />
          <input
            className={styles.searchField}
            type="search"
            placeholder="Search actions, users or servers..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search the audit log"
          />
        </div>

        <label className={styles.filter}>
          <span className={styles.filterLabel}>Action Type:</span>
          <select
            className={styles.filterSelect}
            value={category}
            onChange={(event) => setCategory(event.target.value as ActivityCategory | '')}
          >
            <option value="">All Actions</option>
            <option value="WORKFLOW">Workflows</option>
            <option value="AGENT">Agents</option>
            <option value="WORKSPACE">Workspace</option>
            <option value="INTEGRATION">Integrations</option>
            <option value="MODEL">Models</option>
            <option value="MEMORY">Memory</option>
            <option value="OBJECT">Objects</option>
            <option value="CHAT">Chats</option>
          </select>
          <img src={chevronDown12Icon} alt="" width={12} height={12} />
        </label>

        <label className={styles.filter}>
          <span className={styles.filterLabel}>User:</span>
          <select
            className={styles.filterSelect}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">All Users</option>
            {users.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </select>
          <img src={chevronDown12Icon} alt="" width={12} height={12} />
        </label>

        <label className={styles.filter}>
          <img src={calendarIcon} alt="" width={14} height={14} />
          <select
            className={`${styles.filterSelect} ${styles.filterValue}`}
            value={days}
            onChange={(event) => setDays(event.target.value === '' ? '' : Number(event.target.value))}
            aria-label="Date range"
          >
            <option value={1}>Last 24 Hours</option>
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value="">All Time</option>
          </select>
          <img src={chevronDown12Icon} alt="" width={12} height={12} />
        </label>

        {/*
          An audit log grows while it is being read. Reload now, or keep
          reloading — the interval is the shared one, chosen once for every screen
          that offers it.
        */}
        <div className={styles.watch}>
          <button
            type="button"
            className={styles.refresh}
            onClick={load}
            aria-label="Refresh the audit log"
            title="Refresh the audit log"
          >
            <img src={refreshIcon} alt="" width={14} height={14} />
          </button>
          <AutoRefresh onRefresh={load} busy={loading} />
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colAction}>Action</span>
          <span className={styles.colUser}>User</span>
          <span className={styles.colTimestamp}>Timestamp</span>
        </div>

        <div className={styles.tableBody}>
          {loading && <p className={styles.notice}><Loader /></p>}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {!loading && error === null && entries?.content.length === 0 && (
            <p className={styles.notice}>Nothing matches those filters.</p>
          )}

          {entries?.content.map((entry) => (
            <div key={entry.id} className={styles.row}>
              <span className={`${styles.badge} ${styles[entry.category.toLowerCase()]}`}>
                <img src={CATEGORY_ICON[entry.category]} alt="" width={14} height={14} />
              </span>
              <span className={styles.colAction}>{entry.message}</span>
              <span className={styles.colUser}>
                <span className={styles.userDot} aria-hidden="true">
                  {entry.userId.slice(0, 2).toUpperCase()}
                </span>
                <span className={styles.userName}>{entry.userId}</span>
              </span>
              <span className={styles.colTimestamp}>{formatDate(entry.date)}</span>
            </div>
          ))}
        </div>

        <CompactPagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={entries?.totalElements ?? 0}
          unit="entries"
          onPageChange={setPage}
        />
      </section>
    </AppShell>
  );
}

/** "Aug 14, 2026 09:12", matching the design. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `${day} ${time}`;
}
