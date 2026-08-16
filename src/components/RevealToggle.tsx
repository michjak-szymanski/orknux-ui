import eyeOffIcon from '../assets/eye-off.svg';
import eyeIcon from '../assets/eye.svg';
import styles from './Dialog.module.css';

export interface RevealToggleProps {
  /** Whether the field it belongs to is currently readable. */
  shown: boolean;
  onToggle: () => void;
  /** What is being revealed, for the label a screen reader reads: "Show bot token". */
  label: string;
}

/**
 * Reveals one secret field.
 *
 * It sits inside the field rather than governing the whole form, because the
 * fields are not revealed for the same reason: checking a pasted bot token says
 * nothing about wanting the app-level token beside it on screen. One control per
 * field also means the reveal is next to the thing it acts on, which is where
 * someone looks for it.
 *
 * The eye is masked rather than drawn, so it takes the button's colour and can
 * say whether it is on.
 */
export function RevealToggle({ shown, onToggle, label }: RevealToggleProps) {
  const action = shown ? `Hide ${label}` : `Show ${label}`;

  return (
    <button
      type="button"
      className={styles.revealToggle}
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={action}
      title={action}
    >
      {/*
        Two icons rather than one in two colours: an eye and a struck-through
        eye is what every password box does, and a control whose only difference
        is its shade asks somebody to remember which shade meant what.
      */}
      <span
        className={styles.revealIcon}
        style={
          shown
            ? { maskImage: `url("${eyeOffIcon}")`, WebkitMaskImage: `url("${eyeOffIcon}")` }
            : { maskImage: `url("${eyeIcon}")`, WebkitMaskImage: `url("${eyeIcon}")` }
        }
        aria-hidden="true"
      />
    </button>
  );
}
