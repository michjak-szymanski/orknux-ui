const KEY = 'orknux.lastWorkspace';

/**
 * The workspace the browser was last looking at.
 *
 * The top bar's Workspace tab has to go somewhere from the admin side, where
 * no workspace is in the URL. Sending someone back to where they were beats sending
 * them to whichever workspace happens to sort first.
 */
export function rememberWorkspace(workspaceId: string): void {
  if (workspaceId === '') return;
  try {
    window.localStorage.setItem(KEY, workspaceId);
  } catch {
    // A browser that refuses storage still works; the tab falls back to the
    // first workspace it can see.
  }
}

export function lastWorkspaceId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
