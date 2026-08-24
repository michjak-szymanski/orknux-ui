import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchLlmSessionEvents, EVENT_KIND_LABEL } from '../../api/llmSessions';
import type { LlmSessionEvent } from '../../api/llmSessions';
import type { SessionUser } from '../../api/session';
import {
  answerTaskRequest,
  approveTaskRequest,
  asked,
  fetchTask,
  openRequest,
  refuseTaskRequest,
  stopTask,
  TASK_STATUS_LABEL,
} from '../../api/tasks';
import type { Task } from '../../api/tasks';
import { timeAgo } from '../../api/tools';
import { AppShell } from '../../components/AppShell';
import { AutoRefresh } from '../../components/AutoRefresh';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { Markdown } from '../../components/Markdown';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './TaskPage.module.css';

export interface TaskPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** How much of the log to draw. A task that ran for an hour is longer than a screen. */
const LOG_SIZE = 200;

/**
 * One task: what was asked, who is doing it, and everything it has done.
 *
 * The layout is the one the issue asked for and the order somebody reads in: the
 * prompt, who is working on it, a rule, the event log, a rule, and then whatever
 * needs a decision.
 *
 * The log is not this page's own. It is the task's LLM session, read with the
 * same call the Sessions screen makes, because there is one transcript in this
 * product and a second would be a second thing to keep in step.
 */
export function TaskPage({ session, onSignOut }: TaskPageProps) {
  const { workspaceId = '', taskId = '' } = useParams();

  const [task, setTask] = useState<Task | null>(null);
  const [log, setLog] = useState<LlmSessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (taskId === '') return;
    setLoading(true);
    fetchTask(taskId)
      .then(async (found) => {
        setTask(found);
        setError(found === null ? 'That task is not here.' : null);
        if (found?.sessionId != null) {
          const events = await fetchLlmSessionEvents(found.sessionId, { size: LOG_SIZE });
          setLog(events.content);
        } else {
          setLog([]);
        }
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not load the task.');
        setLoading(false);
      });
  }, [taskId]);

  useEffect(load, [load]);

  const waiting = task === null ? null : openRequest(task);

  async function decide(what: () => Promise<Task>) {
    if (deciding) return;
    setDeciding(true);
    setDecideError(null);
    try {
      await what();
      setAnswer('');
      load();
    } catch (cause: unknown) {
      setDecideError(cause instanceof Error ? cause.message : 'That could not be done.');
    } finally {
      setDeciding(false);
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
        <Link className={styles.back} to={`/workspace/${workspaceId}/tasks`}>
          ← Tasks
        </Link>
        <h1 className={styles.title}>{task?.title ?? 'Task'}</h1>
        {task !== null && (
          <p className={styles.subtitle}>
            <span className={styles.state} data-state={task.status} data-testid="task-state">
              {TASK_STATUS_LABEL[task.status]}
            </span>
            {' · '}
            {task.agentName ?? 'a model'}
            {' · '}
            {task.turnsSpent}/{task.turnsAllowed} turns
            {task.startedAt !== null && ` · started ${timeAgo(task.startedAt)}`}
          </p>
        )}
      </header>

      {loading && task === null && (
        <p className={styles.notice}>
          <Loader />
        </p>
      )}
      {error !== null && (
        <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
          {error}
        </p>
      )}

      {task !== null && (
        <>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.label}>Prompt</span>
              <span className={styles.headRight}>
                <AutoRefresh onRefresh={load} busy={loading} />
                {!['DONE', 'FAILED', 'STOPPED'].includes(task.status) && (
                  <button
                    type="button"
                    className={styles.stop}
                    onClick={() => void decide(() => stopTask(task.id))}
                  >
                    Stop
                  </button>
                )}
              </span>
            </div>
            <p className={styles.prompt}>{task.prompt}</p>
          </section>

          {/*
            What it stopped for, right under the prompt, because it is the only
            thing on this page anybody has to do something about. A parked task
            does nothing at all until somebody decides.
          */}
          {waiting !== null && (
            <section className={styles.asking} data-testid="task-waiting">
              <p className={styles.askingHead}>
                <span className={styles.labelWithHint}>
                  {waiting.kind === 'PERMISSION'
                    ? `It needs ${asked(waiting)} to go on.`
                    : 'It has a question.'}
                  <FieldHint label="What a task is waiting for">
                    {waiting.kind === 'PERMISSION' ? (
                      <>
                        Approving gives this <strong>one task</strong> the one thing it named, for as
                        long as the task runs. It does not change what the agent may do anywhere
                        else, and it is recorded against your name. Refusing lets the task carry on
                        without it, or stop and say what it could not do.
                      </>
                    ) : (
                      <>
                        The agent cannot sensibly go on until it is told this — most often because
                        the prompt did not say where what it is producing should end up. What you
                        write goes to it as the next thing said, and it carries on from there.
                      </>
                    )}
                  </FieldHint>
                </span>
              </p>
              <p className={styles.asks}>{waiting.asks}</p>

              {waiting.kind === 'PERMISSION' ? (
                <div className={styles.askingRow}>
                  <button
                    type="button"
                    className={styles.approve}
                    disabled={deciding}
                    onClick={() => void decide(() => approveTaskRequest(waiting.id))}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={styles.refuse}
                    disabled={deciding}
                    onClick={() => void decide(() => refuseTaskRequest(waiting.id))}
                  >
                    Refuse
                  </button>
                </div>
              ) : (
                <div className={styles.askingRow}>
                  <input
                    className={styles.answer}
                    type="text"
                    placeholder="Answer it…"
                    aria-label="Answer the task"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.approve}
                    disabled={deciding || answer.trim() === ''}
                    onClick={() => void decide(() => answerTaskRequest(waiting.id, answer.trim()))}
                  >
                    Answer
                  </button>
                </div>
              )}

              {decideError !== null && (
                <p className={styles.startError} role="alert">
                  {decideError}
                </p>
              )}
            </section>
          )}

          <section className={styles.card} data-testid="task-log">
            <div className={styles.cardHead}>
              <span className={styles.label}>Event log</span>
              <span className={styles.muted}>{log.length} lines</span>
            </div>

            {log.length === 0 && <p className={styles.notice}>Nothing has happened yet.</p>}

            {log.map((line) => (
              <div key={line.id} className={styles.line} data-kind={line.kind}>
                <span className={styles.lineHead}>
                  <span className={styles.kind} data-kind={line.kind}>
                    {EVENT_KIND_LABEL[line.kind]}
                  </span>
                  <span className={styles.actor}>{line.actor}</span>
                  <span className={styles.when}>{timeAgo(line.at)}</span>
                </span>
                {line.content !== null &&
                  (line.kind === 'TOOL' ? (
                    <pre className={styles.call}>{line.content}</pre>
                  ) : (
                    <div className={styles.said}>
                      <Markdown>{line.content}</Markdown>
                    </div>
                  ))}
              </div>
            ))}
          </section>

          {(task.outcome !== null || task.endedBecause !== null) && (
            <section className={styles.card} data-testid="task-outcome">
              <div className={styles.cardHead}>
                <span className={styles.label}>Outcome</span>
                <span className={styles.muted}>{task.endedBecause}</span>
              </div>
              {task.outcome !== null && (
                <div className={styles.said}>
                  <Markdown>{task.outcome}</Markdown>
                </div>
              )}
            </section>
          )}

          {task.grants.length > 0 && (
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.label}>Granted for this task</span>
              </div>
              {task.grants.map((grant) => (
                <p key={grant.id} className={styles.grant}>
                  {grant.capability.toLowerCase().replace('_', ' ')}
                  {grant.subject !== null && ` — ${grant.subject}`}
                  <span className={styles.muted}> by {grant.grantedBy}</span>
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
