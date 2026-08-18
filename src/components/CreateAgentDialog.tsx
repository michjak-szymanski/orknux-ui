import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { createAgent } from '../api/agents';
import type { Agent } from '../api/agents';
import styles from './Dialog.module.css';

export interface CreateAgentDialogProps {
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
  onCreated: (agent: Agent) => void;
}

/** No frame exists for this one; it follows the create-workflow modal. */
export function CreateAgentDialog({ open, workspaceId, onClose, onCreated, placement = 'modal' }: CreateAgentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      setName('');
      setDescription('');
      setError(null);
      setSubmitting(false);
      if (placement === 'panel') dialog.show();
      else dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '' || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      onCreated(
        await createAgent({ workspaceId, name: name.trim(), type: 'LLM', description: description.trim() || undefined }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the agent.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.dialogWide} ${placement === 'panel' ? styles.dialogPanel : ''}`} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>Create agent</h2>
        </header>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="create-agent-name">
              Agent name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="create-agent-name"
                name="agentName"
                className={styles.input}
                type="text"
                placeholder="e.g. Research Agent"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="create-agent-description">
              Description
            </label>
            <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
              <textarea
                id="create-agent-description"
                name="agentDescription"
                className={`${styles.input} ${styles.textarea}`}
                placeholder="What this agent does."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
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
          <button type="submit" className={styles.filled} disabled={name.trim() === '' || submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
