import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  ISSUE_RELATION_KINDS,
  ISSUE_RELATION_LABEL,
  ISSUE_STATUS_LABEL,
  fetchIssue,
  fetchIssuesToLink,
  relateIssue,
  unrelateIssue,
} from '../api/issues';
import type { Issue, IssueRef, IssueRelation, IssueRelationKind } from '../api/issues';
import styles from './IssueRelationList.module.css';

/** How long typing has to pause before the list is asked again. */
const SEARCH_PAUSE_MS = 200;

export interface IssueRelationListProps {
  workspaceId: string;
  issueId: string;
  /** This issue's number, which is what reading it back again takes. */
  number: number;
  /** What this issue is linked to, already read from this issue's side. */
  related: IssueRelation[];
  /** The issue as the server now has it, so the page redraws from one answer. */
  onChanged: (issue: Issue) => void;
}

/**
 * What this issue has to do with the others.
 *
 * The tracker could hang a web address on an issue, and the address people most
 * wanted to hang was another issue in this same tracker - which as a URL says
 * nothing until it is clicked and is invisible from the other end. This says it
 * on both: a link made here appears on the issue it names, phrased from that
 * issue's side, without anybody going there to write the other half.
 *
 * Finding the far end is a search rather than a box to paste an id into,
 * because issues are said out loud as numbers here - the same `#124` the
 * comments already turn into a link - so that is what the box looks for first.
 *
 * The status of the issue at the far end is shown beside it, and that is not
 * decoration: "blocked by #4" is only worth reading if it also says whether #4
 * is still open.
 */
export function IssueRelationList({
  workspaceId,
  issueId,
  number,
  related,
  onChanged,
}: IssueRelationListProps) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<IssueRelationKind>('RELATES_TO');
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<IssueRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The list is the server's answer to the search rather than a filter over
   * everything fetched: a tracker runs to hundreds of issues, and what is
   * already linked has to be left out - which is a question only the server can
   * answer.
   */
  useEffect(() => {
    if (!adding) return;
    let current = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetchIssuesToLink(issueId, search.trim() || undefined)
        .then((issues) => {
          if (!current) return;
          setFound(issues);
          setLoading(false);
        })
        .catch(() => {
          if (current) {
            setFound([]);
            setLoading(false);
          }
        });
    }, SEARCH_PAUSE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [adding, search, issueId, related]);

  async function change(work: Promise<Issue>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await work);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  /*
   * Chosen and made in one press. The relation was picked before the search
   * began, so a second confirming button would only be a chance to forget which
   * of the five was chosen.
   */
  function link(other: IssueRef) {
    setSearch('');
    setAdding(false);
    void change(relateIssue(issueId, other.id, kind));
  }

  /**
   * Taking one off, and reading the issue back rather than trusting this list.
   *
   * The mutation answers whether it worked and not what is left, because the
   * link belongs to two issues and there is no single issue for it to answer
   * with. This one is the one on the screen, so this one is asked again.
   */
  async function unlink(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await unrelateIssue(id);
      const again = await fetchIssue(workspaceId, number);
      if (again !== null) onChanged(again);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That link could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.related}>
      <span className={styles.head}>
        <span className={styles.label}>Linked issues</span>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => {
            setAdding(!adding);
            setSearch('');
            setError(null);
          }}
        >
          {adding ? 'Cancel' : 'Link an issue'}
        </button>
      </span>

      {adding && (
        <div className={styles.form}>
          {/*
            The relation first and the issue second, in that order on purpose:
            what this issue has to do with the other one is a decision, and the
            search that follows it is a lookup. Reversed, somebody picks an
            issue and then has to remember which way round they meant it.
          */}
          <select
            className={styles.kind}
            value={kind}
            aria-label="How they are linked"
            onChange={(event) => setKind(event.target.value as IssueRelationKind)}
          >
            {ISSUE_RELATION_KINDS.map((one) => (
              <option key={one} value={one}>
                {ISSUE_RELATION_LABEL[one]}
              </option>
            ))}
          </select>

          <input
            className={styles.search}
            type="search"
            value={search}
            autoFocus
            placeholder="#124, or a few words of the title…"
            aria-label="Find an issue to link to"
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className={styles.found}>
            {loading && <p className={styles.notice}>Looking…</p>}
            {!loading && found.length === 0 && (
              <p className={styles.notice}>Nothing here by that number or name.</p>
            )}
            {found.map((one) => (
              <button
                key={one.id}
                type="button"
                className={styles.option}
                disabled={busy}
                onClick={() => link(one)}
              >
                <span className={styles.number}>#{one.number}</span>
                <span className={styles.optionTitle}>{one.title}</span>
                <span className={one.status === 'CLOSED' ? styles.statusClosed : styles.status}>
                  {ISSUE_STATUS_LABEL[one.status]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {related.length === 0 ? (
        <p className={styles.nothing}>
          Nothing linked yet. What blocks this, what it duplicates, what is worth reading beside it.
        </p>
      ) : (
        <ul className={styles.list}>
          {related.map((one) => (
            <li key={one.id} className={styles.row}>
              <span className={styles.kindChip}>{ISSUE_RELATION_LABEL[one.kind]}</span>
              <Link
                to={`/workspace/${workspaceId}/issues/${one.number}`}
                className={styles.rowLink}
                title={one.title}
              >
                <span className={styles.number}>#{one.number}</span>
                <span className={styles.title}>{one.title}</span>
              </Link>
              <span className={one.status === 'CLOSED' ? styles.statusClosed : styles.status}>
                {ISSUE_STATUS_LABEL[one.status]}
              </span>
              {/*
                Offered to anybody who can see both, unlike the cross on a file
                or an address. A link is a claim about two issues rather than
                something one person said, and the team at the far end never
                made it.
              */}
              <button
                type="button"
                className={styles.remove}
                title={`Unlink #${one.number}`}
                aria-label={`Unlink #${one.number}`}
                disabled={busy}
                onClick={() => void unlink(one.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {error !== null && <p className={styles.error}>{error}</p>}
    </section>
  );
}
