import { useEffect, useRef, useState } from 'react';

import alertTriangleIcon from '../assets/alert-triangle.svg';
import styles from './Dialog.module.css';

export interface UnsavedWorkDialogProps {
  /** What the thing is called, or null while there is nothing to ask about. */
  subject: string | null;
  /** Whether it has ever been stored, which changes what saving means. */
  creating: boolean;
  /** Go anyway, and lose what is on screen. */
  onLeave: () => void;
  /** Store it first, then go. Resolves false if the save was refused. */
  onSaveAndLeave: () => Promise<boolean>;
  /** Stay where we are. */
  onStay: () => void;
}

/**
 * The one word an editor never said before walking away.
 *
 * Shared by the three editors that hold work the server has not seen yet - a
 * function, a tool, an object - because all three lose it the same way and all
 * three save it the same way: one button, one round trip, and what came back is
 * the new baseline. Nothing in here knows which of the three it is standing in.
 *
 * Only opened for work the server has not been told about, which is why the
 * middle button is real rather than a formality: somebody who meant to leave
 * presses it once, and somebody who did not gets their work back by pressing
 * Cancel. `Save & Leave` is here because the alternative is three gestures -
 * stay, save, leave again - for the answer almost everybody wants.
 *
 * A refused save keeps the dialog open with the reason in it. Leaving on a save
 * the server would not take is exactly the loss this whole dialog exists to
 * prevent, so it is the one path that must not fall through to `onLeave`.
 */
export function UnsavedWorkDialog({
  subject,
  creating,
  onLeave,
  onSaveAndLeave,
  onStay,
}: UnsavedWorkDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (subject !== null && !dialog.open) {
      setError(null);
      setSaving(false);
      dialog.showModal();
    } else if (subject === null && dialog.open) {
      dialog.close();
    }
  }, [subject]);

  async function handleSaveAndLeave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // False means the server refused it; the reason is already on the page
      // behind this, beside the function's name, so this only has to stay put.
      if (!(await onSaveAndLeave())) {
        setError('That could not be saved, so nothing has been left behind. The reason is on the page.');
        setSaving(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be saved.');
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-check="unsaved-work"
      /*
       * Escape and the backdrop both mean "not now", which is staying. The
       * browser closes the dialog itself on Escape, so `onClose` has to put the
       * page's own record of it away as well or the next attempt to leave finds
       * a dialog that thinks it is already open.
       */
      onCancel={onStay}
      onClose={onStay}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>Leave without saving?</h2>
        </header>

        <div className={styles.warning}>
          <span className={styles.warningBadgeAmber}>
            <img src={alertTriangleIcon} alt="" width={18} height={18} />
          </span>
          <p className={styles.warningMessage}>
            {/*
              Only the function editor ever says yes to `creating`: a tool and an
              object are made elsewhere and this page only ever opens one that
              exists. The wording stays about code and details because that is
              whose branch it is.
            */}
            {creating ? (
              <>
                <strong>&quot;{subject}&quot;</strong> has not been created yet. Leaving now throws away
                the code and the details on this screen, and there is no way back to them.
              </>
            ) : (
              <>
                <strong>&quot;{subject}&quot;</strong> has changes the server has not been told about.
                Leaving now puts it back as it was last saved, and there is no way back from that.
              </>
            )}
          </p>
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onStay} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.amber} onClick={onLeave} disabled={saving}>
            Leave
          </button>
          <button
            type="button"
            className={styles.filled}
            onClick={() => void handleSaveAndLeave()}
            disabled={saving}
            autoFocus
          >
            {saving ? 'Saving…' : 'Save & Leave'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
