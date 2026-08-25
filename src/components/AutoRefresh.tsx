import { useEffect } from 'react';

import { setRefreshSeconds, useRefreshSeconds } from '../session/refresh';
import { SelectField } from './SelectField';
import { t } from '../i18n';

export interface AutoRefreshProps {
  /** Called on every tick. Should be stable — a `useCallback` load function. */
  onRefresh: () => void;
  /** Paused while something else is already loading. */
  busy?: boolean;
}

/** Off, and the intervals worth offering. Seconds. */
const CHOICES: { value: number; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5s' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
];

/**
 * Reloads a screen on a timer, at an interval the person watching chooses.
 *
 * A running workflow changes without anyone touching the page, so a list of runs
 * is out of date the moment it is drawn. The interval is a choice rather than a
 * fixed number because the right one depends on what is being watched: a run
 * that takes seconds wants five, a queue that turns over hourly does not want to
 * be polled at all.
 *
 * Shared across the screens that want it, and shared as one setting: somebody
 * who has decided how often they want to be interrupted has decided it for all
 * of them.
 */
export function AutoRefresh({ onRefresh, busy = false }: AutoRefreshProps) {
  const seconds = useRefreshSeconds();

  useEffect(() => {
    if (seconds === 0) return;
    const timer = window.setInterval(() => {
      // Skipped rather than queued: a slow load should not stack up ticks
      // behind it and then fire them all at once.
      if (!busy) onRefresh();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [seconds, busy, onRefresh]);

  return (
    <SelectField
      label={t('Auto')}
      value={String(seconds)}
      onChange={(value) => setRefreshSeconds(Number(value))}
      ariaLabel={t('Refresh automatically')}
      options={CHOICES.map((choice) => ({ value: String(choice.value), label: choice.label }))}
    />
  );
}
