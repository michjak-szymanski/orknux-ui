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

  const shellRow = (shell: Shell) => (
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
              {shell.kind === 'MCP' ? (
                // An MCP shell has no account or host of its own: its reach is
                // the tool server's, so the address column names that instead.
                <span className={styles.address}>
                  {t('MCP server #')}{shell.mcpServerId ?? '?'}
                </span>
              ) : (
                /*
                  The account it will actually connect as, which is not always
                  one somebody typed: a shell with no username runs as the
                  account this server runs as, the same as `ssh build.internal`.
                */
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
              )}
            </div>
            <div className={styles.colKey}>
              <span className={styles.keyState}>
                {shell.kind === 'MCP'
                  ? t('via the server')
                  : shell.privateKeySet
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
          </div>);

  const sshShells = listed.filter((shell) => shell.kind !== 'MCP');
  const mcpShells = listed.filter((shell) => shell.kind === 'MCP');

  const tableHead = (
    <div className={styles.tableHeader}>
      <div className={styles.colStatus}>{t('Status')}</div>
      <div className={styles.colName}>{t('Name')}</div>
      <div className={styles.colAddress}>{t('Address')}</div>
      <div className={styles.colKey}>{t('Key')}</div>
      <div className={styles.colEnabled}>{t('On')}</div>
      <div className={styles.colActions} />
    </div>
  );

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
              {t('Shells')}
              {/*
                Was the footer under the table, and the ⓘ beside it was a second
                convention for the job the (?) already does.
              */}
              <FieldHint label={t('Shells')}>
                {t('What contains a shell is the machine on the other end and the account you named on it - there is no list of forbidden commands here, because reading a shell command and saying what it will do is not something that can be done reliably, and a list that is nearly right would only tell you that you are protected when you are not. Point these at virtual machines or containers you are willing to lose. Keys are stored encrypted and are never shown again, and every command an agent runs is written down under its own name in the audit log.')}
              </FieldHint>
            </span>
          </h1>
          <p className={styles.subtitle}>
            {t('Machines this installation can run commands on. An agent given the shells asks for one - of either kind - works in a directory of its own on it, and everything it runs is in the audit log.')}
          </p>
        </div>
      </header>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t('SSH Shell')}</h2>
        <Link className={styles.addShell} to="/admin/shell/new">
          <img src={plusIcon} alt="" width={14} height={14} />
          {t('Add SSH Shell')}
        </Link>
      </div>

      <section className={styles.card}>
        {tableHead}

        {loading && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {!loading && error === null && sshShells.length === 0 && (
          <p className={styles.notice}>
            {t('No SSH shells yet. These reach a machine over SSH with a stored key.')}
          </p>
        )}

        {sshShells.map((shell) => shellRow(shell))}
      </section>

      {/*
        MCP shells below, as their own list. Same pool to an agent - the grant
        is "may open a shell", not a machine - but a different way in: a tool
        server on the box rather than sshd, registered on the Integrations page.
        Issue #337.
      */}
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t('MCP Shell')}</h2>
        <Link className={styles.addShell} to="/admin/shell/new-mcp">
          <img src={plusIcon} alt="" width={14} height={14} />
          {t('Add MCP Shell')}
        </Link>
      </div>

      <p className={styles.subtitle}>
        {t('A machine reached through a tool server installed on it rather than over SSH. We recommend')}{' '}
        <a href="https://github.com/wonderwhy-er/DesktopCommanderMCP" target="_blank" rel="noreferrer">
          DesktopCommander
        </a>
        {t('; register it on the Integrations page, then point an MCP shell at it here.')}
      </p>

      <section className={styles.card}>
        {tableHead}

        {!loading && error === null && mcpShells.length === 0 && (
          <p className={styles.notice}>
            {t('No MCP shells yet. Register a tool server on Integrations, then add one here.')}
          </p>
        )}

        {mcpShells.map((shell) => shellRow(shell))}
      </section>

    </AppShell>
  );
}
