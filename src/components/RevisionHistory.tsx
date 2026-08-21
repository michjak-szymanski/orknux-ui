import { useCallback, useEffect, useState } from 'react';

import {
  fetchComponentRevision,
  fetchComponentRevisions,
  restoreComponentRevision,
} from '../api/revisions';
import type {
  ComponentRevision,
  ComponentRevisionDetail,
  ComponentRevisionKind,
} from '../api/revisions';
import { timeAgo } from '../api/tools';
import { FieldHint } from './FieldHint';
import { Loader } from './Loader';
import styles from './RevisionHistory.module.css';

export interface RevisionHistoryProps {
  kind: ComponentRevisionKind;
  componentId: string;
  /**
   * What it is called now, so a row can say when it was called something else.
   *
   * A rename is the change least visible in a list of dates and most confusing
   * to restore blind: somebody putting back yesterday's version has a right to
   * know it will also put back yesterday's name.
   */
  currentName?: string;
  /** Told after a restore, so the page can refetch what it is showing. */
  onRestored?: () => void;
}

/**
 * What this component has been, and putting one of those back.
 *
 * Every save keeps the state it replaced, so this list is the states that are
 * no longer current — the newest of them is what the last save wrote over, and
 * what is on screen above it is the version after that. The list is fetched
 * when the panel is opened rather than with the component: a tool edited fifty
 * times in an afternoon is fifty copies of its source, and none of that is
 * wanted by somebody who came to change a description.
 *
 * A row is opened to read it, and the code or the prose comes down with it.
 * Restoring is one press and no confirmation, deliberately: the restore records
 * what it displaces, so the button that made the mistake is the button that
 * takes it back, and a dialog guarding an undoable action is a dialog people
 * learn to dismiss.
 */
export function RevisionHistory({ kind, componentId, currentName, onRestored }: RevisionHistoryProps) {
  const [revisions, setRevisions] = useState<ComponentRevision[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ComponentRevisionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    // Nothing saved yet has nothing to have been. A page that draws this while
    // creating something would otherwise wait on a fetch it never makes.
    if (componentId === '') {
      setRevisions([]);
      return;
    }
    fetchComponentRevisions(kind, componentId)
      .then((held) => {
        setRevisions(held);
        setError(null);
      })
      .catch((cause: unknown) => {
        setRevisions([]);
        setError(cause instanceof Error ? cause.message : 'Could not read the history.');
      });
  }, [kind, componentId]);

  useEffect(load, [load]);

  async function openRow(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await fetchComponentRevision(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that version.');
    }
  }

  async function restore(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await restoreComponentRevision(id);
      setOpenId(null);
      setDetail(null);
      // The restore is itself a version, so the list it came from is now one
      // row longer - reading it again is the only honest way to draw it.
      load();
      onRestored?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be restored.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.history} aria-label="History">
      {/*
        What this panel is, behind the (?) rather than under the heading.

        `UI-DESIGN-RULES.md`: an explanation goes behind a question mark beside
        the thing it explains, and this was a paragraph of it under a heading -
        printed to everybody who opened an editor, for the one reader who ever
        wondered where old versions go. On the heading rather than on a row,
        because it explains the whole panel.

        The sentence below it stayed where it is on purpose - but only the half
        of it that is a sentence about this component. "Nothing yet." is the
        state; "the next save will keep what this says now, and it will appear
        here" was the panel teaching how it fills, said a second time three
        inches under a control that exists to say exactly that. It is folded
        into the note above rather than deleted: "and it appears here" is the
        same fact, said once.
      */}
      <h2 className={styles.heading}>
        <span className={styles.headingWithHint}>
          History
          <FieldHint label="History">
            Every save keeps what this was before it, and it appears here. How long they are kept
            is an administrator’s setting.
          </FieldHint>
        </span>
      </h2>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {revisions === null ? (
        <Loader />
      ) : revisions.length === 0 ? (
        // A status says the state. It does not teach; the (?) above does that.
        <p className={styles.empty}>Nothing yet.</p>
      ) : (
        <ul className={styles.list}>
          {revisions.map((revision) => (
            <li key={revision.id} className={styles.item}>
              <button
                type="button"
                className={styles.row}
                onClick={() => void openRow(revision.id)}
                aria-expanded={openId === revision.id}
              >
                <span className={styles.when}>{timeAgo(revision.savedAt)}</span>
                <span className={styles.who}>{revision.savedBy === '' ? 'unknown' : revision.savedBy}</span>
                {currentName !== undefined && revision.name !== currentName && (
                  <span className={styles.renamed}>called {revision.name}</span>
                )}
              </button>

              {openId === revision.id && (
                <div className={styles.detail}>
                  {detail === null ? (
                    <Loader />
                  ) : detail.content === null || detail.content === '' ? (
                    <p className={styles.empty}>This version had nothing written in it.</p>
                  ) : (
                    <pre className={styles.content} aria-label="This version">
                      {detail.content}
                    </pre>
                  )}
                  <button
                    type="button"
                    className={styles.restore}
                    onClick={() => void restore(revision.id)}
                    disabled={busy}
                  >
                    Restore this version
                  </button>
                  <p className={styles.undo}>
                    Restoring keeps what it replaces, so this is undoable from the row it adds.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
