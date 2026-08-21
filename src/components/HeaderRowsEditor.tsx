import type { Variable } from '../api/variables';
import type { HttpHeader } from '../api/integrations';
import plusIcon from '../assets/plus.svg';
import trashIcon from '../assets/trash-2.svg';
import { FieldHint } from './FieldHint';
import { FieldPicker } from './FieldPicker';
import type { FieldOption, FieldPickerLabels } from './FieldPicker';
import styles from './HeaderRowsEditor.module.css';

/**
 * One row: a name, and where its value comes from.
 *
 * A superset of `HttpHeader`, so the callers that only ever hold a literal - the
 * connection dialog, the MCP server pages - go on passing what they always
 * passed. `variableId` is set on the rows that read one of the workspace's
 * variables instead, and on those `value` is not the value: it is empty, and
 * what the variable holds is never sent here at all.
 */
export interface HeaderRow {
  name: string;
  value: string;
  /** Which of the workspace's variables holds the value, or null when it was typed. */
  variableId?: string | null;
  /** The name of that variable, for a row that arrived from the server. */
  variableName?: string | null;
}

export interface HeaderRowsEditorProps {
  headers: HeaderRow[];
  onChange: (headers: HeaderRow[]) => void;
  /** The dialogs use shorter rows than the settings pages. */
  compact?: boolean;
  /** What the block is called, where "Custom Headers" is not what the form calls them. */
  heading?: string;
  /**
   * The workspace's variables, which turns the source switch on.
   *
   * Left out, every row is a literal and the rows look exactly as they did
   * before references existed. Passed, each row may name one of these instead of
   * holding a value - which is the only way to put a bearer token on a request
   * without typing the token into a column that is not encrypted and is shown
   * back to whoever opens the form.
   */
  variables?: Variable[];
}

/** The "Custom Headers" block: a name/value pair per row, with add and remove. */
export function HeaderRowsEditor({
  headers,
  onChange,
  compact = false,
  heading = 'Custom Headers',
  variables,
}: HeaderRowsEditorProps) {
  function update(index: number, patch: Partial<HeaderRow>) {
    onChange(headers.map((header, at) => (at === index ? { ...header, ...patch } : header)));
  }

  const options: FieldOption[] = (variables ?? []).map((variable) => ({
    groupKey: variable.catalogId,
    groupName: variable.catalogName,
    field: variable.name,
    expression: variable.id,
    type: variable.type.toLowerCase(),
  }));

  return (
    <div className={styles.block}>
      <p className={styles.heading}>{heading}</p>

      {/*
        Explained once, beside the block, rather than once under every row. The
        words are the ones the plugin parameters use for the same switch: two
        wordings for one idea is how the two come to mean different things.
      */}
      {variables !== undefined && (
        <span className={styles.hintRow}>
          <span className={styles.hintLead}>Source</span>
          <FieldHint label={heading}>
            <strong>Value</strong> is used exactly as written. <strong>Reference</strong> reads one of this
            workspace&apos;s variables, and what that variable holds is never shown here.
          </FieldHint>
        </span>
      )}

      {headers.map((header, index) => {
        /*
         * Which side the row is on, and the empty string is the interesting
         * value. Absent means a literal; *any* string, the empty one included,
         * means a reference - because "Reference pressed, nothing picked yet" is
         * a state somebody is in for as long as it takes to read the list, and
         * it has to be somewhere.
         *
         * Deriving this from "has a variable been chosen" instead, which is what
         * it did first, made the switch inert: pressing Reference could only
         * leave the row a literal, and the picker that is the only way to choose
         * a variable never appeared to be pressed on. Nothing was clickable and
         * nothing said so.
         */
        const reference = header.variableId !== null && header.variableId !== undefined;
        return (
          // Rows have no identity of their own until they are saved.
          // eslint-disable-next-line react/no-array-index-key
          <div
            className={[styles.row, compact ? styles.rowCompact : '', variables !== undefined ? styles.rowSourced : '']
              .filter(Boolean)
              .join(' ')}
            key={index}
          >
            <input
              className={styles.input}
              type="text"
              placeholder="Header name"
              aria-label={`Header ${index + 1} name`}
              value={header.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />


            {/*
              The name and the remove hold the first line; the switch and the
              value take the second. Four controls abreast fit a settings page
              and do not fit a dialog's column - squeezed onto one line the
              picker came out seventy pixels wide, which is an ellipsis and a
              caret and no variable name at all.
            */}
            <div className={variables === undefined ? styles.sourceInline : styles.source}>
            {variables !== undefined && (
              <div className={styles.modeSwitch} role="group" aria-label={`Header ${index + 1} source`}>
                {SOURCES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={
                      (option === 'REFERENCE') === reference
                        ? `${styles.modeOption} ${styles.modeOptionOn}`
                        : styles.modeOption
                    }
                    aria-pressed={(option === 'REFERENCE') === reference}
                    /*
                     * Switching clears the other side rather than keeping it
                     * warm. A row that held both would be a row nobody could
                     * say what it sends, and the server refuses one anyway.
                     */
                    onClick={() =>
                      update(index, option === 'REFERENCE' ? { value: '', variableId: '' } : { variableId: null })
                    }
                    disabled={option === 'REFERENCE' && (variables?.length ?? 0) === 0}
                    title={
                      option === 'REFERENCE' && (variables?.length ?? 0) === 0
                        ? 'This workspace has no variables to point at yet'
                        : undefined
                    }
                  >
                    {option === 'VALUE' ? 'Value' : 'Reference'}
                  </button>
                ))}
              </div>
            )}

            {reference ? (
              <div className={styles.reference}>
                <FieldPicker
                  options={options}
                  value={header.variableId ?? ''}
                  label={`Header ${index + 1} variable`}
                  labels={VARIABLE_LABELS}
                  onChange={(option) => update(index, { variableId: option.expression, value: '' })}
                />
              </div>
            ) : (
              <input
                className={styles.input}
                type="text"
                placeholder="Value"
                aria-label={`Header ${index + 1} value`}
                value={header.value}
                onChange={(event) => update(index, { value: event.target.value })}
              />
            )}
            </div>

            <button
              type="button"
              className={styles.remove}
              onClick={() => onChange(headers.filter((_, at) => at !== index))}
              aria-label={`Remove header ${index + 1}`}
              title="Remove header"
            >
              <img src={trashIcon} alt="" width={16} height={16} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className={styles.add}
        onClick={() => onChange([...headers, { name: '', value: '', variableId: null }])}
      >
        <img src={plusIcon} alt="" width={16} height={16} />
        Add Header
      </button>
    </div>
  );
}

/** Typed in, or read from one of the workspace's variables. Two states, so a switch. */
const SOURCES = ['VALUE', 'REFERENCE'] as const;

/**
 * What the picker says, word for word what the plugins page says.
 *
 * The same control, offering the same list, for the same reason - so it says the
 * same thing. `empty` is the closed control with nothing chosen and `none` is a
 * list with nothing in it, which is a distinction easy to write down backwards:
 * doing so puts "this workspace has no variables" on a control that is about to
 * offer several.
 */
const VARIABLE_LABELS: FieldPickerLabels = {
  empty: 'Choose a variable…',
  search: 'Search variables',
  none: 'This workspace has no variables yet.',
  noMatch: 'No variable matches',
  gone: 'no longer in this workspace',
};

/** Re-exported so the literal-only callers keep the type they were written against. */
export type { HttpHeader };
