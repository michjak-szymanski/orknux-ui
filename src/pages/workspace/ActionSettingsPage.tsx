import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { deleteAction, fetchAction } from '../../api/actions';
import type { Action } from '../../api/actions';
import type { SessionUser } from '../../api/session';
import { ActionForm } from '../../components/ActionForm';
import type { ActionFormStyles } from '../../components/ActionForm';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { Loader } from '../../components/Loader';
import { UsedBy } from '../../components/UsedBy';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './AgentSettingsPage.module.css';
import { t } from '../../i18n';

export interface ActionSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** The page's own names for what the form needs. */
const FORM_STYLES: ActionFormStyles = {
  body: styles.card,
  fields: styles.fields,
  field: styles.field,
  labelRow: styles.labelRow,
  labelWithHint: styles.labelWithHint,
  label: styles.label,
  jump: styles.jump,
  input: styles.input,
  select: styles.select,
  inputWrapper: styles.inputWrapper,
  inputWrapperTall: styles.inputWrapperTall,
  textarea: styles.textarea,
  inputMono: styles.inputMono,
  fieldHint: styles.hint,
  paramHeading: styles.paramHeading,
  mappingList: styles.mappingList,
  mappingRow: styles.mappingRow,
  mappingArgument: styles.mappingArgument,
  paramList: styles.paramList,
  paramRow: styles.paramRow,
  error: styles.error,
  actions: styles.cardActions,
  danger: styles.delete,
  ghost: styles.ghost,
  filled: styles.save,
};

/**
 * One action: written here for the first time, or edited here afterwards.
 *
 * A page rather than the modal the actions list used to open. An action was the
 * last of the seven components still edited only in a dialog — a function, a
 * condition, a trigger, an agent, an object and a tool all open as a page — and
 * what that cost is what an address always buys: a half-written action survives
 * a reload, can be pasted to somebody else, and can be opened in a tab of its
 * own from the list by ctrl-clicking a link that used to be a button. It matters
 * more here than anywhere: this form's four pickers each offer a way out to the
 * definition they name, and a modal is a poor thing to leave behind.
 *
 * Modelled on `ConditionSettingsPage`, which answered the same request for the
 * component most like an action (issue #87): `…/new` alongside `…/:actionId`
 * rendering one component, a breadcrumb back to the list, deleting behind a
 * second click in a Danger Zone, and saving returning to the list. The trigger's
 * page is the other shape available — it keeps a dialog for creating, because a
 * trigger that does not exist yet has nothing to link to and nothing to delete —
 * and it does not fit: creating an action is exactly when its pickers, its
 * "+ New function" and its "+ New condition" are reached for.
 *
 * Saving goes back to the list, for the reason the condition's page gives: the
 * list is where the thing can be seen for what it is, beside its type, its
 * subtype and the parameters the server read off it.
 *
 * The dialog is not gone. The workflow editor's node panel still opens the same
 * fields beside the graph — see `ActionDialog` — because there the action is
 * what a node on the canvas points at rather than what somebody came to work on.
 * Both surfaces render `ActionForm`, so there is one form and not two that
 * drift.
 *
 * Every action belongs to a workspace and every field on it is somebody's to
 * change: unlike a function, there is no such thing as a plugin's action, so
 * there is no read-only case for this page to draw.
 */
export function ActionSettingsPage({ session, onSignOut }: ActionSettingsPageProps) {
  const { workspaceId = '', actionId } = useParams();
  const navigate = useNavigate();
  const adding = actionId === undefined;

  const [action, setAction] = useState<Action | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const list = `/workspace/${workspaceId}/actions`;

  useEffect(() => {
    if (actionId === undefined) return;
    let current = true;

    fetchAction(actionId)
      .then((found) => {
        if (!current) return;
        if (found === null) setLoadError(t('That action does not exist, or you do not have access to it.'));
        else setAction(found);
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : t('Could not open the action.'));
      });

    return () => {
      current = false;
    };
  }, [actionId]);

  async function handleDelete() {
    if (action === null || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await deleteAction(action.id);
      navigate(list);
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : t('Could not delete the action.'));
      setRemoving(false);
    }
  }

  const called = adding ? t('Create Action') : (action?.name ?? '…');

  return (
    <AppShell
      title={adding ? t('New action') : action?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={list} label={t('Actions')} />
          <Link className={styles.crumbLink} to={list}>{t('Actions')}</Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{called}</span>
        </p>
        <h1 className={styles.pageTitle}>{called}</h1>
        <p className={styles.subtitle}>
          {t('A reusable block a workflow node points at. What it asks for follows its type, and the parameters below are read off those settings.')}
        </p>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
          <Link className={styles.crumbLink} to={list}>{t('Back to Actions')}</Link>
        </section>
      ) : !adding && action === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <>
          {/*
            Keyed by which action this is: the form reads its fields as it
            mounts, so following a link from one action to another starts it
            over rather than leaving the previous one's values behind.
          */}
          <ActionForm
            key={action?.id ?? 'new'}
            workspaceId={workspaceId}
            action={action}
            styles={FORM_STYLES}
            onSaved={() => navigate(list)}
          />

          {/*
            What runs it. This panel was put inside the dialog by #258 for one
            stated reason - an action had no page of its own - and the set it
            draws was already computed and already what `deleteAction` refuses
            on, so the only surface it had was the refusal. Now that there is a
            page it is drawn where the six other components draw it: above the
            way to take the action away, so what a deletion is about to break is
            on screen before the button that breaks it.
          */}
          {!adding && action !== null && (
            <section className={styles.card}>
              <UsedBy kind="ACTION" componentId={action.id} />
            </section>
          )}

          {/*
            Removing an action asks twice, as the condition's page does. A
            workflow node pointing at this stops being able to do anything, and
            nothing puts the definition back.
          */}
          {!adding && action !== null && (
            <section className={`${styles.card} ${styles.dangerCard}`}>
              <h2 className={styles.dangerHeading}>{t('Danger Zone')}</h2>
              <div className={styles.dangerRow}>
                <div className={styles.dangerText}>
                  <p className={styles.dangerTitle}>Delete {action.name}</p>
                  <p className={styles.dangerMessage}>
                    {confirmingDelete
                      ? `Delete ${action.name}? A workflow node pointing at it is left pointing at nothing, and says so until it is pointed somewhere else.`
                      : t('Remove this action from the workspace')}
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
                    >{t('Keep')}</button>
                    <button
                      type="button"
                      className={styles.delete}
                      onClick={() => void handleDelete()}
                      disabled={removing}
                    >
                      {removing ? t('Deleting…') : t('Delete Action')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.delete}
                    onClick={() => setConfirmingDelete(true)}
                    disabled={removing}
                  >{t('Delete Action')}</button>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
