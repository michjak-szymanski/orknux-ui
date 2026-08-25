import { useEffect, useMemo, useRef, useState } from 'react';

import styles from './FieldPicker.module.css';
import { t } from '../i18n';

/** One thing a parameter can be pointed at, in the group it belongs to. */
export interface FieldOption {
  /**
   * What it belongs to, and what the list groups by: the node that produces a
   * field, the catalog a variable is kept in.
   */
  groupKey: string;
  groupName: string;
  /** Its own name, as it is shown. */
  field: string;
  /** What gets stored and read later — `reply`, `trigger.channel`, a variable's id. */
  expression: string;
  type?: string;
}

/**
 * The wording, since the same control offers two different lists.
 *
 * A node's fields by default, because that is where it started; a caller offering
 * something else says so rather than leaving the menu talking about nodes.
 */
export interface FieldPickerLabels {
  /** In the closed control, when nothing is chosen. */
  empty: string;
  search: string;
  /** When there is nothing at all to offer. */
  none: string;
  /** When the search matched nothing. The term is quoted after it. */
  noMatch: string;
  /** After a stored value whose source has gone. */
  gone: string;
}

const FIELD_LABELS: FieldPickerLabels = {
  empty: t('Choose a field…'),
  search: t('Search fields'),
  none: t('Nothing upstream produces a field yet.'),
  noMatch: t('No field matches'),
  gone: 'no longer produced',
};

export interface FieldPickerProps {
  options: FieldOption[];
  /** The stored expression, or empty when nothing is chosen yet. */
  value: string;
  onChange: (option: FieldOption) => void;
  /** Names the control for anyone who cannot see what it sits under. */
  label?: string;
  labels?: FieldPickerLabels;
}

/**
 * Picks what a parameter reads from.
 *
 * A list rather than a text box, because the alternative was typing
 * `{{input.reply}}` from memory: a name that is nearly right reads as ordinary
 * text and is sent as those characters, which is the kind of mistake that only
 * shows up in Slack.
 *
 * Searchable because a graph of any size produces more fields than fit on a
 * screen, and the one you want is usually known by name.
 */
export function FieldPicker({ options, value, onChange, label, labels = FIELD_LABELS }: FieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const chosen = options.find((option) => option.expression === value);

  useEffect(() => {
    if (!open) return;

    // Clicking anywhere else closes it, which is what a dropdown does.
    function onDocumentClick(event: MouseEvent) {
      if (boxRef.current?.contains(event.target as Node) !== true) setOpen(false);
    }
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [open]);

  const matching = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return options;
    return options.filter(
      (option) =>
        option.field.toLowerCase().includes(needle) ||
        option.groupName.toLowerCase().includes(needle) ||
        option.expression.toLowerCase().includes(needle),
    );
  }, [options, search]);

  /** Grouped by what produces them, in the order they were given. */
  const grouped = useMemo(() => {
    const byGroup = new Map<string, FieldOption[]>();
    matching.forEach((option) => {
      const held = byGroup.get(option.groupKey);
      if (held === undefined) byGroup.set(option.groupKey, [option]);
      else held.push(option);
    });
    return [...byGroup.values()];
  }, [matching]);

  return (
    <div className={styles.box} ref={boxRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => {
          setSearch('');
          setOpen((showing) => !showing);
        }}
        aria-expanded={open}
        aria-label={label}
      >
        {chosen !== undefined ? (
          <span className={styles.chosen}>
            <span className={styles.chosenGroup}>{chosen.groupName}</span>
            <span className={styles.chosenField}>{chosen.field}</span>
          </span>
        ) : value !== '' ? (
          // A reference whose source has gone: still shown, so it can be seen
          // and repointed rather than silently reading nothing.
          <span className={styles.missing}>
            {value} — {labels.gone}
          </span>
        ) : (
          <span className={styles.empty}>{labels.empty}</span>
        )}
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className={styles.menu}>
          <input
            className={styles.search}
            value={search}
            placeholder={labels.search}
            spellCheck={false}
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
          />

          {options.length === 0 ? (
            <p className={styles.note}>{labels.none}</p>
          ) : grouped.length === 0 ? (
            <p className={styles.note}>
              {labels.noMatch} “{search.trim()}”.
            </p>
          ) : (
            <div className={styles.list}>
              {grouped.map((group) => (
                <div className={styles.group} key={group[0].groupKey}>
                  <p className={styles.groupName}>{group[0].groupName}</p>
                  {group.map((option) => (
                    <button
                      key={option.expression}
                      type="button"
                      className={
                        option.expression === value ? `${styles.option} ${styles.optionChosen}` : styles.option
                      }
                      onClick={() => {
                        onChange(option);
                        setOpen(false);
                      }}
                    >
                      <span className={styles.optionField}>{option.field}</span>
                      {option.type !== undefined && <span className={styles.optionType}>{option.type}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
