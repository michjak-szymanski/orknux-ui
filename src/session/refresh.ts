import { useSyncExternalStore } from 'react';

const KEY = 'orknux.refreshSeconds';

/** Off, and the intervals the control offers. */
const ALLOWED = [0, 5, 15, 30, 60];

/**
 * How often a screen that watches something reloads it, in seconds. Zero is off.
 *
 * Kept in the browser and shared by every screen that offers it: somebody who
 * has decided how often they want to be interrupted has decided it once, not
 * per page. A store rather than context for the same reason the sidebar uses
 * one — the pages reading it are not all below one provider.
 */
function read(): number {
  try {
    const stored = Number(window.localStorage.getItem(KEY));
    return ALLOWED.includes(stored) ? stored : 0;
  } catch {
    return 0;
  }
}

let seconds = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function refreshSeconds(): number {
  return seconds;
}

export function setRefreshSeconds(next: number): void {
  const chosen = ALLOWED.includes(next) ? next : 0;
  if (chosen === seconds) return;
  seconds = chosen;
  try {
    window.localStorage.setItem(KEY, String(chosen));
  } catch {
    // Not worth failing over: the choice lasts as long as the page does.
  }
  listeners.forEach((listener) => listener());
}

export function useRefreshSeconds(): number {
  return useSyncExternalStore(subscribe, refreshSeconds, refreshSeconds);
}
