import { useState } from 'react';

import styles from './Thinking.module.css';
import { thinkingTime } from '../api/chat';
import { t } from '../i18n';

export interface ThinkingProps {
  /** What the model thought, as it arrived. Empty draws nothing at all. */
  text: string;
  /** Whether it is still arriving, which is worth saying while it is. */
  live?: boolean;
  /**
   * How long the thinking went on for, or null where nobody measured it.
   *
   * A count of characters used to sit here instead, and it was read as a token
   * count by the first person to see it - which is the trouble with a bare
   * number beside a word: it is an answer to a question nobody asked and there
   * is no way to tell which question. Time is what somebody wants to know about
   * a model that made them wait.
   *
   * Null draws nothing rather than nought seconds, and it never borrows the
   * turn's own time: that is already reported under the answer, and two numbers
   * on one screen that look like one measurement and are not is worse than one
   * number missing.
   */
  millis?: number | null;
}

/**
 * What a reasoning model thought on its way to an answer.
 *
 * ## It is not the answer, and everything here follows from that
 *
 * A reasoning model produces two things and the product used to show one of
 * them, or worse, both run together — a local server serving DeepSeek-R1 or
 * Qwen3 hands the thinking back inside the answer, tags and all, and it was read
 * out by the speech model and copied by the copy control along with the reply.
 *
 * So this is drawn outside the answer rather than at the top of it. Nothing else
 * changes: the copy control copies `message.content`, the speech model is handed
 * `message.content`, and the next turn sends the thread, which never held this.
 * Those three are correct because the thinking is not in the string they read,
 * which is a stronger arrangement than three places each remembering to leave it
 * out.
 *
 * ## Folded, and why that is not just about length
 *
 * Thinking runs to thousands of words for one paragraph of answer, so a chat
 * that drew it open would be a chat where the answer is off the bottom of the
 * screen. But the reason it is folded rather than merely scrollable is that it
 * is not addressed to the reader: it is the model talking to itself, and it
 * belongs in the position a footnote belongs in. Somebody working out why an
 * answer went the way it did opens it; everybody else reads the answer.
 *
 * Open state is per block and is not remembered. A reader who opened one
 * answer's thinking has said nothing about the next one.
 *
 * ## Nothing for a model that does not have one
 *
 * Most models emit no thinking, and one that does emits none on a short reply.
 * An empty container drawn under every answer would be this asserting that
 * there was thinking to see, which is a worse thing to draw than nothing.
 */
export function Thinking({ text, live = false, millis = null }: ThinkingProps) {
  const [open, setOpen] = useState(false);
  if (text.trim() === '') return null;

  /*
   * Whether there is a duration to say. Not while it is still arriving: the
   * thinking has not finished, so any number would be how long it has taken so
   * far dressed up as how long it took.
   */
  const known = !live && millis !== null && millis !== undefined && millis > 0;

  return (
    <div className={styles.thinking} data-testid="thinking" data-live={live}>
      <button
        type="button"
        className={styles.head}
        onClick={() => setOpen((held) => !held)}
        aria-expanded={open}
      >
        <span className={styles.mark} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {live ? t('Thinking') : known ? t('Thought for') : t('Thought')}
        {/*
          How long it went on for, drawn only where it was measured.

          `thinkingTime` and not a second way of saying a duration: the answer's
          own disclosure a few lines below reads "Thought for 2 seconds" out of
          that same function, and two durations formatted two ways on one screen
          read as two different kinds of thing.
        */}
        {known && <span className={styles.size}>{thinkingTime(millis)}</span>}
      </button>
      {open && <pre className={styles.body}>{text}</pre>}
    </div>
  );
}
