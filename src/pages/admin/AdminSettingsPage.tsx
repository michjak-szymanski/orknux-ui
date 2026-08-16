import { useEffect, useState } from 'react';

import { fetchInstallationSettings, setAttachmentsEnabled, setChatEnabled } from '../../api/installation';
import type { InstallationSettings } from '../../api/installation';
import type { SessionUser } from '../../api/session';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { forgetInstallation } from '../../session/installation';
import { shellUser } from '../../session/user';
import styles from './AdminSettingsPage.module.css';

export interface AdminSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * What this installation allows, for the whole organisation.
 *
 * Two kinds of setting live side by side here, and the difference is worth
 * seeing: a switch is something an administrator decides, and a value in grey is
 * something the operator decided in the configuration file. Where the file has
 * said no, the switch is not offered — it would be a control that cannot do what
 * it says.
 */
export function AdminSettingsPage({ session, onSignOut }: AdminSettingsPageProps) {
  const [settings, setSettings] = useState<InstallationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchInstallationSettings()
      .then(setSettings)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not read the settings.');
      });
  }, []);

  /** Every switch on this page saves the same way; only the mutation differs. */
  async function save(change: () => Promise<InstallationSettings>) {
    if (settings === null || busy) return;

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setSettings(await change());
      // The shell reads the same settings to decide whether to offer the Chat
      // tab, so it is told rather than left showing a link to a page that is off.
      forgetInstallation();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="admin"
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="settings" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Settings</h1>
            <p className={styles.subtitle}>What this installation allows, for every workspace in it.</p>
          </div>
        </header>

        {settings === null && error === null && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && (
          <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
            {error}
          </p>
        )}

        {settings !== null && (
          <>
            <h2 className={styles.sectionHeading}>Chat</h2>

            <div className={styles.setting}>
              <div className={styles.settingText}>
                <p className={styles.settingLabel}>Chat</p>
                <p className={styles.settingNote}>
                  {settings.chatConfigurable
                    ? 'Whether this installation has a chat. Off takes the tab away and refuses new messages; the conversations already had are kept.'
                    : 'Turned off in the configuration file, which is the operator’s decision: this cannot switch it back on.'}
                </p>
              </div>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => void save(() => setChatEnabled(!settings.chatEnabled))}
                disabled={busy || !settings.chatConfigurable}
                role="switch"
                aria-checked={settings.chatEnabled}
                aria-label={settings.chatEnabled ? 'Turn chat off' : 'Turn chat on'}
              >
                <img
                  src={settings.chatEnabled ? toggleOnIcon : toggleOffIcon}
                  alt=""
                  width={36}
                  height={20}
                  data-keeps-colour
                />
              </button>
            </div>

            <p className={styles.hint}>
              Set in the configuration file, under <code>orknux.chat</code>.
            </p>

            <h2 className={styles.sectionHeading}>Attachments</h2>

            <div className={styles.setting}>
              <div className={styles.settingText}>
                <p className={styles.settingLabel}>Files in chats</p>
                <p className={styles.settingNote}>
                  {settings.attachmentsConfigurable
                    ? 'Whether people may attach files to a chat. Off takes the button away; what has already been uploaded stays where it is.'
                    : 'Turned off in the configuration file, which is the operator’s decision: this cannot switch it back on.'}
                </p>
              </div>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => void save(() => setAttachmentsEnabled(!settings.attachmentsEnabled))}
                disabled={busy || !settings.attachmentsConfigurable}
                role="switch"
                aria-checked={settings.attachmentsEnabled}
                aria-label={settings.attachmentsEnabled ? 'Turn attachments off' : 'Turn attachments on'}
              >
                <img
                  src={settings.attachmentsEnabled ? toggleOnIcon : toggleOffIcon}
                  alt=""
                  width={36}
                  height={20}
                  data-keeps-colour
                />
              </button>
            </div>

            {/*
              The operator's half, read-only. A filesystem path is not something
              to hand a browser the ability to change — but somebody wondering
              where a file went should not have to read a container's YAML.
            */}
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt className={styles.factName}>Storage</dt>
                <dd className={styles.factValue}>{settings.attachmentStorage}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.factName}>Location</dt>
                <dd className={`${styles.factValue} ${styles.mono}`}>{settings.attachmentLocation}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.factName}>Largest file</dt>
                <dd className={styles.factValue}>{settings.attachmentMaxFileSizeMb} MB</dd>
              </div>
            </dl>
            <p className={styles.hint}>
              Set in the configuration file, under <code>orknux.attachments</code>. Each workspace keeps its
              files in its own directory beneath that location.
            </p>

            {saved && <p className={styles.saved}>Saved.</p>}
          </>
        )}
      </section>
    </AppShell>
  );
}
