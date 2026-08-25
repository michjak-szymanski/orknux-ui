import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { checkShell, fetchShells, setShellEnabled, shellStatusLabel } from '../../api/shell';
import type { Shell, ShellStatus } from '../../api/shell';
import type { SessionUser } from '../../api/session';
import plusIcon from '../../assets/plus.svg';
import settingsIcon from '../../assets/settings.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { shellUser } from '../../session/user';
import styles from './AdminShellPage.module.css';
import { t } from '../../i18n';

export interface AdminShellPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** Green once the machine answered, red when a check failed, grey until then. */
function statusDot(status: ShellStatus): string {
  switch (status) {
    case 'CONNECTED':
      return styles.dotConnected;
    case 'FAILED':
      return styles.dotFailed;
    default:
      return styles.dotIdle;
  }
}

/**
 * The machines this installation can run commands on.
 *
 * The status on each row is a real connection rather than a note about whether
 * somebody filled the form in: a handshake, the key accepted, and a command
 * actually run. A host that answers on port 22 and refuses every account reads
 * as unreachable here, which is the failure this column exists to catch, and
 * hovering a row says what the machine said.
 */
export function AdminShellPage({ session, onSignOut }: AdminShellPageProps) {
  const [shells, setShells] = useState<Shell[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchShells()
      .then((result) => {
        setShells(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setShells(null);
        setError(cause instanceof Error ? cause.message : t('Could not load the shells.'));
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  /** Replaces one row rather than reloading, so the others do not flicker. */
  function replace(updated: Shell) {
    setShells((current) =>
      current === null ? current : current.map((shell) => (shell.id === updated.id ? updated : shell)),
    );
  }

  async function toggle(shell: Shell) {
    if (busy !== null) return;
    setBusy(shell.id);
    setError(null);
    try {
      replace(await setShellEnabled(shell.id, !shell.enabled));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not change the shell.'));
    } finally {
      setBusy(null);
    }
  }

  async function check(shell: Shell) {
    if (busy !== null) return;
    setBusy(shell.id);
    setError(null);
    try {
      replace(await checkShell(shell.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not check that machine.'));
    } finally {
      setBusy(null);
    }
  }

  const listed = shells ?? [];

  return (
    <AppShell
      user={shellUser(session)}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="shell" />}
    >
      <header className={styles.titleBar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            <span className={styles.titleWithHint}>
              {t('Shell')}
              {/*
                Was the footer under the table, and the ⓘ beside it was a second
                convention for the job the (?) already does.
              */}
              <FieldHint label={t('Shell')}>
                {t('What contains a shell is the machine on the other end and the account you named on it - there is no list of forbidden commands here, because reading a shell command and saying what it will do is not something that can be done reliably, and a list that is nearly right would only tell you that you are protected when you are not. Point these at virtual machines or containers you are willing to lose. Keys are stored encrypted and are never shown again, and every command an agent runs is written down under its own name in the audit log.')}
              </FieldHint>
            </span>
          </h1>
          <p className={styles.subtitle}>
            {t('Machines this installation can run commands on, over SSH. An agent given the shells asks for one of these, works in a directory of its own on it, and everything it runs is in the audit log.')}
          </p>
        </div>
        <Link className={styles.addShell} to="/admin/shell/new">
          <img src={plusIcon} alt="" width={14} height={14} />
          {t('Add Shell')}
        </Link>
      </header>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <div className={styles.colStatus}>{t('Status')}</div>
          <div className={styles.colName}>{t('Name')}</div>
          <div className={styles.colAddress}>{t('Address')}</div>
          <div className={styles.colKey}>{t('Key')}</div>
          <div className={styles.colEnabled}>{t('On')}</div>
          <div className={styles.colActions} />
        </div>

        {loading && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {!loading && error === null && listed.length === 0 && (
          <p className={styles.notice}>
            {t('No shells yet. Until there is one, an agent given the shells has nowhere to run.')}
          </p>
        )}

        {listed.map((shell) => (
          <div className={styles.row} key={shell.id}>
            <div
              className={styles.colStatus}
              title={shell.lastCheckMessage ?? t('Nothing has reached this machine yet')}
            >
              <span className={statusDot(shell.status)} aria-hidden="true" />
              <span className={styles.statusLabel}>{shellStatusLabel(shell.status)}</span>
            </div>
            <div className={styles.colName}>
              <span className={`${styles.name} ${shell.enabled ? '' : styles.nameDisabled}`}>
                {shell.name}
              </span>
              {shell.hostKey !== null && (
                <span className={styles.fingerprint} title={shell.hostKey}>
                  {shell.hostKey}
                </span>
              )}
            </div>
            <div className={styles.colAddress}>
              {/*
                The account it will actually connect as, which is not always one
                somebody typed: a shell with no username runs as the account this
                server runs as, the same as `ssh build.internal` does. Shown
                rather than left off, because the whole of the privilege question
                is which account it is, and a row that answered it only for some
                shells would be a row nobody could read.
              */}
              <span
                className={styles.address}
                title={
                  shell.username === null
                    ? `No account was named, so commands run as ${shell.account} - the account this server itself runs as`
                    : undefined
                }
              >
                {shell.account}@{shell.host}:{shell.port}
              </span>
            </div>
            <div className={styles.colKey}>
              <span className={styles.keyState}>
                {shell.privateKeySet
                  ? shell.passphraseSet
                    ? t('Stored, with a passphrase')
                    : 'Stored'
                  : 'None'}
              </span>
            </div>
            <div className={styles.colEnabled}>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => void toggle(shell)}
                disabled={busy !== null}
                role="switch"
                aria-checked={shell.enabled}
                aria-label={`${shell.enabled ? 'Disable' : 'Enable'} ${shell.name}`}
                title={shell.enabled ? 'Disable' : 'Enable'}
              >
                <img
                  src={shell.enabled ? toggleOnIcon : toggleOffIcon}
                  alt=""
                  width={36}
                  height={20}
                  data-keeps-colour
                />
              </button>
            </div>
            <div className={styles.colActions}>
              <button
                type="button"
                className={styles.checkAction}
                onClick={() => void check(shell)}
                disabled={busy !== null}
                title={t('Connect to this machine now and report what happened')}
              >
                {busy === shell.id ? 'Checking…' : 'Check'}
              </button>
              <Link
                className={styles.rowAction}
                to={`/admin/shell/${shell.id}`}
                aria-label={`Edit ${shell.name}`}
                title={t('Edit')}
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </div>
          </div>
        ))}
      </section>

    </AppShell>
  );
}
