import { graphql } from './client';

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
  WAITING: 'Needs you',
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
