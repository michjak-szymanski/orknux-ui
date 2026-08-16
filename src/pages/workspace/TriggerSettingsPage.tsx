import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { SessionUser } from '../../api/session';
import { deleteTrigger, fetchTrigger } from '../../api/triggers';
import type { Trigger } from '../../api/triggers';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { TriggerForm } from '../../components/TriggerForm';
import type { TriggerFormStyles } from '../../components/TriggerForm';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './AgentSettingsPage.module.css';

export interface TriggerSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** The page's own names for what the form needs. */
const FORM_STYLES: TriggerFormStyles = {
  body: styles.card,
  fields: styles.fields,
  field: styles.field,
  labelRow: styles.labelRow,
  label: styles.label,
  jump: styles.jump,
  input: styles.input,
  select: styles.select,
  inputWrapper: styles.inputWrapper,
  inputWrapperTall: styles.inputWrapperTall,
  textarea: styles.textarea,
  inputMono: styles.inputMono,
  inputCron: styles.inputCron,
  prefix: styles.prefix,
  fieldHint: styles.hint,
  message: styles.hint,
  error: styles.error,
  actions: styles.cardActions,
  ghost: styles.ghost,
  filled: styles.save,
};

/**
 * Everything about one trigger, at a URL.
 *
 * This was a modal, opened from the list. A modal is the wrong shape for it: the
 * settings of a webhook run to a path, a shape, an authentication function and a
 * payload, which is more than a panel wants to hold; the links out to those
 * definitions had nowhere to go; and deleting sat next to Cancel rather than in a
 * danger zone. Creating a trigger is still a dialog — at that moment there is
 * nothing to link to and nothing to delete.
 *
 * The link a workflow node follows when it says which definition it instances
 * lands here, which is what it always meant.
 */
export function TriggerSettingsPage({ session, onSignOut }: TriggerSettingsPageProps) {
  const { workspaceId = '', triggerId = '' } = useParams();
  const navigate = useNavigate();

  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const list = `/workspace/${workspaceId}/triggers`;

  useEffect(() => {
    if (triggerId === '') return;
    let current = true;

    fetchTrigger(triggerId)
      .then((found) => {
        if (!current) return;
        if (found === null) setLoadError('That trigger does not exist, or you do not have access to it.');
        else setTrigger(found);
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : 'Could not load the trigger.');
      });

    return () => {
      current = false;
    };
  }, [triggerId]);

  async function handleDelete() {
    if (removing) return;

    setRemoving(true);
    setRemoveError(null);
    try {
      await deleteTrigger(triggerId);
      navigate(list);
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : 'Could not delete the trigger.');
      setRemoving(false);
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="triggers" />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={list} label="Triggers" />
          <Link className={styles.crumbLink} to={list}>
            Triggers
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{trigger?.name ?? '…'}</span>
        </p>
        <h1 className={styles.pageTitle}>Trigger Settings</h1>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : (
        trigger !== null && (
          <>
            {/*
              Keyed by which trigger this is: the form reads its fields as it
              mounts, so following a link from one trigger to another starts it
              over rather than leaving the previous one's values behind.
            */}
            <TriggerForm
              key={trigger.id}
              workspaceId={workspaceId}
              trigger={trigger}
              styles={FORM_STYLES}
              onSaved={(updated) => {
                setTrigger(updated);
                setSaved(true);
              }}
            />

            {saved && <p className={styles.savedNote}>Saved.</p>}

            <section className={`${styles.card} ${styles.dangerCard}`}>
              <h2 className={styles.dangerHeading}>Danger Zone</h2>
              <div className={styles.dangerRow}>
                <div className={styles.dangerText}>
                  <p className={styles.dangerTitle}>Delete {trigger.name}</p>
                  <p className={styles.dangerMessage}>
                    Nothing waits on this event any more. A workflow node pointing at it stops
                    starting runs, and keeps saying so until it is pointed somewhere else.
                  </p>
                  {removeError !== null && (
                    <p className={styles.error} role="alert">
                      {removeError}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.delete}
                  onClick={() => void handleDelete()}
                  disabled={removing}
                >
                  {removing ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </section>
          </>
        )
      )}
    </AppShell>
  );
}
