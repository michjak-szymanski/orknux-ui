import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * The (?) beside a field's label, and what it has to say when asked.
 *
 * A panel that prints its explanations under the fields explains everything to
 * somebody who needed one of them once. The node editor had eleven paragraphs
 * of it, and the effect is that the thing being typed into is outnumbered by
 * prose about it - so the words go behind a control that is small when nobody
 * is asking and complete when somebody is.
 *
 * It answers two different questions, so it opens two ways.
 *
 * **Hovering** is the glance - what is this field? The note appears under the
 * pointer and goes when the pointer does, costing nothing and asking for
 * nothing. Focusing does the same, because focus is the keyboard's hover.
 *
 * **Pressing pins it.** A note somebody is working from - a format to copy, a
 * rule to check a value against - must not vanish the moment they move the
 * pointer towards the field it is about, which is precisely where they are
 * going next. A pinned note carries a close control and stays until it is used,
 * through presses elsewhere and through scrolling, where it follows the field
 * it belongs to rather than being left behind over another one.
 *
 * A button and not a `title` for both: a native tooltip cannot be reached from
 * the keyboard, cannot be read on a touch screen at all, waits a second before
 * it appears and takes the markup out of the text. On a touch screen, where
 * there is no hovering to do, a tap pins straight away.
 *
 * Closing a hovered note waits a moment. It is drawn a few pixels clear of the
 * control, so a pointer travelling into it to read the end of a sentence
 * crosses ground belonging to neither - shutting the instant the button is left
 * would make the note unreachable by the gesture that opened it.
 *
 * One component and not a class name, because the point is that every field
 * asks in the same shape: two conventions in one panel is worse than the wordy
 * convention it replaces.
 */
export function FieldHint({ label, children }: FieldHintProps) {
  /**
   * Shut, glanced at, or pinned. Three rather than a boolean because a pinned
   * note and a hovered one want opposite things from every event that follows:
   * a press elsewhere, a scroll, a pointer leaving.
   */
  const [mode, setMode] = useState<'shut' | 'hovered' | 'pinned'>('shut');
  const open = mode !== 'shut';
  const pinned = mode === 'pinned';
  /** The pending close, so travelling into the note cancels it. */
  const closing = useRef<number | null>(null);
  /** Where the note is put, in window coordinates; null while it is shut. */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const control = useRef<HTMLButtonElement>(null);
  /** The note itself, which is not inside [box] once it is portalled out. */
  const note = useRef<HTMLSpanElement>(null);
  /**
   * What the note is portalled into: the body, or the dialog it stands in.
   *
   * A modal dialog is put in the browser's top layer, which paints over
   * everything outside it whatever its z-index says - so a note sent to the
   * body from inside one lands in exactly the right place and cannot be seen.
   * Measured rather than assumed: `elementFromPoint` at the note's centre came
   * back with the control underneath it.
   *
   * Read when it opens rather than once, because a control can be rendered
   * before the dialog around it is opened.
   */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const id = useId();

  const stopClosing = () => {
    if (closing.current !== null) {
      window.clearTimeout(closing.current);
      closing.current = null;
    }
  };

  /** The glance. Never demotes a pinned note back to a hovered one. */
  const glance = () => {
    stopClosing();
    setMode((was) => (was === 'pinned' ? was : 'hovered'));
  };

  /** Leaving only closes what hovering opened. */
  const release = () => {
    stopClosing();
    closing.current = window.setTimeout(() => {
      closing.current = null;
      setMode((was) => (was === 'hovered' ? 'shut' : was));
    }, LINGER);
  };

  const shut = () => {
    stopClosing();
    setMode('shut');
  };

  // Nothing left ticking against a control that has gone.
  useEffect(() => () => {
    if (closing.current !== null) window.clearTimeout(closing.current);
  }, []);

  /** Where the note belongs now, read off the control. */
  const place = () => {
    const rect = control.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const room = window.innerWidth - WIDTH - GAP;
    setAt({ top: rect.bottom + GAP, left: Math.max(GAP, Math.min(rect.left, room)) });
  };

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
      setHost(null);
      return;
    }
    setHost(control.current?.closest('dialog') ?? document.body);
    place();
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
      // A pinned note is dismissed by its own control and nothing else - that
      // is what pinning it asked for. Only the glance goes on a press away.
      if (pinned) return;
      const target = event.target as globalThis.Node;
      const inside =
        (box.current !== null && box.current.contains(target)) ||
        (note.current !== null && note.current.contains(target));
      if (!inside) shut();
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
      shut();
      control.current?.focus();
    }

    /*
     * A scroll moves the field, and the note is placed once where the control
     * was - so left alone it would end up sitting over a field it is not about.
     *
     * A glance is simply dropped: it costs a hover to have it back. A pinned
     * note was asked to stay, so it is moved to wherever its control has gone
     * instead of being taken away.
     */
    function onScroll() {
      if (pinned) place();
      else shut();
    }

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, pinned]);

  return (
    /*
      The enter and leave sit on the wrapper rather than on the button, because
      the note is a child of it: a pointer inside the note is still inside this,
      so reading one does not count as leaving it.
    */
    <span
      className={styles.hint}
      ref={box}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') glance();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') release();
      }}
    >
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
        /*
          Focus is the keyboard's hover, so tabbing to it says the same thing
          hovering does rather than asking for a second keystroke.
        */
        onFocus={glance}
        onBlur={release}
        /*
          A press pins it, whichever kind of press: a mouse, a tap, or Enter
          and Space, which a button reports as a click. Pressing a pinned one
          again puts it away, so the control that opened it can also shut it.
        */
        onClick={() => setMode((was) => (was === 'pinned' ? 'shut' : 'pinned'))}
      >
        ?
      </button>
      {/*
        Portalled to the body, and this is not cosmetic.

        `position: fixed` is measured against the window only while no ancestor
        carries a transform, a filter or a containing-block contain. The shell
        animates its content in with `animation-fill-mode: both`, which leaves a
        filling transform on `main` for as long as the page is up - so on every
        page inside the shell the note was landing offset by exactly the content
        area's origin. The editor never showed it, being the one page that hides
        the sidebar and skips that animation, which is precisely the kind of
        accident that keeps a positioning bug hidden until it is everywhere.

        Placing it on the body means no ancestor can capture it, whatever the
        page it is used on decides to animate later.
      */}
      {open && at !== null && host !== null && createPortal(
        // A note rather than a dialog: there is nothing in here to do, and a
        // dialog would take the focus away from the panel to say so.
        <span
          ref={note}
          className={pinned ? `${styles.popover} ${styles.popoverPinned}` : styles.popover}
          id={id}
          role="note"
          style={{ top: at.top, left: at.left }}
          /*
            Its own enter and leave. Portalled out of the wrapper, the note is
            no longer inside what the pointer left, so travelling into it would
            otherwise read as leaving and close the thing being read.
          */
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') stopClosing();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') release();
          }}
        >
          {/*
            Only on a pinned note. A hovered one goes when the pointer does, so
            a way to close it would be a control nobody could reach in time and
            a second thing to read in a note whose whole point is the first.
          */}
          {pinned && (
            <button type="button" className={styles.close} aria-label={`Close the note about ${label}`} onClick={shut}>
              ×
            </button>
          )}
          {children}
        </span>,
        host,
      )}
    </span>
  );
}

/** How wide the note is drawn; the stylesheet says the same, and must. */
const WIDTH = 240;

/** Between the control and the note, and between the note and the window's edge. */
const GAP = 6;

/**
 * How long the note waits before closing once the pointer has left.
 *
 * Long enough to cross the gap between the control and the note; short enough
 * that a pointer passing over a row of them does not leave a trail of open
 * notes behind it.
 */
const LINGER = 140;
