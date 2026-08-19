import { graphql } from './client';

/**
 * Moving components between installations as JSON.
 *
 * The envelope crosses the wire as a string rather than as a typed result, and
 * on purpose: it is a file format with a version inside it, and describing it a
 * second time here would be a second thing to keep in step with the server. What
 * is typed is the *plan* — what an import would do to this workspace — because
 * that is what a screen has to render.
 */

/** What can be exported and imported. Agents and workflows are not here yet. */
export type ComponentKind = 'OBJECT' | 'FUNCTION' | 'CONDITION' | 'TOOL' | 'SKILL';

/** How much of what a component reaches travels with it. */
export type ExportDepth = 'SHALLOW' | 'DEEP';

/** What the import will do about one thing the envelope mentions. */
export type ImportDisposition = 'CREATE' | 'RENAME' | 'REUSE' | 'MISSING';

export interface ComponentExport {
  fileName: string;
  json: string;
}

export interface ImportEntry {
  /** Null for a variable, which is pointed at and never created. */
  kind: ComponentKind | null;
  name: string;
  /** What it will be called here; differs from `name` when it was renamed. */
  targetName: string;
  disposition: ImportDisposition;
  detail: string;
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

const PLAN_FIELDS = `
  formatVersion producedBy depth importable problems
  entries { kind name targetName disposition detail }
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

export async function componentImportPlan(workspaceId: string, envelope: string): Promise<ImportPlan> {
  const data = await graphql<{ componentImportPlan: ImportPlan }>(
    `query ComponentImportPlan($workspaceId: ID!, $envelope: String!) {
       componentImportPlan(workspaceId: $workspaceId, envelope: $envelope) { ${PLAN_FIELDS} }
     }`,
    { workspaceId, envelope },
  );
  return data.componentImportPlan;
}

export async function importComponents(workspaceId: string, envelope: string): Promise<ImportPlan> {
  const data = await graphql<{ importComponents: ImportPlan }>(
    `mutation ImportComponents($workspaceId: ID!, $envelope: String!) {
       importComponents(workspaceId: $workspaceId, envelope: $envelope) { ${PLAN_FIELDS} }
     }`,
    { workspaceId, envelope },
  );
  return data.importComponents;
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
};

export const DISPOSITION_LABEL: Record<ImportDisposition, string> = {
  CREATE: 'New',
  RENAME: 'Renamed',
  REUSE: 'Already here',
  MISSING: 'Not here',
};
