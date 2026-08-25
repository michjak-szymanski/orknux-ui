import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { createWorkspace } from '../api/workspaces';
import type { Workspace } from '../api/workspaces';
import { forgetWorkspaces } from '../session/workspaces';
import styles from './Dialog.module.css';
import { t } from '../i18n';

export interface CreateWorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (workspace: Workspace) => void;
}

/**
 * The Figma popups frame covers rename and delete only; this follows the same
 * chrome so the three dialogs read as one family.
 */
export function CreateWorkspaceDialog({ open, onClose, onCreated }: CreateWorkspaceDialogProps) {
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
      dialog.showModal();
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
      const workspace = await createWorkspace({ name: name.trim(), description: description.trim() || undefined });
      // The selector caches the list; without this the new workspace is missing
      // from it until the tab is reloaded.
      forgetWorkspaces();
      onCreated(workspace);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not create the workspace.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t('Create Workspace')}</h2>
        </header>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="create-workspace-name">
            {t('Workspace name')}
          </label>
          <div className={styles.inputWrapper}>
            <input
              id="create-workspace-name"
              name="workspaceName"
              className={styles.input}
              type="text"
              placeholder="platform"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="create-workspace-description">
            {t('Description')}
          </label>
          <div className={styles.inputWrapper}>
            <textarea
              id="create-workspace-description"
              name="workspaceDescription"
              className={`${styles.input} ${styles.textarea}`}
              rows={3}
              placeholder={t('What this workspace owns.')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
            {t('Cancel')}
          </button>
          <button type="submit" className={styles.filled} disabled={name.trim() === '' || submitting}>
            {submitting ? t('Creating…') : t('Create Workspace')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
