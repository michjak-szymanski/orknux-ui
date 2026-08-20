import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { deleteCondition, fetchCondition } from '../../api/conditions';
import type { Condition } from '../../api/conditions';
import type { SessionUser } from '../../api/session';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { ConditionForm } from '../../components/ConditionForm';
import type { ConditionFormStyles } from '../../components/ConditionForm';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './ConditionSettingsPage.module.css';

export interface ConditionSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** The page's own names for what the form needs. */
const FORM_STYLES: ConditionFormStyles = {
  body: styles.card,
  fields: styles.fields,
  field: styles.field,
  labelRow: styles.labelRow,
  label: styles.label,
  jump: styles.jump,
  input: styles.input,
  select: styles.select,
  inputWrapper: styles.inputWrapper,
  inputMono: styles.inputMono,
  fieldHint: styles.hint,
  toggleRow: styles.toggleRow,
  toggleLabel: styles.toggleLabel,
  toggle: styles.toggle,
  toggleOn: styles.toggleOn,
  knob: styles.knob,
  tags: styles.tags,
  tag: styles.tag,
  tagRemove: styles.tagRemove,
  addValue: styles.addValue,
  error: styles.error,
  actions: styles.cardActions,
  danger: styles.delete,
  ghost: styles.ghost,
  filled: styles.save,
};

/**
 * One condition: written here for the first time, or edited here afterwards.
 *
 * A page rather than the modal the conditions list used to open (issue #87).
 * Every other list on this platform opens a row as a page — a function, a
 * trigger, a tool, a machine — and a condition was the one that did not, which
 * is what the report was about. What it buys beyond consistency is what an
 * address always buys: a half-written condition survives a reload, can be
 * pasted to somebody else, and can be opened in a tab of its own from the list
 * by ctrl-clicking a link that used to be a button.
 *
 * Modelled on the shell page in the admin section, which is the same shape in
 * every respect that matters: `…/new` alongside `…/:conditionId` rendering one
 * component, a breadcrumb back to the list, deleting behind a second click in a
 * Danger Zone, and saving returning to the list.
 *
 * Saving goes back to the list on purpose, for the reason the shell page gives
 * for its own: the list is where the thing can be seen for what it is. The
 * server reads a condition's description off its definition, so the sentence
 * saying what this now asks is a column on the list and is nowhere on this
 * form.
 *
 * The dialog is not gone. The workflow editor's node panel, the trigger form
 * and the action form still open the same fields in a panel, because there the
 * condition is one field of something else that is on the screen and unsaved —
 * see `ConditionDialog`. Both surfaces render `ConditionForm`, so there is one
 * form and not two that drift.
 */
export function ConditionSettingsPage({ session, onSignOut }: ConditionSettingsPageProps) {
  const { workspaceId = '', conditionId } = useParams();
  const navigate = useNavigate();
  const adding = conditionId === undefined;

  const [condition, setCondition] = useState<Condition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const list = `/workspace/${workspaceId}/conditions`;

  /*
   * Arriving to wrap a function in a condition.
   *
   * The function editor sends `?function=<id>`, and that is the whole of the
   * handover: the form opens on Function with it already chosen. Read from the
   * query rather than passed through router state so the link can be kept, sent,
   * or opened in a second tab and still mean the same thing.
   */
  const [query] = useSearchParams();
  const wrapping = query.get('function');
  // One object per function, or the form would be handed a new one to look at
  // on every render of this page.
  const preset = useMemo(() => (wrapping === null ? null : { functionId: wrapping }), [wrapping]);

  useEffect(() => {
    if (conditionId === undefined) return;
    let current = true;

    fetchCondition(conditionId)
      .then((found) => {
        if (!current) return;
        if (found === null) setLoadError('That condition no longer exists.');
        else setCondition(found);
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : 'Could not load the condition.');
      });

    return () => {
      current = false;
    };
  }, [conditionId]);

  async function handleDelete() {
    if (condition === null || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await deleteCondition(condition.id);
      navigate(list);
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : 'Could not delete the condition.');
      setRemoving(false);
    }
  }

  const called = adding ? 'Create Condition' : (condition?.name ?? '…');

  return (
    <AppShell
      title={adding ? 'New condition' : condition?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={list} label="Conditions" />
          <Link className={styles.crumbLink} to={list}>
            Conditions
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{called}</span>
        </p>
        <h1 className={styles.pageTitle}>{called}</h1>
        <p className={styles.subtitle}>
          A reusable question, for workflow branching and action triggers. What it asks is read off
          the definition below and shown wherever the condition is used.
        </p>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
          <Link className={styles.crumbLink} to={list}>
            Back to Conditions
          </Link>
        </section>
      ) : !adding && condition === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <>
          {/*
            Keyed by which condition this is: the form reads its fields as it
            mounts, so following a link from one condition to another starts it
            over rather than leaving the previous one's values behind.
          */}
          <ConditionForm
            key={condition?.id ?? 'new'}
            workspaceId={workspaceId}
            condition={condition}
            preset={adding ? preset : null}
            styles={FORM_STYLES}
            onSaved={() => navigate(list)}
          />

          {/*
            Removing a condition asks twice, as the shell page does. A workflow
            node pointing at this stops being able to decide anything, and
            nothing puts the definition back.
          */}
          {!adding && condition !== null && (
            <section className={`${styles.card} ${styles.dangerCard}`}>
              <h2 className={styles.dangerHeading}>Danger Zone</h2>
              <div className={styles.dangerRow}>
                <div className={styles.dangerText}>
                  <p className={styles.dangerTitle}>Delete {condition.name}</p>
                  <p className={styles.dangerMessage}>
                    {confirmingDelete
                      ? `Delete ${condition.name}? A workflow node or trigger pointing at it is left pointing at nothing, and says so until it is pointed somewhere else.`
                      : 'Remove this condition from the workspace'}
                  </p>
                  {removeError !== null && (
                    <p className={styles.error} role="alert">
                      {removeError}
                    </p>
                  )}
                </div>
                {confirmingDelete ? (
                  <div className={styles.dangerButtons}>
                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => setConfirmingDelete(false)}
                      disabled={removing}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className={styles.delete}
                      onClick={() => void handleDelete()}
                      disabled={removing}
                    >
                      {removing ? 'Deleting…' : 'Delete Condition'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.delete}
                    onClick={() => setConfirmingDelete(true)}
                    disabled={removing}
                  >
                    Delete Condition
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
