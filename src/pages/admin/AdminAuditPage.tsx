import { useCallback, useEffect, useState } from 'react';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import { fetchAuditUsers, fetchWorkspaceAudit } from '../../api/workspaces';
import type { WorkspaceAuditEntry } from '../../api/workspaces';
import calendarIcon from '../../assets/calendar.svg';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import refreshIcon from '../../assets/refresh-cw.svg';
import searchIcon from '../../assets/search.svg';
import { AppShell } from '../../components/AppShell';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AutoRefresh } from '../../components/AutoRefresh';
import { Loader } from '../../components/Loader';
import { Pagination } from '../../components/Pagination';
import { shellUser } from '../../session/user';
import styles from './AdminAuditPage.module.css';

export interface AdminAuditPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 8;
const SEARCH_DEBOUNCE_MS = 300;

export function AdminAuditPage({ session, onSignOut }: AdminAuditPageProps) {
  const [entries, setEntries] = useState<PageOf<WorkspaceAuditEntry> | null>(null);
  const [users, setUsers] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState<number | ''>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAuditUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, userId, days]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchWorkspaceAudit(page - 1, PAGE_SIZE, {
      search: debouncedSearch || undefined,
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
  }, [page, debouncedSearch, userId, days]);

  useEffect(load, [load]);

  return (
    <AppShell
      user={shellUser(session)}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="audit" />}
    >
      <header className={styles.titleHeader}>
        <h1 className={styles.title}>Audit Log</h1>
        <p className={styles.subtitle}>Track all admin-level actions and changes</p>
      </header>

      <div className={styles.filterBar}>
        <div className={styles.searchInput}>
          <img src={searchIcon} alt="" width={16} height={16} />
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
          <img src={calendarIcon} alt="" width={16} height={16} />
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

        {loading && <p className={styles.notice}><Loader /></p>}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {!loading && error === null && entries?.content.length === 0 && (
          <p className={styles.notice}>Nothing matches those filters.</p>
        )}

        {entries?.content.map((entry) => (
          <div key={entry.id} className={styles.row}>
            <span className={styles.dotWrapper} aria-hidden="true">
              <span className={styles.dot} />
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

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={entries?.totalElements ?? 0}
          onPageChange={setPage}
          label="audit entries"
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
