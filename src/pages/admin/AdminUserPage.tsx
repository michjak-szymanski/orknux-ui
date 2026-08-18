import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { fetchRoles } from '../../api/roles';
import type { Role } from '../../api/roles';
import type { SessionUser } from '../../api/session';
import { createUser, fetchUser, initialsOf, updateUser } from '../../api/users';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { Loader } from '../../components/Loader';
import { shellUser } from '../../session/user';
import styles from './AdminUserPage.module.css';

export interface AdminUserPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * One internal user: edited here, or written here for the first time.
 *
 * The same page for both, deliberately - a creation form that says less than
 * the edit page is a form somebody has to leave to finish, which is the lesson
 * the function editor already taught. No id in the path means the user does
 * not exist yet; the first save makes them.
 *
 * What is absent is a password. An internal user is an identity - somebody to
 * assign an issue to, a name to show - not a login; signing in stays with the
 * identity provider.
 */
export function AdminUserPage({ session, onSignOut }: AdminUserPageProps) {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const creating = userId === '';

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<Role[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchRoles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  useEffect(() => {
    if (creating) return;
    let current = true;
    fetchUser(userId)
      .then((found) => {
        if (!current) return;
        if (found === null) {
          setLoadError('That user no longer exists.');
        } else if (!found.editable) {
          // The list never links here for one, but an address can be typed.
          setLoadError(
            `${found.displayName} comes from the identity provider and cannot be edited here.`,
          );
        } else {
          setUsername(found.username);
          setDisplayName(found.displayName);
          setChosen(new Set(found.roles.map((role) => role.id)));
        }
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : 'Could not load the user.');
      });
    return () => {
      current = false;
    };
  }, [creating, userId]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        const made = await createUser({
          username: username.trim(),
          displayName: displayName.trim() || undefined,
          roleIds: [...chosen],
        });
        navigate(`/admin/users/${made.id}`, { replace: true });
      } else {
        await updateUser(userId, { displayName: displayName.trim() || undefined, roleIds: [...chosen] });
        navigate('/admin/users');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the user.');
    } finally {
      setSaving(false);
    }
  }

  const called = displayName.trim() || username.trim() || 'New user';

  return (
    <AppShell
      user={shellUser(session)}
      section="admin"
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="users" />}
    >
      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.error} role="alert">
            {loadError}
          </p>
          <Link className={styles.back} to="/admin/users">
            Back to Users
          </Link>
        </section>
      ) : !creating && username === '' ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <section className={styles.card}>
          <header className={styles.header}>
            <div className={styles.headRow}>
              <BackLink to="/admin/users" label="Users" />
              <span className={styles.avatar} aria-hidden="true">
                {initialsOf(called)}
              </span>
              <div className={styles.titleGroup}>
                <h1 className={styles.title}>{called}</h1>
                <p className={styles.subtitle}>
                  {creating ? 'A new internal user.' : 'Internal — managed here.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              className={styles.save}
              onClick={() => void save()}
              disabled={saving || username.trim() === ''}
            >
              {saving ? 'Saving…' : creating ? 'Create User' : 'Save Changes'}
            </button>
          </header>

          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="user-username">
                Username
              </label>
              <input
                id="user-username"
                className={styles.input}
                type="text"
                value={username}
                // Who somebody is, not a field to edit: renames break every
                // reference by name, so the username is fixed at creation.
                disabled={!creating}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="user-display-name">
                Display Name
              </label>
              <input
                id="user-display-name"
                className={styles.input}
                type="text"
                value={displayName}
                placeholder={username.trim() || 'How they are shown'}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>

            <fieldset className={styles.rolesBox}>
              <legend className={styles.label}>Roles</legend>
              {roles.length === 0 ? (
                <p className={styles.hint}>No roles are defined yet.</p>
              ) : (
                roles.map((role) => (
                  <label key={role.id} className={styles.role}>
                    <input
                      type="checkbox"
                      checked={chosen.has(role.id)}
                      onChange={(event) => {
                        const next = new Set(chosen);
                        if (event.target.checked) next.add(role.id);
                        else next.delete(role.id);
                        setChosen(next);
                      }}
                    />
                    <span className={styles.roleName}>{role.name}</span>
                    {role.description !== null && role.description !== '' && (
                      <span className={styles.roleHint}>{role.description}</span>
                    )}
                  </label>
                ))
              )}
            </fieldset>
          </div>
        </section>
      )}
    </AppShell>
  );
}
