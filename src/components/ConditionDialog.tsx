import { useEffect, useRef } from 'react';

import type { Condition } from '../api/conditions';
import { ConditionForm } from './ConditionForm';
import type { ConditionFormStyles } from './ConditionForm';
import { PanelClose, panelEscape } from './PanelClose';
import styles from './Dialog.module.css';
import { t } from '../i18n';

export interface ConditionDialogProps {
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
  /** Null creates one; a condition edits it. */
  condition: Condition | null;
  /**
   * What a new condition starts as, when something else decided that for it.
   *
   * Passed straight to the form, which is where it means something.
   */
  preset?: { functionId: string } | null;
  onClose: () => void;
  onSaved: (condition: Condition) => void;
  onDeleted?: () => void;
}

/** The dialog's own names for what the form needs. */
const FORM_STYLES: ConditionFormStyles = {
  // The padding belongs to the panel around it, which also holds the title.
  body: styles.fields,
  fields: styles.fields,
  field: styles.field,
  labelRow: styles.labelRow,
  label: styles.label,
  jump: styles.jump,
  input: styles.input,
  select: styles.select,
  inputWrapper: styles.inputWrapper,
  inputMono: styles.inputMono,
  fieldHint: styles.fieldHint,
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
  actions: styles.actions,
  danger: styles.danger,
  ghost: styles.ghost,
  filled: styles.filled,
};

/**
 * Create Condition, and the same form again for a condition that exists, where
 * something already on the screen is the reason for asking.
 *
 * The conditions list no longer opens this - a condition has its own page now
 * (issue #87), which survives a reload and can be linked to. What is left is
 * the places where a page would be the wrong answer: a workflow node's panel,
 * where the graph is the reason somebody is reading the condition at all; a
 * trigger or an action being written, where the condition is one field of a
 * form that has not been saved; and a combining condition asking for a member
 * it does not have yet.
 *
 * The form is mounted only while this is open, and keyed by which condition it
 * holds, which is what resets it: it reads its fields as it mounts, so the next
 * Create Condition starts empty without anything having to empty it.
 */
export function ConditionDialog({
  open,
  workspaceId,
  condition,
  preset = null,
  onClose,
  onSaved,
  onDeleted,
  placement = 'modal',
}: ConditionDialogProps) {
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
      className={`${styles.dialog} ${placement === 'panel' ? styles.dialogPanel : ''}`}
      onCancel={onClose}
      onClose={onClose}
      onKeyDown={panelEscape(placement, onClose)}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>{condition === null ? t('Create Condition') : t('Condition Settings')}</h2>
          {placement === 'panel' && <PanelClose onClose={onClose} />}
        </header>

        <p className={styles.dialogMessage}>
          {t('Define a reusable condition for workflow branching.')}
        </p>

        {open && (
          <ConditionForm
            key={condition?.id ?? 'new'}
            workspaceId={workspaceId}
            condition={condition}
            preset={preset}
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
