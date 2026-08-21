import { useEffect, useRef } from 'react';

import type { Trigger } from '../api/triggers';
import { TriggerForm } from './TriggerForm';
import type { TriggerFormStyles } from './TriggerForm';
import { PanelClose, panelEscape } from './PanelClose';
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
  /** Null makes one; a trigger opens it as it stands, with its type fixed. */
  trigger?: Trigger | null;
  onClose: () => void;
  /** What was made, or what was saved. */
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
 * Create Trigger, from the trigger list — and the same form again for a trigger
 * that exists, where the frame around it is a panel rather than a modal.
 *
 * A modal still only creates: settings for something real want a URL, room, and
 * somewhere to keep a Danger Zone, which is what the trigger's own page is for.
 * Beside a workflow graph the bargain is different — the reason somebody is
 * reading a trigger there is the node in front of them, and a page would take
 * that off the screen to show a form this one already holds.
 *
 * The form is mounted only while this is open, and keyed by which trigger it
 * holds, which is what resets it: it reads its fields as it mounts, so the next
 * Create Trigger starts empty without anything having to empty it.
 */
export function CreateTriggerDialog({ open, workspaceId, trigger = null, onClose, onCreated, placement = 'modal' }: CreateTriggerDialogProps) {
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
      onKeyDown={panelEscape(placement, onClose)}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>{trigger === null ? 'Create Trigger' : 'Trigger Settings'}</h2>
          {placement === 'panel' && <PanelClose onClose={onClose} />}
        </header>

        {open && (
          <TriggerForm
            key={trigger?.id ?? 'new'}
            workspaceId={workspaceId}
            trigger={trigger}
            styles={FORM_STYLES}
            onSaved={onCreated}
            onCancel={onClose}
          />
        )}
      </div>
    </dialog>
  );
}
