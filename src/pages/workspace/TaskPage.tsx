import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchLlmSessionEvents } from '../../api/llmSessions';
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
  watchTask,
  workedTime,
} from '../../api/tasks';
import type { Task, TaskStep, TaskWatchState } from '../../api/tasks';
import { timeAgo } from '../../api/tools';
import { AppShell } from '../../components/AppShell';
import { CallLine } from '../../components/CallLine';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { Markdown } from '../../components/Markdown';
import { Thinking } from '../../components/Thinking';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './TaskPage.module.css';
import { t } from '../../i18n';

export interface TaskPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * How much of the session to draw before following it.
 *
 * The *newest* of it, which is the half that matters and was the other way
 * round: a task that ran overnight has thousands of lines and the first hundred
 * of them are the part that stopped being interesting hours ago. It is also what
 * makes the cursor right — the stream is asked for everything after the newest
 * line drawn, so drawing the oldest ones would mean asking for the whole night
 * again.
 *
 * A hundred because that is what the server will give: `llmSessionEvents` caps a
 * page there, so the two hundred this used to ask for was a hundred that read
 * like a decision.
 */
const LOG_SIZE = 100;

/** What the page says it is doing, in one word. */
const WATCHING_LABEL: Record<TaskWatchState, string> = {
  live: 'Live',
  returning: 'Reconnecting',
  ended: 'Finished',
};

/** The states that mean nothing further will happen. */
const OVER: Task['status'][] = ['DONE', 'FAILED', 'STOPPED'];

/**
 * One task, watched as it is worked on.
 *
 * A session view rather than a table that reloads. Each step appears when it
 * happens, a tool call is named the moment it is made and fills in with what
 * came back when the tool answers, and the state — working, needs you, done,
 * failed — is on the page the instant it changes. There is no refresh control,
 * and its absence is the feature: an interval somebody has to choose is either
 * too slow to read as live or a query every five seconds for an hour.
 *
 * **And it reads the same afterwards.** Nothing here is kept only in the
 * stream. What is drawn is the task's LLM session, which every agent in this
 * application writes into and which was already durable before any of this —
 * so somebody opening a task that finished last week gets the same account,
 * assembled the same way, with the live part simply having nothing left to add.
 * That is also the answer to two people watching at once: they are two cursors
 * over one log rather than two halves of one connection, and neither can be too
 * late for anything.
 */
/**
 * As much of a task's name as a tab can show.
 *
 * Long enough to tell two tasks apart and short enough that the product name
 * after it survives - which is the half somebody with a dozen tabs open is
 * reading. Cut on a word where there is one nearby, because a tab ending
 * mid-syllable reads as a fault rather than as a cut.
 */
function excerpt(title: string): string {
  const cut = title.trim();
  if (cut.length <= 44) return cut;
  const space = cut.lastIndexOf(' ', 44);
  return `${cut.slice(0, space > 24 ? space : 44).trimEnd()}…`;
}

export function TaskPage({ session, onSignOut }: TaskPageProps) {
  const { workspaceId = '', taskId = '' } = useParams();

  const [task, setTask] = useState<Task | null>(null);
  const [log, setLog] = useState<LlmSessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [watching, setWatching] = useState<TaskWatchState>('live');

  /**
   * The newest line drawn, which is where following starts.
   *
   * A ref and not state on purpose: the stream is opened once, in an effect that
   * must not be torn down and rebuilt every time a line arrives — which is what
   * putting the cursor in state would do, and it would reconnect on every step.
   */
  const cursor = useRef('0');

  const load = useCallback(async () => {
    if (taskId === '') return;
    setLoading(true);
    try {
      const found = await fetchTask(taskId);
      setTask(found);
      setError(found === null ? t('That task is not here.') : null);
      if (found?.sessionId != null) {
        // Newest first and turned round, so what is drawn is the tail of the
        // session rather than its opening.
        const page = await fetchLlmSessionEvents(found.sessionId, {
          size: LOG_SIZE,
          ascending: false,
        });
        const lines = [...page.content].reverse();
        setLog(lines);
        cursor.current = lines.reduce(
          (highest, line) => (Number(line.id) > Number(highest) ? line.id : highest),
          '0',
        );
      } else {
        setLog([]);
        cursor.current = '0';
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('Could not load the task.'));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Follows the task, once there is something to follow from.
   *
   * Keyed on the task, the loading flag and the session, and deliberately on
   * nothing else. The cursor and the log are what the stream *writes*, so
   * listing either here would tear the connection down and open another on every
   * line that arrived — a reconnect per step, which is the one shape worse than
   * polling.
   */
  const sessionId = task?.sessionId ?? null;
  useEffect(() => {
    if (taskId === '' || loading || sessionId === null) return;
    return watchTask(taskId, cursor.current, {
      onStep: (step) => setLog((held) => merged(held, step)),
      onTask: setTask,
      onWatching: setWatching,
    });
  }, [taskId, loading, sessionId]);

  const waiting = task === null ? null : openRequest(task);
  const over = task !== null && OVER.includes(task.status);

  async function decide(what: () => Promise<Task>) {
    if (deciding) return;
    setDeciding(true);
    setDecideError(null);
    try {
      setTask(await what());
      setAnswer('');
    } catch (cause: unknown) {
      setDecideError(cause instanceof Error ? cause.message : t('That could not be done.'));
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
      /*
        The tab says what kind of page this is and which one of them.
        
        The name alone was not enough: a task is named after the first line of
        its prompt, so a tab reading "Write me a poem about the Lord of the
        Rings" could as easily have been a chat, an issue or a note - the one
        thing it did not say was that it was a task. An issue has `#12` doing
        that work; a task has nothing of its own, so the word does it.

        Cut, because a prompt is as long as somebody felt like typing and a tab
        shows about thirty characters before the strip cuts it for us.
      */
      title={task === null ? undefined : `${t('Task')}: ${excerpt(task.title)}`}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.titleHeader}>
        <Link className={styles.back} to={`/workspace/${workspaceId}/tasks`}>{t('← Tasks')}</Link>
        <h1 className={styles.title}>{task?.title ?? 'Task'}</h1>
        {task !== null && (
          <p className={styles.subtitle}>
            <span className={styles.state} data-state={task.status} data-testid="task-state">
              {TASK_STATUS_LABEL[task.status]}
            </span>
            {' · '}
            {task.agentName ?? 'a model'}
            {' · '}
            {/*
              The two budgets that can end a task, each with the (?) that says
              where its ceiling came from.

              A bare fraction says what the ceiling is and nothing about who
              chose it — which is how "why 40 turns, is it configurable?" came
              to be asked twice about a number that has been configurable all
              along. The working-time budget was not drawn at all, which is
              worse than bare: a task can stop for having spent it and the page
              gave no sign the allowance existed.
            */}
            <span className={styles.labelWithHint}>
              <span data-testid="task-turns">
                {task.turnsSpent}/{task.turnsAllowed} turns
              </span>
              <FieldHint label={t('Turns')}>
                {t('One turn is one exchange with the model — what it says back, and any tools it runs on the way. The ceiling is the installation’s, set by')}{' '}
                <code>ORKNUX_TASK_MAX_TURNS</code>{' '}
                {t('and copied onto the task when it starts, so changing it later cannot move the goalposts under a task already running.')}
              </FieldHint>
            </span>
            {' · '}
            <span className={styles.labelWithHint}>
              <span data-testid="task-worked">
                {workedTime(task.workedSeconds)} of {workedTime(task.secondsAllowed)}
              </span>
              <FieldHint label={t('Working time')}>
                {t('Time the agent spent actually working. Time parked waiting for somebody to answer counts for none of it. The allowance is the installation’s, set by')}{' '}
                <code>ORKNUX_TASK_WORKING_TIME</code>{' '}
                {t('and copied onto the task when it starts, the same way the turn ceiling is.')}
              </FieldHint>
            </span>
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
              <span className={styles.label}>{t('Prompt')}</span>
              <span className={styles.headRight}>
                {!over && (
                  <button
                    type="button"
                    className={styles.stop}
                    onClick={() => void decide(() => stopTask(task.id))}
                  >{t('Stop')}</button>
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
                    : t('It has a question.')}
                  <FieldHint label={t('What a task is waiting for')}>
                    {waiting.kind === 'PERMISSION' ? (
                      <>
                        Approving gives this <strong>{t('one task')}</strong> the one thing it named, for as
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

              {/*
                How long it will stand here, which is the one thing a parked
                task's page could not say. A task waiting for a person does
                nothing at all until it is answered and is given up on in the
                end — and a deadline nobody is shown is a task that vanishes
                for a reason its own page never mentioned.

                Two words and a date, deliberately: the sentence explaining the
                deadline belongs behind the (?), not printed under it.
              */}
              {task.waitingUntil !== null && (
                <p className={styles.patience} data-testid="task-patience">
                  <span className={styles.labelWithHint}>
                    <span>
                      {t('Waits until')}{' '}
                      {new Date(task.waitingUntil).toLocaleString()}
                    </span>
                    <FieldHint label={t('How long it waits')}>
                      {t('A task that has stopped to ask does nothing at all until somebody answers, so it is not left standing for ever. How long it waits is the installation’s, set by')}{' '}
                      <code>ORKNUX_TASK_PATIENCE</code>{' '}
                      {t('and counted from when it asked. Answering it now clears the deadline.')}
                    </FieldHint>
                  </span>
                </p>
              )}

              {waiting.kind === 'PERMISSION' ? (
                <div className={styles.askingRow}>
                  <button
                    type="button"
                    className={styles.approve}
                    disabled={deciding}
                    onClick={() => void decide(() => approveTaskRequest(waiting.id))}
                  >{t('Approve')}</button>
                  <button
                    type="button"
                    className={styles.refuse}
                    disabled={deciding}
                    onClick={() => void decide(() => refuseTaskRequest(waiting.id))}
                  >{t('Refuse')}</button>
                </div>
              ) : (
                <div className={styles.askingRow}>
                  <input
                    className={styles.answer}
                    type="text"
                    placeholder={t('Answer it…')}
                    aria-label={t('Answer the task')}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.approve}
                    disabled={deciding || answer.trim() === ''}
                    onClick={() => void decide(() => answerTaskRequest(waiting.id, answer.trim()))}
                  >{t('Answer')}</button>
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
              <span className={styles.label}>{t('What it is doing')}</span>
              <span className={styles.headRight}>
                <span
                  className={styles.watching}
                  data-testid="task-watching"
                  data-watching={over ? 'ended' : watching}
                >
                  {over ? WATCHING_LABEL.ended : WATCHING_LABEL[watching]}
                </span>
                <FieldHint label={t('How this page keeps up')}>
                  {t('Each step is sent as it is recorded, so nothing here is waiting on a refresh. If the connection drops the page comes back and asks for whatever it missed by the last line it holds, which is why a task left open overnight catches up rather than redrawing. A finished task reads exactly the same, from the same record.')}
                </FieldHint>
                <span className={styles.muted} data-testid="task-log-count">
                  {log.length} lines
                </span>
              </span>
            </div>

            {log.length === 0 && <p className={styles.notice}>{t('Nothing has happened yet.')}</p>}

            {log.map((line) => (
              <div key={line.id} className={styles.line} data-kind={line.kind} data-id={line.id}>
                {line.kind === 'TOOL' ? (
                  <CallLine
                    actor={line.actor}
                    content={line.content ?? ''}
                    result={line.result}
                    when={timeAgo(line.at)}
                  />
                ) : line.kind === 'THINKING' ? (
                  /*
                    The same block the chat draws, and the same component.

                    Two differences, and both are about which page it is on.
                    The one being written is drawn open, because seeing the
                    model think *now* is what this page was asked for; every
                    earlier turn's is folded, because a task takes dozens of
                    turns and a page that drew all of them open would have the
                    work scrolled off the bottom.

                    And "still thinking" is the server's own answer — a line
                    with no duration on it — narrowed by whether the task is
                    over. A process that died mid-thought leaves a line that
                    never settled, and a finished task whose page said the model
                    was still thinking would be the one lie this screen must not
                    tell.
                  */
                  <Thinking
                    text={line.content ?? ''}
                    live={!over && line.millis === null}
                    millis={line.millis}
                    startOpen={!over && line.millis === null}
                  />
                ) : (
                  <>
                    <span className={styles.lineHead}>
                      <span className={styles.kind} data-kind={line.kind}>
                        {line.kind === 'AGENT' ? line.actor : SPEAKER[line.kind]}
                      </span>
                      {line.kind !== 'AGENT' && <span className={styles.actor}>{line.actor}</span>}
                      <span className={styles.when}>{timeAgo(line.at)}</span>
                    </span>
                    {line.content !== null && (
                      <div className={styles.said}>
                        <Markdown>{line.content}</Markdown>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </section>

          {(task.outcome !== null || task.endedBecause !== null) && (
            <section className={styles.card} data-testid="task-outcome">
              <div className={styles.cardHead}>
                <span className={styles.label}>{t('Outcome')}</span>
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
                <span className={styles.label}>{t('Granted for this task')}</span>
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

/** Who a line is from, where the actor's own name is not the answer. */
const SPEAKER: Record<string, string> = {
  USER: 'Asked',
  SYSTEM: 'Note',
  TOOL: 'Tool',
  AGENT: 'Agent',
};

/**
 * A line arriving, put where it belongs.
 *
 * Merged by id rather than appended, because the same id arrives more than once
 * by design: a call is sent the moment it is made, with nothing back from it,
 * and again when its tool answers, and a block of thinking is sent again every
 * time it has grown. Appending would draw the lookup twice — once running for
 * ever and once returned — and the reasoning once per frame that arrived.
 *
 * Sorted by id afterwards, and only by id. The clock cannot order these: a turn
 * writes its question, its calls and its answer inside the same millisecond, so
 * sorting on the time would leave one exchange in whatever order it happened to
 * be handed over in, and it would change between two renders.
 */
function merged(held: LlmSessionEvent[], step: TaskStep): LlmSessionEvent[] {
  const line: LlmSessionEvent = {
    id: step.id,
    kind: step.kind,
    actor: step.actor,
    content: step.content,
    result: step.result,
    millis: step.millis,
    at: step.at,
  };
  const at = held.findIndex((seen) => seen.id === line.id);
  if (at !== -1) {
    const next = [...held];
    next[at] = line;
    return next;
  }
  return [...held, line].sort((one, other) => Number(one.id) - Number(other.id));
}
