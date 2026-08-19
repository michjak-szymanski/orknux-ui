import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchVariables } from '../../api/variables';
import type { Variable } from '../../api/variables';

/** More variables than a workspace realistically keeps, so a picker is complete. */
const LIMIT = 500;

/**
 * The workspace's variables, for a screen that offers them, kept current.
 *
 * A picker like that sits on a page somebody leaves open — a function editor
 * most of all — while the variable it ought to be offering is made somewhere
 * else: the Variables page, often in another tab. Read once when the page
 * mounted, the list was then wrong for as long as the page stayed open, and
 * reloading it was the only way to be offered what you had just made.
 *
 * So it is read again whenever the window comes back to the front, which is
 * exactly the moment somebody returns from making one; and `refresh` is there
 * for a picker to call as it is reached for. Not on a timer and not on every
 * render: the list changes rarely, and those are the two moments it matters.
 */
export function useWorkspaceVariables(workspaceId: string): {
  variables: Variable[];
  /** Reads the list again. Meant for events; a failure leaves what is held. */
  refresh: () => void;
} {
  const [variables, setVariables] = useState<Variable[]>([]);
  /**
   * Whether one is already on its way.
   *
   * The moments worth asking at arrive in pairs — a tab shown and a window
   * focused, a press and the focus it moves — and each pair would otherwise be
   * two queries for the same names within a few milliseconds.
   */
  const asking = useRef(false);

  const refresh = useCallback(() => {
    if (workspaceId === '' || asking.current) return;
    asking.current = true;
    fetchVariables(workspaceId, { size: LIMIT })
      .then((page) => setVariables(page.content))
      // Left as it was rather than emptied: whatever is wrong, taking away the
      // options somebody is looking at does not tell them anything.
      .catch(() => undefined)
      .finally(() => {
        asking.current = false;
      });
  }, [workspaceId]);

  useEffect(refresh, [refresh]);

  /*
   * Two events say the same thing — a tab shown, a window focused — and a
   * glance at another window and back fires both. Asking twice for a short list
   * of names costs nothing; being out of date is the thing that gets noticed,
   * and nothing on the screen blanks while the answer is on its way.
   */
  useEffect(() => {
    function again() {
      if (document.visibilityState !== 'visible') return;
      refresh();
    }
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [refresh]);

  return { variables, refresh };
}
