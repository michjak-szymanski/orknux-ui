import { useState } from 'react';
import type { ReactNode } from 'react';

import { FieldHint } from './FieldHint';
import { Icon, IconPickerDialog } from './IconPicker';
import styles from './IconField.module.css';

export interface IconFieldProps {
  /** The name chosen, or null for whatever the kind draws by itself. */
  value: string | null;
  onChange: (icon: string | null) => void;
  /**
   * What this icon is for, said in the form's own words - a trigger's nodes and
   * a condition's nodes start from different things.
   *
   * It goes behind the (?) beside the label rather than under the box. Every
   * caller says a version of the same sentence, and four forms printing it is
   * four fields explaining themselves to somebody who is looking at the one
   * control on the screen that already shows what it holds.
   *
   * Prose rather than a string, so a caller with two thoughts can say both.
   */
  hint?: ReactNode;
}

/**
 * The icon a definition carries, on the form that defines it.
 *
 * The same control in four places — an action, a trigger, a condition and an
 * agent all seed the nodes drawn from them — so it is one component rather than
 * four that drift. What it holds is a name from the interface's own set, which
 * is why there is a browser and not a file box.
 */
export function IconField({ value, onChange, hint }: IconFieldProps) {
  const [browsing, setBrowsing] = useState(false);

  return (
    <div className={styles.field}>
      <span className={styles.labelRow}>
        <span className={styles.labelWithHint}>
          <span className={styles.label}>Icon</span>
          {hint !== undefined && <FieldHint label="Icon">{hint}</FieldHint>}
        </span>
        {value !== null && (
          <button type="button" className={styles.textButton} onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </span>

      <div className={styles.box}>
        {value !== null && <Icon name={value} className={styles.preview} />}
        <span className={value === null ? styles.none : styles.name}>{value ?? 'None'}</span>
        <button type="button" className={styles.textButton} onClick={() => setBrowsing(true)}>
          Browse…
        </button>
      </div>

      <IconPickerDialog
        open={browsing}
        selected={value}
        onPick={(name) => onChange(name)}
        onClose={() => setBrowsing(false)}
      />
    </div>
  );
}
