import { useEffect, useState } from 'react';

import type { SessionUser } from '../../api/session';
import moonIcon from '../../assets/moon.svg';
import sunIcon from '../../assets/sun.svg';
import { AppShell } from '../../components/AppShell';
import { applyTheme, currentTheme, rememberTheme } from '../../session/theme';
import type { Theme } from '../../session/theme';
import { shellUser } from '../../session/user';
import {
  DEFAULT_SHORTCUT,
  describe,
  DEFAULT_FORMAT_SHORTCUT,
  DEFAULT_SAVE_SHORTCUT,
  setFormatShortcut,
  setPaletteShortcut,
  setSaveShortcut,
  usable,
  useFormatShortcut,
  usePaletteShortcut,
  useSaveShortcut,
} from '../../session/shortcut';
import styles from './PreferencesPage.module.css';

export interface PreferencesPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * What one person has decided about their own interface.
 *
 * Only appearance so far. A profile and security keys belong here too, and when
 * they arrive they belong on the server — they follow a person between
 * machines, where the theme is a property of the machine they are sitting at.
 */
export function PreferencesPage({ session, onSignOut }: PreferencesPageProps) {
  const shortcut = usePaletteShortcut();
  const save = useSaveShortcut();
  const format = useFormatShortcut();
  /**
   * Which shortcut the next keystroke belongs to, or null while none is being
   * recorded. Not a boolean: there are three of these now, and they share the one
   * listener — one per shortcut would fight over the same keypress.
   */
  const [recording, setRecording] = useState<'palette' | 'save' | 'format' | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  /*
   * Recording listens for one keystroke and takes it, whatever it is.
   *
   * Captured rather than picked from a list, because which keys are free is a
   * property of somebody's machine — their browser, their window manager, their
   * habits — and a list of three guesses cannot know any of that.
   */
  useEffect(() => {
    if (recording === null) return;

    function onKey(event: KeyboardEvent) {
      const said = describe(event);
      if (said === null) return;

      event.preventDefault();
      event.stopPropagation();
      if (said === 'Escape') {
        setRecording(null);
        setRefused(null);
        return;
      }
      if (!usable(said)) {
        setRefused(said);
        return;
      }

      if (recording === 'palette') setPaletteShortcut(said);
      else if (recording === 'save') setSaveShortcut(said);
      else setFormatShortcut(said);
      setRecording(null);
      setRefused(null);
    }

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);

  const [theme, setTheme] = useState<Theme>(currentTheme);

  function choose(next: Theme) {
    // Applied first: the page it changes is the page being looked at.
    applyTheme(next);
    rememberTheme(next);
    setTheme(next);
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="none"
      showAdmin={session.admin}
      onSignOut={onSignOut}
      hideSidebar
      sidebar={null}
    >
      <div className={styles.page}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>User Preferences</h1>
            <p className={styles.subtitle}>
              Manage your developer profile, app appearance, models, and security keys.
            </p>
          </header>

          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Appearance</h2>

            <div className={styles.setting}>
              <span className={styles.settingLabel} id="interface-theme">
                Interface Theme
              </span>
              <div className={styles.options} role="radiogroup" aria-labelledby="interface-theme">
                <button
                  type="button"
                  role="radio"
                  aria-checked={theme === 'dark'}
                  className={theme === 'dark' ? styles.optionCurrent : styles.option}
                  onClick={() => choose('dark')}
                >
                  <img src={moonIcon} alt="" width={14} height={14} />
                  Dark Mode
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={theme === 'light'}
                  className={theme === 'light' ? styles.optionCurrent : styles.option}
                  onClick={() => choose('light')}
                >
                  <img src={sunIcon} alt="" width={14} height={14} />
                  Light Mode
                </button>
              </div>
              <p className={styles.settingNote}>
                Kept in this browser, so it applies before the first paint rather than after a
                round trip.
              </p>
            </div>

            <div className={styles.setting}>
              <span className={styles.settingLabel} id="palette-shortcut">
                Go To Shortcut
              </span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={recording === 'palette' ? styles.optionCurrent : styles.option}
                  onClick={() => {
                    setRefused(null);
                    setRecording((held) => (held === 'palette' ? null : 'palette'));
                  }}
                >
                  {recording === 'palette' ? 'Press any keys\u2026' : shortcut}
                </button>
                {shortcut !== DEFAULT_SHORTCUT && recording !== 'palette' && (
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => setPaletteShortcut(DEFAULT_SHORTCUT)}
                  >
                    Reset
                  </button>
                )}
              </div>
              <p className={styles.settingNote}>
                {refused !== null && recording === 'palette' ? (
                  <>
                    <strong>{refused}</strong> would fire while typing. Hold Ctrl, Alt, Shift or Cmd
                    with it \u2014 or use a function key.
                  </>
                ) : recording === 'palette' ? (
                  <>Press the combination you want. Escape leaves it as it is.</>
                ) : (
                  <>
                    Opens the box in the top bar from anywhere. Yours to choose: which keys are free
                    depends on your browser and your machine, not on this application.
                  </>
                )}
              </p>
            </div>

            <div className={styles.setting}>
              <span className={styles.settingLabel} id="save-shortcut">
                Save Shortcut
              </span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={recording === 'save' ? styles.optionCurrent : styles.option}
                  onClick={() => {
                    setRefused(null);
                    setRecording((held) => (held === 'save' ? null : 'save'));
                  }}
                >
                  {recording === 'save' ? 'Press any keys\u2026' : save}
                </button>
                {save !== DEFAULT_SAVE_SHORTCUT && recording !== 'save' && (
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => setSaveShortcut(DEFAULT_SAVE_SHORTCUT)}
                  >
                    Reset
                  </button>
                )}
              </div>
              <p className={styles.settingNote}>
                {refused !== null && recording === 'save' ? (
                  <>
                    <strong>{refused}</strong> would fire while typing. Hold Ctrl, Alt, Shift or Cmd
                    with it \u2014 or use a function key.
                  </>
                ) : recording === 'save' ? (
                  <>Press the combination you want. Escape leaves it as it is.</>
                ) : (
                  <>
                    Saves whatever editor you are in, and stops the browser offering to save the page
                    instead. The function editor shows this key beside its details.
                  </>
                )}
              </p>
            </div>

            <div className={styles.setting}>
              <span className={styles.settingLabel} id="format-shortcut">
                Format Shortcut
              </span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={recording === 'format' ? styles.optionCurrent : styles.option}
                  onClick={() => {
                    setRefused(null);
                    setRecording((held) => (held === 'format' ? null : 'format'));
                  }}
                >
                  {recording === 'format' ? 'Press any keys…' : format}
                </button>
                {format !== DEFAULT_FORMAT_SHORTCUT && recording !== 'format' && (
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => setFormatShortcut(DEFAULT_FORMAT_SHORTCUT)}
                  >
                    Reset
                  </button>
                )}
              </div>
              <p className={styles.settingNote}>
                {refused !== null && recording === 'format' ? (
                  <>
                    <strong>{refused}</strong> would fire while typing. Hold Ctrl, Alt, Shift or Cmd
                    with it — or use a function key.
                  </>
                ) : recording === 'format' ? (
                  <>Press the combination you want. Escape leaves it as it is.</>
                ) : (
                  <>
                    Lays out the code in the function editor, with the same language service that
                    completes and checks it. Prevented from reaching the browser, which has its own
                    ideas about this one.
                  </>
                )}
              </p>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
