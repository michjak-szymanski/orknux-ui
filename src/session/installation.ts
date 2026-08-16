import { useEffect, useState } from 'react';

import { fetchInstallationSettings } from '../api/installation';
import type { InstallationSettings } from '../api/installation';

/**
 * What this installation allows, kept for as long as the tab lives.
 *
 * The shell asks on every page — whether to offer the Chat tab — and these
 * settings change about as often as somebody visits the admin screen, so one
 * request a session is the right number. Held in memory rather than
 * localStorage: it is a cache of something the server owns, and a stale copy
 * surviving a reload would hide a switch that has since been pressed.
 */
let cached: InstallationSettings | null = null;

/** In flight, so several shells mounting at once make one request. */
let pending: Promise<InstallationSettings> | null = null;

const listeners = new Set<(settings: InstallationSettings) => void>();

function load(): Promise<InstallationSettings> {
  if (pending !== null) return pending;

  pending = fetchInstallationSettings()
    .then((settings) => {
      cached = settings;
      listeners.forEach((listener) => listener(settings));
      return settings;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/**
 * What this installation allows, or null until it is known.
 *
 * Null rather than a guess, so a page can wait instead of showing a tab for one
 * second and taking it away in the next.
 */
export function useInstallation(): InstallationSettings | null {
  const [settings, setSettings] = useState(cached);

  useEffect(() => {
    listeners.add(setSettings);
    if (cached === null) void load().catch(() => undefined);
    return () => {
      listeners.delete(setSettings);
    };
  }, []);

  return settings;
}

/**
 * Drops the cache and refetches, for when a switch has just been pressed.
 * Everything showing the settings hears the answer.
 */
export function forgetInstallation(): void {
  cached = null;
  void load().catch(() => undefined);
}
