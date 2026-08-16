import type { HttpHeader } from '../api/integrations';
import plusIcon from '../assets/plus.svg';
import trashIcon from '../assets/trash-2.svg';
import styles from './HeaderRowsEditor.module.css';

export interface HeaderRowsEditorProps {
  headers: HttpHeader[];
  onChange: (headers: HttpHeader[]) => void;
  /** The dialogs use shorter rows than the settings pages. */
  compact?: boolean;
}

/** The "Custom Headers" block: a name/value pair per row, with add and remove. */
export function HeaderRowsEditor({ headers, onChange, compact = false }: HeaderRowsEditorProps) {
  function update(index: number, patch: Partial<HttpHeader>) {
    onChange(headers.map((header, at) => (at === index ? { ...header, ...patch } : header)));
  }

  return (
    <div className={styles.block}>
      <p className={styles.heading}>Custom Headers</p>

      {headers.map((header, index) => (
        // Rows have no identity of their own until they are saved.
        // eslint-disable-next-line react/no-array-index-key
        <div className={compact ? `${styles.row} ${styles.rowCompact}` : styles.row} key={index}>
          <input
            className={styles.input}
            type="text"
            placeholder="Header name"
            aria-label={`Header ${index + 1} name`}
            value={header.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <input
            className={styles.input}
            type="text"
            placeholder="Value"
            aria-label={`Header ${index + 1} value`}
            value={header.value}
            onChange={(event) => update(index, { value: event.target.value })}
          />
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
      ))}

      <button type="button" className={styles.add} onClick={() => onChange([...headers, { name: '', value: '' }])}>
        <img src={plusIcon} alt="" width={16} height={16} />
        Add Header
      </button>
    </div>
  );
}
