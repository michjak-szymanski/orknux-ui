import { graphql } from './client';

/** Where a user is true: at the identity provider, or here. */
export type UserType = 'INTERNAL' | 'EXTERNAL';

/** A role as a user's row names it: enough to show, enough to pick. */
export interface RoleRef {
  id: string;
  name: string;
}

/**
 * Somebody this installation knows.
 *
 * Not an account: nothing here holds a credential and nothing here signs
 * anybody in. An EXTERNAL user is the identity provider's, recorded when they
 * sign in and read-only after; an INTERNAL one is an identity this
 * installation made up - somebody to assign and mention - and is edited here.
 */
export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  type: UserType;
  roles: RoleRef[];
  /** False for anybody the identity provider defines. */
  editable: boolean;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

const USER_FIELDS = 'id username displayName type roles { id name } editable lastModifiedAt lastModifiedBy';

export async function fetchUsers(search?: string): Promise<AppUser[]> {
  const data = await graphql<{ users: AppUser[] }>(
    `query ($search: String) { users(search: $search) { ${USER_FIELDS} } }`,
    { search: search || null },
  );
  return data.users;
}

export async function fetchUser(id: string): Promise<AppUser | null> {
  const data = await graphql<{ user: AppUser | null }>(
    `query ($id: ID!) { user(id: $id) { ${USER_FIELDS} } }`,
    { id },
  );
  return data.user;
}

export async function createUser(input: {
  username: string;
  displayName?: string;
  roleIds?: string[];
}): Promise<AppUser> {
  const data = await graphql<{ createUser: AppUser }>(
    `mutation ($input: UserInput!) { createUser(input: $input) { ${USER_FIELDS} } }`,
    { input },
  );
  return data.createUser;
}

export async function updateUser(
  id: string,
  input: { displayName?: string; roleIds?: string[] },
): Promise<AppUser> {
  const data = await graphql<{ updateUser: AppUser }>(
    `mutation ($id: ID!, $input: UserInput!) { updateUser(id: $id, input: $input) { ${USER_FIELDS} } }`,
    { id, input },
  );
  return data.updateUser;
}

/**
 * The two letters a circle carries for somebody.
 *
 * The display name's first letters, the way the header badge does it: two words
 * give their initials, one word gives its first two letters.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
