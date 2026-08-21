import { useState } from 'react';
import { FieldHint } from '../../components/FieldHint';
import styles from './RetryPolicyFields.module.css';

/**
 * The backoff, as much of it as belongs on the node.
 *
 * Its own file rather than another six hundred lines in the editor, because
 * what it holds is arithmetic - the same arithmetic the engine does, written
 * again so the panel can say what the policy will actually do - and arithmetic
 * kept next to a canvas is arithmetic nobody finds.
 */

/** What the panel edits. A subset of the node, so the editor can hand it a draft. */
export interface RetryPolicyDraft {
  /** ACTION and AGENT are the kinds that have a policy; the caller decides. */
  kind: string;
  retryAttempts?: number | null;
  retryBackoffSeconds?: number | null;
  retryMultiplier?: number | null;
  retryMaxWaitSeconds?: number | null;
  retryJitter?: number | null;
  retryBudgetSeconds?: number | null;
}

/**
 * What comes back off the panel: the numbers, and never the kind.
 *
 * Without the omission a patch could carry a `kind` of plain `string` back into
 * a node whose kind is one of five words, and the editor would have to widen the
 * thing it is most careful about to accept it.
 */
export type RetryPolicyPatch = Partial<Omit<RetryPolicyDraft, 'kind'>>;

interface RetryPolicyFieldsProps {
  draft: RetryPolicyDraft;
  /** Only the fields that changed; the editor merges them into its own draft. */
  onChange: (patch: RetryPolicyPatch) => void;
}

/** What the server holds each number between; the panel refuses the same range. */
const MOST_ATTEMPTS = 10;
const MOST_WAIT_SECONDS = 3600;
const LEAST_MULTIPLIER = 1;
const MOST_MULTIPLIER = 10;
const MOST_BUDGET_SECONDS = 86_400;

/** A multiplier of one, which is the wait repeated: the shape that needs no ceiling. */
const FLAT = 1;

/**
 * What the whole policy comes to, in seconds of waiting.
 *
 * The same curve StepRunner spends, worked out here so the panel can say it.
 * Five numbers that each read as small compose into something nobody computes
 * in their head - six attempts at three times the last is fifty minutes - and
 * the sentence under the fields is worth more than any field above it.
 *
 * Jitter is left out on purpose: it only ever shortens a wait, so this stays the
 * upper bound it reads as, and the sentence says "up to" where it applies.
 */
export function totalWaitSeconds(policy: RetryPolicyDraft): number {
  const attempts = policy.retryAttempts ?? 1;
  const first = policy.retryBackoffSeconds ?? 0;
  const multiplier = Math.max(FLAT, policy.retryMultiplier ?? FLAT);
  const ceiling = policy.retryMaxWaitSeconds ?? MOST_WAIT_SECONDS;
  let total = 0;
  for (let spent = 1; spent < attempts; spent += 1) {
    total += Math.min(first * multiplier ** (spent - 1), ceiling, MOST_WAIT_SECONDS);
  }
  return total;
}

/** A number of seconds as somebody says it out loud. */
export function saidAsTime(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  const spare = minutes % 60;
  return spare === 0 ? `${hours}h` : `${hours}h ${spare}m`;
}

/**
 * What this policy will do, in one sentence.
 *
 * The line the panel is really for. Exported so it can be read on its own.
 */
export function retrySentence(policy: RetryPolicyDraft): string {
  const attempts = policy.retryAttempts ?? 1;
  if (attempts <= 1) return 'One attempt. A failure stops here.';

  const total = totalWaitSeconds(policy);
  const budget = policy.retryBudgetSeconds ?? null;
  const jittered = (policy.retryJitter ?? 0) > 0;

  if (budget !== null && budget < total) {
    return (
      `Up to ${attempts} attempts, but no more than ${saidAsTime(budget)} of trying — ` +
      `it stops at whichever comes first.`
    );
  }
  const spread = total === 0 ? 'one after another with no wait' : `over ${jittered ? 'up to ' : 'about '}${saidAsTime(total)}`;
  const ending = budget === null ? '' : `, and never more than ${saidAsTime(budget)}`;
  return `Up to ${attempts} attempts ${spread}${ending}.`;
}

/** The panel's own reading of a typed number; null where the box is empty. */
function whole(typed: string, least: number, most: number): number | null {
  if (typed.trim() === '') return null;
  const held = Number.parseInt(typed, 10);
  if (Number.isNaN(held)) return null;
  return Math.min(most, Math.max(least, held));
}

/** The same for the two that are not whole numbers. */
function fraction(typed: string, least: number, most: number): number | null {
  if (typed.trim() === '') return null;
  const held = Number.parseFloat(typed);
  if (Number.isNaN(held)) return null;
  return Math.min(most, Math.max(least, Math.round(held * 100) / 100));
}

export function RetryPolicyFields({ draft, onChange }: RetryPolicyFieldsProps) {
  const attempts = draft.retryAttempts ?? 1;
  const retries = attempts > 1;
  const multiplier = draft.retryMultiplier ?? FLAT;
  const grows = multiplier > FLAT;

  /*
   * Three fields where there were three, and the rest behind a word.
   *
   * Five boxes in a column is a panel nobody reads, and four of the six are
   * answers to questions most nodes never ask: a wait of thirty seconds tried
   * three times needs no ceiling, no jitter and no budget. So the three that
   * describe the shape stay out, and the three that bound it are folded away -
   * open from the start wherever one of them is already set, because a value
   * hidden behind a disclosure is a value somebody will not know is there.
   */
  const [open, setOpen] = useState(
    draft.retryMaxWaitSeconds != null || draft.retryJitter != null || draft.retryBudgetSeconds != null,
  );

  return (
    <div className={styles.field}>
      <span className={styles.labelWithHint}>
        <span className={styles.label}>Retries</span>
        <FieldHint label="Retries">
          <p>
            How many goes in all, not extra ones: one is the single attempt every step has always
            had. The initial wait is what it leaves before the second attempt, and the multiplier is
            what that wait is multiplied by after each one — 1 repeats it, 2 doubles it, and 1.5 is
            somewhere between.
          </p>
          <p>
            {draft.kind === 'AGENT' ? (
              <>
                A model that refused the request for what it said is settled and is never asked
                again, however many attempts are allowed; one that timed out, was rate limited or
                could not be reached is. Every attempt is another call you are billed for.
              </>
            ) : (
              <>
                A failure the server has already settled — a channel that does not exist, a request
                refused for what it said — is never tried again however many are asked for.
              </>
            )}
          </p>
          <p>
            No single wait ever passes an hour, whatever the numbers multiply out to. A maximum wait
            below that flattens the curve where it reaches it; a budget stops the whole business at
            a wall clock, with attempts left over.
          </p>
        </FieldHint>
      </span>

      <div className={styles.retryFields}>
        <label className={styles.retryField}>
          <span className={styles.retryCaption}>Attempts</span>
          <div className={styles.inputWrapper}>
            <input
              className={styles.input}
              type="number"
              min={1}
              max={MOST_ATTEMPTS}
              step={1}
              placeholder="1"
              value={draft.retryAttempts ?? ''}
              onChange={(event) => onChange({ retryAttempts: whole(event.target.value, 1, MOST_ATTEMPTS) })}
            />
          </div>
        </label>

        {/*
          Dead while there is one attempt, because a wait between attempts
          describes nothing when there is nothing to wait between. Left live it
          reads as a delay before the action, which is not what it is and not
          what the server would do with it - so it goes grey and empties itself,
          and a number is taken again once a second attempt gives it something
          to sit between.
        */}
        <label className={retries ? styles.retryField : `${styles.retryField} ${styles.retryFieldOff}`}>
          <span className={styles.retryCaption}>Initial wait</span>
          <div className={styles.inputWrapper}>
            <input
              className={styles.input}
              type="number"
              min={0}
              max={MOST_WAIT_SECONDS}
              step={1}
              placeholder={retries ? '0' : '—'}
              disabled={!retries}
              value={retries ? (draft.retryBackoffSeconds ?? '') : ''}
              onChange={(event) =>
                onChange({ retryBackoffSeconds: whole(event.target.value, 0, MOST_WAIT_SECONDS) })
              }
            />
            <span className={styles.retryUnit}>s</span>
          </div>
        </label>

        {/*
          The curve, as the number it always was underneath. A checkbox saying
          "double it" could name two shapes and the choice is a continuum: this
          is one box where that was a box and a tick, and it goes dead with the
          wait it shapes for the same reason.
        */}
        <label className={retries ? styles.retryField : `${styles.retryField} ${styles.retryFieldOff}`}>
          <span className={styles.retryCaption}>Multiplier</span>
          <div className={styles.inputWrapper}>
            <span className={styles.retryUnit}>×</span>
            <input
              className={styles.input}
              type="number"
              min={LEAST_MULTIPLIER}
              max={MOST_MULTIPLIER}
              step={0.1}
              placeholder={retries ? '1' : '—'}
              disabled={!retries}
              value={retries ? (draft.retryMultiplier ?? '') : ''}
              // Empty and 1 are the same node: one is what no multiplier means,
              // so a node that never had a curve comes back off the panel as it
              // went on rather than as an edit to save.
              onChange={(event) => {
                const said = fraction(event.target.value, LEAST_MULTIPLIER, MOST_MULTIPLIER);
                onChange({
                  retryMultiplier: said === null || said <= FLAT ? null : said,
                  // A ceiling under a wait that no longer grows does not bound
                  // it, it cuts it - so it leaves with the curve rather than
                  // sitting greyed out and still on the row.
                  ...(said === null || said <= FLAT ? { retryMaxWaitSeconds: null } : {}),
                });
              }}
            />
          </div>
        </label>
      </div>

      {/*
        The sentence, which is what the panel is for.
        Six numbers that each read as small compose into something nobody works
        out in their head, and "up to 5 attempts over about 2m" is worth more
        than any one of the boxes above it.
      */}
      <p className={retries ? styles.retrySentence : `${styles.retrySentence} ${styles.retryFieldOff}`}>
        {retrySentence(draft)}
      </p>

      <button
        type="button"
        className={styles.moreToggle}
        aria-expanded={open}
        disabled={!retries}
        onClick={() => setOpen((was) => !was)}
      >
        {open ? 'Fewer settings' : 'Ceiling, jitter and budget'}
      </button>

      {open && retries && (
        <div className={styles.retryFields}>
          {/*
            Only under a curve. A fixed wait cannot grow into anything, so a
            ceiling over it is not a bound but a second, quieter wait - and the
            reader of a fixed policy should not be made to look at one.
          */}
          <label className={grows ? styles.retryField : `${styles.retryField} ${styles.retryFieldOff}`}>
            <span className={styles.retryCaption}>Maximum wait</span>
            <div className={styles.inputWrapper}>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={MOST_WAIT_SECONDS}
                step={1}
                placeholder={grows ? '3600' : '—'}
                disabled={!grows}
                value={grows ? (draft.retryMaxWaitSeconds ?? '') : ''}
                onChange={(event) =>
                  onChange({ retryMaxWaitSeconds: whole(event.target.value, 1, MOST_WAIT_SECONDS) })
                }
              />
              <span className={styles.retryUnit}>s</span>
            </div>
          </label>

          {/*
            A fraction and not a switch, because a switch has to pick one and the
            useful amount depends on how many runs share the node: a tenth
            decorrelates a handful, and all of it is what a hundred runs coming
            off one outage need. Nought and one are both sayable, which a switch
            could also have done - the numbers between are what it could not.
          */}
          <label className={styles.retryField}>
            <span className={styles.retryCaption}>Jitter</span>
            <div className={styles.inputWrapper}>
              <input
                className={styles.input}
                type="number"
                min={0}
                max={1}
                step={0.05}
                placeholder="0"
                value={draft.retryJitter ?? ''}
                onChange={(event) => {
                  const said = fraction(event.target.value, 0, 1);
                  onChange({ retryJitter: said === null || said === 0 ? null : said });
                }}
              />
            </div>
          </label>

          <label className={styles.retryField}>
            <span className={styles.retryCaption}>Budget</span>
            <div className={styles.inputWrapper}>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={MOST_BUDGET_SECONDS}
                step={1}
                placeholder="—"
                value={draft.retryBudgetSeconds ?? ''}
                onChange={(event) =>
                  onChange({ retryBudgetSeconds: whole(event.target.value, 1, MOST_BUDGET_SECONDS) })
                }
              />
              <span className={styles.retryUnit}>s</span>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
