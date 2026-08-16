import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import alertTriangleIcon from '../assets/alert-triangle.svg';
import trash2Icon from '../assets/trash-2.svg';
import styles from './Dialog.module.css';

export type WorkflowConfirmKind = 'disable' | 'remove';

export interface WorkflowConfirmDialogProps {
  /** The workflow name to confirm against, or null when closed. */
  workflowName: string | null;
  kind: WorkflowConfirmKind;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * The disable and remove modals share a layout and differ only in icon, accent
 * and copy, so they are one component.
 */
export function WorkflowConfirmDialog({ workflowName, kind, onClose, onConfirm }: WorkflowConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (workflowName !== null && !dialog.open) {
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (workflowName === null && dialog.open) {
      dialog.close();
    }
  }, [workflowName]);

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

  const name = <strong>&quot;{workflowName}&quot;</strong>;
  const copy: Record<WorkflowConfirmKind, { title: string; message: ReactNode; button: string }> = {
    disable: {
      title: 'Disable workflow',
      message: (
        <>
          Are you sure you want to disable {name}? Active executions will continue but no new ones will be
          triggered.
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
  };

  const { title, message, button } = copy[kind];

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
        </header>

        <div className={styles.warning}>
          <span className={kind === 'disable' ? styles.warningBadgeAmber : styles.warningBadge}>
            <img src={kind === 'disable' ? alertTriangleIcon : trash2Icon} alt="" width={18} height={18} />
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
            className={kind === 'disable' ? styles.amber : styles.destructive}
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
