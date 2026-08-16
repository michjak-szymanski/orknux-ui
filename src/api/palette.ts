import { graphql } from './client';

/**
 * The things in a workspace that have names, for finding them by one.
 *
 * The palette offers pages, which are fixed and few. This is the other half: the
 * workspace's own contents, which are neither. There is no search endpoint to
 * ask — only `variables` and `memories` take a `search` argument, and the rest
 * are plain paged lists — so the names are fetched once and matched here. That
 * also keeps the palette's promise that typing never waits for a request.
 */

export type EntityKind =
  | 'Workflow'
  | 'Trigger'
  | 'Action'
  | 'Condition'
  | 'Function'
  | 'Agent'
  | 'Object'
  | 'Variable'
  | 'Memory'
  | 'Model'
  | 'Skill'
  | 'Tool';

export interface NamedEntity {
  kind: EntityKind;
  /**
   * What the entity's own page is addressed by. For a workflow this is the
   * definition rather than the assignment — the editor is opened by workflowId,
   * and `WorkspaceWorkflow.id` identifies which workspace it is assigned to.
   */
  id: string;
  name: string;
  /** Which catalog it belongs to, where it belongs to one. Shown to tell two alike apart. */
  catalog?: string;
  /**
   * Another name the same thing answers to, matched but not shown.
   *
   * A model is the case that needs it: it has what a person calls it and what
   * the provider's API is given, and those are often nothing like each other —
   * `DeepSeek V4 Pro` against `DeepSeek-V4-Pro`. Somebody who knows only the
   * second should still find it.
   */
  also?: string;
}

/*
 * How many of each are asked for. A palette is for the workspace somebody is
 * working in, not for auditing a database, and a name that is not in the first
 * couple of hundred is a name nobody is going to guess at anyway. The number is
 * here rather than inline so it is one decision instead of ten.
 */
const PER_TYPE = 200;

interface Named {
  id: string;
  name: string;
}

interface Page<T> {
  content: T[];
}

interface Catalog {
  id: string;
  name: string;
}

/**
 * One request per kind, and whatever comes back is what the palette offers.
 *
 * Asking for all of them in a single query is the obvious shape, and it is the
 * wrong one: a GraphQL field that fails nulls the whole response, so one
 * unreadable kind takes the other eight down with it. That is not hypothetical —
 * actions, agents, triggers and variables all carry encrypted values, and an
 * installation whose `orknux.security.secret-key` is unset cannot read a single
 * row of any of them. Finding a workflow by name should not depend on a
 * credential being decryptable.
 *
 * So each kind is asked for on its own, in parallel, and a kind that fails is
 * simply one the palette cannot offer this time.
 */
const QUERIES: { kind: EntityKind; query: string; read: (data: any) => NamedEntity[] }[] = [
  {
    kind: 'Workflow',
    query: `query PaletteWorkflows($workspaceId: ID!, $size: Int!) {
      workspaceWorkflows(workspaceId: $workspaceId, size: $size) { content { workflowId name } }
    }`,
    // The editor is addressed by the definition; `id` here is the assignment.
    read: (data) =>
      data.workspaceWorkflows.content.map((one: { workflowId: string; name: string }) => ({
        kind: 'Workflow' as const,
        id: one.workflowId,
        name: one.name,
      })),
  },
  named('Trigger', 'workspaceTriggers'),
  named('Action', 'workspaceActions'),
  named('Condition', 'workspaceConditions'),
  named('Function', 'workspaceFunctions'),
  named('Agent', 'workspaceAgents'),
  named('Object', 'workspaceObjects'),
  named('Skill', 'workspaceSkills'),
  named('Tool', 'workspaceTools'),
  {
    /*
     * The odd one out among the catalogues: `models` answers a plain list
     * rather than a page, so it takes no `size` and cannot use the helper.
     */
    kind: 'Model',
    query: `query PaletteModels($workspaceId: ID!) {
      models(workspaceId: $workspaceId) { id name modelId providerName }
    }`,
    read: (data) =>
      data.models.map((one: Named & { modelId: string; providerName: string }) => ({
        kind: 'Model' as const,
        id: one.id,
        name: one.name,
        // Which provider it is reached through, so two models named alike are
        // told apart by the thing that actually differs.
        catalog: one.providerName,
        // Findable by what the API is given as well as by what it is called.
        also: one.modelId,
      })),
  },
  {
    kind: 'Variable',
    query: `query PaletteVariables($workspaceId: ID!, $size: Int!) {
      workspaceVariables(workspaceId: $workspaceId, size: $size) { content { id name catalogName } }
    }`,
    read: (data) =>
      data.workspaceVariables.content.map((one: Named & { catalogName: string }) => ({
        kind: 'Variable' as const,
        id: one.id,
        name: one.name,
        catalog: one.catalogName,
      })),
  },
];

/** The kinds that are a plain paged list of `id` and `name` under a workspace. */
function named(kind: EntityKind, field: string) {
  return {
    kind,
    query: `query Palette${kind}s($workspaceId: ID!, $size: Int!) {
      ${field}(workspaceId: $workspaceId, size: $size) { content { id name } }
    }`,
    read: (data: Record<string, Page<Named>>): NamedEntity[] =>
      data[field].content.map((one) => ({ kind, id: one.id, name: one.name })),
  };
}

/** Every named thing in one workspace that could be read. */
export async function fetchWorkspaceEntities(workspaceId: string): Promise<NamedEntity[]> {
  const asked = QUERIES.map(async (one) => {
    const data = await graphql<Record<string, unknown>>(one.query, { workspaceId, size: PER_TYPE });
    return one.read(data);
  });

  const settled = await Promise.allSettled([...asked, memories(workspaceId)]);
  return settled.flatMap((one) => (one.status === 'fulfilled' ? one.value : []));
}

/**
 * Every catalog's memories, asked for together. A memory is titled, not named.
 *
 * The odd one out: memories are listed by catalog rather than by workspace, so
 * which catalogs exist has to come back before they can be asked for at all.
 * That is one extra round trip, aliased into a single query rather than one
 * request per catalog.
 */
async function memories(workspaceId: string): Promise<NamedEntity[]> {
  const found = await graphql<{ memoryCatalogs: Catalog[] }>(
    `query PaletteMemoryCatalogs($workspaceId: ID!) { memoryCatalogs(workspaceId: $workspaceId) { id name } }`,
    { workspaceId },
  );
  const catalogs = found.memoryCatalogs;
  if (catalogs.length === 0) return [];

  const fields = catalogs
    .map((_, index) => `c${index}: memories(catalogId: $c${index}, size: $size) { content { id title } }`)
    .join('\n');
  const parameters = catalogs.map((_, index) => `$c${index}: ID!`).join(', ');

  const variables: Record<string, unknown> = { size: PER_TYPE };
  catalogs.forEach((catalog, index) => {
    variables[`c${index}`] = catalog.id;
  });

  const data = await graphql<Record<string, Page<{ id: string; title: string }>>>(
    `query PaletteMemories($size: Int!, ${parameters}) {\n${fields}\n}`,
    variables,
  );

  return catalogs.flatMap((catalog, index) =>
    (data[`c${index}`]?.content ?? []).map((one) => ({
      kind: 'Memory' as const,
      id: one.id,
      name: one.title,
      catalog: catalog.name,
    })),
  );
}
