import { graphql } from './client';
import type { PageOf } from './client';

/** Where a workflow last got to, so the list shows what a trigger set off. */
export interface LastRun {
  executionId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  /** ISO-8601 offset date-time. */
  startedAt: string;
  durationSeconds: number | null;
}

/** A workflow as it appears for one workspace; `id` identifies the assignment. */
export interface WorkspaceWorkflow {
  id: string;
  workflowId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  lastRun: LastRun | null;
  /** When a scheduled trigger will start it next; null when nothing schedules it. */
  nextRun: string | null;
}

/**
 * What a list of workflows is ordered by, in the words the server uses.
 *
 * Asked of the server rather than sorted here, for the same reason the issue
 * list asks: a page holds ten rows of however many the workspace has, and
 * sorting ten of them orders the page instead of the list.
 */
export type WorkflowOrder = 'NAME' | 'LAST_RUN' | 'ENABLED';

const WORKFLOW_FIELDS =
  'id workflowId name description enabled nextRun ' +
  'lastRun { executionId status startedAt durationSeconds }';

const WORKSPACE_WORKFLOWS_QUERY = `
  query WorkspaceWorkflows(
    $workspaceId: ID!
    $page: Int!
    $size: Int!
    $order: WorkflowOrder
    $ascending: Boolean
  ) {
    workspaceWorkflows(
      workspaceId: $workspaceId
      page: $page
      size: $size
      order: $order
      ascending: $ascending
    ) {
      content { ${WORKFLOW_FIELDS} }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const CREATE_WORKFLOW_MUTATION = `
  mutation CreateWorkflow($input: CreateWorkflowInput!) {
    createWorkflow(input: $input) { ${WORKFLOW_FIELDS} }
  }
`;

const DUPLICATE_WORKFLOW_MUTATION = `
  mutation DuplicateWorkflow($id: ID!) {
    duplicateWorkflow(id: $id) { ${WORKFLOW_FIELDS} }
  }
`;

const UPDATE_WORKFLOW_MUTATION = `
  mutation UpdateWorkflow($id: ID!, $input: UpdateWorkflowInput!) {
    updateWorkflow(id: $id, input: $input) { ${WORKFLOW_FIELDS} }
  }
`;

export async function updateWorkflow(
  id: string,
  input: { name: string; description?: string },
): Promise<WorkspaceWorkflow> {
  const data = await graphql<{ updateWorkflow: WorkspaceWorkflow }>(UPDATE_WORKFLOW_MUTATION, { id, input });
  return data.updateWorkflow;
}

const SET_ENABLED_MUTATION = `
  mutation SetWorkflowEnabled($id: ID!, $enabled: Boolean!) {
    setWorkflowEnabled(id: $id, enabled: $enabled) { ${WORKFLOW_FIELDS} }
  }
`;

const REMOVE_WORKFLOW_MUTATION = `
  mutation RemoveWorkflow($id: ID!) {
    removeWorkflow(id: $id)
  }
`;

/**
 * `page` is 0-based, matching the server.
 *
 * `order` and `ascending` are left off by the callers that only want a list to
 * pick from; the server then answers by name, ascending, which is what this has
 * always done.
 */
export async function fetchWorkspaceWorkflows(
  workspaceId: string,
  page: number,
  size: number,
  order?: WorkflowOrder,
  ascending?: boolean,
): Promise<PageOf<WorkspaceWorkflow>> {
  const data = await graphql<{ workspaceWorkflows: PageOf<WorkspaceWorkflow> }>(WORKSPACE_WORKFLOWS_QUERY, {
    workspaceId,
    page,
    size,
    order: order ?? null,
    ascending: ascending ?? null,
  });
  return data.workspaceWorkflows;
}

export async function createWorkflow(input: {
  workspaceId: string;
  name: string;
  description?: string;
}): Promise<WorkspaceWorkflow> {
  const data = await graphql<{ createWorkflow: WorkspaceWorkflow }>(CREATE_WORKFLOW_MUTATION, { input });
  return data.createWorkflow;
}

/**
 * The same workflow again, graph and all, in the same workspace.
 *
 * Asked of the server rather than assembled here, unlike a duplicated function:
 * a function is one record and its copy is a create with somebody else's
 * contents, while a workflow is a graph of nodes with settings, mappings and
 * edges. Reassembling that from what this page happens to have fetched is a
 * copy that silently loses whatever field nobody remembered to carry.
 *
 * The name is the server's: the original's with *(copy)* after it, numbered if
 * that is taken. Names are unique across the installation, so the alternative
 * is a button that refuses on the second press.
 */
export async function duplicateWorkflow(id: string): Promise<WorkspaceWorkflow> {
  const data = await graphql<{ duplicateWorkflow: WorkspaceWorkflow }>(DUPLICATE_WORKFLOW_MUTATION, { id });
  return data.duplicateWorkflow;
}

export async function setWorkflowEnabled(id: string, enabled: boolean): Promise<WorkspaceWorkflow> {
  const data = await graphql<{ setWorkflowEnabled: WorkspaceWorkflow }>(SET_ENABLED_MUTATION, { id, enabled });
  return data.setWorkflowEnabled;
}

/** Unassigns the workflow from the workspace; the definition is kept. */
export async function removeWorkflow(id: string): Promise<boolean> {
  const data = await graphql<{ removeWorkflow: boolean }>(REMOVE_WORKFLOW_MUTATION, { id });
  return data.removeWorkflow;
}
