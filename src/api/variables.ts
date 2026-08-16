import { graphql } from './client';
import type { PageOf } from './client';

/** What a variable holds. Scalars only: a shape belongs in the object catalogue. */
export type VariableType = 'STRING' | 'NUMBER' | 'BOOLEAN';

/**
 * Whether a variable is something to keep out of sight.
 *
 * Both are encrypted at rest and both reach a function the same way; what
 * differs is the screen. A value is read with the list — a channel name or a
 * threshold is only awkward hidden. A secret is shown when somebody asks, and
 * the asking is recorded.
 */
export type VariableKind = 'VALUE' | 'SECRET';

export const VARIABLE_KIND_LABEL: Record<VariableKind, string> = {
  VALUE: 'Value',
  SECRET: 'Secret',
};

/** A folder of variables, the way a skill catalog is a folder of skills. */
export interface VariableCatalog {
  id: string;
  workspaceId: string;
  name: string;
  /** What the count badge shows, so an empty catalog reads as empty. */
  variableCount: number;
  createdAt: string;
  createdBy: string;
}

/**
 * A named value the workspace keeps.
 *
 * No `value` here: it is stored encrypted, and a list of variables is not a
 * place to put secrets. What a screen knows from a list is that one has been
 * set; seeing it takes asking, which `revealVariable` records.
 */
export interface Variable {
  id: string;
  workspaceId: string;
  catalogId: string;
  catalogName: string;
  name: string;
  /** What it is for, since the name has to be an identifier. */
  description: string | null;
  type: VariableType;
  kind: VariableKind;
  /** What it holds, on a value. Null on a secret, whatever is stored. */
  value: string | null;
  /** Whether anything is stored, which is all a secret says about itself. */
  valueSet: boolean;
  createdAt: string;
  /** Who put it there; the person who knows what it is for. */
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

export const VARIABLE_TYPES: VariableType[] = ['STRING', 'NUMBER', 'BOOLEAN'];

export const VARIABLE_TYPE_LABEL: Record<VariableType, string> = {
  STRING: 'String',
  NUMBER: 'Number',
  BOOLEAN: 'Boolean',
};

const CATALOG_FIELDS = 'id workspaceId name variableCount createdAt createdBy';
const VARIABLE_FIELDS = `id workspaceId catalogId catalogName name description type kind value valueSet
   createdAt createdBy lastModifiedAt lastModifiedBy`;

export async function fetchVariableCatalogs(workspaceId: string): Promise<VariableCatalog[]> {
  const data = await graphql<{ variableCatalogs: VariableCatalog[] }>(
    `query VariableCatalogs($workspaceId: ID!) { variableCatalogs(workspaceId: $workspaceId) { ${CATALOG_FIELDS} } }`,
    { workspaceId },
  );
  return data.variableCatalogs;
}

export async function createVariableCatalog(workspaceId: string, name: string): Promise<VariableCatalog> {
  const data = await graphql<{ createVariableCatalog: VariableCatalog }>(
    `mutation CreateVariableCatalog($workspaceId: ID!, $name: String!) {
       createVariableCatalog(workspaceId: $workspaceId, name: $name) { ${CATALOG_FIELDS} }
     }`,
    { workspaceId, name },
  );
  return data.createVariableCatalog;
}

export async function renameVariableCatalog(id: string, name: string): Promise<VariableCatalog> {
  const data = await graphql<{ renameVariableCatalog: VariableCatalog }>(
    `mutation RenameVariableCatalog($id: ID!, $name: String!) {
       renameVariableCatalog(id: $id, name: $name) { ${CATALOG_FIELDS} }
     }`,
    { id, name },
  );
  return data.renameVariableCatalog;
}

export async function deleteVariableCatalog(id: string): Promise<boolean> {
  const data = await graphql<{ deleteVariableCatalog: boolean }>(
    'mutation DeleteVariableCatalog($id: ID!) { deleteVariableCatalog(id: $id) }',
    { id },
  );
  return data.deleteVariableCatalog;
}

/**
 * One page of variables: a catalog's, or every one the workspace holds.
 *
 * A blank search is no filter rather than a search for nothing, so the screen
 * can send what is in its box without deciding anything.
 */
export async function fetchVariables(
  workspaceId: string,
  options: { catalogId?: string | null; search?: string; page?: number; size?: number } = {},
): Promise<PageOf<Variable>> {
  const data = await graphql<{ workspaceVariables: PageOf<Variable> }>(
    `query WorkspaceVariables($workspaceId: ID!, $catalogId: ID, $search: String, $page: Int!, $size: Int!) {
       workspaceVariables(
         workspaceId: $workspaceId, catalogId: $catalogId, search: $search, page: $page, size: $size
       ) {
         content { ${VARIABLE_FIELDS} }
         page size totalElements totalPages
       }
     }`,
    {
      workspaceId,
      catalogId: options.catalogId ?? null,
      search: options.search ?? null,
      page: options.page ?? 0,
      size: options.size ?? 20,
    },
  );
  return data.workspaceVariables;
}

export async function createVariable(input: {
  workspaceId: string;
  catalogId: string;
  name: string;
  description?: string;
  type: VariableType;
  kind: VariableKind;
  value?: string;
}): Promise<Variable> {
  const data = await graphql<{ createVariable: Variable }>(
    `mutation CreateVariable($input: CreateVariableInput!) {
       createVariable(input: $input) { ${VARIABLE_FIELDS} }
     }`,
    { input },
  );
  return data.createVariable;
}

export async function updateVariable(
  id: string,
  input: {
    catalogId?: string;
    name?: string;
    description?: string;
    type?: VariableType;
    kind?: VariableKind;
    /** Left out to keep the stored value; the form cannot show it to send it back. */
    value?: string;
  },
): Promise<Variable> {
  const data = await graphql<{ updateVariable: Variable }>(
    `mutation UpdateVariable($id: ID!, $input: UpdateVariableInput!) {
       updateVariable(id: $id, input: $input) { ${VARIABLE_FIELDS} }
     }`,
    { id, input },
  );
  return data.updateVariable;
}

/**
 * What a variable holds, asked for deliberately.
 *
 * The one way a value leaves the server, and it is recorded in the audit log:
 * nothing returns it as part of a list, because a value on a screen is a value
 * in a screenshot.
 */
export async function revealVariable(id: string): Promise<string | null> {
  const data = await graphql<{ revealVariable: string | null }>(
    'mutation RevealVariable($id: ID!) { revealVariable(id: $id) }',
    { id },
  );
  return data.revealVariable;
}

export async function deleteVariable(id: string): Promise<boolean> {
  const data = await graphql<{ deleteVariable: boolean }>(
    'mutation DeleteVariable($id: ID!) { deleteVariable(id: $id) }',
    { id },
  );
  return data.deleteVariable;
}
