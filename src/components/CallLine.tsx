import { useMemo, useState } from 'react';

import styles from './CallLine.module.css';
import { t } from '../i18n';

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
  /**
   * Whether the tool could not be run at all, as against running and answering
   * unhelpfully.
   *
   * A page that does not know says nothing, which is every page reading a
   * transcript: what is recorded is what came back, and the record does not say
   * whether the tool or this application produced it. The chat knows because it
   * watched the round happen, and it is worth saying — a lookup that failed
   * explains an answer that a lookup returning nothing does not.
   */
  failed?: boolean;
  /** Something to say about when it happened, drawn beside the name. */
  when?: string;
  /**
   * Whether to draw it as one line until somebody asks for more.
   *
   * **Passed by the caller rather than decided here, because the right answer
   * differs by page.** A chat is a conversation, and a lookup in the middle of
   * one is an aside: what somebody wants at a glance is that it happened and to
   * what, with the arguments and the result a press away. A task's page is not
   * that — watching the calls *is* the feature there, and folding them by
   * default would hide the thing the page exists to show. The session
   * transcript is the same: it is opened to read what happened in full.
   *
   * So the chat passes this and the other two do not, and the component holds
   * no opinion about which page it is on.
   */
  folded?: boolean;
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
export function CallLine({ actor, content, result, failed = false, when, folded = false }: CallLineProps) {
  const asked = useIndented(content);
  const got = useIndented(result ?? '');

  const running = result === null;
  const knowsResult = result !== undefined;

  /*
   * Shut until asked, where the caller asked for that.
   *
   * The same gesture as the thinking block above it and the `Show all …` fold
   * below: a press on the row, a triangle that turns, and `aria-expanded`
   * carrying the state. Three foldables on one screen behaving three ways is
   * three things to learn about one page.
   */
  const [open, setOpen] = useState(!folded);
  const showing = !folded || open;

  return (
    <article
      className={styles.call}
      data-testid="call-line"
      data-running={running}
      data-failed={knowsResult && !running && failed}
    >
      {(() => {
        const head = (
          <>
            {folded && (
              <span className={styles.mark} aria-hidden="true">
                {showing ? '▾' : '▸'}
              </span>
            )}
            <span className={styles.badge}>{t('Tool')}</span>
            <span className={styles.name}>{actor ?? 'a tool'}</span>
            {knowsResult && (
              <span className={styles.state} data-running={running} data-failed={!running && failed}>
                {running ? 'Running' : failed ? t('Failed') : 'Returned'}
              </span>
            )}
            {when !== undefined && !knowsResult && <span className={styles.state}>{when}</span>}
          </>
        );
        return folded ? (
          <button
            type="button"
            className={`${styles.head} ${styles.headButton}`}
            onClick={() => setOpen((held) => !held)}
            aria-expanded={showing}
          >
            {head}
          </button>
        ) : (
          <p className={styles.head}>{head}</p>
        );
      })()}

      {showing &&
        (asked.text.trim() === '' ? (
        <p className={styles.note}>{t('Called with nothing.')}</p>
        ) : (
          <Folding text={asked.text} what="what it was asked" />
        ))}

      {showing && knowsResult && !running && (
        <>
          <p className={styles.label}>{failed ? t('Could not be run') : t('Returned')}</p>
          {got.text.trim() === '' ? (
            <p className={styles.note}>{t('Came back with nothing.')}</p>
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
          {open ? t('Show less') : `Show all ${text.length.toLocaleString()} characters`}
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
