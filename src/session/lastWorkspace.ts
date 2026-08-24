import { useSyncExternalStore } from 'react';

const KEY = 'orknux.lastWorkspace';

/**
 * The workspace the browser was last looking at.
 *
 * The top bar's Workspace tab has to go somewhere from the admin side, where
 * no workspace is in the URL. Sending someone back to where they were beats sending
 * them to whichever workspace happens to sort first.
 *
 * A store rather than a pair of localStorage calls, because it is no longer only
 * read on the way into a page. The chat belongs to no workspace and names none in
 * its address, so *this* is where it reads which one it is about — and a screen
 * that read it once on mount went on showing the old workspace's chats after the
 * selector in the corner had moved (issue #250).
 */
function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // A browser that refuses storage still works; the tab falls back to the
    // first workspace it can see.
    return null;
  }
}

let remembered = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function rememberWorkspace(workspaceId: string): void {
  if (workspaceId === '' || workspaceId === remembered) return;
  remembered = workspaceId;
  try {
    window.localStorage.setItem(KEY, workspaceId);
  } catch {
    // Not remembered is not broken: the choice holds until the tab is closed.
  }
  listeners.forEach((listener) => listener());
}

export function lastWorkspaceId(): string | null {
  return remembered;
}

/** Re-renders whatever reads it whenever the workspace in the corner changes. */
export function useLastWorkspaceId(): string | null {
  return useSyncExternalStore(subscribe, lastWorkspaceId, lastWorkspaceId);
}
