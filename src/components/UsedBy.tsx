import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { dependantLabel, dependantPath, fetchDependants } from '../api/dependants';
import type { Dependant, DependencyKind } from '../api/dependants';
import { FieldHint } from './FieldHint';
import { Loader } from './Loader';
import { OpenDefinitionIcon } from './OpenDefinitionIcon';
import styles from './UsedBy.module.css';

export interface DependantListProps {
  /** The rows, already fetched. */
  entries: Dependant[];
  /** How many are in workspaces this reader cannot open. Named nowhere. */
  hidden: number;
  /**
   * Whether to say which workspace each row is in.
   *
   * True only for a library, which is the installation's: "slugify in Backend"
   * is the whole answer there and "slugify" is half of it. Everything else is
   * asked from inside the workspace it is answered in.
   */
  showWorkspace?: boolean;
}

/**
 * The rows themselves, for a caller that already has them.
 *
 * Apart from [UsedBy] because the libraries screen fetches its dependants with
 * the library - one query for the whole table rather than one per row - and
 * because the same list is what its delete refusal has to draw. Two callers,
 * one set of rows, which is the point of the whole exercise.
 */
export function DependantList({ entries, hidden, showWorkspace = false }: DependantListProps) {
  if (entries.length === 0 && hidden === 0) {
    return <p className={styles.empty}>Nothing uses this yet.</p>;
  }

  return (
    <>
      <ul className={styles.list} data-dependants>
        {entries.map((entry) => (
          <li className={styles.item} key={`${entry.kind}-${entry.id}`}>
            <Link
              className={styles.row}
              to={dependantPath(entry)}
              data-dependant-kind={entry.kind}
              data-dependant-name={entry.name}
            >
              <span className={styles.name}>{entry.name}</span>
              <span className={styles.kind}>{dependantLabel(entry)}</span>
              {showWorkspace && entry.workspaceName !== null && (
                <span className={styles.where}>in {entry.workspaceName}</span>
              )}
              <span className={styles.mark}>
                <OpenDefinitionIcon />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {/*
        Counted, never named. A row in a workspace this reader cannot open is a
        workspace they were not told exists; dropping it silently would answer
        "what uses this?" with rows missing, which is the worse of the two.
      */}
      {hidden > 0 && (
        <p className={styles.empty} data-dependants-hidden={hidden}>
          {hidden === 1 ? 'And one more in a workspace you cannot open.' : `And ${hidden} more in workspaces you cannot open.`}
        </p>
      )}
    </>
  );
}

export interface DependantLinksProps {
  entries: Dependant[];
  hidden: number;
  /** Whether to say which workspace each one is in. */
  showWorkspace?: boolean;
  /** What stands where the names would be when there are none. */
  none: string;
}

/**
 * The same rows on one line, for a place that has no room for a list.
 *
 * The libraries table draws a library as three lines under its key, and the
 * third of them is who imports it. A vertical list there would push the rows
 * apart for the sake of an answer that is usually one name - so the names stay
 * where they were and each becomes something to press, which is the whole of
 * #268. Sharing [dependantPath] with the panel is the point: one place decides
 * where a row goes, so a name that opens the wrong thing is one bug and not two.
 */
export function DependantLinks({ entries, hidden, showWorkspace = false, none }: DependantLinksProps) {
  if (entries.length === 0 && hidden === 0) return <>{none}</>;

  return (
    <>
      {entries.map((entry, at) => (
        <span key={`${entry.kind}-${entry.id}`}>
          {at > 0 && <span className={styles.separator}>{'·'}</span>}
          <Link
            className={styles.inlineRow}
            to={dependantPath(entry)}
            data-dependant-kind={entry.kind}
            data-dependant-name={entry.name}
            title={`Open the ${dependantLabel(entry)} ${entry.name}`}
          >
            {entry.name}
          </Link>
          {showWorkspace && entry.workspaceName !== null && ` in ${entry.workspaceName}`}
        </span>
      ))}
      {hidden > 0 && (
        <span className={styles.separator} data-dependants-hidden={hidden}>
          {`· ${hidden} in workspaces you cannot open`}
        </span>
      )}
    </>
  );
}

export interface UsedByProps {
  kind: DependencyKind;
  componentId: string;
}

/**
 * Where this component is used, and a way to each of them.
 *
 * Issue #258. Being refused a delete with a sentence naming three things is
 * being told the answer at the moment it is least useful and in the form least
 * usable - so the same answer is on the component's own page, before anybody
 * tries to remove it, and every row opens the thing that names it.
 *
 * A panel rather than a tab or a control to press. It is short by nature - most
 * components are used by nothing or by one thing - and a list that is usually
 * three lines does not earn a click to reveal it. It sits where the History
 * panel sits, in the same rhythm, because the two answer the neighbouring
 * questions: what has this been, and what leans on it.
 *
 * The empty state says so in words. An empty box on a page is indistinguishable
 * from a panel that failed to load, and "nothing uses this" is the answer
 * somebody about to delete something actually came for.
 *
 * Fetched when it is drawn, and not again. Nothing this page can do changes the
 * answer: what points at a component is edited on the pages of the things that
 * point at it, never here. Fetched apart from the component for the reason the
 * History panel is - somebody who came to change a description should not be
 * made to wait on a question they did not ask.
 */
export function UsedBy({ kind, componentId }: UsedByProps) {
  const [entries, setEntries] = useState<Dependant[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // Nothing saved yet is used by nothing, and a page drawing this while
    // creating something would otherwise wait on a fetch it never makes.
    if (componentId === '') {
      setEntries([]);
      setHidden(0);
      return;
    }
    fetchDependants(kind, componentId)
      .then((found) => {
        setEntries(found.entries);
        setHidden(found.hidden);
        setError(null);
      })
      .catch((cause: unknown) => {
        setEntries([]);
        setHidden(0);
        setError(cause instanceof Error ? cause.message : 'Could not read what uses this.');
      });
  }, [kind, componentId]);

  useEffect(load, [load]);

  return (
    <section className={styles.usedBy} aria-label="Used by">
      <h2 className={styles.heading}>
        <span className={styles.headingWithHint}>
          Used by
          <FieldHint label="Used by">
            Everything that would break if this went away, and the same list the delete refuses on. A workflow
            appears here when a node points at this - and as <em>published workflow</em> when the frozen copy a
            trigger runs does, which redrawing the canvas will not change. Nothing that merely ran it once is here;
            this is what points at it now.
          </FieldHint>
        </span>
      </h2>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {entries === null ? (
        <Loader />
      ) : (
        <DependantList entries={entries} hidden={hidden} showWorkspace={kind === 'LIBRARY'} />
      )}
    </section>
  );
}
