import { useEffect, useState } from 'react';

import type { SessionUser } from '../../api/session';
import { setUserEmail, setUserEmailNotifications } from '../../api/users';
import moonIcon from '../../assets/moon.svg';
import sunIcon from '../../assets/sun.svg';
import { AppShell } from '../../components/AppShell';
import { FieldHint } from '../../components/FieldHint';
import { applyTheme, currentTheme, rememberTheme } from '../../session/theme';
import type { Theme } from '../../session/theme';
import { shellUser } from '../../session/user';
import {
  DEFAULT_SHORTCUT,
  describe,
  DEFAULT_FORMAT_SHORTCUT,
  DEFAULT_TURN_SHORTCUT,
  DEFAULT_ADD_SHORTCUT,
  DEFAULT_UNDO_SHORTCUT,
  DEFAULT_REDO_SHORTCUT,
  DEFAULT_DUPLICATE_SHORTCUT,
  DEFAULT_PUBLISH_SHORTCUT,
  DEFAULT_SAVE_SHORTCUT,
  setFormatShortcut,
  setTurnShortcut,
  setAddShortcut,
  setUndoShortcut,
  setRedoShortcut,
  setDuplicateShortcut,
  setPublishShortcut,
  setPaletteShortcut,
  setSaveShortcut,
  usable,
  useFormatShortcut,
  useTurnShortcut,
  useAddShortcut,
  useUndoShortcut,
  useRedoShortcut,
  useDuplicateShortcut,
  usePublishShortcut,
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
  const add = useAddShortcut();
  const undo = useUndoShortcut();
  const redo = useRedoShortcut();
  const duplicate = useDuplicateShortcut();
  const publish = usePublishShortcut();
  /**
   * Which shortcut the next keystroke belongs to, or null while none is being
   * recorded. Not a boolean: there are nine of these now, and they share the one
   * listener — one per shortcut would fight over the same keypress.
   */
  const [recording, setRecording] = useState<
    'palette' | 'save' | 'format' | 'turn' | 'add' | 'undo' | 'redo' | 'duplicate' | 'publish' | null
  >(null);
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
       * A bare letter is refused everywhere except the two canvas ones.
       *
       * The others fire wherever somebody is typing, so a letter alone would
       * trigger them mid-word. Turning a node and opening the Add menu are only
       * honoured on the canvas, where a letter is free - which is why R and A
       * can be the defaults there and cannot be anywhere else.
       */
      if (recording !== 'turn' && recording !== 'add' && !usable(said)) {
        setRefused(said);
        return;
      }

      if (recording === 'palette') setPaletteShortcut(said);
      else if (recording === 'save') setSaveShortcut(said);
      else if (recording === 'turn') setTurnShortcut(said);
      else if (recording === 'add') setAddShortcut(said);
      else if (recording === 'undo') setUndoShortcut(said);
      else if (recording === 'redo') setRedoShortcut(said);
      else if (recording === 'duplicate') setDuplicateShortcut(said);
      else if (recording === 'publish') setPublishShortcut(said);
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

  /*
   * Whether the tracker writes to that address as well as ringing the bell.
   *
   * Seeded from the session for the reason the address above is: it arrives with
   * the page, and asking a second question for one boolean would be a round trip
   * to show a control somebody may never touch. Saved on the click rather than
   * behind a button - there is nothing to type and nothing to get wrong, so a
   * Save beside it would only be a second thing to remember to press.
   */
  const [notify, setNotify] = useState(session.emailNotifications !== false);
  const [savingNotify, setSavingNotify] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  async function chooseNotify(next: boolean) {
    if (savingNotify || next === notify) return;
    setSavingNotify(true);
    setNotifyError(null);
    // Shown at once, and put back below if the server disagrees: the control is
    // a switch, and a switch that waits for a round trip reads as a broken one.
    setNotify(next);
    try {
      const held = await setUserEmailNotifications(next);
      setNotify(held.emailNotifications);
    } catch (cause) {
      setNotify(!next);
      setNotifyError(cause instanceof Error ? cause.message : 'Could not save that.');
    } finally {
      setSavingNotify(false);
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
              <span className={styles.labelWithHint}>
                <label className={styles.settingLabel} htmlFor="profile-email">
                  Email Address
                </label>
                <FieldHint label="Email Address">
                  Taken from your directory entry to begin with, and refreshed from it each time you
                  sign in until you set one here. Emptying it hands it back.
                </FieldHint>
              </span>
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
              {emailSaid !== null && <p className={styles.done}>{emailSaid}</p>}
              {emailError !== null && (
                <p className={styles.error} role="alert">
                  {emailError}
                </p>
              )}
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Notifications</h2>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="issue-email">
                  Issue Email
                </span>
                <FieldHint label="Issue Email">
                  Sends you what the bell already shows - an issue you filed, hold or observe being
                  opened, assigned, commented on or closed, and any comment with your name in it. It
                  changes nothing about what you hear, only where. Mail goes to the address above, so
                  without one there is nothing to send; an installation whose administrator has not
                  configured a mail server sends nothing either way.
                </FieldHint>
              </span>
              <div className={styles.options} role="radiogroup" aria-labelledby="issue-email">
                <button
                  type="button"
                  role="radio"
                  aria-checked={notify}
                  disabled={savingNotify}
                  className={notify ? styles.optionCurrent : styles.option}
                  onClick={() => void chooseNotify(true)}
                >
                  On
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!notify}
                  disabled={savingNotify}
                  className={notify ? styles.option : styles.optionCurrent}
                  onClick={() => void chooseNotify(false)}
                >
                  Off
                </button>
              </div>
              {notifyError !== null && (
                <p className={styles.error} role="alert">
                  {notifyError}
                </p>
              )}
            </div>
          </section>

          {/*
            Every setting on this page said what it was for in a paragraph under
            its control, which is the convention the rest of the product moved
            away from - so each of those paragraphs is now behind the (?) beside
            its label.

            What stayed is what is only true while somebody is pressing keys: the
            combination the recorder just turned down, and the line telling them
            what to do next. Neither explains the setting; both are the state of
            the control at that moment, and a note nobody can see while it is
            happening would be no use at all.
          */}
          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Appearance</h2>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="interface-theme">
                  Interface Theme
                </span>
                <FieldHint label="Interface Theme">
                  Kept in this browser, so it applies before the first paint rather than after a
                  round trip.
                </FieldHint>
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
            </div>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="palette-shortcut">
                  Quick Actions Shortcut
                </span>
                {/*
                  "Go To Shortcut" until issue #218, which is what the box in
                  the top bar was called before it offered anything to do as
                  well as somewhere to go. It is Quick actions now, and this
                  says so: a shortcut named after a label nobody sees is a
                  setting nobody connects to the thing it opens. Title case
                  because every other label on this page is - "Save Shortcut",
                  "Turn Node Shortcut" - not because the box is called that.
                  The keystroke and where it is stored are unchanged.
                */}
                <FieldHint label="Quick Actions Shortcut">
                  Opens the box in the top bar from anywhere. Yours to choose: which keys are free
                  depends on your browser and your machine, not on this application.
                </FieldHint>
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
              {recording === 'palette' && (
                <p className={styles.settingNote}>
                  {refused !== null ? (
                    <>
                    <strong>{refused}</strong> would fire while typing. Hold Ctrl, Alt, Shift or Cmd
                    with it \u2014 or use a function key.
                    </>
                  ) : (
                    <>Press the combination you want. Escape leaves it as it is.</>
                  )}
                </p>
              )}
            </div>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="save-shortcut">
                  Save Shortcut
                </span>
                <FieldHint label="Save Shortcut">
                  Saves whatever editor you are in, and stops the browser offering to save the page
                  instead. The function editor shows this key beside its details.
                </FieldHint>
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
              {recording === 'save' && (
                <p className={styles.settingNote}>
                  {refused !== null ? (
                    <>
                    <strong>{refused}</strong> would fire while typing. Hold Ctrl, Alt, Shift or Cmd
                    with it \u2014 or use a function key.
                    </>
                  ) : (
                    <>Press the combination you want. Escape leaves it as it is.</>
                  )}
                </p>
              )}
            </div>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="format-shortcut">
                  Format Shortcut
                </span>
                <FieldHint label="Format Shortcut">
                  Lays out the code in the function editor, with the same language service that
                  completes and checks it. Prevented from reaching the browser, which has its own
                  ideas about this one.
                </FieldHint>
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
              {recording === 'format' && (
                <p className={styles.settingNote}>
                  {refused !== null ? (
                    <>
                    <strong>{refused}</strong> would fire while typing. Hold Ctrl, Alt, Shift or Cmd
                    with it — or use a function key.
                    </>
                  ) : (
                    <>Press the combination you want. Escape leaves it as it is.</>
                  )}
                </p>
              )}
            </div>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="turn-shortcut">
                  Turn Node Shortcut
                </span>
                <FieldHint label="Turn Node Shortcut">
                  Turns the selected node on the workflow canvas, so a graph can run down the screen
                  instead of off the side of it. A bare letter is allowed here, unlike the others:
                  this one is only heard on the canvas, never while typing.
                </FieldHint>
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
              {recording === 'turn' && (
                <p className={styles.settingNote}>Press the combination you want. Escape leaves it as it is.</p>
              )}
            </div>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="add-shortcut">
                  Add Node Shortcut
                </span>
                <FieldHint label="Add Node Shortcut">
                  Opens the workflow editor's Add menu and puts the first kind of node under the
                  keyboard, so a graph can be built without reaching for the toolbar. A bare letter
                  is allowed here for the same reason it is above: only the canvas hears it.
                </FieldHint>
              </span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={recording === 'add' ? styles.optionCurrent : styles.option}
                  onClick={() => {
                    setRefused(null);
                    setRecording((held) => (held === 'add' ? null : 'add'));
                  }}
                >
                  {recording === 'add' ? 'Press any keys…' : add}
                </button>
                {add !== DEFAULT_ADD_SHORTCUT && recording !== 'add' && (
                  <button type="button" className={styles.option} onClick={() => setAddShortcut(DEFAULT_ADD_SHORTCUT)}>
                    Reset
                  </button>
                )}
              </div>
              {recording === 'add' && (
                <p className={styles.settingNote}>Press the combination you want. Escape leaves it as it is.</p>
              )}
            </div>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="undo-shortcut">
                  Undo Shortcut
                </span>
                <FieldHint label="Undo Shortcut">
                  Steps back through what you have drawn on the workflow canvas. Ignored while a caret is in a text box, where the browser&apos;s own undo is the right one.
                </FieldHint>
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
              {recording === 'undo' && (
                <p className={styles.settingNote}>Press the combination you want. Escape leaves it as it is.</p>
              )}
            </div>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="redo-shortcut">
                  Redo Shortcut
                </span>
                <FieldHint label="Redo Shortcut">
                  Steps forward again. Ctrl+Y is heard as well, whatever is chosen here, because it is the other habit people arrive with.
                </FieldHint>
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
              {recording === 'redo' && (
                <p className={styles.settingNote}>Press the combination you want. Escape leaves it as it is.</p>
              )}
            </div>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="duplicate-shortcut">
                  Duplicate Node Shortcut
                </span>
                <FieldHint label="Duplicate Node Shortcut">
                  Puts a second copy of the selected node on the workflow canvas, pointed at the same
                  action, trigger or agent and wired to nothing. The browser&apos;s own meaning for the
                  usual choice is a bookmark, which the editor takes instead.
                </FieldHint>
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
              {recording === 'duplicate' && (
                <p className={styles.settingNote}>Press the combination you want. Escape leaves it as it is.</p>
              )}
            </div>

            <div className={styles.setting}>
              <span className={styles.labelWithHint}>
                <span className={styles.settingLabel} id="publish-shortcut">
                  Publish Shortcut
                </span>
                <FieldHint label="Publish Shortcut">
                  Saves the workflow on the canvas and makes that version the one that runs, without
                  reaching for the toolbar. A modifier is required here, unlike the two canvas keys
                  above: publishing changes what everybody else&apos;s runs do, which is not something
                  a single letter should be able to do by accident.
                </FieldHint>
              </span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={recording === 'publish' ? styles.optionCurrent : styles.option}
                  onClick={() => {
                    setRefused(null);
                    setRecording((held) => (held === 'publish' ? null : 'publish'));
                  }}
                >
                  {recording === 'publish' ? 'Press any keys…' : publish}
                </button>
                {publish !== DEFAULT_PUBLISH_SHORTCUT && recording !== 'publish' && (
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => setPublishShortcut(DEFAULT_PUBLISH_SHORTCUT)}
                  >
                    Reset
                  </button>
                )}
              </div>
              {recording === 'publish' && (
                <p className={styles.settingNote}>Press the combination you want. Escape leaves it as it is.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
