import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import styles from './FieldHint.module.css';

export interface FieldHintProps {
  /**
   * The field this explains, spelled as its label spells it: "Retries",
   * "Output name". Only a screen reader reads it - it is what turns a page of
   * identical question marks into "About Retries".
   */
  label: string;
  /** The explanation. Prose, and as long as the thing actually needs. */
  children: ReactNode;
}

/**
 * The (?) beside a field's label, and what it has to say when pressed.
 *
 * A panel that prints its explanations under the fields explains everything to
 * somebody who needed one of them once. The node editor had eleven paragraphs
 * of it, and the effect is that the thing being typed into is outnumbered by
 * prose about it - so the words go behind a control that is small when nobody
 * is asking and complete when somebody is.
 *
 * A button, not a `title`: a native tooltip cannot be reached from the
 * keyboard, cannot be read on a touch screen, waits a second before it appears
 * and takes markup out of the text. This is focusable, opens on Enter and
 * Space because a button does, closes on Escape and hands the focus back to
 * itself, and closes on a press anywhere else.
 *
 * One component and not a class name, because the point is that every field
 * asks in the same shape: two conventions in one panel is worse than the wordy
 * convention it replaces.
 */
export function FieldHint({ label, children }: FieldHintProps) {
  const [open, setOpen] = useState(false);
  /** Where the note is put, in window coordinates; null while it is shut. */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const control = useRef<HTMLButtonElement>(null);
  const id = useId();

  /*
   * Placed against the window rather than against the label.
   *
   * These stand in a panel 280px wide that scrolls its own contents, and
   * anything that scrolls clips what leaves it: a note hung off the control by
   * ordinary absolute positioning had its right-hand third cut off by the edge
   * of the panel. Fixed puts it over everything, and the reading below keeps it
   * on screen where the field it belongs to is near an edge.
   */
  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const rect = control.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const room = window.innerWidth - WIDTH - GAP;
    setAt({ top: rect.bottom + GAP, left: Math.max(GAP, Math.min(rect.left, room)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    /*
     * In the capture phase. The likeliest next press is the canvas behind the
     * panel, and React Flow stops a press on the pane or on a node from
     * reaching the document at all - a bubbling listener would leave the
     * explanation hanging open over the graph somebody just clicked.
     */
    function onDown(event: MouseEvent) {
      if (box.current !== null && !box.current.contains(event.target as globalThis.Node)) setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      /*
       * Prevented, and the focus put back where it was. These sit inside forms
       * and inside dialogs, where an unprevented Escape is a close request the
       * browser answers by shutting the whole thing - so reading a hint and
       * giving up on it would throw away what somebody had typed around it.
       */
      event.preventDefault();
      setOpen(false);
      control.current?.focus();
    }

    /*
     * And it goes away when anything scrolls. The note is placed once, where
     * the control was: left open through a scroll of the panel it would sit
     * over a field it is not about, which is worse than having to press again.
     */
    function onScroll() {
      setOpen(false);
    }

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <span className={styles.hint} ref={box}>
      <button
        ref={control}
        type="button"
        // What the check script finds them by, and what says which is which
        // in a panel where they are all the same character.
        data-hint={label}
        className={open ? `${styles.circle} ${styles.circleOpen}` : styles.circle}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`About ${label}`}
        onClick={() => setOpen((was) => !was)}
      >
        ?
      </button>
      {open && at !== null && (
        // A note rather than a dialog: there is nothing in here to do, and a
        // dialog would take the focus away from the panel to say so.
        <span className={styles.popover} id={id} role="note" style={{ top: at.top, left: at.left }}>
          {children}
        </span>
      )}
    </span>
  );
}

/** How wide the note is drawn; the stylesheet says the same, and must. */
const WIDTH = 240;

/** Between the control and the note, and between the note and the window's edge. */
const GAP = 6;
