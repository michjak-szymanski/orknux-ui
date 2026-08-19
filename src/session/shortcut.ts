import { useSyncExternalStore } from 'react';

const KEY = 'orknux.paletteShortcut';
const SAVE_KEY = 'orknux.saveShortcut';
const FORMAT_KEY = 'orknux.formatShortcut';
const TURN_KEY = 'orknux.turnShortcut';
const UNDO_KEY = 'orknux.undoShortcut';
const REDO_KEY = 'orknux.redoShortcut';
const DUPLICATE_KEY = 'orknux.duplicateShortcut';

/** What opens the palette when nothing has been chosen. */
export const DEFAULT_SHORTCUT = 'Ctrl+Q';

/**
 * What saves an editor when nothing has been chosen.
 *
 * Ctrl+S, because that is what hands already do. It means the browser's own
 * save-page has to be prevented wherever this is honoured — which is most of the
 * reason it is worth binding at all.
 */
export const DEFAULT_SAVE_SHORTCUT = 'Ctrl+S';

/**
 * What lays out the code when nothing has been chosen.
 *
 * Ctrl+Shift+F, because that is what every editor with a formatter uses and hands
 * already know it. It has to be prevented like the others: it is a browser find in
 * some, and full-screen in others.
 */
export const DEFAULT_FORMAT_SHORTCUT = 'Ctrl+Shift+F';

/**
 * What turns a node on the canvas when nothing has been chosen.
 *
 * Bare R, unlike the others: the graph is not a text field, so a letter on its
 * own is free there, and turning is something somebody does four times in a row
 * - a modifier on each press is three modifiers too many. It is ignored while a
 * caret is in a box, where R is somebody typing the letter.
 */
export const DEFAULT_TURN_SHORTCUT = 'R';

/**
 * What steps back and forward when nothing has been chosen.
 *
 * Ctrl+Z and Ctrl+Shift+Z, which every machine already answers to. Ctrl+Y is
 * honoured for redo as well and is not rebindable: it is the other habit, and
 * taking it away from somebody who has it would be a change nobody asked for.
 */
export const DEFAULT_UNDO_SHORTCUT = 'Ctrl+Z';
export const DEFAULT_REDO_SHORTCUT = 'Ctrl+Shift+Z';

/**
 * What copies the selected node when nothing has been chosen.
 *
 * Ctrl+D, which is what every canvas with a duplicate in it uses. It has to be
 * prevented wherever it is honoured: the browser's own meaning for it is a
 * bookmark, and a graph editor that quietly bookmarked the page every time
 * somebody copied a node would be the worse of the two surprises.
 */
export const DEFAULT_DUPLICATE_SHORTCUT = 'Ctrl+D';

/**
 * Which keystroke opens the command palette, written the way it is shown:
 * modifiers in a fixed order, then the key — `Ctrl+Q`, `Ctrl+Shift+P`, `Alt+G`.
 *
 * Anything can be chosen, because which keys are free depends on the machine:
 * Ctrl+K is a browser's address bar on some and a chat search on others, Ctrl+Q
 * quits an application on a Mac, and somebody's window manager has taken the
 * one we would have picked. Whoever is typing knows what they can spare.
 *
 * Kept in the browser, like the theme and the collapsed menu: it belongs to the
 * keyboard in front of somebody, not to their account.
 */
export type Shortcut = string;

/** The keys that are only ever part of a combination, never the whole of one. */
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph', 'CapsLock', 'Dead']);

/**
 * One remembered keystroke: read it, set it, subscribe to it.
 *
 * A factory because there is more than one now — opening the palette, and saving —
 * and two copies of this would be two places to fix the day local storage throws or
 * what is stored changes shape.
 */
function remembered(key: string, fallback: Shortcut) {
  const read = (): Shortcut => {
    try {
      return window.localStorage.getItem(key)?.trim() || fallback;
    } catch {
      return fallback;
    }
  };

  let held: Shortcut = read();
  const listeners = new Set<() => void>();

  const get = (): Shortcut => held;

  const set = (next: Shortcut): void => {
    if (next === held) return;
    held = next;
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Not worth failing over: the choice lasts as long as the page does.
    }
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { get, set, use: (): Shortcut => useSyncExternalStore(subscribe, get, get) };
}

const palette = remembered(KEY, DEFAULT_SHORTCUT);
const saving = remembered(SAVE_KEY, DEFAULT_SAVE_SHORTCUT);
const formatting = remembered(FORMAT_KEY, DEFAULT_FORMAT_SHORTCUT);
const turning = remembered(TURN_KEY, DEFAULT_TURN_SHORTCUT);
const undoing = remembered(UNDO_KEY, DEFAULT_UNDO_SHORTCUT);
const redoing = remembered(REDO_KEY, DEFAULT_REDO_SHORTCUT);
const duplicating = remembered(DUPLICATE_KEY, DEFAULT_DUPLICATE_SHORTCUT);

export function paletteShortcut(): Shortcut {
  return palette.get();
}

export function setPaletteShortcut(next: Shortcut): void {
  palette.set(next);
}

export function usePaletteShortcut(): Shortcut {
  return palette.use();
}

export function saveShortcut(): Shortcut {
  return saving.get();
}

export function setSaveShortcut(next: Shortcut): void {
  saving.set(next);
}

export function useSaveShortcut(): Shortcut {
  return saving.use();
}

export function formatShortcut(): Shortcut {
  return formatting.get();
}

export function setFormatShortcut(next: Shortcut): void {
  formatting.set(next);
}

export function useFormatShortcut(): Shortcut {
  return formatting.use();
}

export function turnShortcut(): Shortcut {
  return turning.get();
}

export function setTurnShortcut(next: Shortcut): void {
  turning.set(next);
}

export function useTurnShortcut(): Shortcut {
  return turning.use();
}

export function undoShortcut(): Shortcut {
  return undoing.get();
}

export function setUndoShortcut(next: Shortcut): void {
  undoing.set(next);
}

export function useUndoShortcut(): Shortcut {
  return undoing.use();
}

export function redoShortcut(): Shortcut {
  return redoing.get();
}

export function setRedoShortcut(next: Shortcut): void {
  redoing.set(next);
}

export function useRedoShortcut(): Shortcut {
  return redoing.use();
}

export function duplicateShortcut(): Shortcut {
  return duplicating.get();
}

export function setDuplicateShortcut(next: Shortcut): void {
  duplicating.set(next);
}

export function useDuplicateShortcut(): Shortcut {
  return duplicating.use();
}

/** One key, named as somebody would read it rather than as the browser sends it. */
function keyName(key: string): string {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * The keystroke that was just pressed, written the way it is shown.
 *
 * Null while only modifiers are held: `Ctrl` on its own is somebody on their way
 * to pressing something, not a choice.
 */
export function describe(event: KeyboardEvent): Shortcut | null {
  if (MODIFIER_KEYS.has(event.key)) return null;

  const held: string[] = [];
  if (event.ctrlKey) held.push('Ctrl');
  if (event.altKey) held.push('Alt');
  if (event.shiftKey) held.push('Shift');
  if (event.metaKey) held.push('Meta');
  held.push(keyName(event.key));
  return held.join('+');
}

/**
 * Whether a keystroke without a modifier is a reasonable thing to reserve.
 *
 * A bare letter would open the palette every time somebody typed it into a form,
 * so only the keys nothing else claims — the function row — stand alone.
 */
export function usable(chosen: Shortcut): boolean {
  const parts = chosen.split('+');
  if (parts.length > 1) return true;
  return /^F([1-9]|1[0-2])$/.test(parts[0] ?? '');
}

/** Whether this keystroke is the one chosen. */
export function matches(event: KeyboardEvent, chosen: Shortcut): boolean {
  const said = describe(event);
  return said !== null && said.toLowerCase() === chosen.trim().toLowerCase();
}
