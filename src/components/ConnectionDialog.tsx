import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { createConnection, deleteConnection, updateConnection } from '../api/integrations';
import type { Connection, ConnectionType } from '../api/integrations';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './Dialog.module.css';

export interface ConnectionDialogProps {
  /** True to add a default; a connection to edit the one given. */
  open: boolean | Connection;
  onClose: () => void;
  onSaved: (connection: Connection) => void;
}

/**
 * What can be created, which is what a connection can be used for.
 *
 * GitHub, Jira and Webhook are missing on purpose. Nothing sends through them and
 * nothing listens on them — so one could be created, tested, and then do nothing at
 * all, which is a worse answer than not offering it.
 *
 * Email is offered because a mail action sends through one. A default carries the
 * host and nothing else, which is the part a company's relay has in common across
 * every workspace; the login and the from-address are each workspace's own.
 *
 * They stay in the type and in the labels, because a connection created while they
 * were offered still has to name itself properly in the list.
 */
const TYPES: ConnectionType[] = ['SLACK', 'SMTP'];

const TYPE_LABELS: Record<ConnectionType, string> = {
  SLACK: 'Slack',
  SLACK_SOCKET_MODE: 'Slack (Socket Mode)',
  GITHUB: 'GitHub',
  JIRA: 'Jira',
  SMTP: 'Email (SMTP)',
  WEBHOOK: 'Webhook',
};

/** Add / Edit Default Connection, from the connection modals frame. */
export function ConnectionDialog({ open, onClose, onSaved }: ConnectionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editing = typeof open === 'object' ? open : null;

  const [name, setName] = useState('');
  const [type, setType] = useState<ConnectionType | ''>('');
  const [url, setUrl] = useState('');
  const [addToExistingWorkspaces, setAddToExistingWorkspaces] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open !== false && !dialog.open) {
      setName(editing?.name ?? '');
      setType(editing?.type ?? '');
      setUrl(editing?.url ?? '');
      setAddToExistingWorkspaces(false);
      setConfirmingDelete(false);
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (open === false && dialog.open) {
      dialog.close();
    }
    // `editing` is derived from `open`, so one dependency is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const complete = name.trim() !== '' && type !== '' && url.trim() !== '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || submitting) return;

    setSubmitting(true);
    setError(null);
    const input = { name: name.trim(), type, url: url.trim() };
    try {
      const saved =
        editing === null
          ? await createConnection({ ...input, addToExistingWorkspaces })
          : await updateConnection(editing.id, input);
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the connection.');
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (editing === null || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await deleteConnection(editing.id);
      onSaved(editing);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the connection.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.dialogWide}`} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{editing === null ? 'Add Default Connection' : 'Edit Default Connection'}</h2>
        </header>

        <p className={styles.dialogMessage}>
          {editing === null
            ? 'Define a connection that will be automatically assigned to new workspaces'
            : 'Update the default connection settings for all workspaces'}
        </p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="connection-name">
              Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="connection-name"
                name="connectionName"
                className={styles.input}
                type="text"
                placeholder="e.g. Production Slack"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="connection-type">
              Type
            </label>
            <div className={styles.inputWrapper}>
              <select
                id="connection-type"
                name="connectionType"
                className={`${styles.input} ${styles.select}`}
                value={type}
                onChange={(event) => setType(event.target.value as ConnectionType | '')}
                required
              >
                <option value="" disabled>
                  Select type...
                </option>
                {TYPES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {TYPE_LABELS[candidate]}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="connection-url">
              {/* A mail server is named, not addressed: there is no URL to type. */}
              {type === 'SMTP' ? 'Host' : 'URL'}
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="connection-url"
                name="connectionUrl"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder={type === 'SMTP' ? 'smtp.example.com' : 'https://'}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
            </div>
          </div>
          {editing === null && (
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                name="addToExistingWorkspaces"
                checked={addToExistingWorkspaces}
                onChange={(event) => setAddToExistingWorkspaces(event.target.checked)}
              />
              <span>
                Also add to existing workspaces
                <span className={styles.checkboxHint}>
                  Otherwise only workspaces created from now on receive it.
                </span>
              </span>
            </label>
          )}
        </div>

        {confirmingDelete && (
          <p className={styles.warningMessage}>
            Delete <strong>{editing?.name}</strong> from the admin defaults? Workspaces already using it keep
            their own copy, credentials included.
          </p>
        )}

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          {editing !== null && !confirmingDelete && (
            <button
              type="button"
              className={styles.destructiveGhost}
              onClick={() => setConfirmingDelete(true)}
              disabled={submitting}
            >
              Delete
            </button>
          )}
          {confirmingDelete ? (
            <>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => setConfirmingDelete(false)}
                disabled={submitting}
              >
                Keep
              </button>
              <button type="button" className={styles.destructive} onClick={handleDelete} disabled={submitting}>
                {submitting ? 'Deleting…' : 'Delete Connection'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className={styles.filled} disabled={!complete || submitting}>
                {submitting ? 'Saving…' : editing === null ? 'Add Connection' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
