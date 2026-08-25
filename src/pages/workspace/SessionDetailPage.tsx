import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { startChat } from '../../api/chat';
import {
  EVENT_KINDS,
  EVENT_KIND_LABEL,
  fetchLlmSession,
  fetchLlmSessionEvents,
  removeLlmSession,
} from '../../api/llmSessions';
import type {
  LlmSession,
  LlmSessionEvent,
  LlmSessionEventKind,
  LlmSessionEventOrder,
  LlmSessionEventPage,
} from '../../api/llmSessions';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import searchIcon from '../../assets/search.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { CompactPagination } from '../../components/CompactPagination';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './SessionDetailPage.module.css';
import { t } from '../../i18n';

export interface SessionDetailPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 20;
const PAGE_SIZES = [20, 50, 100];
const SEARCH_PAUSE_MS = 300;

const ORDERS: { label: string; order: LlmSessionEventOrder }[] = [
  { label: t('Time'), order: 'AT' },
  { label: t('Kind'), order: 'KIND' },
];

/**
 * How much of one line is shown before it is folded.
 *
 * A tool call's arguments are whatever the model sent, and a file written by an
 * agent arrives as one of them - so a transcript with nothing holding it back is
 * one event per screen, and the shape of the conversation is lost.
 */
const FOLD_OVER_CHARS = 600;

/** The class each kind's badge and rule take, so four things read as four things. */
const KIND_CLASS: Record<LlmSessionEventKind, string> = {
  AGENT: 'kindAgent',
  TOOL: 'kindTool',
  USER: 'kindUser',
  SYSTEM: 'kindSystem',
};

/**
 * A tool call is the arguments as the model sent them, which is usually JSON and
 * is not always: indent what parses and leave the rest exactly as it arrived.
 */
function readable(kind: LlmSessionEventKind, content: string | null): string {
  const raw = content ?? '';
  if (kind !== 'TOOL') return raw;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** The clock down the left of the transcript: the time of day, to the second. */
function timeOfDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** Which day a line falls on, so a fortnight of conversation is not one wall. */
function dayOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** One line of the transcript, folded while it is longer than a line should be. */
function EventLine({ event }: { event: LlmSessionEvent }) {
  const text = readable(event.kind, event.content);
  const long = text.length > FOLD_OVER_CHARS;
  const [open, setOpen] = useState(false);

  return (
    <article className={`${styles.event} ${styles[KIND_CLASS[event.kind]]}`}>
      <div className={styles.eventHead}>
        <span className={styles.kindBadge}>{EVENT_KIND_LABEL[event.kind]}</span>
        <span className={styles.actor}>{event.actor}</span>
        <span className={styles.at} title={event.at}>
          {timeOfDay(event.at)}
        </span>
      </div>
      {text.trim() === '' ? (
        <p className={styles.nothing}>{t('Nothing was recorded on this line.')}</p>
      ) : (
        <>
          {/*
            A tool's arguments are code and are read as code; what was said is
            prose, and monospacing prose makes a conversation look like a log.
          */}
          <pre className={`${styles.content} ${event.kind === 'TOOL' ? styles.code : ''} ${long && !open ? styles.folded : ''}`}>
            {text}
          </pre>
          {long && (
            <button type="button" className={styles.fold} onClick={() => setOpen((held) => !held)}>
              {open ? t('Show less') : `Show all ${text.length.toLocaleString()} characters`}
            </button>
          )}
        </>
      )}
    </article>
  );
}

/**
 * One session, read.
 *
 * The transcript is its own query rather than a field on the session, because a
 * fortnight of conversation is more than a page holds - so the search, the kind
 * filter and the sort all belong to this page rather than to what it is reading.
 */
export function SessionDetailPage({ session, onSignOut }: SessionDetailPageProps) {
  const { workspaceId = '', sessionId = '' } = useParams();

  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  /** True while a chat is being opened, so a second press does not open a second one. */
  const [continuing, setContinuing] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [held, setHeld] = useState<LlmSession | null>(null);
  const [missing, setMissing] = useState(false);
  const [events, setEvents] = useState<LlmSessionEventPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  /*
   * Nothing ticked is every kind, which is what the server means by an empty
   * list as well. So the filter is drawn as four things that can be switched
   * off rather than four that have to be switched on, and switching the last
   * one off returns to the whole transcript instead of emptying the page.
   */
  const [kinds, setKinds] = useState<LlmSessionEventKind[]>([]);
  const [order, setOrder] = useState<LlmSessionEventOrder>('AT');
  const [ascending, setAscending] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionId === '') return;
    fetchLlmSession(sessionId)
      .then((found) => {
        setHeld(found);
        setMissing(found === null);
      })
      .catch(() => setMissing(true));
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), SEARCH_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, kinds, order, ascending, pageSize]);

  const load = useCallback(() => {
    if (sessionId === '') return;
    setLoading(true);
    setError(null);
    fetchLlmSessionEvents(sessionId, {
      search: debouncedSearch || undefined,
      kinds,
      page: page - 1,
      size: pageSize,
      order,
      ascending,
    })
      .then((found) => {
        setEvents(found);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setEvents(null);
        setError(cause instanceof Error ? cause.message : t('Could not load the transcript.'));
        setLoading(false);
      });
  }, [sessionId, debouncedSearch, kinds, page, pageSize, order, ascending]);

  useEffect(load, [load]);

  const filtered = debouncedSearch.trim() !== '' || kinds.length > 0;

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
      title={held?.key}
      scrollContent
    >
      <header className={styles.contentHeader}>
        <p className={styles.breadcrumb}>
          <BackLink to={`/workspace/${workspaceId}/sessions`} label={t('Sessions')} />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/sessions`}>
            {t('Sessions')}
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{held?.key ?? 'Session'}</span>
        </p>

        {missing ? (
          <p className={styles.gone} role="alert">
            {t('There is no such session, or it is not one you can see.')}
          </p>
        ) : (
          <>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{held?.key ?? '…'}</h1>
              {/*
                Two presses rather than a dialog, the way the other destructive
                controls here work. Nothing makes a session again - it exists
                because a run computed its key - so this is the one act on this
                page that cannot be undone by repeating what caused it.
              */}
              {held !== null && (
                <div className={styles.actions}>
                  {/*
                    Picking the conversation up by hand.

                    A session is written by agents going to work, and this is
                    the one way a person joins one: the chat it opens is bound
                    to this session, starts holding what was already said, and
                    writes what is said next back here — so the transcript below
                    keeps growing and the next run to read it finds what a
                    person told it.
                  */}
                  <button
                    type="button"
                    className={styles.continue}
                    disabled={continuing}
                    onClick={() => {
                      setContinuing(true);
                      setRemoveError(null);
                      void startChat(workspaceId, held.key, undefined, held.id)
                        .then((chat) => navigate(`/chat/${chat.id}`))
                        .catch((cause: unknown) => {
                          setContinuing(false);
                          setRemoveError(
                            cause instanceof Error ? cause.message : t('That conversation could not be continued.'),
                          );
                        });
                    }}
                  >
                    {continuing ? t('Opening…') : t('Continue in chat')}
                  </button>
                  <button
                    type="button"
                    className={confirming ? styles.removeArmed : styles.remove}
                    onClick={() => {
                      if (!confirming) {
                        setConfirming(true);
                        return;
                      }
                      void removeLlmSession(held.id)
                        .then(() => navigate(`/workspace/${workspaceId}/sessions`))
                        .catch((cause: unknown) =>
                          setRemoveError(cause instanceof Error ? cause.message : t('That could not be removed.')),
                        );
                    }}
                    onBlur={() => setConfirming(false)}
                  >
                    {confirming ? t('Remove it, and everything said in it') : t('Remove session')}
                  </button>
                </div>
              )}
            </div>
            {removeError !== null && (
              <p className={styles.gone} role="alert">
                {removeError}
              </p>
            )}
            <p className={styles.meta}>
              {held === null ? (
                'Loading…'
              ) : (
                <>
                  {held.keyPrefix === null ? t('No prefix') : <>Prefix {held.keyPrefix}</>}
                  {' · '}
                  {held.eventCount} {held.eventCount === 1 ? 'line' : 'lines'}
                  {' · '}opened {timeAgo(held.createdAt)}
                  {' · '}
                  {held.lastEventAt === null
                    ? 'nothing said yet'
                    : `last spoken in ${timeAgo(held.lastEventAt)}`}
                </>
              )}
            </p>
          </>
        )}
      </header>

      {!missing && (
        <>
          <div className={styles.filterBar}>
            <div className={styles.searchInput}>
              <img src={searchIcon} alt="" width={14} height={14} />
              <input
                className={styles.searchField}
                type="search"
                placeholder={t('Search what was said, and who said it…')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={t('Search this transcript')}
              />
            </div>

            <div className={styles.kindFilter} role="group" aria-label={t('Which kinds to show')}>
              {EVENT_KINDS.map((kind) => {
                const on = kinds.includes(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`${styles.kindChip} ${styles[KIND_CLASS[kind]]} ${on ? styles.kindChipOn : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      setKinds((wanted) =>
                        wanted.includes(kind) ? wanted.filter((one) => one !== kind) : [...wanted, kind],
                      )
                    }
                  >
                    {EVENT_KIND_LABEL[kind]}
                  </button>
                );
              })}
            </div>

            <div className={styles.sortRow}>
              <label className={styles.sortLabel} htmlFor="event-order">{t('Sort')}</label>
              <span className={styles.selectWrapper}>
                <select
                  id="event-order"
                  className={styles.sortSelect}
                  value={order}
                  onChange={(event) => setOrder(event.target.value as LlmSessionEventOrder)}
                >
                  {ORDERS.map((one) => (
                    <option key={one.order} value={one.order}>
                      {one.label}
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </span>
              <button
                type="button"
                className={styles.sortDirection}
                onClick={() => setAscending((was) => !was)}
                title={ascending ? t('Oldest first - press for newest first') : t('Newest first - press for oldest first')}
                aria-label={ascending ? t('Oldest first') : t('Newest first')}
              >
                {ascending ? '↑' : '↓'}
              </button>
            </div>
          </div>

          <section className={styles.transcript}>
            {loading && events === null && (
              <p className={styles.notice}>
                <Loader />
              </p>
            )}
            {error !== null && (
              <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                {error}
              </p>
            )}
            {!loading && error === null && events?.content.length === 0 && (
              <p className={styles.notice}>
                {filtered
                  ? t('Nothing in this session matches that.')
                  : t('This session was opened but nothing has been recorded in it.')}
              </p>
            )}

            {events?.content.map((event, index) => {
              /*
               * The day is a heading rather than part of every line: a session
               * runs for as long as its key is computed again, so the same
               * transcript can span weeks - and only sorted by time does saying
               * so mean anything.
               */
              const day = dayOf(event.at);
              const newDay = order === 'AT' && day !== '' && day !== dayOf(events.content[index - 1]?.at ?? '');
              return (
                <div key={event.id}>
                  {newDay && <p className={styles.day}>{day}</p>}
                  <EventLine event={event} />
                </div>
              );
            })}

            {events !== null && events.totalElements > 0 && (
              <CompactPagination
                page={page}
                pageSize={pageSize}
                totalItems={events.totalElements}
                unit="lines"
                onPageChange={setPage}
                pageSizes={PAGE_SIZES}
                onPageSizeChange={setPageSize}
              />
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
