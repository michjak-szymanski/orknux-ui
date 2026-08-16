import type { SessionUser } from '../../api/session';
import styles from './NoWorkspacesPage.module.css';

export interface NoWorkspacesPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * Shown when the signed-in user's LDAP roles grant no workspaces and they are not an
 * administrator, so there is no section to send them to.
 */
export function NoWorkspacesPage({ session, onSignOut }: NoWorkspacesPageProps) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>No workspaces yet</h1>
        <p className={styles.message}>
          You are signed in as <strong>{session.username}</strong>, but none of your directory groups grant
          access to a workspace. Ask an administrator to add you to the group for your workspace.
        </p>
        {session.roles.length > 0 && <p className={styles.roles}>Roles: {session.roles.join(', ')}</p>}
        {onSignOut && (
          <button type="button" className={styles.signOut} onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </main>
  );
}
