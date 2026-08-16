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

const WORKFLOW_FIELDS =
  'id workflowId name description enabled nextRun ' +
  'lastRun { executionId status startedAt durationSeconds }';

const WORKSPACE_WORKFLOWS_QUERY = `
  query WorkspaceWorkflows($workspaceId: ID!, $page: Int!, $size: Int!) {
    workspaceWorkflows(workspaceId: $workspaceId, page: $page, size: $size) {
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

/** `page` is 0-based, matching the server. */
export async function fetchWorkspaceWorkflows(
  workspaceId: string,
  page: number,
  size: number,
): Promise<PageOf<WorkspaceWorkflow>> {
  const data = await graphql<{ workspaceWorkflows: PageOf<WorkspaceWorkflow> }>(WORKSPACE_WORKFLOWS_QUERY, {
    workspaceId,
    page,
    size,
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

export async function setWorkflowEnabled(id: string, enabled: boolean): Promise<WorkspaceWorkflow> {
  const data = await graphql<{ setWorkflowEnabled: WorkspaceWorkflow }>(SET_ENABLED_MUTATION, { id, enabled });
  return data.setWorkflowEnabled;
}

/** Unassigns the workflow from the workspace; the definition is kept. */
export async function removeWorkflow(id: string): Promise<boolean> {
  const data = await graphql<{ removeWorkflow: boolean }>(REMOVE_WORKFLOW_MUTATION, { id });
  return data.removeWorkflow;
}
