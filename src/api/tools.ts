import { graphql } from './client';
import type { PageOf } from './client';

/**
 * A named piece of JavaScript an agent may call while it runs.
 *
 * Not a workflow function: a function is called by an action node at a point the
 * graph fixed in advance, a tool is offered to an agent that calls it if it
 * judges that it should.
 */
export interface Tool {
  id: string;
  workspaceId: string;
  name: string;
  /** What the tool is for. An agent reads this to decide whether to call it. */
  description: string | null;
  /** The JavaScript that runs. */
  source: string;
  /** The TypeScript it was compiled from, which is what the editor opens. */
  typescript: string;
  enabled: boolean;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

/** What Validate found. `column` is null for a skill, which has no columns to point at. */
export interface SourceValidation {
  valid: boolean;
  message: string | null;
  line: number | null;
  column: number | null;
}

const TOOL_FIELDS = 'id workspaceId name description source typescript enabled lastModifiedAt lastModifiedBy';

export async function fetchWorkspaceTools(workspaceId: string, page = 0, size = 20): Promise<PageOf<Tool>> {
  const data = await graphql<{ workspaceTools: PageOf<Tool> }>(
    `query WorkspaceTools($workspaceId: ID!, $page: Int!, $size: Int!) {
       workspaceTools(workspaceId: $workspaceId, page: $page, size: $size) {
         content { ${TOOL_FIELDS} }
         page size totalElements totalPages
       }
     }`,
    { workspaceId, page, size },
  );
  return data.workspaceTools;
}

export async function fetchTool(id: string): Promise<Tool | null> {
  const data = await graphql<{ tool: Tool | null }>(
    `query Tool($id: ID!) { tool(id: $id) { ${TOOL_FIELDS} } }`,
    { id },
  );
  return data.tool;
}

export interface CreateToolInput {
  name: string;
  description?: string;
  /**
   * The compiled JavaScript. Sent together with `typescript` or not at all: a
   * tool whose halves were written apart is one whose editor and sandbox
   * disagree. Both left out starts the tool from a stub.
   */
  source?: string;
  typescript?: string;
}

export async function createTool(workspaceId: string, input: CreateToolInput): Promise<Tool> {
  const data = await graphql<{ createTool: Tool }>(
    `mutation CreateTool($input: CreateToolInput!) { createTool(input: $input) { ${TOOL_FIELDS} } }`,
    { input: { workspaceId, ...input } },
  );
  return data.createTool;
}

export interface UpdateToolInput {
  name?: string;
  description?: string;
  /** The compiled JavaScript. Sent together with `typescript` or not at all. */
  source?: string;
  typescript?: string;
}

export async function updateTool(id: string, input: UpdateToolInput): Promise<Tool> {
  const data = await graphql<{ updateTool: Tool }>(
    `mutation UpdateTool($id: ID!, $input: UpdateToolInput!) { updateTool(id: $id, input: $input) { ${TOOL_FIELDS} } }`,
    { id, input },
  );
  return data.updateTool;
}

export async function setToolEnabled(id: string, enabled: boolean): Promise<Tool> {
  const data = await graphql<{ setToolEnabled: Tool }>(
    `mutation SetToolEnabled($id: ID!, $enabled: Boolean!) {
       setToolEnabled(id: $id, enabled: $enabled) { ${TOOL_FIELDS} }
     }`,
    { id, enabled },
  );
  return data.setToolEnabled;
}

export async function validateToolSource(workspaceId: string, source: string): Promise<SourceValidation> {
  const data = await graphql<{ validateToolSource: SourceValidation }>(
    `mutation ValidateToolSource($workspaceId: ID!, $source: String!) {
       validateToolSource(workspaceId: $workspaceId, source: $source) { valid message line column }
     }`,
    { workspaceId, source },
  );
  return data.validateToolSource;
}

export async function deleteTool(id: string): Promise<boolean> {
  const data = await graphql<{ deleteTool: boolean }>(
    'mutation DeleteTool($id: ID!) { deleteTool(id: $id) }',
    { id },
  );
  return data.deleteTool;
}

/**
 * "3 hours ago", as the lists show it. Anything older than a week is a date,
 * because "9 weeks ago" is harder to read than the day it happened.
 */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 14) return '1 week ago';
  if (days < 31) return `${Math.round(days / 7)} weeks ago`;

  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
