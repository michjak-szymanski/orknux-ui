import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { createWorkflow } from '../api/workflows';
import type { WorkspaceWorkflow } from '../api/workflows';
import styles from './Dialog.module.css';
import { t } from '../i18n';

export interface CreateWorkflowDialogProps {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (workflow: WorkspaceWorkflow) => void;
}

export function CreateWorkflowDialog({ open, workspaceId, onClose, onCreated }: CreateWorkflowDialogProps) {
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
      onCreated(
        await createWorkflow({ workspaceId, name: name.trim(), description: description.trim() || undefined }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not create the workflow.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.dialogWide}`} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t('Create workflow')}</h2>
        </header>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="create-workflow-name">
              {t('Workflow name')}
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="create-workflow-name"
                name="workflowName"
                className={styles.input}
                type="text"
                placeholder={t('e.g. Backend CI/CD Pipeline')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="create-workflow-description">
              {t('Description')}
            </label>
            <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
              <textarea
                id="create-workflow-description"
                name="workflowDescription"
                className={`${styles.input} ${styles.textarea}`}
                placeholder={t('Describe this workflow...')}
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
            {t('Cancel')}
          </button>
          <button type="submit" className={styles.filled} disabled={name.trim() === '' || submitting}>
            {submitting ? t('Creating…') : 'Create'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
