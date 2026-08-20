import { useCallback, useEffect, useState } from 'react';

import { ROLE_SCOPES, ROLE_SCOPE_HINT, ROLE_SCOPE_LABEL, createRole, deleteRole, fetchRoles, updateRole } from '../../api/roles';
import type { Role, RoleScope } from '../../api/roles';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import lockIcon from '../../assets/lock-keyhole.svg';
import pencilIcon from '../../assets/pencil.svg';
import plusIcon from '../../assets/plus.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { TrashIcon } from '../../components/TrashIcon';
import { shellUser } from '../../session/user';
import styles from './AdminRolesPage.module.css';

export interface AdminRolesPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** A role being written, before it is one. */
interface Draft {
  /** The role this is editing, or null while it is being created. */
  id: string | null;
  name: string;
  description: string;
  scopes: RoleScope[];
}

const BLANK: Draft = { id: null, name: '', description: '', scopes: ['USER'] };

/**
 * The roles this installation defines.
 *
 * A role is what this application says somebody may do; which of a provider's
 * groups or claims grants it is configuration, and deliberately not editable here —
 * an administrator who could grant themselves a directory group from a web page
 * would be an administrator who never needed the directory.
 *
 * The administrator role is built in and shown without its controls. An installation
 * with no administrator role is one nobody can administer, and a delete button able
 * to do that is one that eventually will.
 */
export function AdminRolesPage({ session, onSignOut }: AdminRolesPageProps) {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  /** The role whose removal is waiting to be confirmed. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchRoles()
      .then((found) => {
        setRoles(found);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setRoles(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the roles.');
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  async function save() {
    if (draft === null || draft.name.trim() === '' || saving) return;

    setSaving(true);
    setError(null);
    try {
      const input = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        scopes: draft.scopes,
      };
      if (draft.id === null) await createRole(input);
      else await updateRole(draft.id, input);
      setDraft(null);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the role.');
    } finally {
      setSaving(false);
    }
  }

  /** Opens a role for editing. The row and the pencil both come here. */
  function edit(role: Role) {
    setDraft({
      id: role.id,
      name: role.name,
      description: role.description ?? '',
      scopes: role.scopes,
    });
  }

  async function remove(role: Role) {
    setError(null);
    try {
      await deleteRole(role.id);
      setConfirming(null);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the role.');
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      scrollContent
      sidebar={<AdminSidebar active="roles" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Roles</h1>
            <p className={styles.subtitle}>
              What somebody may do here, in this installation&apos;s own terms. Which of the identity
              provider&apos;s groups or claims grants a role is set in the server&apos;s configuration.
            </p>
          </div>
          <button
            type="button"
            className={styles.create}
            onClick={() => setDraft(BLANK)}
            disabled={draft !== null}
          >
            <img src={plusIcon} alt="" width={14} height={14} />
            New Role
          </button>
        </header>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {draft !== null && (
          <div className={styles.editor}>
            <h2 className={styles.editorTitle}>{draft.id === null ? 'New role' : `Editing ${draft.name}`}</h2>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="role-name">
                Name
              </label>
              <input
                id="role-name"
                className={styles.input}
                value={draft.name}
                placeholder="e.g. Backend"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="role-description">
                Description
              </label>
              <input
                id="role-description"
                className={styles.input}
                value={draft.description}
                placeholder="What holding this role means"
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>

            {/*
              Scopes are what a role grants everywhere, as opposed to the workspaces
              it is assigned to. Checkboxes rather than a picker: a role can be more
              than one thing, and the two are not alternatives.
            */}
            <div className={styles.field}>
              <span className={styles.label}>Scopes</span>
              {ROLE_SCOPES.map((scope) => (
                <label key={scope} className={styles.scope}>
                  <input
                    type="checkbox"
                    checked={draft.scopes.includes(scope)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        scopes: event.target.checked
                          ? [...draft.scopes, scope]
                          : draft.scopes.filter((held) => held !== scope),
                      })
                    }
                  />
                  <span>
                    <span className={styles.scopeName}>{ROLE_SCOPE_LABEL[scope]}</span>
                    <span className={styles.scopeHint}>{ROLE_SCOPE_HINT[scope]}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className={styles.editorActions}>
              <button type="button" className={styles.ghost} onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.save}
                onClick={() => void save()}
                disabled={saving || draft.name.trim() === ''}
              >
                {saving ? 'Saving…' : draft.id === null ? 'Create Role' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colName}>Name</span>
            <span className={styles.colScopes}>Scopes</span>
            <span className={styles.colModified}>Last modified</span>
            <span className={styles.colActions}>Actions</span>
          </div>

          {loading && (
            <p className={styles.notice}>
              <Loader />
            </p>
          )}
          {!loading && roles?.length === 0 && <p className={styles.notice}>No roles yet.</p>}

          {roles?.map((role) => (
            <div
              key={role.id}
              className={role.builtin ? styles.row : styles.rowClickable}
              /*
                The row opens the role, which is what clicking a row in a list of
                things means everywhere else. The built-in one is not clickable at
                all rather than clickable-and-refused: there is nothing behind it
                to open.
              */
              onClick={role.builtin ? undefined : () => edit(role)}
              role={role.builtin ? undefined : 'button'}
              tabIndex={role.builtin ? undefined : 0}
              onKeyDown={
                role.builtin
                  ? undefined
                  : (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        edit(role);
                      }
                    }
              }
            >
              <span className={styles.colName}>
                <span className={styles.name}>
                  {role.name}
                  {role.builtin && (
                    <img src={lockIcon} alt="Built in" title="Built in: not editable" width={12} height={12} />
                  )}
                </span>
                {role.description !== null && <span className={styles.description}>{role.description}</span>}
              </span>
              <span className={styles.colScopes}>
                {role.scopes.map((scope) => (
                  <span key={scope} className={scope === 'ADMIN' ? styles.scopeBadgeAdmin : styles.scopeBadge}>
                    {ROLE_SCOPE_LABEL[scope]}
                  </span>
                ))}
              </span>
              <span className={`${styles.colModified} ${styles.muted}`}>
                {timeAgo(role.lastModifiedAt)} by {role.lastModifiedBy}
              </span>
              <span className={styles.colActions}>
                {/*
                  The built-in role has no controls at all rather than disabled ones:
                  it is not a role somebody has yet to earn the right to change.
                */}
                {!role.builtin && (
                  <>
                    {/*
                      The buttons stop the click reaching the row, which would
                      otherwise open the editor behind whatever was pressed.
                    */}
                    <button
                      type="button"
                      className={styles.rowAction}
                      aria-label={`Edit ${role.name}`}
                      title={`Edit ${role.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        edit(role);
                      }}
                    >
                      <img src={pencilIcon} alt="" width={14} height={14} />
                    </button>
                    {confirming === role.id ? (
                      <button
                        type="button"
                        className={styles.confirm}
                        onClick={(event) => {
                          event.stopPropagation();
                          void remove(role);
                        }}
                      >
                        Remove?
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.rowAction}
                        aria-label={`Remove ${role.name}`}
                        title={`Remove ${role.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirming(role.id);
                        }}
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
