import { useEffect, useRef, useState } from 'react';

import { deleteWorkspace } from '../api/workspaces';
import type { Workspace } from '../api/workspaces';
import trashIcon from '../assets/trash-18.svg';
import { forgetWorkspaces } from '../session/workspaces';
import styles from './Dialog.module.css';

export interface DeleteWorkspaceDialogProps {
  /** The workspace to delete, or null when the dialog is closed. */
  workspace: Workspace | null;
  onClose: () => void;
  onDeleted: (workspace: Workspace) => void;
}

export function DeleteWorkspaceDialog({ workspace, onClose, onDeleted }: DeleteWorkspaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (workspace !== null && !dialog.open) {
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (workspace === null && dialog.open) {
      dialog.close();
    }
  }, [workspace]);

  async function handleDelete() {
    if (workspace === null || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await deleteWorkspace(workspace.id);
      // Otherwise the selector keeps offering a workspace that is gone.
      forgetWorkspaces();
      onDeleted(workspace);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the workspace.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>Delete Workspace</h2>
        </header>

        <div className={styles.warning}>
          <span className={styles.warningBadge}>
            <img src={trashIcon} alt="" width={18} height={18} />
          </span>
          <p className={styles.warningMessage}>
            Are you sure you want to delete workspace <strong>&quot;{workspace?.name}&quot;</strong>? This action cannot be
            undone.
          </p>
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
            className={styles.destructive}
            onClick={handleDelete}
            disabled={submitting}
            autoFocus
          >
            {submitting ? 'Deleting…' : 'Delete workspace'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
