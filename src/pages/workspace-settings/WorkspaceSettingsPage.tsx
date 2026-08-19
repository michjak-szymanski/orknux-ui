import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import { fetchRoles } from '../../api/roles';
import type { Role } from '../../api/roles';
import type { SessionUser } from '../../api/session';
import { fetchWorkspaces, updateWorkspace } from '../../api/workspaces';
import type { Workspace } from '../../api/workspaces';
import { AppShell } from '../../components/AppShell';
import { AdminSidebar } from '../../components/AdminSidebar';
import { DeleteWorkspaceDialog } from '../../components/DeleteWorkspaceDialog';
import { shellUser } from '../../session/user';
import { forgetWorkspaces } from '../../session/workspaces';
import styles from './WorkspaceSettingsPage.module.css';

export interface WorkspaceSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const WORKSPACE_LIST_SIZE = 100;

export function WorkspaceSettingsPage({ session, onSignOut }: WorkspaceSettingsPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  /** Which roles open this workspace, and everything there is to choose from. */
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  /*
   * Everything there is to assign. Loaded here rather than with the workspace
   * because it is the same list for every workspace, and a checkbox for a role that
   * has since been removed would be a checkbox for nothing.
   */
  useEffect(() => {
    fetchRoles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  /** What is left to add, so the button knows whether there is anything to add. */
  const unassigned = roles.filter((role) => !roleIds.includes(role.id));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    // The workspaces query is already filtered to what the caller may see.
    fetchWorkspaces(0, WORKSPACE_LIST_SIZE)
      .then((page) => {
        const found = page.content.find((candidate) => candidate.id === workspaceId) ?? null;
        if (found === null) {
          setLoadError('That workspace does not exist, or you do not have access to it.');
          return;
        }
        setWorkspace(found);
        setName(found.name);
        setDescription(found.description ?? '');
        setRoleIds(found.roles.map((role) => role.id));
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the workspace.');
      });
  }, [workspaceId]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '' || saving) return;

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await updateWorkspace(workspaceId, {
        name: name.trim(),
        description: description.trim() || undefined,
        roleIds,
      });
      // A rename has to reach the selector, which paints from the cached list.
      forgetWorkspaces();
      setWorkspace(updated);
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the workspace.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="admin"
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="workspaces" />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <Link className={styles.crumbLink} to="/admin">
            Workspaces
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{workspace?.name ?? '…'}</span>
        </p>
        <h1 className={styles.pageTitle}>Workspace Settings</h1>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : (
        <>
          <form className={styles.card} onSubmit={handleSave}>
            <div className={styles.sectionTitle}>
              <h2 className={styles.sectionHeading}>General</h2>
            </div>

            <div className={styles.fields}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="workspace-name">
                  Workspace Name
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="workspace-name"
                    name="workspaceName"
                    className={styles.input}
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="workspace-description">
                  Description
                </label>
                <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
                  <textarea
                    id="workspace-description"
                    name="workspaceDescription"
                    className={`${styles.input} ${styles.textarea}`}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
              </div>

              {/*
                Roles, not a group typed from memory. What used to be here was the
                directory's own name for an audience — free text, unvalidated, and
                meaningless to any other identity provider. These are this
                installation's roles, defined on the Roles screen, and which of the
                provider's groups or claims grants one is the server's configuration.

                A row per role with an add button under it, the same shape the
                function editor uses for its parameters: each row is one decision,
                and the picker in it can be changed without taking the row off first.
              */}
              <div className={styles.field}>
                <span className={styles.label}>Roles</span>
                <div className={styles.roleList}>
                  {roleIds.map((roleId, index) => (
                    <div key={`${roleId}-${index}`} className={styles.roleRow}>
                      <div className={styles.selectWrapper}>
                        <select
                          className={styles.roleSelect}
                          value={roleId}
                          aria-label={`Role ${index + 1}`}
                          onChange={(event) =>
                            setRoleIds((held) =>
                              held.map((id, at) => (at === index ? event.target.value : id)),
                            )
                          }
                        >
                          {roles.map((role) => (
                            <option
                              key={role.id}
                              value={role.id}
                              // Already on another row: choosing it twice would
                              // assign it once and leave a row that does nothing.
                              disabled={role.id !== roleId && roleIds.includes(role.id)}
                            >
                              {role.name}
                            </option>
                          ))}
                        </select>
                        <img src={chevronDown12Icon} alt="" width={12} height={12} />
                      </div>
                      <button
                        type="button"
                        className={styles.roleRemove}
                        aria-label={`Remove ${roles.find((role) => role.id === roleId)?.name ?? 'role'}`}
                        onClick={() => setRoleIds((held) => held.filter((_, at) => at !== index))}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className={styles.addRole}
                    disabled={unassigned.length === 0}
                    title={
                      roles.length === 0
                        ? 'No roles are defined yet'
                        : unassigned.length === 0
                          ? 'Every role is already assigned'
                          : 'Assign another role to this workspace'
                    }
                    onClick={() => {
                      const next = unassigned[0];
                      if (next !== undefined) setRoleIds((held) => [...held, next.id]);
                    }}
                  >
                    + Add Role
                  </button>

                  <p className={styles.hint}>
                    {roles.length === 0 ? (
                      <>
                        No roles are defined yet. Add one on the{' '}
                        <Link to="/admin/roles">Roles</Link> screen, then assign it here.
                      </>
                    ) : (
                      <>
                        Whoever holds one of these can see the workspace. None assigned keeps it
                        administrators-only.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {saveError !== null && (
              <p className={styles.error} role="alert">
                {saveError}
              </p>
            )}

            <div className={styles.cardActions}>
              {saved && saveError === null && <p className={styles.savedNote}>Saved.</p>}
              <button type="submit" className={styles.save} disabled={name.trim() === '' || saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>

          <section className={`${styles.card} ${styles.dangerCard}`}>
            <h2 className={styles.dangerHeading}>Danger Zone</h2>
            <div className={styles.dangerRow}>
              <div className={styles.dangerText}>
                <p className={styles.dangerTitle}>Delete Workspace</p>
                <p className={styles.dangerMessage}>
                  Permanently remove this workspace and all associated workflows and executions.
                </p>
              </div>
              <button type="button" className={styles.delete} onClick={() => setDeleting(true)}>
                Delete Workspace
              </button>
            </div>
          </section>
        </>
      )}

      <DeleteWorkspaceDialog
        workspace={deleting ? workspace : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false);
          navigate('/admin');
        }}
      />
    </AppShell>
  );
}
