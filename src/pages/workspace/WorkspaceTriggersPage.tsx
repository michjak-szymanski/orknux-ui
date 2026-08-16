import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import {
  FIRING_OUTCOME_LABEL,
  TRIGGER_TYPE_LABEL,
  fetchTriggerFirings,
  fetchWorkspaceTriggerFirings,
  fetchWorkspaceTriggers,
  setTriggerEnabled,
} from '../../api/triggers';
import type { Trigger, TriggerFiring } from '../../api/triggers';
import refreshIcon from '../../assets/refresh-cw.svg';
import settingsIcon from '../../assets/settings-14.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AppShell } from '../../components/AppShell';
import { AutoRefresh } from '../../components/AutoRefresh';
import { CompactPagination } from '../../components/CompactPagination';
import { CreateTriggerDialog } from '../../components/CreateTriggerDialog';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceTriggersPage.module.css';

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
  const navigate = useNavigate();

  /** A trigger that exists is edited on its own page; the row is the way in. */
  const settings = useCallback(
    (trigger: Trigger) => navigate(`/workspace/${workspaceId}/triggers/${trigger.id}`),
    [navigate, workspaceId],
  );

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
        setError(cause instanceof Error ? cause.message : 'Could not load triggers.');
        setLoading(false);
      });
  }, [workspaceId, page]);

  useEffect(load, [load]);

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
        setHistoryError(cause instanceof Error ? cause.message : 'Could not load the history.');
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
        if (current) setFiringsError(cause instanceof Error ? cause.message : 'Could not load the log.');
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
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      /*
       * Two lists on one screen, each of which can be long. Without this the page
       * itself grows and the sidebar rides up out of view; with it the shell keeps
       * its height and the content scrolls inside it.
       */
      scrollContent
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="triggers" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Triggers</h1>
            <p className={styles.subtitle}>Define events that start workflow executions.</p>
          </div>
          <button type="button" className={styles.createTrigger} onClick={() => setCreating(true)}>
            + Create Trigger
          </button>
        </header>

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colName}>Name</span>
            <span className={styles.colType}>Type</span>
            <span className={styles.colSource}>Source</span>
            <span className={styles.colAction}>Action</span>
            <span className={styles.colFired}>Last fired</span>
            <span className={styles.colStatus}>Status</span>
            <span className={styles.colActions}>Actions</span>
          </div>

          {loading && <p className={styles.notice}><Loader /></p>}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {!loading && error === null && triggers?.content.length === 0 && (
            <p className={styles.notice}>No triggers yet.</p>
          )}

          {triggers?.content.map((trigger) => (
            <Fragment key={trigger.id}>
            <div className={styles.row}>
              <button
                type="button"
                className={`${styles.colName} ${styles.name} ${styles.nameButton}`}
                onClick={() => settings(trigger)}
                title={`Settings for ${trigger.name}`}
              >
                {trigger.name}
              </button>
              <span className={`${styles.colType} ${styles.muted}`}>{TRIGGER_TYPE_LABEL[trigger.type]}</span>
              <span className={`${styles.colSource} ${styles.muted}`}>{trigger.source}</span>
              <span
                className={`${styles.colAction} ${trigger.type === 'SCHEDULED' ? styles.mono : styles.muted}`}
              >
                {trigger.event}
              </span>
              <button
                type="button"
                className={`${styles.colFired} ${styles.firedButton}`}
                onClick={() => setShowing((current) => (current === trigger.id ? null : trigger.id))}
                aria-expanded={showing === trigger.id}
                title={
                  trigger.lastFiring === null
                    ? 'This trigger has not been asked to do anything yet'
                    : (trigger.lastFiring.detail ?? FIRING_OUTCOME_LABEL[trigger.lastFiring.outcome])
                }
              >
                {trigger.lastFiring === null ? (
                  <span className={styles.never}>Never</span>
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
                <button
                  type="button"
                  className={styles.rowAction}
                  onClick={() => settings(trigger)}
                  aria-label={`Settings for ${trigger.name}`}
                  title={`Settings for ${trigger.name}`}
                >
                  <img src={settingsIcon} alt="" width={14} height={14} />
                </button>
              </span>
            </div>

            {showing === trigger.id && (
              <div className={styles.log}>
                {firingsError !== null && <p className={styles.logEmpty}>{firingsError}</p>}
                {firingsError === null && firings.length === 0 && (
                  <p className={styles.logEmpty}>
                    Nothing yet. This trigger has not been asked to do anything — for a Slack
                    trigger that means no matching event has arrived.
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
          ))}

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
            <h2 className={styles.title}>History</h2>
            <p className={styles.subtitle}>
              What every trigger here has done, newest first &mdash; including the firings no run came
              of, which appear nowhere else.
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
              aria-label="Refresh the history"
              title="Refresh the history"
            >
              <img src={refreshIcon} alt="" width={14} height={14} />
            </button>
            <AutoRefresh onRefresh={loadHistory} />
          </div>
        </div>

        <div className={styles.historyHeader}>
          <span className={styles.colWhen}>When</span>
          <span className={styles.colTrigger}>Trigger</span>
          <span className={styles.colOutcome}>Outcome</span>
          <span className={styles.colRuns}>Runs</span>
          <span className={styles.colDetail}>Detail</span>
        </div>

        <div className={styles.historyBody}>
          {historyError !== null && <p className={styles.logEmpty}>{historyError}</p>}
          {historyError === null && history !== null && history.content.length === 0 && (
            <p className={styles.logEmpty}>
              Nothing has fired here yet. A trigger that has never been asked to do anything leaves
              no entry.
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
