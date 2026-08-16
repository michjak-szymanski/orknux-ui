import { useEffect, useMemo, useRef, useState } from 'react';

import styles from './FieldPicker.module.css';

/** One field a node produces, as something a parameter can be pointed at. */
export interface FieldOption {
  /** The node that produces it; what the canvas draws a line from. */
  nodeKey: string;
  nodeName: string;
  /** The field's own name, as it is shown. */
  field: string;
  /** What gets stored and read at runtime — `reply`, or `trigger.channel`. */
  expression: string;
  type?: string;
}

export interface FieldPickerProps {
  options: FieldOption[];
  /** The stored expression, or empty when nothing is chosen yet. */
  value: string;
  onChange: (option: FieldOption) => void;
}

/**
 * Picks the field a parameter reads from.
 *
 * A list rather than a text box, because the alternative was typing
 * `{{input.reply}}` from memory: a name that is nearly right reads as ordinary
 * text and is sent as those characters, which is the kind of mistake that only
 * shows up in Slack.
 *
 * Searchable because a graph of any size produces more fields than fit on a
 * screen, and the one you want is usually known by name.
 */
export function FieldPicker({ options, value, onChange }: FieldPickerProps) {
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
        option.nodeName.toLowerCase().includes(needle) ||
        option.expression.toLowerCase().includes(needle),
    );
  }, [options, search]);

  /** Grouped by the node that produces them, in the order they were given. */
  const grouped = useMemo(() => {
    const byNode = new Map<string, FieldOption[]>();
    matching.forEach((option) => {
      const held = byNode.get(option.nodeKey);
      if (held === undefined) byNode.set(option.nodeKey, [option]);
      else held.push(option);
    });
    return [...byNode.values()];
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
      >
        {chosen !== undefined ? (
          <span className={styles.chosen}>
            <span className={styles.chosenNode}>{chosen.nodeName}</span>
            <span className={styles.chosenField}>{chosen.field}</span>
          </span>
        ) : value !== '' ? (
          // A reference whose source has gone: still shown, so it can be seen
          // and repointed rather than silently reading nothing.
          <span className={styles.missing}>{value} — no longer produced</span>
        ) : (
          <span className={styles.empty}>Choose a field…</span>
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
            placeholder="Search fields"
            spellCheck={false}
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
          />

          {options.length === 0 ? (
            <p className={styles.note}>Nothing upstream produces a field yet.</p>
          ) : grouped.length === 0 ? (
            <p className={styles.note}>No field matches “{search.trim()}”.</p>
          ) : (
            <div className={styles.list}>
              {grouped.map((group) => (
                <div className={styles.group} key={group[0].nodeKey}>
                  <p className={styles.groupName}>{group[0].nodeName}</p>
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
