import { useEffect, useRef, useState } from 'react';

import { ASSIGNEE_KIND_LABEL, fetchAssignees } from '../api/issues';
import type { Assignee } from '../api/issues';
import { initialsOf } from '../api/users';
import styles from './AssigneePicker.module.css';

export interface AssigneePickerProps {
  workspaceId: string;
  /** Who has it now, or null for nobody. */
  chosen: Assignee | null;
  onChoose: (assignee: Assignee | null) => void;
  label?: string;
}

/** How long typing has to pause before the list is asked again. */
const SEARCH_PAUSE_MS = 200;

/**
 * Who is looking at this: a person, an agent, or a model.
 *
 * One box over three kinds, the way Jira's assignee box works over one -
 * somebody typing "sup" wants the support agent or the support desk user and
 * should not have to say which kind first. What each row carries is a name, a
 * second line saying what it is, and initials, so an agent and a person of the
 * same name are still told apart.
 *
 * The list is the server's answer to the search rather than a filter over a
 * fetched list: a workspace's models alone can run to hundreds.
 */
export function AssigneePicker({ workspaceId, chosen, onChoose, label = 'Assignee' }: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(false);
  /*
   * Which row the arrows are on.
   *
   * -1 is "No one", which is the first row and a real answer rather than an
   * empty state - somebody clearing an assignee is doing the same kind of
   * thing as choosing one, and should be able to arrow to it.
   */
  const [at, setAt] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetchAssignees(workspaceId, search.trim() || undefined)
        .then((people) => {
          if (!current) return;
          setFound(people);
          // Back to the top whenever the list changes under the cursor:
          // keeping an index into a list that no longer has that row is how a
          // search ends up choosing somebody nobody looked at.
          setAt(people.length === 0 ? -1 : 0);
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
  }, [open, search, workspaceId]);

  /* Clicking anywhere else closes it, which is what a box like this must do. */
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }

      /*
       * Up and down move, Enter takes what is under the cursor.
       *
       * Bound while the list is open and prevented, so the arrows move the
       * list rather than the caret in the search box and Enter does not
       * submit the form the picker sits in.
       */
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setAt((held) => (held + 1 > found.length - 1 ? -1 : held + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setAt((held) => (held - 1 < -1 ? found.length - 1 : held - 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onChoose(at === -1 ? null : found[at]);
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, found, at, onChoose]);

  return (
    <div className={styles.picker} ref={box}>
      <span className={styles.label}>{label}</span>

      <button
        type="button"
        className={styles.current}
        onClick={() => {
          setOpen((was) => !was);
          setSearch('');
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {chosen === null ? (
          <span className={styles.nobody}>No one</span>
        ) : (
          <>
            <span className={styles.avatar} aria-hidden="true">
              {initialsOf(chosen.name)}
            </span>
            <span className={styles.names}>
              <span className={styles.name}>{chosen.name}</span>
              <span className={styles.hint}>
                {ASSIGNEE_KIND_LABEL[chosen.kind]} · {chosen.hint}
              </span>
            </span>
          </>
        )}
      </button>

      {open && (
        <div className={styles.menu} role="listbox">
          <input
            className={styles.search}
            type="search"
            value={search}
            autoFocus
            placeholder="Find a person, agent or model…"
            aria-label="Search for someone to assign"
            onChange={(event) => setSearch(event.target.value)}
          />

          <button
            type="button"
            className={at === -1 ? `${styles.option} ${styles.optionAt}` : styles.option}
            // Under the pointer as well as under the arrows: a hand and a
            // keyboard should not disagree about which row is next.
            onMouseEnter={() => setAt(-1)}
            onClick={() => {
              onChoose(null);
              setOpen(false);
            }}
          >
            <span className={styles.nobody}>No one</span>
          </button>

          {loading && <p className={styles.notice}>Looking…</p>}
          {!loading && found.length === 0 && <p className={styles.notice}>Nobody by that name.</p>}

          {found.map((candidate, index) => (
            <button
              key={`${candidate.kind}-${candidate.id}`}
              type="button"
              className={index === at ? `${styles.option} ${styles.optionAt}` : styles.option}
              role="option"
              aria-selected={index === at}
              // Kept in view as the arrows move past the bottom of the list.
              ref={(node) => {
                if (index === at) node?.scrollIntoView({ block: 'nearest' });
              }}
              onMouseEnter={() => setAt(index)}
              onClick={() => {
                onChoose(candidate);
                setOpen(false);
              }}
            >
              <span className={styles.avatar} aria-hidden="true">
                {initialsOf(candidate.name)}
              </span>
              <span className={styles.names}>
                <span className={styles.name}>{candidate.name}</span>
                <span className={styles.hint}>
                  {ASSIGNEE_KIND_LABEL[candidate.kind]} · {candidate.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
