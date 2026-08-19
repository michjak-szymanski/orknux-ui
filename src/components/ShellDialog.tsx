import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { createShell, deleteShell, updateShell } from '../api/shell';
import type { Shell } from '../api/shell';
import styles from './Dialog.module.css';

export interface ShellDialogProps {
  /** True to add a shell; a shell to edit the one given. */
  open: boolean | Shell;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Adds, edits and deletes one shell.
 *
 * The key field is write-only, the same as every other credential on this
 * platform: the server never sends one back, so the box starts empty on an edit
 * and the hint beside it says what leaving it empty means. Typing nothing keeps
 * what is stored, which is what somebody editing a port expects; clearing a key
 * has to be asked for on purpose.
 */
export function ShellDialog({ open, onClose, onSaved }: ShellDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editing = typeof open === 'object' ? open : null;

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [forgetHostKey, setForgetHostKey] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open !== false && !dialog.open) {
      setName(editing?.name ?? '');
      setHost(editing?.host ?? '');
      setPort(editing === null ? '22' : String(editing.port));
      setUsername(editing?.username ?? '');
      setPrivateKey('');
      setPassphrase('');
      setClearKey(false);
      setForgetHostKey(false);
      setConfirmingDelete(false);
      setSubmitting(false);
      setError(null);
      dialog.showModal();
    } else if (open === false && dialog.open) {
      dialog.close();
    }
    // `editing` is derived from `open`, so one dependency is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const portNumber = Number(port);
  const complete =
    name.trim() !== '' &&
    host.trim() !== '' &&
    username.trim() !== '' &&
    Number.isInteger(portNumber) &&
    portNumber > 0 &&
    portNumber < 65536;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || submitting) return;
    setSubmitting(true);
    setError(null);

    /*
     * An absent key means "leave it alone" and an empty one means "clear it",
     * so the field being blank cannot be sent as it stands - it would wipe the
     * key every time somebody edited a port.
     */
    const key = clearKey ? '' : privateKey !== '' ? privateKey : undefined;
    const secret = clearKey ? '' : passphrase !== '' ? passphrase : undefined;

    try {
      const input = {
        name: name.trim(),
        host: host.trim(),
        port: portNumber,
        username: username.trim(),
        ...(key === undefined ? {} : { privateKey: key }),
        ...(secret === undefined ? {} : { keyPassphrase: secret }),
        ...(forgetHostKey ? { forgetHostKey: true } : {}),
      };
      if (editing === null) {
        await createShell(input);
      } else {
        await updateShell(editing.id, input);
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the shell.');
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (editing === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteShell(editing.id);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the shell.');
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.dialogWide}`}
      onCancel={onClose}
      onClose={onClose}
    >
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{editing === null ? 'Add Shell' : 'Edit Shell'}</h2>
        </header>
        <p className={styles.dialogMessage}>
          An SSH target an agent can be given. What contains it is this machine and the account you
          name on it - point it at a virtual machine or a container you are willing to lose.
        </p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="shell-name">
              Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="shell-name"
                name="shellName"
                className={styles.input}
                type="text"
                placeholder="e.g. build box"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="shell-host">
              Host
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="shell-host"
                name="shellHost"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder="build.internal"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                required
              />
            </div>
            <p className={styles.fieldHint}>
              A host name or address, without a scheme. Changing it forgets the host key this shell
              was first seen with, because that key was about a different machine.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="shell-port">
              Port
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="shell-port"
                name="shellPort"
                className={styles.input}
                type="number"
                min={1}
                max={65535}
                placeholder="22"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="shell-username">
              Username
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="shell-username"
                name="shellUsername"
                className={styles.input}
                type="text"
                placeholder="orknux"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
            <p className={styles.fieldHint}>
              The account commands run as. Whatever this account can do, an agent given the shells
              can do - so give it the least that is useful.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="shell-key">
              Private key
            </label>
            <div className={styles.inputWrapper}>
              <textarea
                id="shell-key"
                name="shellKey"
                className={`${styles.textarea} ${styles.inputMono}`}
                rows={6}
                placeholder={
                  editing?.privateKeySet === true
                    ? 'Stored; paste a key to replace it'
                    : '-----BEGIN OPENSSH PRIVATE KEY-----'
                }
                value={privateKey}
                onChange={(event) => {
                  setPrivateKey(event.target.value);
                  setClearKey(false);
                }}
                disabled={clearKey}
              />
            </div>
            <p className={styles.fieldHint}>
              OpenSSH or PEM. Stored encrypted and never shown again; leaving this empty keeps
              whatever is already stored. Its matching public key has to be in the account&apos;s
              authorized_keys on the far side.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="shell-passphrase">
              Key passphrase
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="shell-passphrase"
                name="shellPassphrase"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                placeholder={editing?.passphraseSet === true ? 'Stored; type to replace' : 'Optional'}
                value={passphrase}
                onChange={(event) => {
                  setPassphrase(event.target.value);
                  setClearKey(false);
                }}
                disabled={clearKey}
              />
            </div>
          </div>

          {editing?.privateKeySet === true && (
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={clearKey}
                onChange={(event) => {
                  setClearKey(event.target.checked);
                  if (event.target.checked) {
                    setPrivateKey('');
                    setPassphrase('');
                  }
                }}
              />
              <span>
                Remove the stored key
                <span className={styles.checkboxHint}>
                  Nothing can connect to this machine until another is pasted in
                </span>
              </span>
            </label>
          )}

          {/*
            The way past a host key mismatch, and deliberately a thing somebody
            has to tick. A machine that answers with a different key than it did
            last time has either been rebuilt or is not that machine, and only a
            person can tell those apart.
          */}
          {editing !== null && editing.hostKey !== null && (
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={forgetHostKey}
                onChange={(event) => setForgetHostKey(event.target.checked)}
              />
              <span>
                Forget the host key
                <span className={styles.checkboxHint}>
                  {editing.hostKey} - the next connection will trust whatever answers and record
                  that instead. Tick this after rebuilding the machine.
                </span>
              </span>
            </label>
          )}
        </div>

        {confirmingDelete && (
          <p className={styles.warningMessage}>
            Delete <strong>{editing?.name}</strong>? Any sessions still open on it are closed first
            and their working directories destroyed.
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
              <button
                type="button"
                className={styles.destructive}
                onClick={() => void handleDelete()}
                disabled={submitting}
              >
                {submitting ? 'Deleting…' : 'Delete Shell'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className={styles.filled} disabled={!complete || submitting}>
                {submitting ? 'Saving…' : editing === null ? 'Add Shell' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
