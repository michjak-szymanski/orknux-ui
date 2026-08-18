import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import styles from './Dialog.module.css';

export interface NameDialogProps {
  /**
   * Whether this stands over the page or beside it.
   *
   * A modal is right when what somebody is doing has nothing to do with what
   * is behind it; making a component for the node they are editing is the
   * opposite, so the workflow editor asks for a panel and keeps its graph.
   */
  placement?: 'modal' | 'panel';
  open: boolean;
  title: string;
  /** One line under the title saying what is being made. */
  message: string;
  nameLabel: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  submitLabel: string;
  onClose: () => void;
  /** Throwing shows the reason in the dialog and leaves it open. */
  onSubmit: (name: string, description: string) => Promise<void>;
}

/**
 * Asks for a name and a description, and nothing else.
 *
 * Tools and skills are both edited on a page of their own, but they need a name
 * before there is anything to open — the name is the identity. So this is the
 * step between the list's Create button and the editor.
 */
export function NameDialog({
  open,
  title,
  message,
  nameLabel,
  namePlaceholder,
  descriptionPlaceholder,
  submitLabel,
  onClose,
  onSubmit, placement = 'modal' }: NameDialogProps) {
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
      await onSubmit(name.trim(), description.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create it.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${placement === 'panel' ? styles.dialogPanel : ''}`} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
        </header>

        <p className={styles.dialogMessage}>{message}</p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-name">
              {nameLabel}
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="new-name"
                name="name"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder={namePlaceholder}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-description">
              Description
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="new-description"
                name="description"
                className={styles.input}
                type="text"
                placeholder={descriptionPlaceholder}
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
            {submitting ? 'Creating…' : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
