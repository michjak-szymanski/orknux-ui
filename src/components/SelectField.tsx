import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './SelectField.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  /** Shown before the value, e.g. "Status:". Omitted when the value speaks for itself. */
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** For screen readers when there is no visible label. */
  ariaLabel?: string;
  className?: string;
}

/**
 * A select whose whole box opens it.
 *
 * A native `<select>` beside a `<span>` inside a `<label>` looks like one
 * control and behaves like two: clicking the word focuses the select but does
 * not open it, so the box only reacts where the value happens to be. Nobody
 * aims at the value — they click the thing.
 *
 * So the real select is stretched over the whole box and made invisible, and
 * what is drawn underneath is the label, the chosen option's text and the
 * chevron. The select keeps the keyboard behaviour, the focus ring and the
 * accessible name; it simply covers what it appears to be.
 */
export function SelectField({ label, value, options, onChange, ariaLabel, className }: SelectFieldProps) {
  const chosen = options.find((option) => option.value === value);

  return (
    <div className={className === undefined ? styles.field : `${styles.field} ${className}`}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <span className={styles.value}>{chosen?.label ?? ''}</span>
      <img src={chevronDown12Icon} alt="" width={12} height={12} />
      <select
        className={styles.control}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel ?? label}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
