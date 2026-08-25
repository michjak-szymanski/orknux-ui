import { graphql } from './client';
import { fetchMcpServers, fetchWorkspaceConnections } from './integrations';
import { answers, fetchModels } from './models';
import { t } from '../i18n';

/**
 * Moving components between installations as JSON.
 *
 * The envelope crosses the wire as a string rather than as a typed result, and
 * on purpose: it is a file format with a version inside it, and describing it a
 * second time here would be a second thing to keep in step with the server. What
 * is typed is the *plan* — what an import would do to this workspace — because
 * that is what a screen has to render.
 */

/** What can be exported and imported: the whole catalogue. */
export type ComponentKind =
  | 'OBJECT'
  | 'FUNCTION'
  | 'CONDITION'
  | 'TOOL'
  | 'SKILL'
  | 'ACTION'
  | 'TRIGGER'
  | 'AGENT'
  | 'WORKFLOW';

/**
 * What a file points at and can never carry.
 *
 * Each of these is a row kept beside a credential, so what travels is the name
 * and the type. Saying which of this workspace's rows a name means is the
 * binding step, and until it is said the import is refused rather than left to
 * invent a connection to nowhere.
 */
export type ExternalKind = 'MODEL' | 'CONNECTION' | 'MCP_SERVER';

/** How much of what a component reaches travels with it. */
export type ExportDepth = 'SHALLOW' | 'DEEP';

/** What the import will do about one thing the envelope mentions. */
export type ImportDisposition = 'CREATE' | 'RENAME' | 'REUSE' | 'MISSING' | 'EXCLUDE';

export interface ComponentExport {
  fileName: string;
  json: string;
}

export interface ImportEntry {
  /** The kind, for something the file carries. Null for an external and for a variable. */
  kind: ComponentKind | null;
  /** The kind, for something no file could carry. Set only where `kind` is not. */
  external: ExternalKind | null;
  /**
   * Whether the envelope holds this one, rather than pointing at it.
   *
   * The one fact that decides what a row may be offered. Only what the file
   * carries can be left out; every other row is a *reference* — a name that has
   * to be matched against this workspace or bound to one of its rows — and there
   * is nothing in the file to take away. True exactly where `disposition` is
   * CREATE, RENAME or EXCLUDE.
   */
  carried: boolean;
  /**
   * The name in the file, and the key a binding answers by.
   *
   * For a model, the provider's name and the model's. Opaque: it is compared
   * and sent back as it stands, never taken apart.
   */
  name: string;
  /** What it will be called here; differs from `name` when it was renamed or bound. */
  targetName: string;
  disposition: ImportDisposition;
  detail: string;
}

/**
 * One answer to something the file could not carry.
 *
 * `name` is the plan's, sent back exactly as it came; `targetId` says which of
 * this workspace's rows it means. A binding naming a row this workspace does not
 * hold is refused rather than ignored, so a form left open while the workspace
 * changed gets an error and not a quietly different import.
 */
export interface ComponentBinding {
  kind: ExternalKind;
  name: string;
  targetId: string;
}

export interface ImportPlan {
  formatVersion: number;
  producedBy: string | null;
  depth: ExportDepth;
  /** False while anything is MISSING; the Import button is refused. */
  importable: boolean;
  entries: ImportEntry[];
  problems: string[];
}

/**
 * Shared with the template queries, which answer the same plan.
 *
 * Using a template is this import with the file already chosen, so a second copy
 * of these fields would be a second place for a new one to be forgotten.
 */
/**
 * One component the import is to leave out.
 *
 * Named as the file names it — the name the plan gave back, not whatever it
 * would be renamed to here — and only ever a carried one. The server refuses a
 * name it does not carry rather than ignoring it, so this cannot quietly ask for
 * something that does not happen.
 */
export interface ComponentExclusion {
  kind: ComponentKind;
  name: string;
}

export const PLAN_FIELDS = `
  formatVersion producedBy depth importable problems
  entries { kind external carried name targetName disposition detail }
`;

export async function exportComponent(
  workspaceId: string,
  kind: ComponentKind,
  id: string,
  depth: ExportDepth,
): Promise<ComponentExport> {
  const data = await graphql<{ exportComponent: ComponentExport }>(
    `query ExportComponent($workspaceId: ID!, $kind: ComponentKind!, $id: ID!, $depth: ExportDepth!) {
       exportComponent(workspaceId: $workspaceId, kind: $kind, id: $id, depth: $depth) { fileName json }
     }`,
    { workspaceId, kind, id, depth },
  );
  return data.exportComponent;
}

export async function componentImportPlan(
  workspaceId: string,
  envelope: string,
  bindings: ComponentBinding[] = [],
  exclude: ComponentExclusion[] = [],
): Promise<ImportPlan> {
  const data = await graphql<{ componentImportPlan: ImportPlan }>(
    `query ComponentImportPlan(
       $workspaceId: ID!, $envelope: String!,
       $bindings: [ComponentBindingInput!], $exclude: [ComponentExclusionInput!]
     ) {
       componentImportPlan(
         workspaceId: $workspaceId, envelope: $envelope, bindings: $bindings, exclude: $exclude
       ) {
         ${PLAN_FIELDS}
       }
     }`,
    { workspaceId, envelope, bindings, exclude },
  );
  return data.componentImportPlan;
}

export async function importComponents(
  workspaceId: string,
  envelope: string,
  bindings: ComponentBinding[] = [],
  exclude: ComponentExclusion[] = [],
): Promise<ImportPlan> {
  const data = await graphql<{ importComponents: ImportPlan }>(
    `mutation ImportComponents(
       $workspaceId: ID!, $envelope: String!,
       $bindings: [ComponentBindingInput!], $exclude: [ComponentExclusionInput!]
     ) {
       importComponents(
         workspaceId: $workspaceId, envelope: $envelope, bindings: $bindings, exclude: $exclude
       ) {
         ${PLAN_FIELDS}
       }
     }`,
    { workspaceId, envelope, bindings, exclude },
  );
  return data.importComponents;
}

/** One of this workspace's rows, offered as an answer to a name in the file. */
export interface BindingChoice {
  id: string;
  /** Named as the plan names it, so the two lists read alike. */
  label: string;
  /** What it is here — the type, the address — for telling two of them apart. */
  note: string | null;
}

/**
 * What this workspace can point a name at.
 *
 * Asked of the catalogues that already answer these questions elsewhere rather
 * than through a query of its own: the picker offers the same models the agent
 * form offers and the same connections the integrations page lists, and a second
 * route to them would be a second thing to keep in step.
 *
 * A model is labelled with its provider, because that is what the file names and
 * what the plan echoes back — two providers offering a model of one name is
 * common enough that the bare name would be ambiguous on both sides.
 */
export async function bindingChoices(workspaceId: string, kind: ExternalKind): Promise<BindingChoice[]> {
  switch (kind) {
    case 'MODEL': {
      const models = await fetchModels(workspaceId);
      // An agent talks; a model that only hears or reads is not what it thinks with.
      return models.filter(answers).map((model) => ({
        id: model.id,
        label: `${model.providerName} / ${model.name}`,
        note: model.modelId,
      }));
    }
    case 'CONNECTION': {
      const connections = await fetchWorkspaceConnections(workspaceId);
      return connections.map((connection) => ({
        id: connection.id,
        label: connection.name,
        // The type as the plan writes it, so "(slack)" in the file has a match here.
        note: connection.type.toLowerCase().replace(/_/g, ' '),
      }));
    }
    case 'MCP_SERVER': {
      const servers = await fetchMcpServers(workspaceId);
      return servers.map((server) => ({ id: server.id, label: server.name, note: server.address }));
    }
  }
}

/** What the file is called on the way in, once the browser has taken it. */
export function saveJson(fileName: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next turn: revoking it in this one races the download in
  // some browsers, which then save nothing and report nothing.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const KIND_LABEL: Record<ComponentKind, string> = {
  OBJECT: 'Object',
  FUNCTION: 'Function',
  CONDITION: 'Condition',
  TOOL: 'Tool',
  SKILL: 'Skill',
  ACTION: 'Action',
  TRIGGER: 'Trigger',
  AGENT: 'Agent',
  WORKFLOW: 'Workflow',
};

export const EXTERNAL_LABEL: Record<ExternalKind, string> = {
  MODEL: 'Model',
  CONNECTION: 'Connection',
  MCP_SERVER: t('MCP server'),
};

export const DISPOSITION_LABEL: Record<ImportDisposition, string> = {
  CREATE: 'New',
  RENAME: 'Renamed',
  REUSE: t('Already here'),
  MISSING: t('Not here'),
  EXCLUDE: t('Left out'),
};
