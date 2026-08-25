import { graphql } from './client';
import { t } from '../i18n';

/** What a role lets somebody do, beyond the workspaces it is assigned to. */
export type RoleScope = 'ADMIN' | 'USER';

/**
 * A role this installation defines.
 *
 * Not a group from a directory. A provider's group or an OIDC claim is mapped onto
 * one of these, so everything past the front door — who administers, who sees which
 * workspace — is said in this installation's own terms rather than the provider's.
 */
export interface Role {
  id: string;
  name: string;
  description: string | null;
  scopes: RoleScope[];
  /** True for the administrator role, which is shown without its controls. */
  builtin: boolean;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

export interface RoleInput {
  name: string;
  description?: string;
  scopes?: RoleScope[];
}

export const ROLE_SCOPES: RoleScope[] = ['ADMIN', 'USER'];

export const ROLE_SCOPE_LABEL: Record<RoleScope, string> = {
  ADMIN: 'Administrator',
  USER: 'User',
};

export const ROLE_SCOPE_HINT: Record<RoleScope, string> = {
  ADMIN: t('Sees the Admin section and every workspace, whatever else is assigned.'),
  USER: t('Signs in, and sees the workspaces this role is assigned to.'),
};

const ROLE_FIELDS = 'id name description scopes builtin lastModifiedAt lastModifiedBy';

export async function fetchRoles(): Promise<Role[]> {
  const data = await graphql<{ roles: Role[] }>(`query Roles { roles { ${ROLE_FIELDS} } }`);
  return data.roles;
}

export async function createRole(input: RoleInput): Promise<Role> {
  const data = await graphql<{ createRole: Role }>(
    `mutation CreateRole($input: RoleInput!) { createRole(input: $input) { ${ROLE_FIELDS} } }`,
    { input },
  );
  return data.createRole;
}

export async function updateRole(id: string, input: RoleInput): Promise<Role> {
  const data = await graphql<{ updateRole: Role }>(
    `mutation UpdateRole($id: ID!, $input: RoleInput!) { updateRole(id: $id, input: $input) { ${ROLE_FIELDS} } }`,
    { id, input },
  );
  return data.updateRole;
}

export async function deleteRole(id: string): Promise<boolean> {
  const data = await graphql<{ deleteRole: boolean }>(
    `mutation DeleteRole($id: ID!) { deleteRole(id: $id) }`,
    { id },
  );
  return data.deleteRole;
}
