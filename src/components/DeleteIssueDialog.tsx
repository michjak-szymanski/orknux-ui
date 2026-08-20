import { useEffect, useRef, useState } from 'react';

import { deleteIssue } from '../api/issues';
import type { Issue } from '../api/issues';
import trashIcon from '../assets/trash-18.svg';
import styles from './Dialog.module.css';

export interface DeleteIssueDialogProps {
  /** The issue to delete, or null when the dialog is closed. */
  issue: Issue | null;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * The page's trash button used to delete on the click that reached it.
 *
 * An issue takes its description, its comments and its whole history with it
 * and nothing in the UI brings any of that back, so the click asks first.
 */
export function DeleteIssueDialog({ issue, onClose, onDeleted }: DeleteIssueDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (issue !== null && !dialog.open) {
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (issue === null && dialog.open) {
      dialog.close();
    }
  }, [issue]);

  async function handleDelete() {
    if (issue === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteIssue(issue.id);
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the issue.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>Delete Issue</h2>
        </header>

        <div className={styles.warning}>
          <span className={styles.warningBadge}>
            <img src={trashIcon} alt="" width={18} height={18} />
          </span>
          {/*
            The number as well as the title: two issues in a workspace can read
            the same, and the number is what the person came here by.
          */}
          <p className={styles.warningMessage}>
            Are you sure you want to delete <strong>#{issue?.number} &quot;{issue?.title}&quot;</strong>? This
            permanently removes the issue with its comments, attachments and history.
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
            {submitting ? 'Deleting…' : 'Delete Issue'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
