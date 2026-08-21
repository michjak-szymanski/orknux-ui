import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import alertTriangleIcon from '../assets/alert-triangle.svg';
import trash2Icon from '../assets/trash-2.svg';
import styles from './Dialog.module.css';

export type ConfirmKind = 'disable' | 'remove' | 'discard' | 'deleteChat';

export interface ConfirmDialogProps {
  /** What is being acted on, named, or null when the dialog is closed. */
  subject: string | null;
  kind: ConfirmKind;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Asking before something cannot be undone.
 *
 * The modals share a layout and differ only in icon, accent and copy, so they
 * are one component. It was called `WorkflowConfirmDialog` and took a
 * `workflowName` while three of its four uses were workflows - then deleting a
 * chat turned out to ask nothing at all, and the choice was between a second
 * component of the same shape and a name that tells the truth. Two dialogs
 * doing one job is the drift this codebase keeps paying for, so it is one, and
 * what it confirms against is a `subject`.
 */
export function ConfirmDialog({ subject, kind, onClose, onConfirm }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (subject !== null && !dialog.open) {
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (subject === null && dialog.open) {
      dialog.close();
    }
  }, [subject]);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply the change.');
      setSubmitting(false);
    }
  }

  const name = <strong>&quot;{subject}&quot;</strong>;
  const copy: Record<ConfirmKind, { title: string; message: ReactNode; button: string }> = {
    disable: {
      title: 'Disable workflow',
      message: (
        <>
          Are you sure you want to disable {name}? Runs already going will finish, and nothing will start it
          by itself again - no trigger, no schedule, no tool call. Pressing Run yourself still works, so it can
          be tried while you fix it.
        </>
      ),
      button: submitting ? 'Disabling…' : 'Disable',
    },
    remove: {
      title: 'Remove workflow',
      message: (
        <>
          Are you sure you want to remove {name} from this workspace? This will not delete the workflow definition.
        </>
      ),
      button: submitting ? 'Removing…' : 'Remove',
    },
    deleteChat: {
      title: 'Delete chat',
      message: (
        <>
          Delete {name}? Every message in it goes with it, and there is no way back from this one.
        </>
      ),
      button: submitting ? 'Deleting…' : 'Delete',
    },
    discard: {
      title: 'Discard changes',
      message: (
        <>
          Put {name} back as it was last saved? Everything since — nodes, wiring, what each one passes — is
          lost, and there is no way back from this one.
        </>
      ),
      button: submitting ? 'Discarding…' : 'Discard',
    },
  };

  const { title, message, button } = copy[kind];

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
        </header>

        <div className={styles.warning}>
          <span className={kind === 'remove' || kind === 'deleteChat' ? styles.warningBadge : styles.warningBadgeAmber}>
            <img src={kind === 'remove' || kind === 'deleteChat' ? trash2Icon : alertTriangleIcon} alt="" width={18} height={18} />
          </span>
          <p className={styles.warningMessage}>{message}</p>
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className={kind === 'remove' || kind === 'deleteChat' ? styles.destructive : styles.amber}
            onClick={handleConfirm}
            disabled={submitting}
            autoFocus
          >
            {button}
          </button>
        </div>
      </div>
    </dialog>
  );
}
