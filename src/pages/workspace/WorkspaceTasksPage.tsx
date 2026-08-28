import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { fetchWorkspaceAgents } from '../../api/agents';
import type { Agent } from '../../api/agents';
import type { SessionUser } from '../../api/session';
import { startTask, fetchTasks, openRequest, TASK_STATUSES, TASK_STATUS_LABEL } from '../../api/tasks';
import type { TaskPage, TaskStatus } from '../../api/tasks';
import { timeAgo } from '../../api/tools';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import { AppShell } from '../../components/AppShell';
import { AutoRefresh } from '../../components/AutoRefresh';
import { CompactPagination } from '../../components/CompactPagination';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceTasksPage.module.css';
import { t } from '../../i18n';

export interface WorkspaceTasksPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 12;

/** How many agents to offer. More than a workspace has, in one page. */
const AGENTS = 200;

/**
 * Tasks: an agent given a problem and left to work at it.
 *
 * The form is at the top rather than behind a button because starting one is
 * what this page is for, and a page whose purpose is one press away is a page
 * with a list on it.
 */
export function WorkspaceTasksPage({ session, onSignOut }: WorkspaceTasksPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<TaskPage | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [prompt, setPrompt] = useState('');
  const [worker, setWorker] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => setPage(1), [status]);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchTasks(workspaceId, {
      status: status === '' ? undefined : status,
      page: page - 1,
      size: PAGE_SIZE,
    })
      .then((found) => {
        setTasks(found);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setTasks(null);
        setError(cause instanceof Error ? cause.message : t('Could not load the tasks.'));
        setLoading(false);
      });
  }, [workspaceId, status, page]);

  useEffect(load, [load]);

  useEffect(() => {
    if (workspaceId === '') return;
    let current = true;
    /*
     * Only agents that could actually work: switched on, and with a model
     * chosen. The models list used to be fetched beside this one and offered as
     * the other half of the choice - see the label below for why it is not.
     *
     * Null on failure rather than an empty list, and null until it arrives. It
     * used to end `.catch(() => undefined)`, which left the list empty - and
     * empty now means "add an agent", so a server that had gone away would send
     * somebody off to build an agent they already have. Neither the note nor the
     * disabled select is drawn while the answer is unknown.
     */
    void fetchWorkspaceAgents(workspaceId, 0, AGENTS)
      .then((found) => {
        if (current) setAgents(found.content.filter((one) => one.enabled && one.modelId !== null));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [workspaceId]);

  async function start() {
    const said = prompt.trim();
    if (said === '' || worker === '' || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const made = await startTask({ workspaceId, prompt: said, agentId: worker });
      setPrompt('');
      navigate(`/workspace/${workspaceId}/tasks/${made.id}`);
    } catch (cause: unknown) {
      setStartError(cause instanceof Error ? cause.message : t('Could not start the task.'));
      setStarting(false);
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.titleHeader}>
        <h1 className={styles.title}>{t('Tasks')}</h1>
        <p className={styles.subtitle}>
          {t('An agent given a problem, working at it until it is done')}
        </p>
      </header>

      {/* The issue's own layout: the prompt, then who is to do it. */}
      <section className={styles.starter}>
        <label className={styles.label} htmlFor="task-prompt">
          <span className={styles.labelWithHint}>
            {t('Prompt')}
            <FieldHint label={t('Prompt')}>
              {t('What you want done, in your own words. The agent works on its own from here: it uses the tools it has been granted, writes down what it is doing as it goes, and stops when it says it is finished. If it needs something it was not given, or the prompt does not say how the result should reach you, it stops and asks — and you are told. Say where the result should end up and you save it a question.')}
            </FieldHint>
          </span>
        </label>
        <textarea
          id="task-prompt"
          className={styles.prompt}
          rows={4}
          placeholder={t('Write a report of last week\'s failed runs and put it in the shared drive.')}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />

        <div className={styles.starterRow}>
          <label className={styles.label} htmlFor="task-worker">
            <span className={styles.labelWithHint}>
              {t('Agent')}
              <FieldHint label={t('Agent')}>
                {t('An agent brings its own instructions, skills and grants, and those grants are the whole of what the task may reach.')}
              </FieldHint>
            </span>
          </label>
          <span className={styles.selectWrapper}>
            <select
              id="task-worker"
              className={styles.select}
              value={worker}
              onChange={(event) => setWorker(event.target.value)}
              disabled={agents !== null && agents.length === 0}
            >
              <option value="">{t('Choose…')}</option>
              {(agents ?? []).map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </span>

          <button
            type="button"
            className={styles.start}
            onClick={() => void start()}
            disabled={prompt.trim() === '' || worker === '' || starting}
          >
            {starting ? 'Starting…' : 'Start'}
          </button>
        </div>

        {/*
          A workspace with no agent is a workspace where nothing can be started,
          which is a state this page did not have before issue #295: a bare model
          used to fill the gap. So it says what is missing and offers the way,
          rather than leaving an empty dropdown to be puzzled over.
        */}
        {agents !== null && agents.length === 0 && (
          <p className={styles.startError}>
            {t('This workspace has no agent that can work yet.')}{' '}
            <Link to={`/workspace/${workspaceId}/agents`}>{t('Add an agent')}</Link>
          </p>
        )}

        {startError !== null && (
          <p className={styles.startError} role="alert">
            {startError}
          </p>
        )}
      </section>

      <div className={styles.filterBar}>
        <div className={styles.sortRow}>
          <label className={styles.sortLabel} htmlFor="task-status">{t('State')}</label>
          <span className={styles.selectWrapper}>
            <select
              id="task-status"
              className={styles.sortSelect}
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskStatus | '')}
            >
              <option value="">{t('All')}</option>
              {TASK_STATUSES.map((one) => (
                <option key={one} value={one}>
                  {TASK_STATUS_LABEL[one]}
                </option>
              ))}
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </span>
        </div>
        {/* A task changes without anybody touching the page, so the list is out
            of date the moment it is drawn. */}
        <AutoRefresh onRefresh={load} busy={loading} />
      </div>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colTitle}>{t('Task')}</span>
          <span className={styles.colWorker}>{t('Doing it')}</span>
          <span className={styles.colState}>{t('State')}</span>
          <span className={styles.colTurns}>{t('Turns')}</span>
          <span className={styles.colWhen}>{t('Started')}</span>
        </div>

        {loading && tasks === null && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && (
          <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
            {error}
          </p>
        )}

        {!loading && error === null && tasks?.content.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>
              <span className={styles.labelWithHint}>
                {t('No tasks yet.')}
                <FieldHint label={t('No tasks yet')}>
                  {t('A task is an agent working on its own: it is given a problem, it uses its tools until it decides it is done, and everything it does is written down as it happens. Type what you want into the box above and choose who is to do it. Tasks also start from elsewhere in the product, and those appear on this list too.')}
                </FieldHint>
              </span>
            </p>
          </div>
        )}

        {tasks?.content.map((one) => {
          const waiting = openRequest(one);
          return (
            <Link
              key={one.id}
              className={styles.row}
              to={`/workspace/${workspaceId}/tasks/${one.id}`}
              data-task-status={one.status}
            >
              <span className={`${styles.colTitle} ${styles.name}`}>
                {one.title}
                {waiting !== null && <span className={styles.needs}>{t('needs you')}</span>}
              </span>
              <span className={`${styles.colWorker} ${styles.muted}`}>
                {one.agentName ?? <span className={styles.nothing}>{t('a model')}</span>}
              </span>
              <span className={styles.colState}>
                <span className={styles.state} data-state={one.status}>
                  {TASK_STATUS_LABEL[one.status]}
                </span>
              </span>
              <span className={`${styles.colTurns} ${styles.muted}`}>
                {one.turnsSpent}/{one.turnsAllowed}
              </span>
              <span className={`${styles.colWhen} ${styles.muted}`}>
                {one.startedAt === null ? (
                  <span className={styles.nothing}>{t('not yet')}</span>
                ) : (
                  timeAgo(one.startedAt)
                )}
              </span>
            </Link>
          );
        })}

        {tasks !== null && tasks.totalElements > 0 && (
          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={tasks.totalElements}
            unit="tasks"
            onPageChange={setPage}
          />
        )}
      </section>
    </AppShell>
  );
}
