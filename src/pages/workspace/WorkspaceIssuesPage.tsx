import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ISSUE_STATUS_LABEL, fetchIssueLabels, fetchIssues } from '../../api/issues';
import type { Issue, IssueOrder, IssuePage, IssueStatus } from '../../api/issues';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import { initialsOf } from '../../api/users';
import plusIcon from '../../assets/plus.svg';
import searchIcon from '../../assets/search.svg';
import { AppShell } from '../../components/AppShell';
import { CompactPagination } from '../../components/CompactPagination';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceIssuesPage.module.css';

export interface WorkspaceIssuesPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * How many rows a page holds, and what else it may be set to.
 *
 * Ten fits a laptop without scrolling, which is why it is first; a tracker
 * being read rather than worked through wants fifty. Remembered per person
 * rather than per workspace - it says how much of a screen somebody has, not
 * what they are looking at.
 */
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_KEY = 'orknux.issues.page-size';

/** How long typing has to pause before the list is asked. */
const SEARCH_PAUSE_MS = 300;

/**
 * How old the list has to be before coming back to the window asks again.
 *
 * Half a minute, because the cost of asking is a request nobody sees and the
 * cost of not asking is reading a state that has moved on - but a glance at
 * another window and back is not news, and treating it as news is what made
 * this feel like a page reload.
 */
const STALE_AFTER_MS = 30_000;

/** Open first, because that is what somebody arriving is looking at. */
const FILTERS: { label: string; status: IssueStatus | null }[] = [
  { label: 'Open', status: 'OPEN' },
  { label: 'In progress', status: 'IN_PROGRESS' },
  { label: 'Closed', status: 'CLOSED' },
  { label: 'All', status: null },
];

/**
 * What the list can be ordered by, in the words somebody would use.
 *
 * Asked of the server rather than sorted here: this page holds ten rows of a
 * hundred, and sorting ten of them orders the page instead of the tracker -
 * which looks like it worked until the row somebody wanted is on page three.
 */
const ORDERS: { label: string; order: IssueOrder }[] = [
  { label: 'Newest', order: 'NUMBER' },
  { label: 'Title', order: 'TITLE' },
  { label: 'Last change', order: 'UPDATED' },
];

/**
 * What is wrong with this workspace's work, beside the work itself.
 *
 * A tracker small enough to live here rather than in another product: an issue
 * about a workflow belongs next to the workflow, and the alternative - a link
 * to somewhere else - is a link nobody follows while they are in the middle of
 * fixing something.
 *
 * One search over the title, the description and the labels together: somebody
 * typing "slack" means any of the three. Clicking a label searches for it, so
 * the labels are a filter without being a second control.
 */
export function WorkspaceIssuesPage({ session, onSignOut }: WorkspaceIssuesPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [issues, setIssues] = useState<IssuePage | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [status, setStatus] = useState<IssueStatus | null>('OPEN');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<IssueOrder>('NUMBER');
  const [ascending, setAscending] = useState(false);
  const [pageSize, setPageSize] = useState(() => {
    const held = Number(window.localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(held) ? held : DEFAULT_PAGE_SIZE;
  });
  const [loading, setLoading] = useState(true);
  /*
   * Bumped to ask again.
   *
   * The list only fetched when a filter changed, so an issue closed
   * anywhere else - another tab, the API, an assistant - left this page
   * showing a state that was hours old and looked like nothing had
   * happened. Coming back to the window is exactly when somebody expects
   * to see what changed while they were away.
   */
  const [asked, setAsked] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /*
   * Whether the next fetch is somebody asking or the page catching up.
   *
   * Catching up must not look like loading: blanking the list and showing
   * "Loading…" every time the window is touched turns a quiet refresh into a
   * flash of nothing, and the list somebody was reading jumps. Held on a ref
   * rather than in state so that setting it cannot itself cause a render.
   */
  const quietly = useRef(false);

  /** When the list last came back, so a glance away does not refetch. */
  const loadedAt = useRef(0);

  useEffect(() => {
    if (workspaceId === '') return;
    let current = true;
    if (quietly.current) {
      quietly.current = false;
    } else {
      setLoading(true);
    }
    const timer = window.setTimeout(() => {
      fetchIssues(workspaceId, {
        status: status ?? undefined,
        search: search.trim() || undefined,
        page: page - 1,
        size: pageSize,
        order,
        ascending,
      })
        .then((found) => {
          if (!current) return;
          setIssues(found);
          setError(null);
          setLoading(false);
          loadedAt.current = Date.now();
        })
        .catch((cause: unknown) => {
          if (!current) return;
          setError(cause instanceof Error ? cause.message : 'Could not load the issues.');
          setLoading(false);
        });
    }, SEARCH_PAUSE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [workspaceId, status, search, page, pageSize, order, ascending, asked]);

  /*
   * Coming back to the window catches the list up, quietly and not always.
   *
   * Two events say the same thing - a tab shown and a window focused - and
   * both fire for a glance at another window and back. Asking every time made
   * switching tabs feel like reloading the page, which is what it looked like:
   * the list blanked. So it is only worth asking if the answer could have aged,
   * and the asking never shows.
   */
  useEffect(() => {
    function again() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - loadedAt.current < STALE_AFTER_MS) return;
      quietly.current = true;
      setAsked((count) => count + 1);
    }
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, []);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchIssueLabels(workspaceId)
      .then(setLabels)
      .catch(() => setLabels([]));
  }, [workspaceId, issues]);

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="issues" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Issues</h1>
            <p className={styles.subtitle}>
              What is wrong with this workspace's work, and who is looking at it.
            </p>
          </div>
          <button
            type="button"
            className={styles.create}
            onClick={() => navigate(`/workspace/${workspaceId}/issues/new`)}
          >
            <img src={plusIcon} alt="" width={14} height={14} />
            New Issue
          </button>
        </header>

        <div className={styles.filters}>
          <div className={styles.tabs} role="group" aria-label="Filter by status">
            {FILTERS.map((filter) => (
              <button
                key={filter.label}
                type="button"
                className={status === filter.status ? styles.tabActive : styles.tab}
                onClick={() => {
                  setStatus(filter.status);
                  setPage(1);
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className={styles.searchRow}>
            <img src={searchIcon} alt="" width={14} height={14} />
            <input
              className={styles.search}
              type="search"
              value={search}
              placeholder="Search titles, descriptions and labels…"
              aria-label="Search issues"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className={styles.sortRow}>
            <label className={styles.sortLabel} htmlFor="issue-order">
              Sort
            </label>
            <select
              id="issue-order"
              className={styles.sortSelect}
              value={order}
              onChange={(event) => {
                setOrder(event.target.value as IssueOrder);
                setPage(1);
              }}
            >
              {ORDERS.map((one) => (
                <option key={one.order} value={one.order}>
                  {one.label}
                </option>
              ))}
            </select>
            {/*
              One button rather than two options, because a direction has two
              states and a control with two states is a switch. The arrow says
              which way it is now, not which way pressing it would go.
            */}
            <button
              type="button"
              className={styles.sortDirection}
              onClick={() => {
                setAscending((was) => !was);
                setPage(1);
              }}
              title={ascending ? 'Ascending - press for descending' : 'Descending - press for ascending'}
              aria-label={ascending ? 'Sorted ascending' : 'Sorted descending'}
            >
              {ascending ? '↑' : '↓'}
            </button>

            <label className={styles.sortLabel} htmlFor="issue-page-size">
              Show
            </label>
            <select
              id="issue-page-size"
              className={styles.sortSelect}
              value={pageSize}
              onChange={(event) => {
                const chosen = Number(event.target.value);
                setPageSize(chosen);
                window.localStorage.setItem(PAGE_SIZE_KEY, String(chosen));
                // The page somebody is on means something different at a
                // different size, and the first page is the one that always
                // exists.
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>

        {labels.length > 0 && (
          <div className={styles.labelRow}>
            {labels.map((label) => (
              /* A label is a search somebody has already typed. */
              <button
                key={label}
                type="button"
                className={search.trim() === label ? styles.labelChipActive : styles.labelChip}
                onClick={() => {
                  setSearch(search.trim() === label ? '' : label);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.list}>
          {loading && (
            <p className={styles.notice}>
              <Loader />
            </p>
          )}
          {!loading && issues?.content.length === 0 && (
            <p className={styles.notice}>
              {search.trim() === '' && status === 'OPEN'
                ? 'Nothing open. That is either good news or an empty tracker.'
                : 'Nothing matches that.'}
            </p>
          )}

          {!loading &&
            issues?.content.map((issue) => (
              <Link
                key={issue.id}
                className={styles.row}
                to={`/workspace/${workspaceId}/issues/${issue.number}`}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    <span
                      className={
                        issue.status === 'OPEN'
                          ? styles.dotOpen
                          : issue.status === 'IN_PROGRESS'
                            ? styles.dotProgress
                            : styles.dotClosed
                      }
                      aria-hidden="true"
                      title={ISSUE_STATUS_LABEL[issue.status]}
                    />
                    <span className={styles.issueTitle}>{issue.title}</span>
                  </span>
                  <span className={styles.rowMeta}>
                    #{issue.number} opened by {issue.reporter} · {timeAgo(issue.lastModifiedAt)}
                  </span>
                </span>

                <span className={styles.rowLabels}>
                  {issue.labels.map((label) => (
                    <span key={label} className={styles.labelTag}>
                      {label}
                    </span>
                  ))}
                </span>

                <span className={styles.rowAssignee}>
                  {issue.assignee === null ? (
                    <span className={styles.nobody}>—</span>
                  ) : (
                    <span className={styles.avatar} title={`${issue.assignee.name} · ${issue.assignee.hint}`}>
                      {initialsOf(issue.assignee.name)}
                    </span>
                  )}
                </span>
              </Link>
            ))}
        </div>

        {issues !== null && issues.totalElements > pageSize && (
          <CompactPagination
            page={page}
            pageSize={pageSize}
            totalItems={issues.totalElements}
            unit="issues"
            onPageChange={setPage}
          />
        )}
      </section>
    </AppShell>
  );
}

export type { Issue };
