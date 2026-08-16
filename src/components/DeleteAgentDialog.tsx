import { useEffect, useRef, useState } from 'react';

import { deleteAgent } from '../api/agents';
import type { Agent } from '../api/agents';
import trashIcon from '../assets/trash-18.svg';
import styles from './Dialog.module.css';

export interface DeleteAgentDialogProps {
  /** The agent to delete, or null when the dialog is closed. */
  agent: Agent | null;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * The frame deletes straight from the Danger Zone button; deleting an agent
 * cannot be undone from the UI, so it is confirmed first.
 */
export function DeleteAgentDialog({ agent, onClose, onDeleted }: DeleteAgentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (agent !== null && !dialog.open) {
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (agent === null && dialog.open) {
      dialog.close();
    }
  }, [agent]);

  async function handleDelete() {
    if (agent === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteAgent(agent.id);
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the agent.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>Delete Agent</h2>
        </header>

        <div className={styles.warning}>
          <span className={styles.warningBadge}>
            <img src={trashIcon} alt="" width={18} height={18} />
          </span>
          <p className={styles.warningMessage}>
            Are you sure you want to delete <strong>&quot;{agent?.name}&quot;</strong>? This permanently removes
            the agent and its configuration.
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
            {submitting ? 'Deleting…' : 'Delete Agent'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
