import type { ComponentKind, ExportDepth, ImportPlan } from './transfer';
import { graphql } from './client';

/**
 * The installation's component templates.
 *
 * A template is a stored export — the same envelope `exportComponent` writes,
 * kept under a name — so there is deliberately nothing here that describes the
 * file. What crosses the wire is the *row* and what reading its envelope found,
 * and using one goes through the import that already existed: the plan and the
 * confirmation are `ImportPlan`, exactly as they are for an uploaded file.
 *
 * It holds a copy taken when it was published. Nothing here follows the
 * component it was made from, and every screen that shows a template says so.
 */

/** One thing inside a template, as the stored file names it. */
export interface TemplateComponent {
  kind: ComponentKind;
  name: string;
}

export interface ComponentTemplate {
  id: string;
  name: string;
  description: string | null;
  /** Null when this installation cannot read the stored file. */
  formatVersion: number | null;
  producedBy: string | null;
  depth: ExportDepth | null;
  /** Which kinds are inside, each once. */
  kinds: ComponentKind[];
  componentCount: number;
  contents: TemplateComponent[];
  /** False when the stored envelope is from a version this cannot read. */
  usable: boolean;
  /** Why not, in words, when `usable` is false. */
  problem: string | null;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

export interface ComponentTemplateInput {
  name: string;
  description?: string | null;
  /** Required when publishing a file; left out on an edit keeps the stored one. */
  envelope?: string | null;
}

const TEMPLATE_FIELDS = `
  id name description formatVersion producedBy depth kinds componentCount
  usable problem createdAt createdBy lastModifiedAt lastModifiedBy
  contents { kind name }
`;

const PLAN_FIELDS = `
  formatVersion producedBy depth importable problems
  entries { kind name targetName disposition detail }
`;

/** Every template, or only the ones carrying a kind. */
export async function fetchComponentTemplates(holding?: ComponentKind): Promise<ComponentTemplate[]> {
  const data = await graphql<{ componentTemplates: ComponentTemplate[] }>(
    `query ComponentTemplates($holding: ComponentKind) {
       componentTemplates(holding: $holding) { ${TEMPLATE_FIELDS} }
     }`,
    { holding: holding ?? null },
  );
  return data.componentTemplates;
}

export async function fetchComponentTemplate(id: string): Promise<ComponentTemplate | null> {
  const data = await graphql<{ componentTemplate: ComponentTemplate | null }>(
    `query ComponentTemplate($id: ID!) { componentTemplate(id: $id) { ${TEMPLATE_FIELDS} } }`,
    { id },
  );
  return data.componentTemplate;
}

/** The stored file, for the Download on a template's page. Administrators only. */
export async function fetchTemplateEnvelope(id: string): Promise<string> {
  const data = await graphql<{ componentTemplateEnvelope: string }>(
    `query TemplateEnvelope($id: ID!) { componentTemplateEnvelope(id: $id) }`,
    { id },
  );
  return data.componentTemplateEnvelope;
}

/** What using it here would do. The import's own plan, from the import's reader. */
export async function componentTemplatePlan(workspaceId: string, templateId: string): Promise<ImportPlan> {
  const data = await graphql<{ componentTemplatePlan: ImportPlan }>(
    `query ComponentTemplatePlan($workspaceId: ID!, $templateId: ID!) {
       componentTemplatePlan(workspaceId: $workspaceId, templateId: $templateId) { ${PLAN_FIELDS} }
     }`,
    { workspaceId, templateId },
  );
  return data.componentTemplatePlan;
}

export async function useComponentTemplate(workspaceId: string, templateId: string): Promise<ImportPlan> {
  const data = await graphql<{ useComponentTemplate: ImportPlan }>(
    `mutation UseComponentTemplate($workspaceId: ID!, $templateId: ID!) {
       useComponentTemplate(workspaceId: $workspaceId, templateId: $templateId) { ${PLAN_FIELDS} }
     }`,
    { workspaceId, templateId },
  );
  return data.useComponentTemplate;
}

export async function createComponentTemplate(input: ComponentTemplateInput): Promise<ComponentTemplate> {
  const data = await graphql<{ createComponentTemplate: ComponentTemplate }>(
    `mutation CreateComponentTemplate($input: ComponentTemplateInput!) {
       createComponentTemplate(input: $input) { ${TEMPLATE_FIELDS} }
     }`,
    { input },
  );
  return data.createComponentTemplate;
}

/** Publishes what the caller is looking at; the server exports it itself. */
export async function saveComponentAsTemplate(
  workspaceId: string,
  kind: ComponentKind,
  id: string,
  depth: ExportDepth,
  input: ComponentTemplateInput,
): Promise<ComponentTemplate> {
  const data = await graphql<{ saveComponentAsTemplate: ComponentTemplate }>(
    `mutation SaveComponentAsTemplate(
       $workspaceId: ID!, $kind: ComponentKind!, $id: ID!, $depth: ExportDepth!, $input: ComponentTemplateInput!
     ) {
       saveComponentAsTemplate(
         workspaceId: $workspaceId, kind: $kind, id: $id, depth: $depth, input: $input
       ) { ${TEMPLATE_FIELDS} }
     }`,
    { workspaceId, kind, id, depth, input },
  );
  return data.saveComponentAsTemplate;
}

export async function updateComponentTemplate(
  id: string,
  input: ComponentTemplateInput,
): Promise<ComponentTemplate> {
  const data = await graphql<{ updateComponentTemplate: ComponentTemplate }>(
    `mutation UpdateComponentTemplate($id: ID!, $input: ComponentTemplateInput!) {
       updateComponentTemplate(id: $id, input: $input) { ${TEMPLATE_FIELDS} }
     }`,
    { id, input },
  );
  return data.updateComponentTemplate;
}

export async function deleteComponentTemplate(id: string): Promise<boolean> {
  const data = await graphql<{ deleteComponentTemplate: boolean }>(
    `mutation DeleteComponentTemplate($id: ID!) { deleteComponentTemplate(id: $id) }`,
    { id },
  );
  return data.deleteComponentTemplate;
}

/**
 * "2 objects and a function", for a row that has to say what is inside without
 * listing it.
 *
 * Counted from the contents rather than from the kinds, because "holds functions"
 * and "holds four functions" are different amounts of help when somebody is
 * deciding whether to press Use.
 */
export function contentsSummary(template: ComponentTemplate): string {
  if (template.contents.length === 0) return 'Nothing this installation can read';
  const counted = new Map<ComponentKind, number>();
  template.contents.forEach((held) => counted.set(held.kind, (counted.get(held.kind) ?? 0) + 1));
  const parts = [...counted.entries()].map(([kind, count]) =>
    count === 1 ? `1 ${kind.toLowerCase()}` : `${count} ${kind.toLowerCase()}s`,
  );
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
