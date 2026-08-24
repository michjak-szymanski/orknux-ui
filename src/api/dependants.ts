import { graphql } from './client';

/**
 * What a dependency question is asked about, and what an answer may name.
 *
 * The server's vocabulary, spelled the same way. Four of these are only ever
 * answers - nothing in the product points at a workflow, a connection, an MCP
 * server or a model provider - so asking about one is refused rather than
 * answered with an empty list.
 */
export type DependencyKind =
  | 'OBJECT'
  | 'FUNCTION'
  | 'CONDITION'
  | 'TOOL'
  | 'SKILL_CATALOG'
  | 'MEMORY_CATALOG'
  | 'ACTION'
  | 'TRIGGER'
  | 'AGENT'
  | 'WORKFLOW'
  | 'VARIABLE'
  | 'LIBRARY'
  | 'CONNECTION'
  | 'MCP_SERVER'
  | 'MODEL_PROVIDER';

/** One thing that depends on a component, and where to open it. */
export interface Dependant {
  kind: DependencyKind;
  id: string;
  name: string;
  /** Null for a function the organisation owns, which belongs to no workspace. */
  workspaceId: string | null;
  workspaceName: string | null;
  /** Whether it is the published copy rather than the drawn one. */
  published: boolean;
}

export interface Dependants {
  entries: Dependant[];
  /**
   * How many are in workspaces this reader cannot open.
   *
   * Counted and never named. Only a library ever reaches out of a workspace, so
   * this is zero everywhere else.
   */
  hidden: number;
}

export const DEPENDANT_FIELDS = 'kind id name workspaceId workspaceName published';

export async function fetchDependants(kind: DependencyKind, componentId: string): Promise<Dependants> {
  const data = await graphql<{ componentDependants: Dependants }>(
    `query ComponentDependants($kind: DependencyKind!, $componentId: ID!) {
       componentDependants(kind: $kind, componentId: $componentId) {
         entries { ${DEPENDANT_FIELDS} }
         hidden
       }
     }`,
    { kind, componentId },
  );
  return data.componentDependants;
}

/**
 * What the thing is called on screen, in the singular.
 *
 * The server says `SKILL_CATALOG` because the folder is the unit an agent is
 * granted; a person reading a list says "skill catalog", and the row is the only
 * place either word appears.
 */
const LABELS: Record<DependencyKind, string> = {
  OBJECT: 'object',
  FUNCTION: 'function',
  CONDITION: 'condition',
  TOOL: 'tool',
  SKILL_CATALOG: 'skill catalog',
  MEMORY_CATALOG: 'memory catalog',
  ACTION: 'action',
  TRIGGER: 'trigger',
  AGENT: 'agent',
  WORKFLOW: 'workflow',
  VARIABLE: 'variable',
  LIBRARY: 'library',
  CONNECTION: 'connection',
  MCP_SERVER: 'MCP server',
  MODEL_PROVIDER: 'model provider',
};

export function dependantLabel(entry: Dependant): string {
  // A published copy is a different thing to be rid of - redrawing the canvas
  // does not touch it - so the row says which of the two it is.
  if (entry.kind === 'WORKFLOW' && entry.published) return 'published workflow';
  return LABELS[entry.kind];
}

/**
 * Where a row goes when it is followed.
 *
 * The routes live here rather than on the server, because they are the
 * interface's own shape: the server answers what a thing is and which workspace
 * it is in, and a path is this application's word for that. Every one of them is
 * a path already in `navigation.ts` - a jump that lands on a page nobody
 * registered is a link naming one thing and opening another, which is the
 * failure the browser check follows a row to the end for.
 *
 * Three kinds have no page of their own and go to the list they are in: a skill
 * catalog, a memory catalog and a variable are all selected inside a page rather
 * than addressed by one. The two catalogs carry `?catalog=`, which those pages
 * already read and which `AgentForm` already links by - opening the list on the
 * catalog somebody asked for rather than on whichever is first. A variable has
 * no such handle, so its row lands on the list; that is a smaller lie than not
 * linking at all, and it is where somebody would go anyway.
 */
export function dependantPath(entry: Dependant): string {
  const workspace = `/workspace/${entry.workspaceId ?? ''}`;
  switch (entry.kind) {
    case 'OBJECT':
      return `${workspace}/objects/${entry.id}`;
    case 'FUNCTION':
      return `${workspace}/functions/${entry.id}`;
    case 'CONDITION':
      return `${workspace}/conditions/${entry.id}`;
    case 'TOOL':
      return `${workspace}/tools/${entry.id}`;
    case 'SKILL_CATALOG':
      return `${workspace}/skills?catalog=${entry.id}`;
    case 'MEMORY_CATALOG':
      return `${workspace}/memory?catalog=${entry.id}`;
    case 'ACTION':
      return `${workspace}/actions/${entry.id}`;
    case 'TRIGGER':
      return `${workspace}/triggers/${entry.id}`;
    case 'AGENT':
      return `${workspace}/agents/${entry.id}/settings`;
    case 'WORKFLOW':
      return `${workspace}/workflows/${entry.id}/settings`;
    case 'VARIABLE':
      return `${workspace}/variables`;
    case 'LIBRARY':
      return '/admin/libraries';
    case 'CONNECTION':
      return `${workspace}/integrations/connections/${entry.id}`;
    case 'MCP_SERVER':
      return `${workspace}/integrations/servers/${entry.id}`;
    case 'MODEL_PROVIDER':
      return `${workspace}/models/providers/${entry.id}`;
  }
}
