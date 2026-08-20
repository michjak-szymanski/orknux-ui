import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { createShell, deleteShell, fetchShell, shellStatusLabel, updateShell } from '../../api/shell';
import type { Shell } from '../../api/shell';
import type { SessionUser } from '../../api/session';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { Loader } from '../../components/Loader';
import { shellUser } from '../../session/user';
import styles from './AdminShellSettingsPage.module.css';

export interface AdminShellSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * One machine: written here for the first time, or edited here afterwards.
 *
 * A page rather than the dialog this used to be. What decides between the two
 * on this platform is not how many fields there are but whether the thing is
 * being *made*: a dialog asks one question about something that already exists
 * and hands the answer back to the list behind it, which is what MoveIssueDialog
 * does. This form creates a machine, holds a private key somebody has to paste
 * out of another window, and carries a host key fingerprint they may want to
 * compare against `ssh-keygen -lf` on the machine itself - none of which
 * survives a modal being dismissed by a stray click on the backdrop, and none of
 * which has an address to come back to. A page has one, so a half-written shell
 * can be left and returned to and pointed at by somebody else.
 *
 * Modelled on the provider page, which is the same shape in every respect that
 * matters: add and edit through one form, a credential that is written but never
 * read back, and a danger zone for removing the thing. The route follows the
 * users page in this same section - `/admin/shell/new` alongside
 * `/admin/shell/:shellId` - because that is how every other admin list opens one
 * of its rows.
 *
 * The key field is write-only, the same as every other credential here: the
 * server never sends one back, so the box starts empty on an edit and the hint
 * beside it says what leaving it empty means. Typing nothing keeps what is
 * stored, which is what somebody editing a port expects; clearing a key has to
 * be asked for on purpose.
 */
export function AdminShellSettingsPage({ session, onSignOut }: AdminShellSettingsPageProps) {
  const { shellId } = useParams();
  const navigate = useNavigate();
  const adding = shellId === undefined;

  const [shell, setShell] = useState<Shell | null>(null);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [forgetHostKey, setForgetHostKey] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (shellId === undefined) return;
    let current = true;
    fetchShell(shellId)
      .then((found) => {
        if (!current) return;
        if (found === null) {
          setLoadError('That shell no longer exists.');
          return;
        }
        setShell(found);
        setName(found.name);
        setHost(found.host);
        setPort(String(found.port));
        setUsername(found.username);
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : 'Could not load the shell.');
      });
    return () => {
      current = false;
    };
  }, [shellId]);

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
    if (!complete || saving) return;
    setSaving(true);
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
      if (adding) await createShell(input);
      else await updateShell(shellId, input);

      /*
       * Back to the list, whether the shell was made or edited. The list is
       * where the status dot and the Check button are, and the first thing
       * anybody wants after saving a machine is to find out whether it answers
       * - so leaving them on a form that cannot tell them would be sending
       * them somewhere with nothing left to do.
       */
      navigate('/admin/shell');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the shell.');
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (shellId === undefined || saving) return;
    setSaving(true);
    setError(null);
    try {
      await deleteShell(shellId);
      navigate('/admin/shell');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the shell.');
      setSaving(false);
    }
  }

  const called = adding ? 'Add Shell' : (shell?.name ?? '…');

  return (
    <AppShell
      title={adding ? 'New shell' : shell?.name}
      user={shellUser(session)}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="shell" />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to="/admin/shell" label="Shell" />
          <Link className={styles.crumbLink} to="/admin/shell">
            Shell
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{called}</span>
        </p>
        <h1 className={styles.pageTitle}>{called}</h1>
        <p className={styles.subtitle}>
          An SSH target an agent can be given. What contains it is the machine on the other end and
          the account you name on it - point it at a virtual machine or a container you are willing
          to lose.
        </p>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
          <Link className={styles.crumbLink} to="/admin/shell">
            Back to Shell
          </Link>
        </section>
      ) : !adding && shell === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Machine</h2>
            <div className={styles.divider} />

            <div className={styles.field}>
              <label className={styles.label} htmlFor="shell-name">
                Name <span className={styles.required}>*</span>
              </label>
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

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="shell-host">
                  Host <span className={styles.required}>*</span>
                </label>
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
                <p className={styles.hint}>
                  A host name or address, without a scheme. Changing it forgets the host key this
                  shell was first seen with, because that key was about a different machine.
                </p>
              </div>

              <div className={styles.fieldNarrow}>
                <label className={styles.label} htmlFor="shell-port">
                  Port <span className={styles.required}>*</span>
                </label>
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

            {/*
              The way past a host key mismatch, and deliberately a thing somebody
              has to tick. A machine that answers with a different key than it did
              last time has either been rebuilt or is not that machine, and only a
              person can tell those apart.
            */}
            {shell !== null && shell.hostKey !== null && (
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={forgetHostKey}
                  onChange={(event) => setForgetHostKey(event.target.checked)}
                />
                <span>
                  Forget the host key
                  <span className={styles.checkboxHint}>
                    {shell.hostKey} - the next connection will trust whatever answers and record
                    that instead. Tick this after rebuilding the machine.
                  </span>
                </span>
              </label>
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Account</h2>
            <div className={styles.divider} />

            <div className={styles.field}>
              <label className={styles.label} htmlFor="shell-username">
                Username <span className={styles.required}>*</span>
              </label>
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
              <p className={styles.hint}>
                The account commands run as. Whatever this account can do, an agent given the shells
                can do - so give it the least that is useful.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="shell-key">
                Private key
              </label>
              <textarea
                id="shell-key"
                name="shellKey"
                className={`${styles.input} ${styles.inputMono} ${styles.textarea}`}
                rows={6}
                placeholder={
                  shell?.privateKeySet === true
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
              <p className={styles.hint}>
                OpenSSH or PEM. Stored encrypted and never shown again; leaving this empty keeps
                whatever is already stored. Its matching public key has to be in the account&apos;s
                authorized_keys on the far side.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="shell-passphrase">
                Key passphrase
              </label>
              <input
                id="shell-passphrase"
                name="shellPassphrase"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                placeholder={shell?.passphraseSet === true ? 'Stored; type to replace' : 'Optional'}
                value={passphrase}
                onChange={(event) => {
                  setPassphrase(event.target.value);
                  setClearKey(false);
                }}
                disabled={clearKey}
              />
            </div>

            {shell?.privateKeySet === true && (
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
          </section>

          <div className={styles.footer}>
            <div className={styles.status}>
              {error !== null ? (
                <span className={styles.statusFailed} role="alert">
                  {error}
                </span>
              ) : (
                /* What the last check found, in the machine's own words. */
                shell !== null && (
                  <>
                    <span
                      className={`${styles.dot} ${
                        shell.status === 'CONNECTED'
                          ? styles.dotConnected
                          : shell.status === 'FAILED'
                            ? styles.dotFailed
                            : styles.dotIdle
                      }`}
                      aria-hidden="true"
                    />
                    <span
                      className={
                        shell.status === 'CONNECTED'
                          ? styles.statusConnected
                          : shell.status === 'FAILED'
                            ? styles.statusFailed
                            : styles.statusIdle
                      }
                    >
                      {shell.lastCheckMessage ?? shellStatusLabel(shell.status)}
                    </span>
                  </>
                )
              )}
            </div>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => navigate('/admin/shell')}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className={styles.primaryButton} disabled={!complete || saving}>
                {saving ? 'Saving…' : adding ? 'Add Shell' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/*
        Removing a machine still asks twice. The dialog did, and the reason has
        not changed with the shape of the screen: this closes every session open
        on the far side and destroys the directories they were working in, which
        is not recoverable by anybody.
      */}
      {!adding && loadError === null && shell !== null && (
        <section className={styles.dangerCard}>
          <h2 className={styles.dangerHeading}>Danger Zone</h2>
          <div className={styles.divider} />
          <div className={styles.dangerRow}>
            <div className={styles.dangerText}>
              <span className={styles.dangerTitle}>Delete Shell</span>
              <span className={styles.dangerNote}>
                {confirmingDelete
                  ? `Delete ${shell.name}? Any sessions still open on it are closed first and their working directories destroyed.`
                  : 'Remove this machine, and everything on it that belonged to a session'}
              </span>
            </div>
            {confirmingDelete ? (
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setConfirmingDelete(false)}
                  disabled={saving}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void handleDelete()}
                  disabled={saving}
                >
                  {saving ? 'Deleting…' : 'Delete Shell'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => setConfirmingDelete(true)}
                disabled={saving}
              >
                Delete Shell
              </button>
            )}
          </div>
        </section>
      )}
    </AppShell>
  );
}
