import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

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

  /*
   * The filters live in the address, not in this component.
   *
   * A tracker is a thing people send each other: "the open p1 ones" is a link
   * if the filters are in the URL and a sentence of instructions if they are
   * not. It also means a refresh, a back button and a restored tab all come
   * back to the list somebody was looking at rather than to Open, newest
   * first - which is what made refreshing feel like losing your place.
   *
   * The search box keeps its own copy while it is being typed in, because a
   * history entry per keystroke would make Back walk letter by letter.
   */
  const [params, setParams] = useSearchParams();
  /*
   * "All" is written down as a word rather than left out.
   *
   * Absent has to mean Open, since that is what somebody arriving expects to
   * see - so absent cannot also mean every state, and asking for all of them
   * has to say so.
   */
  const wanted = params.get('status');
  const status: IssueStatus | null = wanted === null ? 'OPEN' : wanted === 'all' ? null : (wanted as IssueStatus);
  const search = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;
  const order = (params.get('order') as IssueOrder | null) ?? 'NUMBER';
  const ascending = params.get('dir') === 'asc';
  const [typed, setTyped] = useState(search);

  /**
   * Writes the filters back into the address.
   *
   * Replacing rather than pushing: changing a filter is not somewhere you
   * went, and a Back button that walks through every filter you tried is a
   * Back button nobody can use to leave the page.
   */
  function filterBy(changes: Record<string, string | null>, andPage = true) {
    /*
     * Built from whatever the address holds at the moment it is written, not
     * from what it held when this render started. Two filters changed in quick
     * succession - a state and then a sort - would otherwise each build on the
     * same stale copy, and the first change would vanish when the second
     * landed.
     */
    setParams(
      (held) => {
        const next = new URLSearchParams(held);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        if (andPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }
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

  /*
   * The typed search reaches the address once typing pauses.
   *
   * Kept apart from the fetch below on purpose: this decides what the list is,
   * and the fetch reacts to that - so the address and the list can never
   * disagree about what is being shown.
   */
  useEffect(() => {
    if (typed === search) return;
    const timer = window.setTimeout(() => filterBy({ q: typed.trim() === '' ? null : typed }), SEARCH_PAUSE_MS);
    return () => window.clearTimeout(timer);
    // filterBy reads the current params, and re-running on those would fight
    // the typing it is debouncing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, search]);

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
      /*
       * The list scrolls inside the frame rather than growing it.
       *
       * Without this the page simply gets taller: the filters, the search and
       * the paging scroll away with the rows, so a tracker with fifty issues on
       * a page means scrolling back to the top to change anything. Four other
       * pages already ask for this; the tracker is the one that needed it most
       * and did not have it.
       */
      scrollContent
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
                onClick={() => filterBy({ status: filter.status ?? 'all' })}
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
              value={typed}
              placeholder="Search titles, descriptions and labels…"
              aria-label="Search issues"
              onChange={(event) => setTyped(event.target.value)}
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
              onChange={(event) => filterBy({ order: event.target.value })}
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
              onClick={() => filterBy({ dir: ascending ? 'desc' : 'asc' })}
              title={ascending ? 'Ascending - press for descending' : 'Descending - press for ascending'}
              aria-label={ascending ? 'Sorted ascending' : 'Sorted descending'}
            >
              {ascending ? '↑' : '↓'}
            </button>

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
                  const wanted = search.trim() === label ? '' : label;
                  setTyped(wanted);
                  filterBy({ q: wanted === '' ? null : wanted });
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
                    {/*
                      Said in words as well as in the dot. A colour is a legend
                      somebody has to have learnt, and the one thing a row is
                      most often scanned for should not depend on remembering
                      what amber meant.
                    */}
                    <span
                      className={
                        issue.status === 'OPEN'
                          ? styles.stateOpen
                          : issue.status === 'IN_PROGRESS'
                            ? styles.stateProgress
                            : styles.stateClosed
                      }
                    >
                      {ISSUE_STATUS_LABEL[issue.status]}
                    </span>
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

        {/*
          Shown whenever there is anything at all, not only when there is a
          second page. The line says how many there are, which is worth reading
          on its own - and it now carries the size control, which would
          otherwise disappear exactly when somebody had just chosen a size big
          enough to fit everything, leaving no way to choose a smaller one.
        */}
        {issues !== null && issues.totalElements > 0 && (
          <CompactPagination
            page={page}
            pageSize={pageSize}
            totalItems={issues.totalElements}
            unit="issues"
            onPageChange={(wanted) => filterBy({ page: String(wanted) }, false)}
            pageSizes={PAGE_SIZES}
            onPageSizeChange={(chosen) => {
              setPageSize(chosen);
              window.localStorage.setItem(PAGE_SIZE_KEY, String(chosen));
              // The page somebody is on means something different at a
              // different size, and the first page is the one that always
              // exists.
              filterBy({});
            }}
          />
        )}
      </section>
    </AppShell>
  );
}

export type { Issue };
