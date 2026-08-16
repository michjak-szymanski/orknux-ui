import { graphql } from './client';
import type { PageOf } from './client';

/** The shape one property has. */
export type PropertyKind = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'OBJECT' | 'ARRAY';

export interface ObjectProperty {
  name: string;
  kind: PropertyKind;
  /** The object this points at, when the kind is one or an array of them. */
  refObjectId: string | null;
  /** What an array holds when it holds scalars. */
  elementKind: PropertyKind | null;
  /** Ready to show: `string`, `ApiResponse`, `array<FileObject>`. */
  display: string;
}

export interface WorkflowObject {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  properties: ObjectProperty[];
  propertyCount: number;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

export interface ObjectPropertyInput {
  name: string;
  kind: PropertyKind;
  refObjectId?: string | null;
  elementKind?: PropertyKind | null;
}

/** What Validate answers; it is a report, not a failure. */
export interface ObjectValidation {
  valid: boolean;
  message: string;
}

const OBJECT_FIELDS = `
  id workspaceId name description propertyCount createdAt createdBy lastModifiedAt lastModifiedBy
  properties { name kind refObjectId elementKind display }
`;

export async function fetchWorkspaceObjects(
  workspaceId: string,
  page: number,
  size: number,
): Promise<PageOf<WorkflowObject>> {
  const data = await graphql<{ workspaceObjects: PageOf<WorkflowObject> }>(
    `query WorkspaceObjects($workspaceId: ID!, $page: Int!, $size: Int!) {
       workspaceObjects(workspaceId: $workspaceId, page: $page, size: $size) {
         content { ${OBJECT_FIELDS} }
         page size totalElements totalPages
       }
     }`,
    { workspaceId, page, size },
  );
  return data.workspaceObjects;
}

export async function fetchObject(id: string): Promise<WorkflowObject | null> {
  const data = await graphql<{ workflowObject: WorkflowObject | null }>(
    `query WorkflowObjectById($id: ID!) { workflowObject(id: $id) { ${OBJECT_FIELDS} } }`,
    { id },
  );
  return data.workflowObject;
}

export async function createObject(
  workspaceId: string,
  input: { name: string; description?: string; properties?: ObjectPropertyInput[] },
): Promise<WorkflowObject> {
  const data = await graphql<{ createObject: WorkflowObject }>(
    `mutation CreateObject($input: CreateObjectInput!) { createObject(input: $input) { ${OBJECT_FIELDS} } }`,
    { input: { workspaceId, ...input } },
  );
  return data.createObject;
}

export async function updateObject(
  id: string,
  input: { name?: string; description?: string; properties?: ObjectPropertyInput[] },
): Promise<WorkflowObject> {
  const data = await graphql<{ updateObject: WorkflowObject }>(
    `mutation UpdateObject($id: ID!, $input: UpdateObjectInput!) {
       updateObject(id: $id, input: $input) { ${OBJECT_FIELDS} }
     }`,
    { id, input },
  );
  return data.updateObject;
}

export async function deleteObject(id: string): Promise<boolean> {
  const data = await graphql<{ deleteObject: boolean }>(
    `mutation DeleteObject($id: ID!) { deleteObject(id: $id) }`,
    { id },
  );
  return data.deleteObject;
}

export async function validateObject(
  workspaceId: string,
  properties: ObjectPropertyInput[],
): Promise<ObjectValidation> {
  const data = await graphql<{ validateObject: ObjectValidation }>(
    `mutation ValidateObject($workspaceId: ID!, $properties: [ObjectPropertyInput!]!) {
       validateObject(workspaceId: $workspaceId, properties: $properties) { valid message }
     }`,
    { workspaceId, properties },
  );
  return data.validateObject;
}

/** The scalar kinds, which are what a picker offers before any object is named. */
export const SCALAR_KINDS: PropertyKind[] = ['STRING', 'NUMBER', 'BOOLEAN'];

export const PROPERTY_KIND_LABEL: Record<PropertyKind, string> = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  OBJECT: 'object',
  ARRAY: 'array',
};
