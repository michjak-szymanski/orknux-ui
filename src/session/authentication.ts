import { useEffect, useState } from 'react';

import { authMethod } from '../api/session';
import type { AuthMethodInfo } from '../api/session';

/**
 * How this installation signs people in, kept for as long as the tab lives.
 *
 * The shell asks on every page — whether to draw the notice across the top, and
 * whether the account menu has anything to sign out of — and the answer is a
 * deployment setting that cannot change without a restart. So it is fetched once
 * and shared, the way `installation.ts` shares what an installation allows;
 * without the cache this would be one request per navigation, on every page, for
 * an answer that is the same every time.
 *
 * In memory rather than localStorage. It is a cache of something the server owns,
 * and a stale copy surviving a reload could tell somebody that authentication is
 * off on an installation where it has since been turned back on — which is the one
 * direction this must never be wrong in.
 */
let cached: AuthMethodInfo | null = null;

/** In flight, so several shells mounting at once make one request. */
let pending: Promise<AuthMethodInfo> | null = null;

const listeners = new Set<(found: AuthMethodInfo) => void>();

function load(): Promise<AuthMethodInfo> {
  if (pending !== null) return pending;

  pending = authMethod()
    .then((found) => {
      cached = found;
      listeners.forEach((listener) => listener(found));
      return found;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/**
 * How this installation signs people in, or null until it is known.
 *
 * Null rather than a guess, so nothing is drawn for one frame and taken away in
 * the next — and, more to the point, so a notice saying the door is open is drawn
 * only once the server has actually said so.
 */
export function useAuthentication(): AuthMethodInfo | null {
  const [found, setFound] = useState(cached);

  useEffect(() => {
    listeners.add(setFound);
    if (cached === null) void load().catch(() => undefined);
    return () => {
      listeners.delete(setFound);
    };
  }, []);

  return found;
}
