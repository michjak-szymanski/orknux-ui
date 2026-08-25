import { useState } from 'react';

import { ASSIGNEE_KIND_LABEL, observeIssue, unobserveIssue } from '../api/issues';
import type { Assignee, AssigneeKind, Issue, IssueObserver } from '../api/issues';
import { initialsOf } from '../api/users';
import { AssigneePicker } from './AssigneePicker';
import styles from './ObserverList.module.css';
import { t } from '../i18n';

/**
 * What may observe, held out here rather than written inline.
 *
 * The picker refetches when this changes, and an array written into the props
 * is a new array on every render - which would ask the server for the list
 * again every time anything on the page moved.
 *
 * A model is not on it. Observing is a statement about who reads, and a model
 * has nowhere to read: the news is resolved to a person by their token and to
 * an agent by name, and there is no third door.
 */
const CAN_OBSERVE: AssigneeKind[] = ['USER', 'AGENT'];

export interface ObserverListProps {
  workspaceId: string;
  issueId: string;
  observers: IssueObserver[];
  /** Whether this person may put somebody other than themselves on the list. */
  admin: boolean;
  /** The issue as the server now has it, so the page redraws from one answer. */
  onChanged: (issue: Issue) => void;
}

/**
 * Who else hears about this issue.
 *
 * An issue's news reached exactly two audiences: whoever has it and whoever
 * filed it. That is the right pair for work somebody has been handed and
 * nobody at all for work that has not - which is how a tracker filled with
 * carefully written reports told no one. This is where somebody says "tell me
 * about this one" without anybody having to be given it.
 *
 * Watching yourself is one press, because it is what nearly everybody who
 * opens this is here to do. Putting somebody else on the list is a search, and
 * only an administrator is shown it - the server refuses it either way, and the
 * button is hidden so that nobody is offered something they would be refused.
 *
 * The reporter and the assignee are not listed here. They already hear about
 * everything and each has a place of its own on this page; rows for them would
 * be rows whose remove button does nothing, and the assignee's would appear and
 * disappear as the issue changed hands.
 */
export function ObserverList({ workspaceId, issueId, observers, admin, onChanged }: ObserverListProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Whether the person reading is on the list, answered by the server rather
   * than by comparing names here: a second window signed in as somebody else
   * would otherwise be offered a button that does the wrong thing.
   */
  const watching = observers.some((one) => one.mine);

  async function change(work: Promise<Issue>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await work);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That could not be changed.'));
    } finally {
      setBusy(false);
    }
  }

  function add(chosen: Assignee | null) {
    if (chosen === null) return;
    void change(observeIssue(issueId, { kind: chosen.kind, id: chosen.id }));
  }

  return (
    <div className={styles.observers}>
      <span className={styles.label}>{t('Observers')}</span>

      {observers.length === 0 && <p className={styles.nobody}>{t('Nobody but the reporter and the assignee.')}</p>}

      <ul className={styles.list}>
        {observers.map((one) => (
          <li key={`${one.kind}-${one.id}`} className={styles.row}>
            <span className={styles.avatar} aria-hidden="true">
              {initialsOf(one.name)}
            </span>
            <span className={styles.names}>
              <span className={styles.name}>{one.name}</span>
              <span className={styles.hint}>
                {ASSIGNEE_KIND_LABEL[one.kind]} · {one.hint}
              </span>
            </span>
            {/*
              Yours to take off always; somebody else's only with the role. The
              button is hidden rather than disabled where it would be refused,
              since a button that explains itself only when pressed is a button
              that reads as broken.
            */}
            {(one.mine || admin) && (
              <button
                type="button"
                className={styles.remove}
                title={one.mine ? t('Stop watching this issue') : `Take ${one.name} off the list`}
                aria-label={one.mine ? t('Stop watching this issue') : `Take ${one.name} off the list`}
                disabled={busy}
                onClick={() => void change(unobserveIssue(issueId, { kind: one.kind, id: one.id }))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      {/*
        The common case, in one press. Nothing is named, which is what makes it
        the one thing anybody in the workspace may do without a role.
      */}
      <button
        type="button"
        className={styles.watch}
        disabled={busy}
        onClick={() =>
          void change(watching ? unobserveIssue(issueId) : observeIssue(issueId))
        }
      >
        {watching ? t('Stop watching') : t('Watch this issue')}
      </button>

      {admin && (
        <AssigneePicker
          workspaceId={workspaceId}
          chosen={null}
          onChoose={add}
          label={t('Add an observer')}
          placeholder={t('Someone else…')}
          kinds={CAN_OBSERVE}
          clearable={false}
        />
      )}

      {error !== null && <p className={styles.error}>{error}</p>}
    </div>
  );
}
