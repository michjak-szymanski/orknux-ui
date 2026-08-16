import { fetchWorkspaces } from '../api/workspaces';
import type { Workspace } from '../api/workspaces';

/**
 * The workspace list, kept for as long as the tab lives.
 *
 * Every page renders its own AppShell, so moving between pages inside a
 * workspace unmounts the sidebar and mounts a new one. Without somewhere to keep
 * the list, each of those mounts started from an empty array and refetched, and
 * the workspace selector visibly emptied and refilled on a navigation that never
 * left the workspace.
 *
 * Deliberately in memory rather than localStorage: this is a cache of something
 * the server owns, and a stale list surviving a reload would be worse than a
 * fetch.
 */
let cached: Workspace[] | null = null;

/** In flight, so several sidebars mounting at once make one request. */
let pending: Promise<Workspace[]> | null = null;

/** What is known right now, for painting before the network answers. */
export function cachedWorkspaces(): Workspace[] | null {
  return cached;
}

/**
 * Fetches the list and updates the cache, sharing a request already in flight.
 *
 * Callers that have a cached list should paint it first and treat this as a
 * revalidation: it resolves with the fresh list, which is usually identical.
 */
export function loadWorkspaces(size: number): Promise<Workspace[]> {
  if (pending !== null) return pending;

  pending = fetchWorkspaces(0, size)
    .then((page) => {
      cached = page.content;
      return page.content;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/**
 * Drops the cache, for when the list is known to have changed — a workspace
 * created, renamed or deleted. The next mount fetches again.
 */
export function forgetWorkspaces(): void {
  cached = null;
}
