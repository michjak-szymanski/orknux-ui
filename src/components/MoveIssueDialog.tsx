import { useEffect, useRef, useState } from 'react';

import chevronDown12Icon from '../assets/chevron-down-12.svg';
import { moveIssue } from '../api/issues';
import type { Issue } from '../api/issues';
import { fetchWorkspaces } from '../api/workspaces';
import type { Workspace } from '../api/workspaces';
import styles from './Dialog.module.css';

/**
 * How many workspaces the list offers.
 *
 * An installation with more than this many is one where a picker of any length
 * is the wrong thing, and nobody has one yet. Asking for a hundred is one round
 * trip rather than a paging control inside a dialog that exists to ask a single
 * question.
 */
const MANY = 100;

export interface MoveIssueDialogProps {
  /** The issue to move, or null when the dialog is closed. */
  issue: Issue | null;
  onClose: () => void;
  onMoved: (moved: Issue) => void;
}

/**
 * Asks where an issue should go, and says what the move costs.
 *
 * The warning is the reason this is a dialog rather than a menu item. Moving an
 * issue changes its number, because numbers are per workspace - so the address
 * people have been sending each other stops working, and every `#4` written in
 * some other issue goes on pointing at whatever holds 4 where it was written.
 * Nothing can fix those without editing what other people wrote, so the honest
 * thing is to say it before the button is pressed rather than afterwards.
 *
 * Administrators only, and the page only offers it to them - the server refuses
 * it for anybody else, and the two agree on purpose.
 */
export function MoveIssueDialog({ issue, onClose, onMoved }: MoveIssueDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [chosen, setChosen] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (issue !== null && !dialog.open) {
      setError(null);
      setSubmitting(false);
      setChosen('');
      dialog.showModal();
    } else if (issue === null && dialog.open) {
      dialog.close();
    }
  }, [issue]);

  /*
   * The list is read when the dialog opens rather than when the page loads.
   * Most readings of an issue never move it, and an installation's workspaces
   * are not this page's business the rest of the time.
   */
  useEffect(() => {
    if (issue === null) return;

    let current = true;
    void fetchWorkspaces(0, MANY)
      .then((page) => {
        if (!current) return;
        // Never the one it is already in: the server refuses that, and an
        // option that can only produce a refusal is not an option.
        setWorkspaces(page.content.filter((workspace) => workspace.id !== issue.workspaceId));
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Could not read the workspaces.');
      });
    return () => {
      current = false;
    };
  }, [issue]);

  async function handleMove() {
    if (issue === null || chosen === '' || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      onMoved(await moveIssue(issue.id, chosen));
    } catch (cause) {
      /*
       * Shown as the server said it. A refusal names the thing standing in the
       * way - an assignee or an observer that does not exist where the issue is
       * going - and rewording it here would drop the one detail that tells an
       * administrator what to change before trying again.
       */
      setError(cause instanceof Error ? cause.message : 'Could not move the issue.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 className={styles.title}>Move Issue</h2>
        </header>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="move-issue-workspace">
              Move to
            </label>
            {/*
              In a wrapper with a chevron beside it, like every other select in
              a dialog. It had neither: `.input` draws no box of its own — the
              wrapper is the box — so this one was a bare platform control in a
              row of fields the page had drawn itself.
            */}
            <div className={styles.inputWrapper}>
              <select
                id="move-issue-workspace"
                className={`${styles.input} ${styles.select}`}
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                disabled={submitting}
              >
                <option value="">Choose a workspace…</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
            {/*
              Printed rather than behind a (?): this is what moving does, and
              renumbering an issue breaks every address anybody has written down.
              A consequence has to be read before the button is pressed, not
              found by somebody who thought to hover first.
            */}
            <p className={styles.fieldHint}>
              Its comments, labels, links, observers and files come with it. It is given a number that is free where it
              lands, so <strong>#{issue?.number}</strong> stops being this issue: the address people have been using
              will not find it, and references written as #{issue?.number} elsewhere will point at whatever holds that
              number here. The move is written into the issue and into both workspaces&apos; activity.
            </p>
          </div>
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.filled}
            onClick={() => void handleMove()}
            disabled={submitting || chosen === ''}
          >
            {submitting ? 'Moving…' : 'Move issue'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
