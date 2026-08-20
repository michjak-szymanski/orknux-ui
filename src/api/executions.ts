import { graphql } from './client';
import type { PageOf } from './client';
import type { EdgeBranch, NodeKind } from './graph';

export type ExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ExecutionTrigger = 'WEBHOOK' | 'MANUAL' | 'SCHEDULE' | 'API';

export interface Execution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  trigger: ExecutionTrigger;
  startedAt: string;
  finishedAt: string | null;
  /** Null while the run is still going. */
  durationSeconds: number | null;
  /**
   * What ended the run early, when a condition decided there was nothing
   * further to do. Null for a run that went all the way through.
   */
  stoppedReason: string | null;
}

/**
 * Where one node of the graph got to in a run. `WAITING` is a step parked until
 * a time passes or something it waits on holds: open, and holding nothing.
 */
export type StepStatus = 'PENDING' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
export type LogLevel = 'INFO' | 'SUCCESS' | 'ERROR';

export interface ExecutionStep {
  key: string;
  kind: NodeKind;
  name: string;
  description: string | null;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  input: string | null;
  output: string | null;
  error: string | null;
  /** The catalogue entry the step ran, which the run links back to. */
  actionId: string | null;
  conditionId: string | null;
  /**
   * Which way out of itself this step sent the run; null where it answered
   * nothing. FAILURE means the step failed and the run went on down the node's
   * failure edge rather than stopping there.
   */
  branch: EdgeBranch | null;
  /**
   * How many attempts the step spent. More than one only where its node was
   * given a retry policy and needed it.
   */
  attempts: number;
  /**
   * Copied from an earlier run rather than performed here, which is what every
   * step ahead of a re-run's starting point is. Its status and its times are
   * that earlier run's, so the page has to say where they came from.
   */
  carriedOver: boolean;
  x: number;
  y: number;
}

export interface ExecutionLogLine {
  id: string;
  /** Null for lines about the run itself rather than one step. */
  nodeKey: string | null;
  at: string;
  level: LogLevel;
  message: string;
}

export interface ExecutionDetail extends Execution {
  workspaceId: string;
  /** Why the run stopped, when it stopped badly. */
  error: string | null;
  /** The node that ended the run early; null for a run that went all the way through. */
  stoppedAtNodeKey: string | null;
  /**
   * The run this one was started from, when it came of re-running an earlier
   * one - all of it, or from one of its steps. Null for a run nobody re-ran.
   */
  startedFrom: string | null;
  steps: ExecutionStep[];
  /**
   * The graph the run went through. The branch is on it because a line the run
   * could only take on a failure is worth drawing as one.
   */
  edges: Array<{ source: string; target: string; branch: EdgeBranch | null }>;
  logs: ExecutionLogLine[];
  /**
   * Temporal's own screen for this run: every attempt behind what is shown
   * here. Null when Temporal is off or has no interface to send anybody to.
   */
  temporalUrl?: string | null;
}

export interface ExecutionFilters {
  status?: ExecutionStatus;
  workflowId?: string;
  /** Only runs started in the last N days; omit for all time. */
  days?: number;
  search?: string;
}

const WORKSPACE_EXECUTIONS_QUERY = `
  query WorkspaceExecutions(
    $workspaceId: ID!
    $page: Int!
    $size: Int!
    $status: ExecutionStatus
    $workflowId: ID
    $days: Int
    $search: String
  ) {
    workspaceExecutions(
      workspaceId: $workspaceId
      page: $page
      size: $size
      status: $status
      workflowId: $workflowId
      days: $days
      search: $search
    ) {
      content { id workflowId workflowName status trigger startedAt finishedAt durationSeconds }
      page
      size
      totalElements
      totalPages
    }
  }
`;

/** `page` is 0-based, matching the server. */
export async function fetchWorkspaceExecutions(
  workspaceId: string,
  page: number,
  size: number,
  filters: ExecutionFilters = {},
): Promise<PageOf<Execution>> {
  const data = await graphql<{ workspaceExecutions: PageOf<Execution> }>(WORKSPACE_EXECUTIONS_QUERY, {
    workspaceId,
    page,
    size,
    status: filters.status ?? null,
    workflowId: filters.workflowId ?? null,
    days: filters.days ?? null,
    search: filters.search ?? null,
  });
  return data.workspaceExecutions;
}

export const STATUS_LABEL: Record<ExecutionStatus, string> = {
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export const TRIGGER_LABEL: Record<ExecutionTrigger, string> = {
  WEBHOOK: 'Webhook',
  MANUAL: 'Manual',
  SCHEDULE: 'Schedule',
  API: 'API',
};

/** 83 -> "1m 23s", 45 -> "45s"; null while the run is going. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** "2 min ago", as the design shows the start time. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const EXECUTION_DETAIL_FIELDS = `
  id workspaceId workflowId workflowName status trigger startedAt finishedAt durationSeconds error
  stoppedAtNodeKey stoppedReason startedFrom
  steps { key kind name description status startedAt finishedAt durationSeconds input output error actionId conditionId branch attempts carriedOver x y }
  edges { source target branch }
  logs { id nodeKey at level message }
  temporalUrl
`;

const EXECUTION_QUERY = `
  query Execution($id: ID!) {
    execution(id: $id) { ${EXECUTION_DETAIL_FIELDS} }
  }
`;

const RERUN_MUTATION = `
  mutation RerunExecution($id: ID!) {
    rerunExecution(id: $id) { ${EXECUTION_DETAIL_FIELDS} }
  }
`;

const RERUN_STEP_MUTATION = `
  mutation RerunExecutionStep($id: ID!, $nodeKey: String!) {
    rerunExecutionStep(id: $id, nodeKey: $nodeKey) { ${EXECUTION_DETAIL_FIELDS} }
  }
`;

export async function fetchExecution(id: string): Promise<ExecutionDetail | null> {
  const data = await graphql<{ execution: ExecutionDetail | null }>(EXECUTION_QUERY, { id });
  return data.execution;
}

/** Queues the workflow again with the graph as it stands now. */
export async function rerunExecution(id: string): Promise<ExecutionDetail> {
  const data = await graphql<{ rerunExecution: ExecutionDetail }>(RERUN_MUTATION, { id });
  return data.rerunExecution;
}

/**
 * Queues the workflow again from one of this run's steps, carrying what the run
 * had produced by the time it reached it.
 *
 * Whether a given step can be started from is the server's judgement and not
 * this module's - it knows what the earlier run recorded and what the graph
 * looks like now - so the call is always made and the refusal comes back as the
 * sentence the server wrote.
 */
export async function rerunExecutionStep(id: string, nodeKey: string): Promise<ExecutionDetail> {
  const data = await graphql<{ rerunExecutionStep: ExecutionDetail }>(RERUN_STEP_MUTATION, {
    id,
    nodeKey,
  });
  return data.rerunExecutionStep;
}

const START_EXECUTION_MUTATION = `
  mutation StartExecution($workspaceId: ID!, $workflowId: ID!, $input: String) {
    startExecution(workspaceId: $workspaceId, workflowId: $workflowId, input: $input) { id status }
  }
`;

/**
 * Runs a workflow by hand, from the workflows list.
 *
 * `input` is what the first node is handed, as JSON; a trigger supplies it from
 * whatever fired, and a run started here can be given one or nothing.
 */
export async function startExecution(
  workspaceId: string,
  workflowId: string,
  input?: string,
): Promise<{ id: string; status: ExecutionStatus }> {
  const data = await graphql<{ startExecution: { id: string; status: ExecutionStatus } }>(
    START_EXECUTION_MUTATION,
    { workspaceId, workflowId, input: input ?? null },
  );
  return data.startExecution;
}
