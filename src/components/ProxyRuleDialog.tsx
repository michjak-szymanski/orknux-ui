import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { createProxyRule, deleteProxyRule, updateProxyRule } from '../api/networking';
import type { ProxyRule } from '../api/networking';
import styles from './Dialog.module.css';
import { FieldHint } from './FieldHint';

export interface ProxyRuleDialogProps {
  /** True to add a rule; a rule to edit the one given. */
  open: boolean | ProxyRule;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Adds, edits and deletes one proxy rule.
 *
 * The password field is write-only, the same as every other credential on this
 * platform: the server never sends one back, so the box starts empty on an edit
 * and the hint beside it says what leaving it empty means. Typing nothing keeps
 * what is stored, which is what somebody editing a pattern expects; clearing a
 * password has to be asked for on purpose.
 */
export function ProxyRuleDialog({ open, onClose, onSaved }: ProxyRuleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editing = typeof open === 'object' ? open : null;

  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open !== false && !dialog.open) {
      setName(editing?.name ?? '');
      setPattern(editing?.pattern ?? '');
      setProxyHost(editing?.proxyHost ?? '');
      setProxyPort(editing === null ? '' : String(editing.proxyPort));
      setUsername(editing?.username ?? '');
      setPassword('');
      setClearPassword(false);
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

  const port = Number(proxyPort);
  const complete =
    name.trim() !== '' &&
    pattern.trim() !== '' &&
    proxyHost.trim() !== '' &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || submitting) return;
    setSubmitting(true);
    setError(null);

    /*
     * An absent password means "leave it alone" and an empty one means "clear
     * it", so the field being blank cannot be sent as it stands - it would wipe
     * a password every time somebody edited a pattern.
     */
    const credential = clearPassword ? '' : password !== '' ? password : undefined;

    try {
      const input = {
        name: name.trim(),
        pattern: pattern.trim(),
        proxyHost: proxyHost.trim(),
        proxyPort: port,
        username: username.trim() === '' ? null : username.trim(),
        ...(credential === undefined ? {} : { password: credential }),
      };
      if (editing === null) {
        await createProxyRule(input);
      } else {
        await updateProxyRule(editing.id, input);
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the rule.');
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (editing === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteProxyRule(editing.id);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the rule.');
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
          <h2 className={styles.title}>{editing === null ? 'Add Proxy Rule' : 'Edit Proxy Rule'}</h2>
        </header>
        <p className={styles.dialogMessage}>
          Every request whose URL matches the pattern goes through this proxy. Everything else
          carries on going out the way it does now.
        </p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="proxy-rule-name">
              Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="proxy-rule-name"
                name="proxyRuleName"
                className={styles.input}
                type="text"
                placeholder="e.g. Entra ID"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.labelWithHint}>
              <label className={styles.label} htmlFor="proxy-rule-pattern">
                URL pattern
              </label>
              <FieldHint label="URL pattern">
                A regular expression, matched against the whole URL and found anywhere in it,
                ignoring case. Anchor it with ^ and $ to match the whole address.
              </FieldHint>
            </span>
            <div className={styles.inputWrapper}>
              <input
                id="proxy-rule-pattern"
                name="proxyRulePattern"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder="login\.microsoftonline\.com"
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.labelWithHint}>
              <label className={styles.label} htmlFor="proxy-rule-host">
                Proxy host
              </label>
              <FieldHint label="Proxy host">
                A host name, without a scheme. A proxy is spoken to over plain HTTP whatever the
                request going through it is.
              </FieldHint>
            </span>
            <div className={styles.inputWrapper}>
              <input
                id="proxy-rule-host"
                name="proxyRuleHost"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder="proxy.example.com"
                value={proxyHost}
                onChange={(event) => setProxyHost(event.target.value)}
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="proxy-rule-port">
              Proxy port
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="proxy-rule-port"
                name="proxyRulePort"
                className={styles.input}
                type="number"
                min={1}
                max={65535}
                placeholder="3128"
                value={proxyPort}
                onChange={(event) => setProxyPort(event.target.value)}
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="proxy-rule-username">
              Proxy username
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="proxy-rule-username"
                name="proxyRuleUsername"
                className={styles.input}
                type="text"
                placeholder="Optional"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="proxy-rule-password">
              Proxy password
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="proxy-rule-password"
                name="proxyRulePassword"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                placeholder={editing?.passwordSet === true ? 'Stored; type to replace' : 'Optional'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setClearPassword(false);
                }}
                disabled={clearPassword}
              />
            </div>
            {/*
              Printed rather than behind the (?). The first sentence is a
              consequence - there is no reading it back, so a password not kept
              elsewhere is gone - and the second is what an empty box means here,
              which is the difference between keeping a password and clearing it.
            */}
            <p className={styles.fieldHint}>
              Stored encrypted and never shown again. Leaving this empty keeps whatever is already
              stored.
            </p>
          </div>

          {editing?.passwordSet === true && (
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={clearPassword}
                onChange={(event) => {
                  setClearPassword(event.target.checked);
                  if (event.target.checked) setPassword('');
                }}
              />
              <span>
                Remove the stored password
                <span className={styles.checkboxHint}>The proxy will be called without one</span>
              </span>
            </label>
          )}
        </div>

        {confirmingDelete && (
          <p className={styles.warningMessage}>
            Delete <strong>{editing?.name}</strong>? Requests it matches will go out directly, which
            is what they did before it existed.
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
                {submitting ? 'Deleting…' : 'Delete Rule'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className={styles.filled} disabled={!complete || submitting}>
                {submitting ? 'Saving…' : editing === null ? 'Add Rule' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
