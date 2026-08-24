import { ApiError, request } from './client';

export interface SessionUser {
  username: string;
  roles: string[];
  /** Holds the server's configured admin role: sees the admin section and every workspace. */
  admin: boolean;
  /** The directory's mail attribute; absent when the entry has none. */
  email?: string | null;
  /**
   * Whether issue news is posted to that address as well as rung on the bell.
   * True until somebody turns it off, and nothing is sent at all on an
   * installation with no mail server configured.
   */
  emailNotifications?: boolean;
  /**
   * Whether a chat prints what an answer cost beside how long it took. False
   * until somebody turns it on, on the Preferences page.
   */
  chatCostShown?: boolean;
}

export interface Credentials {
  username: string;
  password: string;
}

export async function login(credentials: Credentials): Promise<SessionUser> {
  const response = await request('/api/session', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });

  if (response.status === 401) {
    throw new ApiError('Invalid username or password.', 401);
  }
  if (!response.ok) {
    throw new ApiError(`Sign-in failed with status ${response.status}`, response.status);
  }

  return (await response.json()) as SessionUser;
}

/** Resolves to null when nobody is signed in. */
export async function currentSession(): Promise<SessionUser | null> {
  const response = await request('/api/session');

  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new ApiError(`Could not read the session (status ${response.status})`, response.status);
  }

  return (await response.json()) as SessionUser;
}

export async function logout(): Promise<void> {
  await request('/api/session', { method: 'DELETE' });
}

/**
 * How this installation signs people in.
 *
 * INTERNAL is a password box like LDAP, against accounts the installation holds
 * itself rather than a directory. It is what the all-in-one image runs on, and
 * that image has no directory to reach - so the card must not say it is reaching
 * one.
 */
export type AuthMethod = 'LDAP' | 'INTERNAL' | 'OIDC' | 'NONE';

export interface AuthMethodInfo {
  method: AuthMethod;
  /** What the sign-in button says, where there is one. */
  displayName: string;
  /** Where to send the browser, or null when there is a password box instead. */
  authorizeUrl: string | null;
  /**
   * What this installation has to say out loud about itself, wherever somebody is
   * standing in it. Null on every installation that asks people to sign in.
   *
   * The sentence is the server's, not this bundle's: the startup log, the Doctor
   * screen and the strip across the top of every page all read one constant, so
   * they cannot end up describing the same installation differently.
   */
  notice: string | null;
}

/**
 * What kind of sign-in this installation uses.
 *
 * Asked before anybody has signed in, because the screen cannot draw itself
 * without it: a password box, or a button pointing at the provider. Open on the
 * server for the same reason.
 *
 * Falls back to a password box if the question cannot be answered. An installation
 * whose server is unreachable has a bigger problem than this, and a form somebody
 * can try is a better dead end than a blank card.
 *
 * That fallback is also the closed one, which matters now that one of the answers
 * is "there is no sign-in": a browser that could not ask must never conclude that
 * authentication is off, and must never draw the notice for an installation that
 * has one.
 */
export async function authMethod(): Promise<AuthMethodInfo> {
  try {
    const response = await fetch('/api/auth/method', { credentials: 'include' });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as AuthMethodInfo;
  } catch {
    return { method: 'LDAP', displayName: 'single sign-on', authorizeUrl: null, notice: null };
  }
}
