import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { SessionUser } from '../../api/session';
import { fetchWorkspaceWorkflows, removeWorkflow, updateWorkflow } from '../../api/workflows';
import type { WorkspaceWorkflow } from '../../api/workflows';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { WorkflowConfirmDialog } from '../../components/WorkflowConfirmDialog';
import { shellUser } from '../../session/user';
import styles from './AgentSettingsPage.module.css';

export interface WorkflowSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const WORKFLOW_LIST_SIZE = 100;

/**
 * No frame exists for this one; the workflows row now opens a settings cog, so
 * this mirrors the agent settings page and keeps removal reachable.
 */
export function WorkflowSettingsPage({ session, onSignOut }: WorkflowSettingsPageProps) {
  const { workspaceId = '', workflowId = '' } = useParams();
  const navigate = useNavigate();

  const [workflow, setWorkflow] = useState<WorkspaceWorkflow | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceWorkflows(workspaceId, 0, WORKFLOW_LIST_SIZE)
      .then((page) => {
        const found = page.content.find((candidate) => candidate.id === workflowId) ?? null;
        if (found === null) {
          setLoadError('That workflow is not assigned to this workspace, or you do not have access to it.');
          return;
        }
        setWorkflow(found);
        setName(found.name);
        setDescription(found.description ?? '');
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the workflow.');
      });
  }, [workspaceId, workflowId]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '' || saving) return;

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await updateWorkflow(workflowId, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setWorkflow(updated);
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the workflow.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title={workflow?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}`}>
            Workflows
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{workflow?.name ?? '…'}</span>
        </p>
        <h1 className={styles.pageTitle}>Workflow Settings</h1>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : workflow === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <>
          <form className={styles.card} onSubmit={handleSave}>
            <h2 className={styles.sectionHeading}>General</h2>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="workflow-name">
                Workflow Name
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="workflow-name"
                  name="workflowName"
                  className={styles.input}
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              {/*
                Not behind the (?). Somebody typing in this box believes they
                are renaming their own copy; that they are renaming everyone's
                is a consequence of the edit, and a consequence read afterwards
                is one that has already happened.
              */}
              <p className={styles.hint}>
                The definition is shared, so renaming it affects every workspace using this workflow.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="workflow-description">
                Description
              </label>
              <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
                <textarea
                  id="workflow-description"
                  name="workflowDescription"
                  className={`${styles.input} ${styles.textarea}`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
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
                <p className={styles.dangerTitle}>Remove Workflow</p>
                <p className={styles.dangerMessage}>
                  Unassign this workflow from the workspace. The workflow definition is kept.
                </p>
              </div>
              <button type="button" className={styles.delete} onClick={() => setRemoving(true)}>
                Remove Workflow
              </button>
            </div>
          </section>
        </>
      )}

      <WorkflowConfirmDialog
        workflowName={removing ? (workflow?.name ?? null) : null}
        kind="remove"
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          await removeWorkflow(workflowId);
          setRemoving(false);
          navigate(`/workspace/${workspaceId}`);
        }}
      />
    </AppShell>
  );
}
