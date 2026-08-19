import { useEffect, useState } from 'react';

import type { SessionUser } from '../../api/session';
import { setUserEmail } from '../../api/users';
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
  DEFAULT_TURN_SHORTCUT,
  DEFAULT_UNDO_SHORTCUT,
  DEFAULT_REDO_SHORTCUT,
  DEFAULT_DUPLICATE_SHORTCUT,
  DEFAULT_SAVE_SHORTCUT,
  setFormatShortcut,
  setTurnShortcut,
  setUndoShortcut,
  setRedoShortcut,
  setDuplicateShortcut,
  setPaletteShortcut,
  setSaveShortcut,
  usable,
  useFormatShortcut,
  useTurnShortcut,
  useUndoShortcut,
  useRedoShortcut,
  useDuplicateShortcut,
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
 * Appearance, and the one thing about a person the server keeps for them: the
 * address to write to. The theme is a property of the machine somebody is
 * sitting at and stays in the browser; an address follows them between
 * machines, so it lives on the server. Security keys belong here too, when they
 * arrive.
 */
export function PreferencesPage({ session, onSignOut }: PreferencesPageProps) {
  const shortcut = usePaletteShortcut();
  const save = useSaveShortcut();
  const format = useFormatShortcut();
  const turn = useTurnShortcut();
  const undo = useUndoShortcut();
  const redo = useRedoShortcut();
  const duplicate = useDuplicateShortcut();
  /**
   * Which shortcut the next keystroke belongs to, or null while none is being
   * recorded. Not a boolean: there are three of these now, and they share the one
   * listener — one per shortcut would fight over the same keypress.
   */
  const [recording, setRecording] = useState<'palette' | 'save' | 'format' | 'turn' | 'undo' | 'redo' | 'duplicate' | null>(null);
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
      /*
       * A bare letter is refused everywhere except turning a node.
       *
       * The others fire wherever somebody is typing, so a letter alone would
       * trigger them mid-word. Turning is only honoured on the canvas, where a
       * letter is free - which is why R can be the default there and cannot be
       * anywhere else.
       */
      if (recording !== 'turn' && !usable(said)) {
        setRefused(said);
        return;
      }

      if (recording === 'palette') setPaletteShortcut(said);
      else if (recording === 'save') setSaveShortcut(said);
      else if (recording === 'turn') setTurnShortcut(said);
      else if (recording === 'undo') setUndoShortcut(said);
      else if (recording === 'redo') setRedoShortcut(said);
      else if (recording === 'duplicate') setDuplicateShortcut(said);
      else setFormatShortcut(said);
      setRecording(null);
      setRefused(null);
    }

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);

  const [theme, setTheme] = useState<Theme>(currentTheme);

  /*
   * The address, as it is now and as it is being typed.
   *
   * Seeded from the session because that is where the answer already arrives -
   * the recorded one where there is one, and the provider's until somebody
   * changes it. Kept here after saving rather than re-read: the session was
   * fetched once, when the application started, and it would go on saying the
   * old address until the next reload.
   */
  const [email, setEmail] = useState(session.email ?? '');
  /** What the server last said, so the button knows whether anything has changed. */
  const [savedEmail, setSavedEmail] = useState(session.email ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSaid, setEmailSaid] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function saveEmail() {
    if (savingEmail) return;
    setSavingEmail(true);
    setEmailError(null);
    setEmailSaid(null);
    try {
      const held = await setUserEmail(email.trim());
      setEmail(held.email ?? '');
      setSavedEmail(held.email ?? '');
      setEmailSaid(
        held.email === null
          ? 'Cleared. Your directory entry fills it in again at your next sign-in.'
          : 'Saved. Signing in no longer overwrites it.',
      );
    } catch (cause) {
      setEmailError(cause instanceof Error ? cause.message : 'Could not save the address.');
    } finally {
      setSavingEmail(false);
    }
  }

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
            <h2 className={styles.sectionTitle}>Profile</h2>

            <div className={styles.setting}>
              <label className={styles.settingLabel} htmlFor="profile-email">
                Email Address
              </label>
              <div className={styles.row}>
                <input
                  id="profile-email"
                  className={styles.input}
                  type="email"
                  value={email}
                  placeholder="nobody@example.com"
                  autoComplete="email"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setEmailSaid(null);
                    setEmailError(null);
                  }}
                />
                <button
                  type="button"
                  className={styles.save}
                  onClick={() => void saveEmail()}
                  disabled={savingEmail || email.trim() === savedEmail}
                >
                  {savingEmail ? 'Saving…' : 'Save'}
                </button>
              </div>
              <p className={styles.settingNote}>
                Taken from your directory entry to begin with, and refreshed from it each time you
                sign in until you set one here. Emptying it hands it back.
              </p>
              {emailSaid !== null && <p className={styles.done}>{emailSaid}</p>}
              {emailError !== null && (
                <p className={styles.error} role="alert">
                  {emailError}
                </p>
              )}
            </div>
          </section>

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

            <div className={styles.setting}>
              <span className={styles.settingLabel} id="turn-shortcut">
                Turn Node Shortcut
              </span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={recording === 'turn' ? styles.optionCurrent : styles.option}
                  onClick={() => {
                    setRefused(null);
                    setRecording((held) => (held === 'turn' ? null : 'turn'));
                  }}
                >
                  {recording === 'turn' ? 'Press any keys…' : turn}
                </button>
                {turn !== DEFAULT_TURN_SHORTCUT && recording !== 'turn' && (
                  <button type="button" className={styles.option} onClick={() => setTurnShortcut(DEFAULT_TURN_SHORTCUT)}>
                    Reset
                  </button>
                )}
              </div>
              <p className={styles.settingNote}>
                {recording === 'turn' ? (
                  <>Press the combination you want. Escape leaves it as it is.</>
                ) : (
                  <>
                    Turns the selected node on the workflow canvas, so a graph can run down the screen
                    instead of off the side of it. A bare letter is allowed here, unlike the others:
                    this one is only heard on the canvas, never while typing.
                  </>
                )}
              </p>
            </div>

            <div className={styles.setting}>
              <span className={styles.settingLabel} id="undo-shortcut">
                Undo Shortcut
              </span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={recording === 'undo' ? styles.optionCurrent : styles.option}
                  onClick={() => {
                    setRefused(null);
                    setRecording((held) => (held === 'undo' ? null : 'undo'));
                  }}
                >
                  {recording === 'undo' ? 'Press any keys…' : undo}
                </button>
                {undo !== DEFAULT_UNDO_SHORTCUT && recording !== 'undo' && (
                  <button type="button" className={styles.option} onClick={() => setUndoShortcut(DEFAULT_UNDO_SHORTCUT)}>
                    Reset
                  </button>
                )}
              </div>
              <p className={styles.settingNote}>
                {recording === 'undo' ? (
                  <>Press the combination you want. Escape leaves it as it is.</>
                ) : (
                  <>Steps back through what you have drawn on the workflow canvas. Ignored while a caret is in a text box, where the browser&apos;s own undo is the right one.</>
                )}
              </p>
            </div>

            <div className={styles.setting}>
              <span className={styles.settingLabel} id="redo-shortcut">
                Redo Shortcut
              </span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={recording === 'redo' ? styles.optionCurrent : styles.option}
                  onClick={() => {
                    setRefused(null);
                    setRecording((held) => (held === 'redo' ? null : 'redo'));
                  }}
                >
                  {recording === 'redo' ? 'Press any keys…' : redo}
                </button>
                {redo !== DEFAULT_REDO_SHORTCUT && recording !== 'redo' && (
                  <button type="button" className={styles.option} onClick={() => setRedoShortcut(DEFAULT_REDO_SHORTCUT)}>
                    Reset
                  </button>
                )}
              </div>
              <p className={styles.settingNote}>
                {recording === 'redo' ? (
                  <>Press the combination you want. Escape leaves it as it is.</>
                ) : (
                  <>Steps forward again. Ctrl+Y is heard as well, whatever is chosen here, because it is the other habit people arrive with.</>
                )}
              </p>
            </div>

            <div className={styles.setting}>
              <span className={styles.settingLabel} id="duplicate-shortcut">
                Duplicate Node Shortcut
              </span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={recording === 'duplicate' ? styles.optionCurrent : styles.option}
                  onClick={() => {
                    setRefused(null);
                    setRecording((held) => (held === 'duplicate' ? null : 'duplicate'));
                  }}
                >
                  {recording === 'duplicate' ? 'Press any keys…' : duplicate}
                </button>
                {duplicate !== DEFAULT_DUPLICATE_SHORTCUT && recording !== 'duplicate' && (
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => setDuplicateShortcut(DEFAULT_DUPLICATE_SHORTCUT)}
                  >
                    Reset
                  </button>
                )}
              </div>
              <p className={styles.settingNote}>
                {recording === 'duplicate' ? (
                  <>Press the combination you want. Escape leaves it as it is.</>
                ) : (
                  <>
                    Puts a second copy of the selected node on the workflow canvas, pointed at the same
                    action, trigger or agent and wired to nothing. The browser&apos;s own meaning for the
                    usual choice is a bookmark, which the editor takes instead.
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
