import { useEffect, useRef } from 'react';

import type { Trigger } from '../api/triggers';
import { TriggerForm } from './TriggerForm';
import type { TriggerFormStyles } from './TriggerForm';
import styles from './Dialog.module.css';

export interface CreateTriggerDialogProps {
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
  onClose: () => void;
  onCreated: (trigger: Trigger) => void;
}

/** The dialog's own names for what the form needs. */
const FORM_STYLES: TriggerFormStyles = {
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
  inputWrapperTall: styles.inputWrapperTall,
  textarea: styles.textarea,
  inputMono: styles.inputMono,
  inputCron: styles.inputCron,
  prefix: styles.prefix,
  fieldHint: styles.fieldHint,
  message: styles.dialogMessage,
  error: styles.error,
  actions: styles.actions,
  ghost: styles.ghost,
  filled: styles.filled,
};

/**
 * Create Trigger, from the trigger list.
 *
 * Only creating: a trigger that exists has a page of its own, which is where
 * everything about it is changed. A modal is right for the one moment when there
 * is nothing to look at yet, and wrong for the settings of something real —
 * those want a URL, room, and somewhere to keep a Danger Zone.
 *
 * The form is mounted only while this is open, which is what resets it: it reads
 * its fields as it mounts, so the next Create Trigger starts empty without
 * anything having to empty it.
 */
export function CreateTriggerDialog({ open, workspaceId, onClose, onCreated, placement = 'modal' }: CreateTriggerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) if (placement === 'panel') dialog.show();
      else dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.dialogWide} ${styles.dialogWider} ${placement === 'panel' ? styles.dialogPanel : ''}`}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>Create Trigger</h2>
        </header>

        {open && (
          <TriggerForm
            workspaceId={workspaceId}
            styles={FORM_STYLES}
            onSaved={onCreated}
            onCancel={onClose}
          />
        )}
      </div>
    </dialog>
  );
}
