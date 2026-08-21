import type { ReactNode } from 'react';

import { FieldHint } from './FieldHint';
import styles from './ValidationStatus.module.css';

/**
 * What the last press of Validate found, or null if nothing has been validated
 * against what is on screen now.
 *
 * `message` is the tail of a sentence and not a sentence: this component writes
 * the head, so that four editors cannot drift into four vocabularies for one
 * answer. "every property's type resolves", not "Valid.".
 */
export interface Validation {
  ok: boolean;
  message: string;
  /**
   * Whether `message` is a sentence of its own rather than the tail of this
   * component's.
   *
   * The Validate button's own answers are tails, so that the three states read
   * as one sequence. Something that happened *to* the editor and landed in the
   * same line - a save the server refused, a suggestion stored, a delete that
   * failed - is its own sentence, because "Not valid - it could not be saved"
   * says something untrue about the code: what failed was the save, and the
   * code may be perfectly good.
   */
  whole?: boolean;
}

export interface ValidationStatusProps {
  /**
   * What Validate looks at, named as a sentence would name it and capitalised
   * as a sentence starts: "The code", "The properties", "The definition". It is
   * the difference between a status that announces an absence and one that says
   * the absence of what.
   */
  subject: string;
  /** What the last validate found, or null if none has been run against this. */
  status: Validation | null;
  /**
   * Whether what is on screen has just been stored, for the editors where a
   * save is itself the strongest validation there is - the server ran the same
   * rules on the way in and accepted it.
   */
  saved?: boolean;
  /**
   * What pressing Validate actually checks, for the (?) beside the button.
   *
   * The status stays in the open because it is the state of the thing being
   * looked at; what the action means is an explanation, and explanations go
   * behind a (?) - see UI-DESIGN-RULES.md. Both halves are needed: a status
   * nobody can interpret is not better for being visible.
   */
  explains: ReactNode;
}

/**
 * The Validate status, in the four editors that have a Validate button.
 *
 * It used to read "Not checked yet." in a footer, and it was reported by the
 * product owner in those words: "what the f that 'not checked yet' does?".
 * Three things were wrong with it and they compound.
 *
 * The button says **Validate** and the status said *checked*, so the reader had
 * to guess that two words meant one action. It sat in the **footer**, which on
 * the object editor put it at the far end of a row from "+ Add Property", a
 * control it has nothing to do with. And it never said what validating would
 * **tell** you - for an object that every property's type resolves, for a
 * function that the code compiles and the sandbox's parser accepts it - so it
 * announced an absence without naming the absence of what.
 *
 * So: the status stands beside the button, in the button's own word, and the
 * three states are one sequence rather than three unrelated sentences.
 *
 *     The code has not been validated.
 *     Valid - the code compiles and the sandbox's parser accepts it.
 *     Not valid - Line 3: Unexpected token.
 *
 * The head of each is this component's and the tail is the page's, which is
 * what stops four editors from growing four vocabularies for the same answer.
 */
export function ValidationStatus({ subject, status, saved = false, explains }: ValidationStatusProps) {
  const sentence =
    status === null
      ? `${subject} has not been validated.`
      : status.whole === true
        ? status.message
        : status.ok
          ? /*
             * A save is a validation the server performed and accepted, so
             * saying both is not saying the same thing twice - it is why this
             * green can be trusted, and it is one line rather than two badges.
             */
            `${saved ? 'Saved, and valid' : 'Valid'} — ${status.message}`
          : `Not valid — ${status.message}`;

  const tone = status === null ? styles.dotIdle : status.ok ? styles.dotOk : styles.dotBad;

  return (
    <span className={styles.status} data-check="validate-status">
      <span className={`${styles.dot} ${tone}`} aria-hidden="true" />
      {/*
        A status and not an alert. It changes when somebody presses a button
        they are looking at, so `role="status"` would announce what they already
        know - and the loader's own `[role="status"]` is what the checks in
        `scripts/` wait on to decide a page has not finished drawing.
      */}
      <span className={status?.ok === false ? styles.textBad : styles.text} title={sentence}>
        {sentence}
      </span>
      <FieldHint label="Validate">{explains}</FieldHint>
    </span>
  );
}
