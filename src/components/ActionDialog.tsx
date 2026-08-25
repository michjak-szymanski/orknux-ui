import { useEffect, useRef } from 'react';

import type { Action } from '../api/actions';
import { ActionForm } from './ActionForm';
import type { ActionFormStyles } from './ActionForm';
import { PanelClose, panelEscape } from './PanelClose';
import styles from './Dialog.module.css';
import { t } from '../i18n';

export interface ActionDialogProps {
  /**
   * Whether this stands over the page or beside it.
   *
   * A modal is right when what somebody is doing has nothing to do with what
   * is behind it; making a component for the node they are editing is the
   * opposite, so the workflow editor asks for a panel and keeps its graph.
   */
  placement?: 'modal' | 'panel';
  open: boolean;
  workspaceId: string;
  /** Null creates one; an action edits it, with its type fixed. */
  action: Action | null;
  onClose: () => void;
  onSaved: (action: Action) => void;
  onDeleted?: () => void;
}

/** The dialog's own names for what the form needs. */
const FORM_STYLES: ActionFormStyles = {
  // The padding belongs to the panel around it, which also holds the title.
  body: styles.fields,
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
  fieldHint: styles.fieldHint,
  paramHeading: styles.paramHeading,
  mappingList: styles.mappingList,
  mappingRow: styles.mappingRow,
  mappingArgument: styles.mappingArgument,
  paramList: styles.paramList,
  paramRow: styles.paramRow,
  error: styles.error,
  actions: styles.actions,
  danger: styles.danger,
  ghost: styles.ghost,
  filled: styles.filled,
};

/**
 * The action editor beside a graph, for the one door where a page is the wrong
 * answer.
 *
 * The actions list no longer opens this — an action has its own page now, the
 * way a condition got one in issue #87 — and that is the door a page belongs to,
 * because there the action *is* what somebody came to work on.
 *
 * What is left is the workflow editor's node panel. Somebody there is
 * configuring a node that points at this action, and the graph is the reason
 * they are reading it at all: sending them to a page would take away the thing
 * that gives the settings their meaning, and bring them back to a canvas whose
 * unsaved layout had to survive the trip. So the panel opens the definition
 * *beside* the graph, which is what `placement="panel"` is and what the editor's
 * own comment beside the trigger and condition panels says.
 *
 * Both surfaces render `ActionForm`, so there is one form and not two that
 * drift. What the page has and this does not is the `Used by` panel and a
 * Danger Zone — see `ActionSettingsPage`.
 *
 * The form is mounted only while this is open, and keyed by which action it
 * holds, which is what resets it: it reads its fields as it mounts, so the next
 * action opened starts from that action's own values without anything having to
 * put them back.
 */
export function ActionDialog({
  open,
  workspaceId,
  action,
  onClose,
  onSaved,
  onDeleted,
  placement = 'modal',
}: ActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      if (placement === 'panel') dialog.show();
      else dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.dialogWide} ${placement === 'panel' ? styles.dialogPanel : ''}`}
      onCancel={onClose}
      onClose={onClose}
      onKeyDown={panelEscape(placement, onClose)}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>{action === null ? t('Create Action') : t('Action Settings')}</h2>
          {placement === 'panel' && <PanelClose onClose={onClose} />}
        </header>

        <p className={styles.dialogMessage}>{t('Define a reusable action block for workflows.')}</p>

        {open && (
          <ActionForm
            key={action?.id ?? 'new'}
            workspaceId={workspaceId}
            action={action}
            styles={FORM_STYLES}
            onSaved={onSaved}
            onDeleted={onDeleted}
            onCancel={onClose}
          />
        )}
      </div>
    </dialog>
  );
}
