import { useMemo, useState } from 'react';

import styles from './CallLine.module.css';

export interface CallLineProps {
  /** The tool's name, as the session recorded it. */
  actor: string | null;
  /** The arguments, as the model sent them. */
  content: string;
  /**
   * What came back, where the page has it.
   *
   * `undefined` on a page that does not read results at all — a chat thread,
   * which carries the calls made in the session it continues and nothing those
   * calls returned. `null` means the page reads them and this one has not
   * answered yet, which is a different fact and is shown as one.
   */
  result?: string | null;
  /** Something to say about when it happened, drawn beside the name. */
  when?: string;
}

/**
 * How much of a call is shown before it is folded.
 *
 * What a model passes a tool can be a whole file, and what one gives back can be
 * a workspace's entire issue list — a single one of those measured forty
 * thousand characters. One call left to run would bury the exchange it was made
 * in the middle of, which on a task's page is the thread somebody opened it to
 * follow.
 */
const FOLD_OVER_CHARS = 600;

/**
 * A call an agent made, drawn the same way wherever one is drawn.
 *
 * There are three places in this product that show what an agent did on its way
 * to an answer — the session's own page, a chat that continues one, and a task
 * being watched as it works — and a call has to read as the same thing in all of
 * them. It was already two copies before this; a third, on the page where
 * watching the calls *is* the feature, would have been the one to drift.
 *
 * Drawn as what it is rather than as a turn. Nobody said this: it is the agent
 * going and looking something up, and the reason it is on a page of conversation
 * at all is that an answer with the lookup taken out of it reads as the model
 * having simply known.
 *
 * **Both halves, and the second one arrives late.** A call is recorded before
 * its tool runs, so a line with arguments and no result is a lookup that was
 * asked for and has not come back — which is the truth on a page watching a task
 * work, and is why "running" is a state this draws rather than an absence it
 * hides. The two are folded separately: a long argument and a long result are
 * two different things to want to open.
 */
export function CallLine({ actor, content, result, when }: CallLineProps) {
  const asked = useIndented(content);
  const got = useIndented(result ?? '');

  const running = result === null;
  const knowsResult = result !== undefined;

  return (
    <article className={styles.call} data-testid="call-line" data-running={running}>
      <p className={styles.head}>
        <span className={styles.badge}>Tool</span>
        <span className={styles.name}>{actor ?? 'a tool'}</span>
        {knowsResult && (
          <span className={styles.state} data-running={running}>
            {running ? 'Running' : 'Returned'}
          </span>
        )}
        {when !== undefined && !knowsResult && <span className={styles.state}>{when}</span>}
      </p>

      {asked.text.trim() === '' ? (
        <p className={styles.note}>Called with nothing.</p>
      ) : (
        <Folding text={asked.text} what="what it was asked" />
      )}

      {knowsResult && !running && (
        <>
          <p className={styles.label}>Returned</p>
          {got.text.trim() === '' ? (
            <p className={styles.note}>It came back with nothing.</p>
          ) : (
            <Folding text={got.text} what="what came back" />
          )}
        </>
      )}
    </article>
  );
}

/** One block of code, folded while it is longer than a line should be. */
function Folding({ text, what }: { text: string; what: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > FOLD_OVER_CHARS;

  return (
    <>
      <pre className={`${styles.body} ${long && !open ? styles.folded : ''}`}>{text}</pre>
      {long && (
        <button
          type="button"
          className={styles.fold}
          onClick={() => setOpen((held) => !held)}
          aria-label={open ? `Show less of ${what}` : `Show all of ${what}`}
        >
          {open ? 'Show less' : `Show all ${text.length.toLocaleString()} characters`}
        </button>
      )}
    </>
  );
}

/**
 * Indented where it parses and left exactly as it arrived where it does not.
 *
 * What was recorded is what the model sent and what the tool returned, and
 * prettying something that is not JSON would be this deciding what it meant.
 */
function useIndented(raw: string): { text: string } {
  return useMemo(() => {
    try {
      return { text: JSON.stringify(JSON.parse(raw), null, 2) };
    } catch {
      return { text: raw };
    }
  }, [raw]);
}
