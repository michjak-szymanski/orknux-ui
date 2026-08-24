import { useSyncExternalStore } from 'react';

const KEY = 'orknux.recentlyOpened';

/**
 * How many addresses are kept.
 *
 * Twelve rather than a hundred: this is "take me back to what I was just doing",
 * and something forty pages ago is found by name like anything else. A short list
 * is also what keeps the answer honest — every entry has to be checked against
 * what the workspace still holds before it can be drawn, and a long list would be
 * mostly things that have since been renamed away from or deleted.
 */
const KEPT = 12;

/**
 * The addresses this browser last opened one particular thing at, newest first.
 *
 * **Kept in the browser, not on the server, and that is a decision rather than a
 * shortcut.** Three things pushed it here. It is a trail of what one person has
 * been reading, which is the sort of thing that should not become a column an
 * administrator can dump — nobody agreed to their afternoon being recorded when
 * they opened a workflow. It is also about the machine somebody is sitting at, in
 * the same way the theme, the collapsed menu and every keystroke in
 * `shortcut.ts` are: the tabs open on the laptop are not the tabs open on the
 * desktop, and a list merged across both is a list of neither. And a server-side
 * list would need a table, a row per visit, and a retention rule that has to be
 * argued about — for a convenience that is worth nothing the moment it is a
 * request away.
 *
 * What is kept is the address and nothing else. Not the name the thing had when
 * it was opened: a workflow renamed since is listed under the name it has now,
 * because the palette resolves every entry against the names it has already
 * fetched. Storing a label would mean storing a copy that goes stale, and
 * showing somebody an old name is worse than showing them nothing.
 */
function read(): string[] {
  try {
    const held = window.localStorage.getItem(KEY);
    if (held === null) return [];
    const parsed: unknown = JSON.parse(held);
    if (!Array.isArray(parsed)) return [];
    // Filtered rather than trusted: this is a value a person can edit, and a
    // number where a path was expected would otherwise reach `matchPath`.
    return parsed.filter((one): one is string => typeof one === 'string').slice(0, KEPT);
  } catch {
    // A browser that refuses storage, or a value somebody has broken. Neither is
    // worth failing over: the palette simply has no recent list to offer.
    return [];
  }
}

let held: string[] = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(next: string[]): void {
  held = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not remembered is not broken: the list holds until the tab is closed.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Note that this browser has just opened [pathname].
 *
 * Moves an address already in the list to the front rather than adding a second
 * copy — going back to something is what makes it recent, not how many times.
 * Ignored when it is already the newest, which is what a re-render or a replaced
 * history entry looks like from here.
 */
export function rememberVisit(pathname: string): void {
  if (pathname === '' || held[0] === pathname) return;
  write([pathname, ...held.filter((one) => one !== pathname)].slice(0, KEPT));
}

export function recentlyOpened(): readonly string[] {
  return held;
}

/** Re-renders whatever reads it as soon as another page is opened. */
export function useRecentlyOpened(): readonly string[] {
  return useSyncExternalStore(subscribe, recentlyOpened, recentlyOpened);
}
