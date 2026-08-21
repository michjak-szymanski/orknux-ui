import { useCallback, useEffect, useState } from 'react';

import { fetchWorkflowPublications, restoreWorkflowPublication } from '../api/revisions';
import type { WorkflowPublication } from '../api/revisions';
import { timeAgo } from '../api/tools';
import { FieldHint } from './FieldHint';
import { Loader } from './Loader';
import styles from './RevisionHistory.module.css';

export interface PublicationHistoryProps {
  workspaceId: string;
  workflowId: string;
  /** Told after a restore, so the page can say what the badge is now. */
  onRestored?: (status: string) => void;
}

/**
 * Every publication of a workflow: its versions.
 *
 * A workflow is the one component with a draft, and by the owner's rule a draft
 * is not a version — the version is what was published, the way a commit on
 * main is not a release. So this is the list of publications rather than the
 * list of saves, and there is no history here for a workflow nobody has
 * published.
 *
 * Restoring publishes the old graph again rather than reviving its row, which
 * is why the list only ever grows and why a restored publication says which
 * one it copied. **It does not touch the draft**: that is what somebody is in
 * the middle of, it is not versioned, and overwriting it would destroy
 * unpublished work with nothing to recover it from. The page is told the new
 * status so it can say whether what is drawn is still what runs.
 */
export function PublicationHistory({ workspaceId, workflowId, onRestored }: PublicationHistoryProps) {
  const [publications, setPublications] = useState<WorkflowPublication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (workspaceId === '' || workflowId === '') return;
    fetchWorkflowPublications(workspaceId, workflowId)
      .then((held) => {
        setPublications(held);
        setError(null);
      })
      .catch((cause: unknown) => {
        setPublications([]);
        setError(cause instanceof Error ? cause.message : 'Could not read the publications.');
      });
  }, [workspaceId, workflowId]);

  useEffect(load, [load]);

  async function restore(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await restoreWorkflowPublication(workspaceId, id);
      load();
      onRestored?.(status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be restored.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.history} aria-label="Publications">
      {/*
        What a publication is, behind the (?) rather than under the heading.

        The same split the History panel next door was given, and it is cleaner
        here: the paragraph explains what a version of a workflow *is*, which is
        a thing to be told once, and the line below it is the state of this
        workflow, which is a thing to be told every time.

        Three sentences, and the middle one arrived from below. The empty state
        used to read "Never published. Publishing this workflow makes a version
        of it, and it will appear here" - a state and then a lesson in how the
        panel fills, which is what the (?) beside it is for. The state stayed;
        the lesson moved up here and is said once.

        Nothing is shortened on the way in. "The newest publication is what
        triggers and schedules run" is the one fact somebody needs before
        restoring an older one - a note that explained what a version is and
        left out which one runs would be the wrong half kept.
      */}
      <h2 className={styles.heading}>
        <span className={styles.headingWithHint}>
          Publications
          <FieldHint label="Publications">
            A workflow’s versions are what was published, not what was saved — a draft is a
            draft. Publishing this workflow makes a version of it, and it appears here. The
            newest publication is what triggers and schedules run.
          </FieldHint>
        </span>
      </h2>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {publications === null ? (
        <Loader />
      ) : publications.length === 0 ? (
        // The state of this workflow, and only that. The rest is in the (?).
        <p className={styles.empty}>Never published.</p>
      ) : (
        <ul className={styles.list}>
          {publications.map((publication) => (
            <li key={publication.id} className={styles.item}>
              <div className={styles.publicationRow}>
                <span className={styles.when}>{timeAgo(publication.publishedAt)}</span>
                <span className={styles.who}>
                  {publication.publishedBy === '' ? 'unknown' : publication.publishedBy}
                </span>
                {publication.restoredFrom !== null && (
                  <span className={styles.renamed}>restored from an earlier one</span>
                )}
                {publication.current ? (
                  <span className={styles.live}>Live</span>
                ) : (
                  <button
                    type="button"
                    className={styles.restore}
                    onClick={() => void restore(publication.id)}
                    disabled={busy}
                  >
                    Restore
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {publications !== null && publications.length > 0 && (
        <p className={styles.undo}>
          Restoring publishes that graph again and leaves the draft on the canvas alone, so nothing
          half-finished is lost.
        </p>
      )}
    </section>
  );
}
