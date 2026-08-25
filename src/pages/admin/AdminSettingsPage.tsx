import { useEffect, useState } from 'react';

import {
  fetchInstallationSettings,
  setAttachmentsEnabled,
  setChatEnabled,
  setMetricsAnonymous,
  setRevisionRetentionDays,
  setTaskMaxTurns,
} from '../../api/installation';
import type { InstallationSettings } from '../../api/installation';
import type { SessionUser } from '../../api/session';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { forgetInstallation } from '../../session/installation';
import { shellUser } from '../../session/user';
import styles from './AdminSettingsPage.module.css';
import { t } from '../../i18n';

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
  /**
   * What is typed in the retention box, as text.
   *
   * Kept apart from `settings` because a half-typed number is not a setting: a
   * field bound straight to the stored value cannot be cleared to type a new
   * one without saving an empty string on the way through.
   */
  const [retention, setRetention] = useState('');
  /** What is typed in the turns box, as text, for the same reason the retention is. */
  const [turns, setTurns] = useState('');

  useEffect(() => {
    fetchInstallationSettings()
      .then((held) => {
        setSettings(held);
        setRetention(String(held.revisionRetentionDays));
        setTurns(String(held.taskMaxTurns));
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : t('Could not read the settings.'));
      });
  }, []);

  /** Every switch on this page saves the same way; only the mutation differs. */
  async function save(change: () => Promise<InstallationSettings>) {
    if (settings === null || busy) return;

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const held = await change();
      setSettings(held);
      setRetention(String(held.revisionRetentionDays));
      setTurns(String(held.taskMaxTurns));
      // The shell reads the same settings to decide whether to offer the Chat
      // tab, so it is told rather than left showing a link to a page that is off.
      forgetInstallation();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="settings" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{t('Settings')}</h1>
            <p className={styles.subtitle}>
              {t('What this installation allows, for every workspace in it.')}
            </p>
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
            <h2 className={styles.sectionHeading}>
              <span className={styles.headingWithHint}>
                {t('Chat')}
                <FieldHint label={t('Chat')}>
                  Set in the configuration file, under <code>orknux.chat</code>.
                </FieldHint>
              </span>
            </h2>

            <div className={styles.setting}>
              <div className={styles.settingText}>
                <p className={styles.settingLabel}>{t('Chat')}</p>
                <p className={styles.settingNote}>
                  {settings.chatConfigurable
                    ? t('Whether this installation has a chat. Off takes the tab away and refuses new messages; the conversations already had are kept.')
                    : t('Turned off in the configuration file, which is the operator’s decision: this cannot switch it back on.')}
                </p>
              </div>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => void save(() => setChatEnabled(!settings.chatEnabled))}
                disabled={busy || !settings.chatConfigurable}
                role="switch"
                aria-checked={settings.chatEnabled}
                aria-label={settings.chatEnabled ? t('Turn chat off') : t('Turn chat on')}
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

            <h2 className={styles.sectionHeading}>
              <span className={styles.headingWithHint}>
                {t('Attachments')}
                <FieldHint label={t('Attachments')}>
                  Set in the configuration file, under <code>orknux.attachments</code>. Each
                  workspace keeps its files in its own directory beneath that location.
                </FieldHint>
              </span>
            </h2>

            <div className={styles.setting}>
              <div className={styles.settingText}>
                <p className={styles.settingLabel}>{t('Files in chats')}</p>
                <p className={styles.settingNote}>
                  {settings.attachmentsConfigurable
                    ? t('Whether people may attach files to a chat. Off takes the button away; what has already been uploaded stays where it is.')
                    : t('Turned off in the configuration file, which is the operator’s decision: this cannot switch it back on.')}
                </p>
              </div>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => void save(() => setAttachmentsEnabled(!settings.attachmentsEnabled))}
                disabled={busy || !settings.attachmentsConfigurable}
                role="switch"
                aria-checked={settings.attachmentsEnabled}
                aria-label={settings.attachmentsEnabled ? t('Turn attachments off') : t('Turn attachments on')}
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
                <dt className={styles.factName}>{t('Storage')}</dt>
                <dd className={styles.factValue}>{settings.attachmentStorage}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.factName}>{t('Location')}</dt>
                <dd className={`${styles.factValue} ${styles.mono}`}>{settings.attachmentLocation}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.factName}>{t('Largest file')}</dt>
                <dd className={styles.factValue}>{settings.attachmentMaxFileSizeMb} MB</dd>
              </div>
            </dl>
            <h2 className={styles.sectionHeading}>{t('Metrics')}</h2>

            <div className={styles.setting}>
              <div className={styles.settingText}>
                <span className={styles.labelWithHint}>
                  <p className={styles.settingLabel}>{t('Scraping without signing in')}</p>
                  {/*
                    What turning this on exposes is exactly the sort of
                    consequence the rules put behind the (?): read once by
                    somebody deciding, and in the way of everybody else.
                  */}
                  <FieldHint label={t('Scraping without signing in')}>
                    On publishes <code>/actuator/prometheus</code> to anybody who can reach this
                    server’s port: how many workspaces exist, how often workflows run and how often
                    they fail. Turn it on only where the scrape crosses a network the scraper alone is
                    on. A Prometheus that can send an Authorization header should carry an API token
                    instead and leave this off.
                  </FieldHint>
                </span>
              </div>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => void save(() => setMetricsAnonymous(!settings.metricsAnonymous))}
                disabled={busy}
                role="switch"
                aria-checked={settings.metricsAnonymous}
                aria-label={
                  settings.metricsAnonymous
                    ? t('Stop answering metrics to callers who have not signed in')
                    : t('Answer metrics to callers who have not signed in')
                }
              >
                <img
                  src={settings.metricsAnonymous ? toggleOnIcon : toggleOffIcon}
                  alt=""
                  width={36}
                  height={20}
                  data-keeps-colour
                />
              </button>
            </div>

            {settings.metricsAnonymous && (
              <p className={styles.warning}>
                {t('Open now: anyone who can reach this port is reading those numbers without an account.')}
              </p>
            )}

            {/*
              This is the one switch with a rival: the environment sets what a
              fresh installation answers, and an administrator’s stored answer
              takes over from there. An operator who edited their config file and
              finds the screen ignoring it is owed the reason, so the two are
              only ever silent about each other when they agree.
            */}
            <p className={styles.fieldNote}>
              {settings.metricsAnonymous === settings.metricsAnonymousConfigured ? (
                <>
                  <code>ORKNUX_METRICS_ANONYMOUS</code> in the environment says{' '}
                  {settings.metricsAnonymousConfigured ? 'on' : 'off'}, and this switch agrees with
                  it. What is stored here takes effect on the next scrape rather than the next
                  restart.
                </>
              ) : (
                <>
                  <code>ORKNUX_METRICS_ANONYMOUS</code> in the environment says{' '}
                  {settings.metricsAnonymousConfigured ? 'on' : 'off'}, but an administrator stored{' '}
                  {settings.metricsAnonymous ? 'on' : 'off'} here, and the stored answer is the one
                  in force. Editing the environment will not move it back — this switch will.
                </>
              )}
            </p>

            <h2 className={styles.sectionHeading}>{t('Component history')}</h2>

            <div className={styles.setting}>
              <div className={styles.settingText}>
                <span className={styles.labelWithHint}>
                  <p className={styles.settingLabel}>{t('How long versions are kept')}</p>
                  <FieldHint label={t('How long versions are kept')}>
                    {t('Every save of a function, tool, skill or agent keeps what it was before, and every publication of a workflow is kept as a version of it. A version is a whole copy — the code, the parameters, the prompt — so this is what decides how much disk the history takes. Counted from when a version stopped being current, not from when it was written. A workflow’s live publication is never swept, however old it is.')}
                  </FieldHint>
                </span>
              </div>
              <div className={styles.retention}>
                <input
                  id="revision-retention-days"
                  name="revisionRetentionDays"
                  className={styles.input}
                  type="number"
                  min={1}
                  max={3650}
                  value={retention}
                  onChange={(event) => setRetention(event.target.value)}
                  disabled={busy}
                  aria-label={t('How many days of component history to keep')}
                />
                <span className={styles.retentionUnit}>{t('days')}</span>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void save(() => setRevisionRetentionDays(Number(retention)))}
                  disabled={
                    busy ||
                    retention.trim() === '' ||
                    Number(retention) === settings.revisionRetentionDays
                  }
                >{t('Save')}</button>
              </div>
            </div>

            {/*
              The same rival the metrics switch has: the environment says what a
              fresh installation keeps, and a stored answer takes over from
              there. Said only where they differ, because an operator who edited
              their config file and finds it ignored is owed the reason.
            */}
            {settings.revisionRetentionDays !== settings.revisionRetentionDaysConfigured && (
              <p className={styles.fieldNote}>
                <code>ORKNUX_REVISION_RETENTION_DAYS</code> in the environment says{' '}
                {settings.revisionRetentionDaysConfigured} days, but an administrator stored{' '}
                {settings.revisionRetentionDays} here, and the stored answer is the one in force.
              </p>
            )}

            <h2 className={styles.sectionHeading}>{t('Tasks')}</h2>

            <div className={styles.setting}>
              <div className={styles.settingText}>
                <span className={styles.labelWithHint}>
                  <p className={styles.settingLabel}>{t('How many turns a task may take')}</p>
                  <FieldHint label={t('How many turns a task may take')}>
                    {t('One turn is one round of the agent’s own tool loop: it is asked, it may call its tools, and it answers. A task that has used them all is stopped and says so, which is the signal that it is going round in circles rather than working. The number is copied onto a task when it starts, so raising it gives the next task more and leaves the ones already running as they were. It is not the only ceiling — a task is also stopped after two hours of working time, which is what bounds a turn that sits waiting on a slow tool.')}
                  </FieldHint>
                </span>
              </div>
              <div className={styles.retention}>
                <input
                  id="task-max-turns"
                  name="taskMaxTurns"
                  className={styles.input}
                  type="number"
                  min={1}
                  max={200}
                  value={turns}
                  onChange={(event) => setTurns(event.target.value)}
                  disabled={busy}
                  aria-label={t('How many turns a task may take')}
                />
                <span className={styles.retentionUnit}>{t('turns')}</span>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void save(() => setTaskMaxTurns(Number(turns)))}
                  disabled={busy || turns.trim() === '' || Number(turns) === settings.taskMaxTurns}
                >{t('Save')}</button>
              </div>
            </div>

            {settings.taskMaxTurns !== settings.taskMaxTurnsConfigured && (
              <p className={styles.fieldNote}>
                <code>ORKNUX_TASK_MAX_TURNS</code> in the environment says{' '}
                {settings.taskMaxTurnsConfigured}, but an administrator stored{' '}
                {settings.taskMaxTurns} here, and the stored answer is the one in force.
              </p>
            )}

            {saved && <p className={styles.saved}>{t('Saved.')}</p>}
          </>
        )}
      </section>
    </AppShell>
  );
}
