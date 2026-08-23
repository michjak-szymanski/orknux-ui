import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { DefinitionPicker } from './DefinitionPicker';
import type { DefinitionOption } from './DefinitionPicker';
import { FieldHint } from './FieldHint';
import { RevealToggle } from './RevealToggle';
import styles from './SecretField.module.css';

/** Stands in for a stored secret until somebody asks to see it. */
export const MASK = '••••••••••••••••';

/**
 * Where one secret field's value comes from, and the two are exclusive.
 *
 * Not a checkbox reading "use a workspace secret" beside the box, because that
 * arrangement leaves both inputs on screen at once and invites somebody to fill
 * in both - which the server refuses, correctly, as a caller who has not
 * chosen. A pair of tabs can only be in one of its states, so the form cannot
 * express the thing that would be rejected, and only the input belonging to the
 * chosen half is asked for.
 */
export type SecretSource = 'OWN' | 'VARIABLE';

/**
 * What a save has to send for one secret field.
 *
 * Three answers and not two: `null` is "leave the stored one alone", which is
 * the state a masked box is in and the easiest thing on any of these forms to
 * break. It is computed here, once, rather than worked out again beside every
 * mutation - the second field on a card is exactly where a second, slightly
 * different version of this rule would be written.
 */
export type SecretSending = { variable: string } | { value: string } | null;

/**
 * One secret field's whole state: which of the two it is, what is in the box,
 * which variable it points at, and what was revealed.
 *
 * A hook rather than four `useState`s on the page, because these move together
 * and the ways they move are the dangerous part. A card with two secrets calls
 * this twice and gets two of everything, including two of the rule below about
 * emptying the box - which is the rule a second field written out by hand would
 * get wrong.
 */
export interface SecretFieldHandle {
  source: SecretSource;
  /** Null while a stored secret is untouched, so a save leaves it alone. */
  value: string | null;
  /** The workspace variable it reads; empty while none is chosen. */
  variableId: string;
  /** Whether the server holds a secret of its own for this field. */
  stored: boolean;
  /** Whether the box is holding exactly what was revealed, and can be re-hidden. */
  revealed: boolean;
  /** Whether hiding or showing is offered at all: there has to be one to show. */
  offersReveal: boolean;
  /** Nothing chosen on a field that says it reads a variable. */
  unchosen: boolean;
  sending: SecretSending;
  choose: (next: SecretSource) => void;
  type: (next: string) => void;
  point: (at: string) => void;
  show: (what: string) => void;
  hide: () => void;
  reset: (found: { stored: boolean; variable: string | null }) => void;
}

export interface UseSecretFieldOptions {
  /**
   * Whether something is already stored. A form that is adding holds nothing,
   * so its box starts empty rather than starting as "leave alone".
   */
  stored?: boolean;
}

export function useSecretField({ stored: startsStored = false }: UseSecretFieldOptions = {}): SecretFieldHandle {
  const [source, setSource] = useState<SecretSource>('OWN');
  const [value, setValue] = useState<string | null>(startsStored ? null : '');
  const [variableId, setVariableId] = useState('');
  const [stored, setStored] = useState(startsStored);
  /** What was revealed, kept so it can be put back out of sight. Null: nothing was. */
  const [shownValue, setShownValue] = useState<string | null>(null);

  /*
   * Hiding is only offered while the box still holds exactly what was revealed:
   * once it has been typed into, covering it again would either throw the
   * typing away or leave an edit pending behind a row of dots.
   */
  const revealed = shownValue !== null && value === shownValue;
  const offersReveal = stored && (shownValue === null || value === shownValue);

  return {
    source,
    value,
    variableId,
    stored,
    revealed,
    offersReveal,
    unchosen: source === 'VARIABLE' && variableId === '',
    /*
     * One of the two, never both and never neither by accident.
     *
     * A variable sent drops any copy that was held and a secret sent drops any
     * reference, so the exclusivity is the server's rule as much as this form's
     * - and sending the pair is a BAD_REQUEST rather than something resolved by
     * precedence. On its own value, sending nothing is still what says "leave
     * the stored one alone".
     */
    sending: source === 'VARIABLE' ? { variable: variableId } : value === null ? null : { value },
    /**
     * Moving from one kind to the other, and what each move does to the box.
     *
     * Going to its own value from a reference has to empty that box. Left
     * holding null it would mean "leave the stored secret alone", which for a
     * field that has none is a save that changes nothing and reads as the
     * control not having worked. Where something *is* stored, null is exactly
     * right and is left where it is.
     */
    choose(next) {
      setSource(next);
      if (next === 'OWN' && !stored) setValue((held) => held ?? '');
    },
    type(next) {
      setValue(next);
    },
    point(at) {
      setVariableId(at);
    },
    show(what) {
      setValue(what);
      setShownValue(what);
    },
    hide() {
      // Null, not empty: it is what tells the save to leave the stored one alone.
      setValue(null);
      setShownValue(null);
    },
    reset(found) {
      setSource(found.variable === null ? 'OWN' : 'VARIABLE');
      setVariableId(found.variable ?? '');
      setStored(found.stored);
      setValue(null);
      setShownValue(null);
    },
  };
}

export interface SecretFieldProps {
  /**
   * The id the box gets. The picker takes the same with `-variable` on the end,
   * so a card with two of these has four ids and no collision.
   */
  id: string;
  /** What this field is called: "API Key", "Client Secret", "Bot Token". */
  label: string;
  required?: boolean;
  /** What this particular secret is, and where somebody gets one. */
  hint: ReactNode;
  field: SecretFieldHandle;
  /** The workspace's secrets, already filtered: a value may not be pointed at. */
  options: DefinitionOption[];
  /** Where variables are made, for the note behind the (?). */
  variablesPath: string;
  placeholder?: string;
  onSource: (next: SecretSource) => void;
  onValue?: () => void;
  onVariable?: () => void;
  /** Fetches the stored secret and hands it to `field.show`. */
  onReveal?: () => void;
  /**
   * That this field's reference points at nothing, in the caller's own words.
   *
   * An error, so it is in the open rather than behind the (?) - and inside this
   * field rather than above the card, because on a card with two secrets a
   * sentence above them cannot say which one came apart.
   */
  broken?: ReactNode;
}

/**
 * A secret somebody types, or a workspace secret they point at - as one field,
 * with the choice standing beside that field's own name.
 *
 * The choice was a pair of tabs above the card when this landed for issue #232,
 * and it was rejected for a reason that generalises: a mode of a card reads as
 * being about the card. It happens to be unambiguous where the card holds one
 * secret, and a model provider does - `secret` is the API key or the Entra
 * client secret, never both. It says nothing at all where a card holds two. A
 * Slack connection keeps a bot token and an app token, and "this card uses a
 * workspace secret" cannot mean one of them without meaning the other.
 *
 * So the control belongs to the field it governs: it stands beside that field's
 * label, above that field's one input and nothing else, and it is named after
 * that field for anything that reads names. Two secrets on a card is two
 * of these, side by side or stacked, each answering for itself - which is the
 * arrangement this was written for even though the provider form has one.
 *
 * The label is the field's own - API Key, Client Secret, Bot Token - and never
 * "Credential" or "Workspace Secret". What changes with the choice is where the
 * value comes from, not what the field is asking for, so the name above it does
 * not move when the tabs do.
 */
export function SecretField({
  id,
  label,
  required = false,
  hint,
  field,
  options,
  variablesPath,
  placeholder,
  onSource,
  onValue,
  onVariable,
  onReveal,
  broken,
}: SecretFieldProps) {
  const pickerId = `${id}-variable`;
  const reading = field.source === 'VARIABLE';

  return (
    <div className={styles.field}>
      <div className={styles.header}>
        <span className={styles.labelWithHint}>
          {/* Pointing at whichever control the field is drawing: one field,
              asked for one way at a time. */}
          <label className={styles.label} htmlFor={reading ? pickerId : id}>
            {label} {required && <span className={styles.required}>*</span>}
          </label>
          <FieldHint label={label}>
            {hint}
            {reading ? (
              <>
                {' '}
                Read from one of this workspace’s variables — a Secret, not a Value — at the moment it
                is needed, so a new value is in use immediately and rotating it is one edit rather
                than one per place it is used. The variable is held by identity, so renaming it or
                moving it to another catalog changes nothing here, and it cannot be deleted while
                this reads it. Make one on the <Link to={variablesPath}>Variables</Link> page.
              </>
            ) : (
              <> Kept here, encrypted, and belonging to this alone: changing it changes nothing else.</>
            )}
          </FieldHint>
        </span>

        {/*
          The choice, on the field's own line rather than above the card. Named
          after the field, so two of these on one card are two different
          questions to anything that reads names rather than one asked twice.
        */}
        <div className={styles.sources} role="tablist" aria-label={`Where the ${label} comes from`}>
          <button
            type="button"
            role="tab"
            aria-selected={!reading}
            className={reading ? styles.source : styles.sourceOn}
            onClick={() => onSource('OWN')}
          >
            Value
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reading}
            className={reading ? styles.sourceOn : styles.source}
            onClick={() => onSource('VARIABLE')}
          >
            Reference
          </button>
        </div>
      </div>

      {broken !== undefined && broken !== null && (
        <p className={styles.broken} role="alert" data-secret-missing={id}>
          {broken}
        </p>
      )}

      {reading ? (
        <DefinitionPicker
          id={pickerId}
          value={field.variableId}
          options={options}
          onChoose={(chosen) => {
            field.point(chosen);
            onVariable?.();
          }}
          placeholder={options.length === 0 ? 'This workspace has no secrets yet' : 'Choose a secret…'}
          searchPlaceholder="Search secrets…"
          ariaLabel={`Search workspace secrets for the ${label}`}
        />
      ) : (
        <div className={styles.row}>
          <input
            id={id}
            className={`${styles.input} ${styles.inputMono}`}
            type={field.revealed || field.value === '' ? 'text' : 'password'}
            value={field.value ?? MASK}
            onChange={(event) => {
              field.type(event.target.value);
              onValue?.();
            }}
            onFocus={() => {
              // Typing replaces the stored one rather than editing a mask.
              if (field.value === null) field.type('');
            }}
            placeholder={placeholder}
          />
          {onReveal !== undefined && field.offersReveal && (
            <RevealToggle
              shown={field.revealed}
              label={label}
              onToggle={() => {
                if (field.revealed) field.hide();
                else onReveal();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
