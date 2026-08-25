import { graphql } from './client';
import type { LlmSessionEventKind } from './llmSessions';
import { payloadOf, readEventStream } from './sse';
import { t } from '../i18n';

/**
 * Where a task has got to.
 *
 * The interesting one is WAITING: a task that stopped to ask a person something
 * and is doing nothing at all until it is answered.
 */
export type TaskStatus = 'QUEUED' | 'RUNNING' | 'WAITING' | 'DONE' | 'FAILED' | 'STOPPED';

/** Something a task may be given that its agent was not. */
export type TaskCapability =
  | 'ORKNUX'
  | 'SHELLS'
  | 'TOOL'
  | 'MCP_SERVER'
  | 'SKILL_CATALOG'
  | 'MEMORY_CATALOG';

export type TaskRequestKind = 'PERMISSION' | 'QUESTION';

export type TaskDecision = 'GRANTED' | 'REFUSED' | 'ANSWERED';

export interface TaskRequest {
  id: string;
  kind: TaskRequestKind;
  /** Set on a permission, null on a question. */
  capability: TaskCapability | null;
  /** Which one, for the capabilities that name something. */
  subject: string | null;
  /** The question, or why the agent says it needs the thing. */
  asks: string;
  askedAt: string;
  /** Null while it is still waiting. */
  decision: TaskDecision | null;
  answer: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface TaskGrant {
  id: string;
  capability: TaskCapability;
  subject: string | null;
  grantedBy: string;
  grantedAt: string;
}

/**
 * A problem given to an agent, and the agent working at it until it is done.
 *
 * What it *did* is not on this type. `sessionId` names an LLM session, and the
 * event log is that session's events - read with `fetchLlmSessionEvents`, the
 * same call the Sessions screen makes. There is one transcript in this product
 * and this is it.
 */
export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  prompt: string;
  agentId: string | null;
  agentName: string | null;
  modelId: string | null;
  status: TaskStatus;
  /** Where the event log is. Null only on a task whose log was thrown away. */
  sessionId: string | null;
  issueId: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  turnsSpent: number;
  turnsAllowed: number;
  /** Seconds actually worked. Time parked waiting for somebody counts for none of it. */
  workedSeconds: number;
  secondsAllowed: number;
  waitingUntil: string | null;
  outcome: string | null;
  endedBecause: string | null;
  requests: TaskRequest[];
  grants: TaskGrant[];
}

export interface TaskPage {
  totalElements: number;
  content: Task[];
}

/** What each state is called where somebody reads it. */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Working',
  WAITING: t('Needs you'),
  DONE: 'Done',
  FAILED: 'Failed',
  STOPPED: 'Stopped',
};

/** The states worth offering as a filter, in the order somebody scans for them. */
export const TASK_STATUSES: TaskStatus[] = [
  'WAITING',
  'RUNNING',
  'QUEUED',
  'DONE',
  'FAILED',
  'STOPPED',
];

/** What each capability is called on the button somebody presses. */
export const CAPABILITY_LABEL: Record<TaskCapability, string> = {
  ORKNUX: 'orknux',
  SHELLS: 'the shells',
  TOOL: 'a tool',
  MCP_SERVER: 'an MCP server',
  SKILL_CATALOG: 'a skill catalog',
  MEMORY_CATALOG: 'a memory catalog',
};

/** What was asked for, as one phrase: "the shells", "a tool, weather". */
export function asked(request: TaskRequest): string {
  if (request.capability === null) return 'an answer';
  const what = CAPABILITY_LABEL[request.capability];
  return request.subject === null ? what : `${what}, ${request.subject}`;
}

/** The one it is standing still for, or null when it is not standing still. */
export function openRequest(task: Task): TaskRequest | null {
  return task.requests.find((one) => one.decision === null) ?? null;
}

/**
 * A task's working time, in the largest unit that says something.
 *
 * `formatDuration` in `executions.ts` is the runs page's and stays there: it
 * stops at minutes, because a workflow run that takes an hour is a workflow
 * run that has gone wrong. A task is allowed two hours by default, so the same
 * function would draw its budget as "120m 0s" - a number nobody reads as two
 * hours.
 *
 * Seconds only below a minute, because a task measured in seconds is one that
 * failed on its first turn and the seconds are the whole story.
 */
export function workedTime(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const REQUEST_FIELDS =
  'id kind capability subject asks askedAt decision answer decidedBy decidedAt';

const GRANT_FIELDS = 'id capability subject grantedBy grantedAt';

const TASK_FIELDS = `
  id workspaceId title prompt agentId agentName modelId status sessionId issueId
  createdBy createdAt startedAt finishedAt
  turnsSpent turnsAllowed workedSeconds secondsAllowed waitingUntil outcome endedBecause
  requests { ${REQUEST_FIELDS} }
  grants { ${GRANT_FIELDS} }
`;

export async function fetchTasks(
  workspaceId: string,
  options: { status?: TaskStatus; page?: number; size?: number } = {},
): Promise<TaskPage> {
  const data = await graphql<{ workspaceTasks: TaskPage }>(
    `query ($workspaceId: ID!, $status: TaskStatus, $page: Int, $size: Int) {
       workspaceTasks(workspaceId: $workspaceId, status: $status, page: $page, size: $size) {
         totalElements
         content { ${TASK_FIELDS} }
       }
     }`,
    {
      workspaceId,
      status: options.status ?? null,
      page: options.page ?? 0,
      size: options.size ?? 20,
    },
  );
  return data.workspaceTasks;
}

/** Null where there is no such task, or it is not one this person may see. */
export async function fetchTask(id: string): Promise<Task | null> {
  const data = await graphql<{ task: Task | null }>(
    `query ($id: ID!) { task(id: $id) { ${TASK_FIELDS} } }`,
    { id },
  );
  return data.task;
}

/**
 * Sets an agent to work on a problem.
 *
 * `issueId` is the link back, and it is what decides who else hears about the
 * task - which is why "Start by AI" on an issue is this same call.
 */
export async function startTask(input: {
  workspaceId: string;
  prompt: string;
  title?: string;
  agentId?: string | null;
  modelId?: string | null;
  issueId?: string | null;
}): Promise<Task> {
  const data = await graphql<{ startTask: Task }>(
    `mutation ($input: StartTaskInput!) { startTask(input: $input) { ${TASK_FIELDS} } }`,
    {
      input: {
        workspaceId: input.workspaceId,
        prompt: input.prompt,
        title: input.title ?? null,
        agentId: input.agentId ?? null,
        modelId: input.modelId ?? null,
        issueId: input.issueId ?? null,
      },
    },
  );
  return data.startTask;
}

/**
 * "Start by AI" on an issue: its agent, set to work on the issue.
 *
 * `startTask` underneath, with a prompt the server composes from the issue -
 * the browser does not write it, because what an agent is handed is a product
 * decision and not a page's. The issue moves to In progress; nothing moves it
 * back afterwards.
 */
export async function startIssueTask(issueId: string): Promise<Task> {
  const data = await graphql<{ startIssueTask: Task }>(
    `mutation ($issueId: ID!) { startIssueTask(issueId: $issueId) { ${TASK_FIELDS} } }`,
    { issueId },
  );
  return data.startIssueTask;
}

/** Everything one issue has started, newest first. The link back. */
export async function fetchIssueTasks(issueId: string): Promise<Task[]> {
  const data = await graphql<{ issueTasks: Task[] }>(
    `query ($issueId: ID!) { issueTasks(issueId: $issueId) { ${TASK_FIELDS} } }`,
    { issueId },
  );
  return data.issueTasks;
}

/** The one still going, or null. What decides whether the button is a button. */
export function stillGoing(tasks: Task[]): Task | null {
  return tasks.find((one) => !['DONE', 'FAILED', 'STOPPED'].includes(one.status)) ?? null;
}

/** Gives a parked task the one thing it asked for, and lets it carry on. */
export async function approveTaskRequest(id: string): Promise<Task> {
  const data = await graphql<{ approveTaskRequest: Task }>(
    `mutation ($id: ID!) { approveTaskRequest(id: $id) { ${TASK_FIELDS} } }`,
    { id },
  );
  return data.approveTaskRequest;
}

export async function refuseTaskRequest(id: string): Promise<Task> {
  const data = await graphql<{ refuseTaskRequest: Task }>(
    `mutation ($id: ID!) { refuseTaskRequest(id: $id) { ${TASK_FIELDS} } }`,
    { id },
  );
  return data.refuseTaskRequest;
}

export async function answerTaskRequest(id: string, said: string): Promise<Task> {
  const data = await graphql<{ answerTaskRequest: Task }>(
    `mutation ($id: ID!, $said: String!) { answerTaskRequest(id: $id, said: $said) { ${TASK_FIELDS} } }`,
    { id, said },
  );
  return data.answerTaskRequest;
}

export async function stopTask(id: string): Promise<Task> {
  const data = await graphql<{ stopTask: Task }>(
    `mutation ($id: ID!) { stopTask(id: $id) { ${TASK_FIELDS} } }`,
    { id },
  );
  return data.stopTask;
}

/** Throws a finished task away, its event log with it. Stop it first. */
export async function deleteTask(id: string): Promise<boolean> {
  const data = await graphql<{ deleteTask: boolean }>(
    `mutation ($id: ID!) { deleteTask(id: $id) }`,
    { id },
  );
  return data.deleteTask;
}

/**
 * How a task's page is watching, in the words it says out loud.
 *
 * Three, and the middle one is the honest one. A page that has lost the stream
 * and is coming back must not draw itself as live, because the whole promise of
 * this screen is that what is on it is what is happening.
 */
export type TaskWatchState = 'live' | 'returning' | 'ended';

/** One line of a task's session, as the stream sends it. */
export interface TaskStep {
  id: string;
  kind: LlmSessionEventKind;
  actor: string;
  content: string | null;
  /** What a call gave back. Null while its tool has not answered. */
  result: string | null;
  at: string;
}

export interface TaskWatchHandlers {
  /**
   * A line arrived, or one already drawn was filled in.
   *
   * The same id can arrive twice on purpose: a call is sent the moment it is
   * made, with nothing back from it, and again when its tool answers. The page
   * merges by id, which is why the id is on the frame at all.
   */
  onStep: (step: TaskStep) => void;
  /** The task itself, whenever anything about it changed. */
  onTask: (task: Task) => void;
  /** What the page should say it is doing. */
  onWatching: (state: TaskWatchState) => void;
}

/**
 * How long to wait before coming back after a stream that failed.
 *
 * Only after a *failure*. A stint that ended the way it was meant to reconnects
 * at once, because nothing is wrong and a gap there would be a page that stops
 * being live for a second every four minutes.
 */
const RETURN_AFTER_MS = 2_000;

/**
 * Follows a task as it works, and returns the way to stop.
 *
 * The connection is not the account — the account is in the database, and this
 * is a cursor over it. So a drop is not an error to report: the page keeps the
 * id of the newest line it holds, and coming back asks for everything after it.
 * Nothing is replayed from the beginning, which for a task that ran overnight is
 * the difference between a reconnect and rebuilding the page.
 *
 * The server ends a stint every few minutes on purpose and says `again` when it
 * does. That is the same path a dropped connection takes, which is the point of
 * doing it: a recovery path that only runs when something has gone wrong is one
 * nobody finds out is broken until the night it is needed.
 *
 * @param from the newest event id the page already holds, or '0' for a page
 *   holding none. A page that has just drawn the log so far passes the highest
 *   of what it drew and is given only what came after.
 */
export function watchTask(id: string, from: string, handlers: TaskWatchHandlers): () => void {
  const stopper = new AbortController();
  let cursor = from;
  let stopped = false;

  async function stint(): Promise<'again' | 'ended'> {
    const response = await fetch(`/api/tasks/${id}/stream?after=${encodeURIComponent(cursor)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'text/event-stream' },
      signal: stopper.signal,
    });

    let ending: 'again' | 'ended' = 'again';
    await readEventStream(response, (frame) => {
      if (frame.event === 'step') {
        const step = payloadOf<TaskStep>(frame);
        if (step === null) return;
        /*
         * The cursor moves on the frame's id, and only forwards. A call is sent
         * once when it is made and again when its tool answers, so the second
         * frame carries an id the page has already passed - and a cursor that
         * followed it would ask the server for everything since, all over again.
         */
        if (frame.id !== null && Number(frame.id) > Number(cursor)) cursor = frame.id;
        handlers.onStep(step);
      } else if (frame.event === 'state') {
        const task = payloadOf<Task>(frame);
        if (task !== null) handlers.onTask(task);
      } else if (frame.event === 'end') {
        ending = 'ended';
      }
      // `again` needs nothing done to it: the stream is about to close and the
      // loop below opens the next one, which is what it was announcing.
    });
    return ending;
  }

  void (async () => {
    for (;;) {
      if (stopped) return;
      try {
        handlers.onWatching('live');
        const ending = await stint();
        if (stopped) return;
        if (ending === 'ended') {
          handlers.onWatching('ended');
          return;
        }
      } catch (cause: unknown) {
        if (stopped || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        /*
         * Anything else — the server restarting, a network that went away, a
         * proxy that closed it — is the same thing and is answered the same way.
         * There is nothing to report, because nothing is lost: the cursor says
         * what is still owed and the next attempt asks for exactly that.
         */
        handlers.onWatching('returning');
        await new Promise((wake) => {
          window.setTimeout(wake, RETURN_AFTER_MS);
        });
      }
    }
  })();

  return () => {
    stopped = true;
    stopper.abort();
  };
}
