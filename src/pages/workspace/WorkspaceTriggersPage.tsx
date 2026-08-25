import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import {
  FIRING_OUTCOME_LABEL,
  TRIGGER_TYPE_LABEL,
  cannotReceive,
  fetchSlackBotUsers,
  fetchTriggerFirings,
  fetchWorkspaceTriggerFirings,
  fetchWorkspaceTriggers,
  listensForMessages,
  setTriggerEnabled,
} from '../../api/triggers';
import type { SlackBotUser, Trigger, TriggerFiring } from '../../api/triggers';
import refreshIcon from '../../assets/refresh-cw.svg';
import settingsIcon from '../../assets/settings-14.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AppShell } from '../../components/AppShell';
import { AutoRefresh } from '../../components/AutoRefresh';
import { CompactPagination } from '../../components/CompactPagination';
import {
  ExportComponentButton,
  ImportComponentsButton,
  SaveAsTemplateButton,
  UseTemplateButton,
  transferStyles,
} from '../../components/ComponentTransfer';
import { CreateTriggerDialog } from '../../components/CreateTriggerDialog';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceTriggersPage.module.css';
import { t } from '../../i18n';

export interface WorkspaceTriggersPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 5;

/** Enough recent firings to see a pattern without becoming the page. */
const HISTORY_PAGE_SIZE = 10;

/** A timestamp as somebody watching a trigger reads it: how long ago. */
function when(at: string): string {
  const seconds = Math.round((Date.now() - new Date(at).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

/** What starts this workspace's workflows. */
export function WorkspaceTriggersPage({ session, onSignOut }: WorkspaceTriggersPageProps) {
  const { workspaceId = '' } = useParams();

  /**
   * A trigger that exists is edited on its own page; the row is the way in.
   *
   * A real link rather than a click that navigates, so the page it opens can be
   * middle-clicked into a tab of its own, copied, or opened beside the list -
   * which is what somebody comparing two triggers is trying to do.
   */
  const settingsPath = (trigger: Trigger) => `/workspace/${workspaceId}/triggers/${trigger.id}`;

  const [triggers, setTriggers] = useState<PageOf<Trigger> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** Which trigger's log is open, and what it holds. */
  const [showing, setShowing] = useState<string | null>(null);
  const [firings, setFirings] = useState<TriggerFiring[]>([]);
  const [firingsError, setFiringsError] = useState<string | null>(null);
  /** Everything that has fired here, whichever trigger did it. */
  const [history, setHistory] = useState<PageOf<TriggerFiring> | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyError, setHistoryError] = useState<string | null>(null);
  /**
   * What each Slack connection's bot token can and cannot do.
   *
   * One answer for the whole workspace, held beside the list rather than looked
   * up per row: `slackBotUsers` is a workspace query, so thirty rows are one
   * question here and — because the server keeps each connection's answer for
   * ten minutes against the token's own fingerprint — at most one `auth.test`
   * per connection behind it, not one per row and not one per page turned.
   */
  const [botUsers, setBotUsers] = useState<SlackBotUser[]>([]);
  /**
   * Which workspace that was asked for, so paging does not ask again.
   *
   * A ref and not state: it decides whether to send a request and nothing is
   * drawn from it, so setting it must not cost a render.
   */
  const asked = useRef('');

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspaceTriggers(workspaceId, page - 1, PAGE_SIZE)
      .then((result) => {
        setTriggers(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setTriggers(null);
        setError(cause instanceof Error ? cause.message : t('Could not load triggers.'));
        setLoading(false);
      });
  }, [workspaceId, page]);

  useEffect(load, [load]);

  /*
   * Whether these connections can hear a message at all, asked once and only
   * where the answer could change what is drawn.
   *
   * A workspace of schedules, webhooks and mentions never asks: none of those
   * is gated on a history scope, so a call to Slack for them would be spent on
   * a question with no bearing on any row. The moment one row does wait for a
   * message or a reply the whole list is answered together, because the query
   * is the workspace's rather than the connection's - which is what keeps a
   * page of thirty from being thirty of anything.
   */
  useEffect(() => {
    if (workspaceId === '') return;
    // Another workspace's answers are about another workspace's connections.
    if (asked.current !== '' && asked.current !== workspaceId) {
      asked.current = '';
      setBotUsers([]);
    }
    if (asked.current === workspaceId) return;
    if (!(triggers?.content.some(listensForMessages) ?? false)) return;
    asked.current = workspaceId;
    fetchSlackBotUsers(workspaceId)
      .then(setBotUsers)
      .catch(() => setBotUsers([]));
  }, [workspaceId, triggers]);

  /*
   * The history is loaded with the page rather than on demand: it is the answer
   * to "why did nothing run", and somebody asking that has already been told by
   * the list above that every trigger looks fine.
   */
  const loadHistory = useCallback(() => {
    if (workspaceId === '') return;
    setHistoryError(null);
    fetchWorkspaceTriggerFirings(workspaceId, historyPage - 1, HISTORY_PAGE_SIZE)
      .then(setHistory)
      .catch((cause: unknown) => {
        setHistory(null);
        setHistoryError(cause instanceof Error ? cause.message : t('Could not load the history.'));
      });
  }, [workspaceId, historyPage]);

  useEffect(loadHistory, [loadHistory]);

  /**
   * The log is loaded when a row is opened rather than with the list — twenty
   * rows would mean twenty queries for something nobody has asked to see.
   */
  useEffect(() => {
    if (showing === null) return;
    let current = true;
    setFirings([]);
    setFiringsError(null);
    fetchTriggerFirings(showing, 0, 20)
      .then((page) => {
        if (current) setFirings(page.content);
      })
      .catch((cause: unknown) => {
        if (current) setFiringsError(cause instanceof Error ? cause.message : t('Could not load the log.'));
      });
    return () => {
      current = false;
    };
  }, [showing]);

  async function toggle(trigger: Trigger) {
    await setTriggerEnabled(trigger.id, !trigger.enabled);
    load();
  }

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      /*
       * Two lists on one screen, each of which can be long. Without this the page
       * itself grows and the sidebar rides up out of view; with it the shell keeps
       * its height and the content scrolls inside it.
       */
      scrollContent
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>{t('Triggers')}</h1>
            <p className={styles.subtitle}>{t('Define events that start workflow executions.')}</p>
          </div>
          <div className={transferStyles.headerActions}>
            <ImportComponentsButton workspaceId={workspaceId} onImported={load} />
            <UseTemplateButton workspaceId={workspaceId} kind="TRIGGER" onImported={load} />
            <button type="button" className={styles.createTrigger} onClick={() => setCreating(true)}>{t('+ Create Trigger')}</button>
          </div>
        </header>

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colName}>{t('Name')}</span>
            <span className={styles.colType}>{t('Type')}</span>
            <span className={styles.colSource}>{t('Source')}</span>
            <span className={styles.colAction}>{t('Action')}</span>
            <span className={styles.colFired}>{t('Last fired')}</span>
            <span className={styles.colStatus}>{t('Status')}</span>
            <span className={styles.colActions}>{t('Actions')}</span>
          </div>

          {loading && <p className={styles.notice}><Loader /></p>}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {!loading && error === null && triggers?.content.length === 0 && (
            <p className={styles.notice}>{t('No triggers yet.')}</p>
          )}

          {triggers?.content.map((trigger) => {
            /*
             * The connection saying this row can never fire, where it says so.
             *
             * Here rather than on the trigger's own page alone, because this is
             * the screen the question is asked on: every column reads healthy -
             * Enabled, a connection, an action - and the one fact that decides
             * whether anything will ever happen was drawn nowhere. Null and
             * false are kept apart inside `cannotReceive`; a connection Slack
             * said nothing about is not marked.
             */
            const silent = cannotReceive(trigger, botUsers);
            return (
            <Fragment key={trigger.id}>
            <div className={styles.row}>
              <Link
                className={`${styles.colName} ${styles.name} ${styles.nameButton}`}
                to={settingsPath(trigger)}
                title={`Settings for ${trigger.name}`}
              >
                {trigger.name}
              </Link>
              <span className={`${styles.colType} ${styles.muted}`}>{TRIGGER_TYPE_LABEL[trigger.type]}</span>
              <span className={`${styles.colSource} ${styles.muted}`}>{trigger.source}</span>
              <span className={`${styles.colAction} ${styles.actionCell}`}>
                <span className={trigger.type === 'SCHEDULED' ? styles.mono : styles.muted}>
                  {trigger.event}
                </span>
                {/*
                  Two words in the open and the sentence behind the (?): the
                  row has one line to spare and the product already has a
                  sentence for this, so the short form marks the row and the
                  long one is a press away rather than a screen away.
                */}
                {silent !== null && (
                  <span className={styles.cannotFire} id={`trigger-cannot-fire-${trigger.id}`}>
                    <span className={styles.cannotFireBadge}>{t('Will not fire')}</span>
                    <FieldHint label={t('Will not fire')}>{silent.message}</FieldHint>
                  </span>
                )}
              </span>
              <button
                type="button"
                className={`${styles.colFired} ${styles.firedButton}`}
                onClick={() => setShowing((current) => (current === trigger.id ? null : trigger.id))}
                aria-expanded={showing === trigger.id}
                title={
                  trigger.lastFiring === null
                    ? t('This trigger has not been asked to do anything yet')
                    : (trigger.lastFiring.detail ?? FIRING_OUTCOME_LABEL[trigger.lastFiring.outcome])
                }
              >
                {trigger.lastFiring === null ? (
                  <span className={styles.never}>{t('Never')}</span>
                ) : (
                  <>
                    <span
                      className={
                        trigger.lastFiring.outcome === 'STARTED' ? styles.outcomeGood : styles.outcomeQuiet
                      }
                    >
                      {FIRING_OUTCOME_LABEL[trigger.lastFiring.outcome]}
                    </span>
                    <span className={styles.firedAt}>{when(trigger.lastFiring.at)}</span>
                  </>
                )}
              </button>
              <span className={styles.colStatus}>
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={() => toggle(trigger)}
                  aria-pressed={trigger.enabled}
                  aria-label={`${trigger.enabled ? 'Disable' : 'Enable'} ${trigger.name}`}
                  title={trigger.enabled ? 'Enabled' : 'Disabled'}
                >
                  <img
                    src={trigger.enabled ? toggleOnIcon : toggleOffIcon}
                    data-keeps-colour
                    alt=""
                    width={36}
                    height={20}
                  />
                </button>
              </span>
              <span className={styles.colActions}>
                <ExportComponentButton
                  workspaceId={workspaceId}
                  kind="TRIGGER"
                  id={trigger.id}
                  name={trigger.name}
                  className={styles.rowAction}
                />
                <SaveAsTemplateButton
                  workspaceId={workspaceId}
                  kind="TRIGGER"
                  id={trigger.id}
                  name={trigger.name}
                  className={styles.rowAction}
                  canPublish={session.admin}
                />
                <Link
                  className={styles.rowAction}
                  to={settingsPath(trigger)}
                  aria-label={`Settings for ${trigger.name}`}
                  title={`Settings for ${trigger.name}`}
                >
                  <img src={settingsIcon} alt="" width={14} height={14} />
                </Link>
              </span>
            </div>

            {showing === trigger.id && (
              <div className={styles.log}>
                {firingsError !== null && <p className={styles.logEmpty}>{firingsError}</p>}
                {/*
                  "Nothing yet." stops being true the first time this fires.
                  Why an empty log is unremarkable, and what "asked" means for a
                  Slack trigger, is as true of a log with forty rows in it - so
                  by the rules file's test it is not status, and it goes behind
                  the (?) beside the line rather than away.
                */}
                {firingsError === null && firings.length === 0 && (
                  <p className={styles.logEmpty}>
                    <span className={styles.labelWithHint}>
                      {t('Nothing yet.')}
                      <FieldHint label={t('Nothing yet')}>
                        {t('This trigger has not been asked to do anything — for a Slack trigger that means no matching event has arrived. An empty log is what a trigger nobody has reached looks like, not a sign that anything is wrong with it.')}
                      </FieldHint>
                    </span>
                  </p>
                )}
                {firings.map((firing) => (
                  <div key={firing.id} className={styles.logRow}>
                    <span className={styles.logAt}>{when(firing.at)}</span>
                    <span
                      className={firing.outcome === 'STARTED' ? styles.outcomeGood : styles.outcomeQuiet}
                    >
                      {FIRING_OUTCOME_LABEL[firing.outcome]}
                    </span>
                    <span className={styles.logDetail}>{firing.detail}</span>
                  </div>
                ))}
              </div>
            )}
            </Fragment>
            );
          })}

          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={triggers?.totalElements ?? 0}
            onPageChange={setPage}
            unit="triggers"
          />
        </div>
      </section>

      {/*
        Every trigger's log in one place, under the list it explains.
      */}
      <section className={styles.card}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title}>{t('History')}</h2>
            <p className={styles.subtitle}>
              {t('What every trigger here has done, newest first — including the firings no run came of, which appear nowhere else.')}
            </p>
          </div>
          {/*
            A trigger fires without anybody watching, so this list is out of date
            the moment it is drawn. Both ways of dealing with that: reload now, or
            keep reloading. The interval is the shared one — chosen once, not per
            screen.
          */}
          <div className={styles.watch}>
            <button
              type="button"
              className={styles.refresh}
              onClick={loadHistory}
              aria-label={t('Refresh the history')}
              title={t('Refresh the history')}
            >
              <img src={refreshIcon} alt="" width={14} height={14} />
            </button>
            <AutoRefresh onRefresh={loadHistory} />
          </div>
        </div>

        <div className={styles.historyHeader}>
          <span className={styles.colWhen}>{t('When')}</span>
          <span className={styles.colTrigger}>{t('Trigger')}</span>
          <span className={styles.colOutcome}>{t('Outcome')}</span>
          <span className={styles.colRuns}>{t('Runs')}</span>
          <span className={styles.colDetail}>{t('Detail')}</span>
        </div>

        <div className={styles.historyBody}>
          {historyError !== null && <p className={styles.logEmpty}>{historyError}</p>}
          {/* The same split, for the whole workspace's log. */}
          {historyError === null && history !== null && history.content.length === 0 && (
            <p className={styles.logEmpty}>
              <span className={styles.labelWithHint}>
                {t('Nothing has fired here yet.')}
                <FieldHint label={t('Nothing has fired here yet')}>
                  {t('A trigger that has never been asked to do anything leaves no entry, so an empty log here means nothing has reached any trigger in this workspace rather than that something failed.')}
                </FieldHint>
              </span>
            </p>
          )}
          {history?.content.map((firing) => (
            <div key={firing.id} className={styles.historyRow}>
              <span className={`${styles.colWhen} ${styles.muted}`} title={firing.at}>
                {when(firing.at)}
              </span>
              {/* The trigger opens from here: an entry usually raises a question about it. */}
              <span className={styles.colTrigger}>
                {firing.triggerId != null && firing.triggerName != null ? (
                  <Link
                    className={styles.historyTrigger}
                    to={`/workspace/${workspaceId}/triggers/${firing.triggerId}`}
                  >
                    {firing.triggerName}
                  </Link>
                ) : (
                  <span className={styles.muted}>&mdash;</span>
                )}
              </span>
              <span className={styles.colOutcome}>
                <span
                  className={firing.outcome === 'STARTED' ? styles.outcomeGood : styles.outcomeQuiet}
                >
                  {FIRING_OUTCOME_LABEL[firing.outcome]}
                </span>
              </span>
              <span className={`${styles.colRuns} ${styles.mono}`}>{firing.runsStarted}</span>
              <span className={`${styles.colDetail} ${styles.muted}`} title={firing.detail ?? undefined}>
                {firing.detail ?? '—'}
              </span>
            </div>
          ))}
        </div>

        <CompactPagination
          page={historyPage}
          pageSize={HISTORY_PAGE_SIZE}
          totalItems={history?.totalElements ?? 0}
          onPageChange={setHistoryPage}
          unit="firings"
        />
      </section>

      <CreateTriggerDialog
        open={creating}
        workspaceId={workspaceId}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          load();
        }}
      />
    </AppShell>
  );
}
