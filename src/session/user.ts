import type { SessionUser } from '../api/session';
import type { AppShellUser } from '../components/AppShell';

/** e.g. ["ROLE_ADMINS", "ROLE_USERS"] -> "Admins". */
export function roleLabel(roles: string[]): string {
  const role = roles[0];
  if (role === undefined) return 'Member';
  const name = role.replace(/^ROLE_/, '').toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The signed-in user as the app shell's top bar wants it. */
export function shellUser(session: SessionUser): AppShellUser {
  return {
    name: session.username,
    role: roleLabel(session.roles),
    initials: session.username.slice(0, 2).toUpperCase(),
    email: session.email ?? undefined,
  };
}
