import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { SessionUser } from '../../api/session';
import { fetchWorkspaceWorkflows, removeWorkflow, updateWorkflow } from '../../api/workflows';
import type { WorkspaceWorkflow } from '../../api/workflows';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { PublicationHistory } from '../../components/PublicationHistory';
import { FieldHint } from '../../components/FieldHint';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
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
  /**
   * What the workflow's badge said after a restore.
   *
   * A restore puts an older publication back into service and leaves the draft
   * alone, so the two can end up disagreeing - the answer is the status the
   * server worked out, said here rather than left for somebody to discover in
   * the editor.
   */
  const [restored, setRestored] = useState<string | null>(null);

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
              <span className={styles.labelWithHint}>
                <label className={styles.label} htmlFor="workflow-name">
                  Workflow Name
                </label>
                {/*
                  Behind the (?), like every other consequence in the product.
                  It was printed here on the argument that a consequence read
                  afterwards has already happened - which is a fair argument and
                  is not the one this product settled on: the rules file puts a
                  consequence worth knowing beforehand behind the (?) beside the
                  thing it is about, and a screen keeping its own answer is the
                  inconsistency the whole convention exists to end.
                */}
                <FieldHint label="Workflow Name">
                  The definition is shared, so renaming it affects every workspace using this
                  workflow.
                </FieldHint>
              </span>
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

          {/*
            A workflow's versions are its publications, so this is the history
            and the canvas is not. It sits above the Danger Zone for the same
            reason it exists: somebody who has just broken a live workflow is
            looking for the way back, not the way out.
          */}
          <section className={styles.card}>
            <PublicationHistory
              workspaceId={workspaceId}
              workflowId={workflowId}
              onRestored={setRestored}
            />
            {restored !== null && (
              <p className={styles.savedNote}>
                {restored === 'PUBLISHED'
                  ? 'Restored. What runs is what the editor is drawing.'
                  : 'Restored. What runs is now that publication; the draft on the canvas is untouched, ' +
                    'so the workflow reads as a draft until it is published again.'}
              </p>
            )}
          </section>

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

      <ConfirmDialog
        subject={removing ? (workflow?.name ?? null) : null}
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
