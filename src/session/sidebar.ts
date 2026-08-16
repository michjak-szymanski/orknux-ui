import { useSyncExternalStore } from 'react';

const KEY = 'orknux.sidebarCollapsed';

/**
 * Whether the menu column is collapsed to its icons.
 *
 * Kept in the browser for the same reason the theme is: it is a property of the
 * window somebody is working in, not of who they are. Someone who collapses it
 * on a laptop has not asked for it collapsed on a desk with room to spare.
 *
 * A store rather than React context, because the pages that need to read it are
 * *above* the shell that owns it: a page builds its sidebar and hands it over as
 * a prop, so any hook it calls runs outside the provider and would always see
 * the default. Position in the tree does not matter to a store.
 */
function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'true';
  } catch {
    // A browser that refuses storage still works; the menu is simply open.
    return false;
  }
}

let collapsed = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sidebarCollapsed(): boolean {
  return collapsed;
}

export function setSidebarCollapsed(next: boolean): void {
  if (next === collapsed) return;
  collapsed = next;
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    // Not worth failing over: the choice lasts as long as the page does.
  }
  listeners.forEach((listener) => listener());
}

/** Re-renders whatever reads it whenever the column opens or closes. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, sidebarCollapsed, sidebarCollapsed);
}
