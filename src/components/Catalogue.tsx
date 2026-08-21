import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { ApiError } from '../api/client';
import styles from './Catalogue.module.css';

/**
 * A list of the workspace's things, and the difference between having none of
 * them and not being able to find out.
 *
 * Half the screens in the app fill a picker from a catalogue - the models a
 * chat may speak to, the tools an agent may run, the connections an action may
 * send through - and every one of them was written the same way:
 *
 *     fetchWorkspaceTools(workspaceId).then(setTools).catch(() => setTools([]));
 *
 * which turns "the server did not answer" into "there are none", and then the
 * panel prints *No tools in this workspace yet*. That sentence is an invitation
 * to go and make one. It is exactly the wrong thing to say to somebody whose
 * session has just expired with a workspace full of tools behind it, and it is
 * the wrong thing said at the worst moment: a session that ends while the page
 * is open empties every picker at once, which reads as a workspace that has
 * been wiped.
 *
 * The two states want opposite things from the reader, so they are two states
 * here. `useCatalogue` keeps the failure instead of swallowing it, and
 * `CatalogueNote` prints one sentence or the other in the place the empty state
 * already occupied.
 *
 * It is one shape rather than a sentence per screen because the loading was
 * already one shape: every one of these is a workspace id, one fetch, an array,
 * and a picker that has nothing in it until the array arrives. Where a screen
 * does something else with the answer - choose a default, fill in a name from
 * the row it was started from - that is `onLoaded`, and the screen keeps it.
 */
export interface Catalogue<T> {
  /** What was listed. Empty while it is being asked for, and empty if it failed. */
  items: T[];
  /** Still asking. Neither sentence is true yet, so neither is printed. */
  loading: boolean;
  /** What went wrong and what to do about it, or null if nothing did. */
  failure: string | null;
  /** Ask again. What the *Try again* button does, and callers may too. */
  reload: () => void;
  /**
   * Put one row in without asking again, for something the screen has just
   * made itself - a condition written in the dialog that is picking one. A
   * method rather than a field so that a `Catalogue<Condition>` is still a
   * `Catalogue<unknown>` where only the count and the failure are wanted.
   */
  add(item: T): void;
}

export interface CatalogueOptions<T> {
  /**
   * Do not ask at all. For the screens that mount before they know which
   * workspace they are in, or a dialog that has not been opened yet: a
   * catalogue that was never asked for has not failed, and says nothing.
   */
  skip?: boolean;
  /**
   * Run when the list arrives. This is where a caller picks the default row,
   * or fills a name in from it. Held in a ref, so passing a closure written
   * inline does not set the fetch going again.
   */
  onLoaded?: (items: T[]) => void;
}

/**
 * @param what  the things being listed, spelled as a sentence would spell them
 *              mid-way through: `tools`, `memory catalogs`, `models in this
 *              workspace`. It is the subject of whatever went wrong.
 * @param load  the fetch. One call, one array.
 * @param deps  what makes it worth asking again - the workspace id, usually.
 */
export function useCatalogue<T>(
  what: string,
  load: () => Promise<T[]>,
  deps: unknown[],
  options: CatalogueOptions<T> = {},
): Catalogue<T> {
  const { skip = false, onLoaded } = options;

  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(!skip);
  const [failure, setFailure] = useState<string | null>(null);
  /** Bumped by `reload`; it is in the effect's dependencies, so it re-runs. */
  const [asked, setAsked] = useState(0);

  const latest = useRef(load);
  latest.current = load;
  const arrived = useRef(onLoaded);
  arrived.current = onLoaded;

  useEffect(() => {
    if (skip) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setFailure(null);

    latest
      .current()
      .then((found) => {
        if (!current) return;
        setItems(found);
        setFailure(null);
        setLoading(false);
        arrived.current?.(found);
      })
      .catch((cause: unknown) => {
        if (!current) return;
        // Emptied deliberately: the rows that were there belong to a list this
        // one could not confirm, and the sentence beside them now says so.
        setItems([]);
        setFailure(catalogueFailure(what, cause));
        setLoading(false);
      });

    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, asked, ...deps]);

  const reload = useCallback(() => setAsked((count) => count + 1), []);
  const add = useCallback((item: T) => setItems((present) => [...present, item]), []);

  return { items, loading, failure, reload, add };
}

/**
 * What to tell somebody whose list did not arrive.
 *
 * Not "something went wrong": that is the same non-answer as the empty state,
 * wearing a different coat. There are three different things a reader can do
 * about this and the sentence has to say which one - try it again, sign in
 * again, or go and find somebody with the rights - so the status decides the
 * words.
 *
 * Exported because a picker that draws its own empty line, rather than using
 * `CatalogueNote`, still wants the same sentence.
 */
export function catalogueFailure(what: string, cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) {
      return `Your session has ended, so the ${what} could not be listed. Sign in again to see them.`;
    }
    if (cause.status === 403) {
      return `You are not allowed to list the ${what}. An administrator can grant that.`;
    }
    if (cause.status >= 500) {
      return `The server failed while listing the ${what} (HTTP ${cause.status}). Its log will say why.`;
    }
    // A GraphQL error comes back on a 200 with something specific to say, and
    // that sentence is worth more than anything written here.
    if (cause.message !== '') return `The ${what} could not be listed: ${cause.message}`;
  }

  if (unreachable(cause)) {
    return `The server could not be reached, so the ${what} could not be listed. Check that it is running.`;
  }

  /*
   * Everything else, and on purpose without the raw message. What lands here is
   * a session that expired into a redirect to the sign-in page, so what the
   * browser threw is a JSON parse error about an unexpected `<` - true, and no
   * use at all to the person reading it.
   */
  return `The ${what} could not be listed. If asking again does not help, sign in again.`;
}

/** Whether nothing answered at all: `fetch` rejects rather than resolving. */
function unreachable(cause: unknown): boolean {
  if (cause instanceof TypeError) return true;
  return cause instanceof Error && /failed to fetch|network ?error|load failed/i.test(cause.message);
}

export interface CatalogueNoteProps {
  catalogue: Catalogue<unknown>;
  /**
   * What the list says when it really is empty - the invitation to make the
   * first one. Printed only when the catalogue was actually read. Left out
   * where a screen had no empty state to begin with and this is only here for
   * the failure: an empty picker that says nothing is what it already did.
   */
  empty?: ReactNode;
  /**
   * The style the screen already gave its empty line, so this reads as part of
   * the panel it is in rather than as something bolted on.
   */
  className?: string;
}

/**
 * The line where the rows would have been: the empty state, or the failure and
 * a way to ask again.
 *
 * Nothing at all while it is loading. The old code printed the empty state from
 * the first paint, because an array that has not arrived is also an array of
 * length nothing - so every one of these panels claimed the workspace was empty
 * for as long as the fetch took, and then filled in.
 */
export function CatalogueNote({ catalogue, empty, className }: CatalogueNoteProps) {
  if (catalogue.loading) return null;

  if (catalogue.failure !== null) {
    return (
      <p className={className === undefined ? styles.failed : `${className} ${styles.failed}`} role="alert">
        {catalogue.failure}{' '}
        <button type="button" className={styles.retry} onClick={catalogue.reload}>
          Try again
        </button>
      </p>
    );
  }

  if (catalogue.items.length === 0 && empty !== undefined && empty !== null) {
    return <p className={className}>{empty}</p>;
  }
  return null;
}
