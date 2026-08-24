import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { fetchWorkspaceAgents } from '../../api/agents';
import type { Agent } from '../../api/agents';
import { fetchModels } from '../../api/models';
import type { Model } from '../../api/models';
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

export interface WorkspaceTasksPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 12;

/** How many agents to offer. More than a workspace has, in one page. */
const AGENTS = 200;

/**
 * Who is to do it, as one field.
 *
 * An agent and a model are the two answers to one question, so they are one
 * control rather than two that can both be filled in. The value carries which
 * of the two it is, because the ids are from different tables and 7 alone does
 * not say which 7.
 */
function workerValue(kind: 'agent' | 'model', id: string): string {
  return `${kind}:${id}`;
}

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

  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
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
        setError(cause instanceof Error ? cause.message : 'Could not load the tasks.');
        setLoading(false);
      });
  }, [workspaceId, status, page]);

  useEffect(load, [load]);

  useEffect(() => {
    if (workspaceId === '') return;
    let current = true;
    void fetchWorkspaceAgents(workspaceId, 0, AGENTS)
      .then((found) => {
        if (current) setAgents(found.content.filter((one) => one.enabled));
      })
      .catch(() => undefined);
    void fetchModels(workspaceId)
      .then((found) => {
        if (current) setModels(found.filter((one) => one.enabled && one.kind === 'CHAT'));
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
    const [kind, id] = worker.split(':');
    try {
      const made = await startTask({
        workspaceId,
        prompt: said,
        agentId: kind === 'agent' ? id : null,
        modelId: kind === 'model' ? id : null,
      });
      setPrompt('');
      navigate(`/workspace/${workspaceId}/tasks/${made.id}`);
    } catch (cause: unknown) {
      setStartError(cause instanceof Error ? cause.message : 'Could not start the task.');
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
        <h1 className={styles.title}>Tasks</h1>
        <p className={styles.subtitle}>An agent given a problem, working at it until it is done</p>
      </header>

      {/* The issue's own layout: the prompt, then who is to do it. */}
      <section className={styles.starter}>
        <label className={styles.label} htmlFor="task-prompt">
          <span className={styles.labelWithHint}>
            Prompt
            <FieldHint label="Prompt">
              What you want done, in your own words. The agent works on its own from here: it uses
              the tools it has been granted, writes down what it is doing as it goes, and stops when
              it says it is finished. If it needs something it was not given, or the prompt does not
              say how the result should reach you, it stops and asks — and you are told. Say where
              the result should end up and you save it a question.
            </FieldHint>
          </span>
        </label>
        <textarea
          id="task-prompt"
          className={styles.prompt}
          rows={4}
          placeholder="Write a report of last week's failed runs and put it in the shared drive."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />

        <div className={styles.starterRow}>
          <label className={styles.label} htmlFor="task-worker">
            <span className={styles.labelWithHint}>
              Agent or model
              <FieldHint label="Agent or model">
                An agent brings its own instructions, skills and grants, and those grants are the
                whole of what the task may reach. A bare model brings none of that: it starts with
                nothing and has to ask for everything, which is the safer place to start and the
                slower one.
              </FieldHint>
            </span>
          </label>
          <span className={styles.selectWrapper}>
            <select
              id="task-worker"
              className={styles.select}
              value={worker}
              onChange={(event) => setWorker(event.target.value)}
            >
              <option value="">Choose…</option>
              {agents.length > 0 && (
                <optgroup label="Agents">
                  {agents.map((one) => (
                    <option key={`agent-${one.id}`} value={workerValue('agent', one.id)}>
                      {one.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {models.length > 0 && (
                <optgroup label="Models">
                  {models.map((one) => (
                    <option key={`model-${one.id}`} value={workerValue('model', one.id)}>
                      {one.providerName} · {one.name}
                    </option>
                  ))}
                </optgroup>
              )}
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

        {startError !== null && (
          <p className={styles.startError} role="alert">
            {startError}
          </p>
        )}
      </section>

      <div className={styles.filterBar}>
        <div className={styles.sortRow}>
          <label className={styles.sortLabel} htmlFor="task-status">
            State
          </label>
          <span className={styles.selectWrapper}>
            <select
              id="task-status"
              className={styles.sortSelect}
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskStatus | '')}
            >
              <option value="">All</option>
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
          <span className={styles.colTitle}>Task</span>
          <span className={styles.colWorker}>Doing it</span>
          <span className={styles.colState}>State</span>
          <span className={styles.colTurns}>Turns</span>
          <span className={styles.colWhen}>Started</span>
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
                No tasks yet.
                <FieldHint label="No tasks yet">
                  A task is an agent working on its own: it is given a problem, it uses its tools
                  until it decides it is done, and everything it does is written down as it happens.
                  Type what you want into the box above and choose who is to do it. Tasks also start
                  from elsewhere in the product, and those appear on this list too.
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
                {waiting !== null && <span className={styles.needs}>needs you</span>}
              </span>
              <span className={`${styles.colWorker} ${styles.muted}`}>
                {one.agentName ?? <span className={styles.nothing}>a model</span>}
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
                  <span className={styles.nothing}>not yet</span>
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
