import { useEffect, useMemo, useRef, useState } from 'react';

import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './DefinitionPicker.module.css';

/** One definition a field can be pointed at. */
export interface DefinitionOption {
  /** What gets stored when this row is chosen. */
  value: string;
  label: string;
  /** A second line saying which one this is: a signature, a shape, a status. */
  hint?: string;
}

export interface DefinitionPickerProps {
  /** So the field's own label can point at the control, as it did at the select. */
  id: string;
  value: string;
  options: DefinitionOption[];
  onChoose: (value: string) => void;
  /** What the closed box says while nothing is chosen. */
  placeholder: string;
  /** What the search box says, e.g. "Search functions…". */
  searchPlaceholder?: string;
  /**
   * The row that makes a new one, kept at the top and never filtered away.
   *
   * Its value is handed to `onChoose` like any other, and what that means is the
   * form's business: holding a word until the form is saved, or opening a dialog.
   */
  create?: DefinitionOption | null;
  /** What the search box is called, where the field's own label is not enough. */
  ariaLabel?: string;
  disabled?: boolean;
  /**
   * Why there is nothing to choose from, where the reason is that the list
   * could not be fetched rather than that the workspace has none.
   *
   * Without it a picker with no options says *Nothing to choose here yet*,
   * which is an invitation to go and make one - and that is a lie told to
   * anybody whose session expired with a workspace full of them behind it. The
   * sentence comes from `catalogueFailure`; see components/Catalogue.tsx.
   */
  failure?: string | null;
}

/**
 * Picks one of a workspace's definitions - a function, a condition, an object, a
 * connection - by typing at it.
 *
 * A `<select>` is fine for a handful of fixed choices and useless for a
 * catalogue: a workspace grown to a hundred functions hands somebody a list they
 * can only scroll, with no way to say the name they already have in mind. So the
 * same keyboard bargain the assignee box strikes is struck here - type to
 * narrow, arrows to move, Enter to take, Escape to give up.
 *
 * Shared rather than written out per field, because the fields differ only in
 * what fills them: three dialogs pick functions, conditions, objects and
 * connections between them, and four copies of an arrow-key loop is four places
 * for the loop to be wrong.
 *
 * The narrowing happens here rather than by asking the server again, which is
 * the one thing this does differently from AssigneePicker: the forms already
 * hold the list they were handed when they opened, and a round trip per
 * keystroke to re-sort what is already in the browser buys nothing. The day
 * these catalogues can be searched server-side, this is the single place that
 * has to learn how.
 */
export function DefinitionPicker({
  id,
  value,
  options,
  onChoose,
  placeholder,
  searchPlaceholder = 'Type to search…',
  create = null,
  ariaLabel,
  disabled = false,
  failure = null,
}: DefinitionPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  /** Which row the arrows are on; -1 while there is no row to be on. */
  const [at, setAt] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const matching = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || (option.hint ?? '').toLowerCase().includes(needle),
    );
  }, [options, search]);

  /*
   * What the arrows walk, in the order it is drawn.
   *
   * Making one is a row rather than a button beside the list, so it is reachable
   * the same way everything else is - and it survives the search unfiltered,
   * because typing a name that matches nothing is exactly the moment somebody
   * wants to make it.
   */
  const rows = useMemo(() => (create === null ? matching : [create, ...matching]), [create, matching]);

  const chosen = options.find((option) => option.value === value) ?? null;
  const chosenLabel =
    chosen !== null ? chosen.label : create !== null && create.value === value ? create.label : null;

  /*
   * Back to the top whenever the list changes under the cursor.
   *
   * Keeping an index into a list that no longer holds that row is how a search
   * ends up choosing something nobody looked at.
   */
  useEffect(() => {
    if (!open) return;
    setAt(rows.length === 0 ? -1 : 0);
  }, [open, rows]);

  /*
   * The whole list brought into view as it opens.
   *
   * A dialog taller than the window scrolls, and a field near the bottom of one
   * opened its list below the fold - so the rows were there, under the edge of
   * the dialog, with nothing to say they existed. Nearest, so a list that
   * already fits is left exactly where it is.
   */
  useEffect(() => {
    if (!open) return;
    menu.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    /* Clicking anywhere else closes it, which is what a box like this must do. */
    function onDown(event: MouseEvent) {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      /*
       * Up and down move, Enter takes what is under the cursor, Escape gives up.
       *
       * Every one of them is prevented, and Escape most of all: these pickers
       * stand inside a `<dialog>`, where an unprevented Escape is a close request
       * the browser answers by shutting the whole form - so giving up on a search
       * would throw away everything typed into the dialog around it.
       */
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setAt((held) => (held + 1 > rows.length - 1 ? 0 : held + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setAt((held) => (held - 1 < 0 ? rows.length - 1 : held - 1));
      } else if (event.key === 'Enter') {
        // Prevented whether or not a row is under the cursor: this sits in a
        // form, and an Enter that fell through would submit it half-filled.
        event.preventDefault();
        const row = rows[at];
        if (row === undefined) return;
        onChoose(row.value);
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, rows, at, onChoose]);

  return (
    <div className={styles.picker} ref={box}>
      <button
        id={id}
        type="button"
        className={open ? `${styles.current} ${styles.currentOpen}` : styles.current}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setSearch('');
          setOpen((was) => !was);
        }}
      >
        <span className={chosenLabel === null ? `${styles.chosen} ${styles.placeholder}` : styles.chosen}>
          {chosenLabel ?? placeholder}
        </span>
        <img src={chevronDown12Icon} alt="" width={12} height={12} />
      </button>

      {open && (
        <div className={styles.menu} role="listbox" ref={menu}>
          <input
            className={styles.search}
            type="search"
            value={search}
            autoFocus
            spellCheck={false}
            placeholder={searchPlaceholder}
            aria-label={ariaLabel ?? searchPlaceholder}
            onChange={(event) => setSearch(event.target.value)}
          />

          {rows.length === 0 && (
            <p className={failure === null ? styles.notice : `${styles.notice} ${styles.noticeFailed}`}>
              {failure !== null
                ? failure
                : options.length === 0
                  ? 'Nothing to choose here yet.'
                  : 'Nothing by that name.'}
            </p>
          )}

          {rows.map((row, index) => (
            <button
              key={row.value}
              type="button"
              role="option"
              aria-selected={row.value === value}
              className={[
                styles.option,
                create !== null && index === 0 ? styles.optionCreate : '',
                index === at ? styles.optionAt : '',
              ]
                .filter((name) => name !== '')
                .join(' ')}
              // Kept in view as the arrows move past the bottom of the list.
              ref={(node) => {
                if (index === at) node?.scrollIntoView({ block: 'nearest' });
              }}
              /*
               * Under the pointer as well as under the arrows: a hand and a
               * keyboard should not disagree about which row is next.
               *
               * Movement rather than entry, because the list is scrolled into
               * view as it opens: rows sliding under a hand that has not moved
               * fire enter, and the cursor would land on whichever row happened
               * to stop beneath the pointer rather than on the first one.
               */
              onMouseMove={() => setAt(index)}
              onClick={() => {
                onChoose(row.value);
                setOpen(false);
              }}
            >
              <span className={styles.optionLabel}>{row.label}</span>
              {row.hint !== undefined && row.hint !== '' && (
                <span className={styles.optionHint}>{row.hint}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
