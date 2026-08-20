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
  /** Where to write to them. Null where neither the provider nor anybody here has said. */
  email: string | null;
  /** True where the address was typed here, so sign-in leaves it alone. */
  emailChosen: boolean;
  /** Whether the news that rings their bell is posted to their address as well. */
  emailNotifications: boolean;
  type: UserType;
  roles: RoleRef[];
  /** False for anybody the identity provider defines. */
  editable: boolean;
  /** Whether they can sign in, which is not the same as existing. */
  hasPassword: boolean;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

const USER_FIELDS =
  'id username displayName email emailChosen emailNotifications type roles { id name } editable hasPassword lastModifiedAt lastModifiedBy';

/** A token, as it is listed: never its secret, which is shown once. */
export interface UserToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const TOKEN_FIELDS = 'id name createdAt lastUsedAt';

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

export async function setUserPassword(id: string, password: string): Promise<AppUser> {
  const data = await graphql<{ setUserPassword: AppUser }>(
    `mutation ($id: ID!, $password: String!) { setUserPassword(id: $id, password: $password) { ${USER_FIELDS} } }`,
    { id, password },
  );
  return data.setUserPassword;
}

/**
 * Sets an address: yours when no id is given, anybody's for an administrator.
 *
 * An empty one clears it and hands the field back to the provider, which is why
 * this takes a plain string rather than refusing to send nothing.
 */
export async function setUserEmail(email: string, id?: string): Promise<AppUser> {
  const data = await graphql<{ setUserEmail: AppUser }>(
    `mutation ($id: ID, $email: String) { setUserEmail(id: $id, email: $email) { ${USER_FIELDS} } }`,
    { id: id ?? null, email },
  );
  return data.setUserEmail;
}

/**
 * Turns issue mail on or off: yours when no id is given, anybody's for an
 * administrator.
 *
 * It decides only whether what the bell already shows is posted as well. Who
 * hears about an issue is the tracker's decision and is not changed by this.
 */
export async function setUserEmailNotifications(enabled: boolean, id?: string): Promise<AppUser> {
  const data = await graphql<{ setUserEmailNotifications: AppUser }>(
    `mutation ($id: ID, $enabled: Boolean!) {
       setUserEmailNotifications(id: $id, enabled: $enabled) { ${USER_FIELDS} }
     }`,
    { id: id ?? null, enabled },
  );
  return data.setUserEmailNotifications;
}

export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<boolean> {
  const data = await graphql<{ changeMyPassword: boolean }>(
    `mutation ($currentPassword: String!, $newPassword: String!) {
       changeMyPassword(currentPassword: $currentPassword, newPassword: $newPassword)
     }`,
    { currentPassword, newPassword },
  );
  return data.changeMyPassword;
}

export async function fetchMyTokens(): Promise<UserToken[]> {
  const data = await graphql<{ myTokens: UserToken[] }>(`query { myTokens { ${TOKEN_FIELDS} } }`);
  return data.myTokens;
}

export async function fetchUserTokens(id: string): Promise<UserToken[]> {
  const data = await graphql<{ userTokens: UserToken[] }>(
    `query ($id: ID!) { userTokens(id: $id) { ${TOKEN_FIELDS} } }`,
    { id },
  );
  return data.userTokens;
}

/** The secret comes back exactly once: whatever shows it must not lose it. */
export async function createUserToken(name: string, id?: string): Promise<{ token: UserToken; secret: string }> {
  const data = await graphql<{ createUserToken: { token: UserToken; secret: string } }>(
    `mutation ($id: ID, $name: String!) {
       createUserToken(id: $id, name: $name) { secret token { ${TOKEN_FIELDS} } }
     }`,
    { id: id ?? null, name },
  );
  return data.createUserToken;
}

export async function deleteUserToken(id: string): Promise<boolean> {
  const data = await graphql<{ deleteUserToken: boolean }>(
    `mutation ($id: ID!) { deleteUserToken(id: $id) }`,
    { id },
  );
  return data.deleteUserToken;
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
