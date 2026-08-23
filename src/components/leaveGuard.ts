import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/*
 * The mark on the history entry that exists only to be pressed Back through.
 *
 * `useBlocker` is the right tool for this and it is not available here: it wants
 * a data router and the application mounts `<BrowserRouter>`, so a page has to
 * hold Back off with the one thing it can do about it, which is to put an entry
 * of its own on the stack while there is something to lose. Back lands on that
 * instead of leaving, and the editor is still there to ask.
 *
 * Kept in react-router's own location state rather than in `window.history`
 * directly, so the router keeps counting its entries correctly and Back goes on
 * meaning what it means everywhere else.
 */
const LEAVE_GUARD = 'orknuxUnsavedWork';

export interface LeaveGuardOptions {
  /**
   * Whether there is work on screen the server has not been told about.
   *
   * A value comparison against what was loaded, not a flag set on a keystroke.
   * Every editor that uses this computes it for itself, because only the page
   * knows what its fields are - but all of them answer the same question, and
   * they answer it the same way: somebody who types a character and deletes it
   * has changed nothing, and a guard that stops them anyway is a guard people
   * learn to click through.
   */
  unsaved: boolean;
  /** Where this editor's list is, for a Back press with nothing behind it. */
  backTo: string;
  /** Store what is on screen. False means the server refused it. */
  save: () => Promise<boolean>;
}

/**
 * The page holding work the server has not been told about, right now.
 *
 * A module-level slot rather than a context, and one slot rather than a list,
 * because at most one page is on screen at a time and this is a property of the
 * screen rather than of a subtree. It exists for the one exit a document
 * listener cannot see: a navigation that no anchor was clicked for.
 *
 * The workspace picker in the top bar is that exit. It is a `<select>` and a
 * `navigate()`, so the capture-phase click listener below - which is looking
 * for an `<a>` - never had anything to catch, and switching workspace while an
 * issue was being written threw the writing away without a word (issue #234).
 */
let armed: ((to: string) => boolean) | null = null;

/**
 * Offer a navigation to whatever is guarding the screen.
 *
 * @returns true when a guard has taken it, meaning the question is now open and
 * the caller must not navigate; false when nothing is guarded and the caller
 * should go ahead exactly as it did before.
 */
export function askBeforeLeaving(to: string): boolean {
  return armed?.(to) ?? false;
}

export interface LeaveGuard {
  /** Whether the question is open. Feeds the dialog's subject. */
  asking: boolean;
  /** Put the question away and stay where we are. */
  stay: () => void;
  /** Go anyway, and lose what is on screen. */
  leave: () => void;
  /** Store it first, then go. False if the save was refused, and we stayed. */
  saveAndLeave: () => Promise<boolean>;
}

/**
 * The three ways out of an editor, and the one question asked before any of them.
 *
 * Written for the function editor under issue #138 and lifted out of it when the
 * object editor and the tool editor turned out to have the same hole. There is
 * nothing about a function in it: the mechanism is the same three exits
 * wherever unsaved work sits, and the only thing that differs between editors is
 * what counts as unsaved - which is why that is the caller's answer to give.
 *
 * A link inside the application is react-router's to follow and this hook's to
 * intercept. Closing the tab or reloading is the browser's, and `beforeunload`
 * is the whole of what a page may say about it. Back is the third, and the one
 * with a workaround in it; see `LEAVE_GUARD` above.
 */
export function useLeaveGuard({ unsaved, backTo, save }: LeaveGuardOptions): LeaveGuard {
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * What is being asked about, or null while nothing is.
   *
   * `to` is where the click was going; null means Back was pressed, which has
   * no destination to name - only a number of entries to go.
   */
  const [leaving, setLeaving] = useState<{ to: string | null } | null>(null);
  /**
   * True from the moment somebody has said go.
   *
   * Everything below stops guarding while this is set. Without it the two acts
   * that leave - the navigation, and the flag going quiet after a save - race
   * each other through the same history stack.
   */
  const goingAnyway = useRef(false);
  /** Read by listeners bound once, which must not close over an old answer. */
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  /** Likewise: the page's save is a new function every render, and only called. */
  const saveRef = useRef(save);
  saveRef.current = save;

  /*
   * Closing the tab, reloading, or going somewhere that is not this application.
   *
   * The browser will not let a page stop this or say anything of its own about
   * it, so this is the one exit that gets the browser's own question in the
   * browser's own words. Exactly the shape the workflow editor uses, and for
   * the same reason: `preventDefault` on the event is the whole of the API.
   */
  useEffect(() => {
    if (!unsaved) return;
    function onLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', onLeaving);
    return () => window.removeEventListener('beforeunload', onLeaving);
  }, [unsaved]);

  /*
   * A link out of the editor, wherever on the page it is.
   *
   * The workflow editor intercepts its links one by one, because it only has to
   * catch the handful it draws itself. An editor page's ways out are mostly not
   * its own: the sidebar, the shell's four sections, the breadcrumb and the back
   * arrow are all shared components, and rewriting them to know about one
   * editor's draft would put this guard in nine files. One listener on the
   * document, in the capture phase, catches every one of them before
   * react-router sees the click - and it is bound only while there is something
   * to lose, so a page with nothing unsaved behaves exactly as it did.
   *
   * A modified click, a middle click, a download and a `target` of its own are
   * all handed straight back to the browser: a new tab takes nothing off this
   * screen. So is a link to another origin - that one is a real unload, and the
   * effect above already asks about it in the only way the browser allows.
   */
  useEffect(() => {
    if (!unsaved) return;
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || goingAnyway.current) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.target !== '' && anchor.target !== '_self') return;
      const href = anchor.getAttribute('href');
      if (href === null || href.startsWith('#')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const to = `${destination.pathname}${destination.search}${destination.hash}`;
      // A link to where we already are is not a way out of anything.
      if (to === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving({ to });
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [unsaved]);

  /*
   * The same interception for a navigation nobody clicked a link for; see
   * `armed` above.
   *
   * Armed only while there is something to lose, and taken down on the way out,
   * so a shell that consults it on every workspace switch finds nothing to ask
   * about on the pages that hold nothing - which is all of them but one.
   */
  useEffect(() => {
    if (!unsaved) return;
    const ask = (to: string) => {
      // Already going: the answer has been given and the navigation is under
      // way, and asking again would be this guard interrupting itself.
      if (goingAnyway.current) return false;
      setLeaving({ to });
      return true;
    };
    armed = ask;
    return () => {
      if (armed === ask) armed = null;
    };
  }, [unsaved]);

  /* Whether the entry we are standing on is the spare one this page pushed. */
  const onGuardEntry = (location.state as Record<string, unknown> | null)?.[LEAVE_GUARD] === true;
  /** Pops this page caused itself, which are not somebody pressing Back. */
  const ourPops = useRef(0);
  /** Set while the spare entry is being taken back off, so it is only done once. */
  const dropping = useRef(false);

  /*
   * The spare history entry: put on while there is work to lose, taken off the
   * moment there is not.
   *
   * Taking it off again is the half that matters most. Leave it on after a save
   * and the first Back press lands on an address the page is already showing,
   * which reads as Back being broken - and a guard that breaks Back when there
   * is nothing to guard is a guard people learn to route around.
   */
  useEffect(() => {
    if (goingAnyway.current) return;
    if (unsaved && !onGuardEntry) {
      dropping.current = false;
      navigate(`${location.pathname}${location.search}`, {
        state: { ...(location.state as Record<string, unknown> | null), [LEAVE_GUARD]: true },
      });
      return;
    }
    if (!unsaved && onGuardEntry && !dropping.current) {
      dropping.current = true;
      ourPops.current += 1;
      navigate(-1);
    }
    // `location.state` is deliberately not a dependency: it is what this effect
    // writes, and reading it back as a trigger is a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsaved, onGuardEntry, location.pathname, location.search, navigate]);

  /*
   * Back, pressed.
   *
   * By the time this runs the spare entry has already been spent, so the page
   * has not moved - both entries are this same address. The effect above
   * notices the spare one has gone and puts another on, so a second press is
   * caught too; all this has to do is ask.
   */
  useEffect(() => {
    function onPop() {
      if (ourPops.current > 0) {
        ourPops.current -= 1;
        dropping.current = false;
        return;
      }
      if (goingAnyway.current || !unsavedRef.current) return;
      setLeaving({ to: null });
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /**
   * Go, having been asked and answered.
   *
   * A named destination replaces the spare entry rather than being pushed on
   * top of it, so Back from wherever this lands is the editor once - not the
   * editor's address twice, the first of which looks like a press that did
   * nothing.
   *
   * Back has no destination, only a distance: two entries, being the spare one
   * and the editor itself. An editor opened straight from a fresh tab has
   * nothing two entries back, and rather than leave somebody pressing a button
   * that does nothing, the way back to the list stands in for it.
   */
  function leaveNow(to: string | null) {
    goingAnyway.current = true;
    setLeaving(null);
    if (to !== null) {
      navigate(to, { replace: onGuardEntry });
      return;
    }
    const here = location.pathname;
    ourPops.current += 1;
    navigate(-2);
    window.setTimeout(() => {
      if (window.location.pathname === here) navigate(backTo, { replace: true });
    }, 300);
  }

  return {
    asking: leaving !== null,
    stay: () => setLeaving(null),
    leave: () => leaveNow(leaving?.to ?? null),
    saveAndLeave: async () => {
      const to = leaving?.to ?? null;
      /*
       * Held up front so the spare entry is not taken back off underneath the
       * navigation this is about to make: a successful save turns the flag off,
       * and the effect that watches it would otherwise step back one entry at
       * the same moment as the step this is taking.
       */
      goingAnyway.current = true;
      if (!(await saveRef.current())) {
        goingAnyway.current = false;
        return false;
      }
      leaveNow(to);
      return true;
    },
  };
}
