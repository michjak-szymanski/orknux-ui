import { useEffect, useRef, useState } from 'react';

import styles from './Thinking.module.css';
import { thinkingTime } from '../api/chat';
import { t } from '../i18n';

export interface ThinkingProps {
  /** What the model thought, as it arrived. Empty draws nothing at all. */
  text: string;
  /** Whether it is still arriving, which is worth saying while it is. */
  live?: boolean;
  /**
   * How long the thinking went on for, as the server measured it.
   *
   * A count of characters used to sit here instead and was read as a token
   * count by the first person to see it, which is the trouble with a bare
   * number beside a word: it answers a question nobody asked and gives no way
   * to tell which. Time is what somebody wants to know about a model that made
   * them wait.
   *
   * Null where the server measured none, and then the block falls back to what
   * it counted itself while the thinking was arriving - so the row always has a
   * duration on it. It shipped once without that fallback and without a working
   * measurement behind it, and the row read "Thought" and nothing else.
   */
  millis?: number | null;
  /**
   * Whether to draw it already open.
   *
   * Off everywhere by default, which is the chat, and the note below says why
   * folded is the right default there. A task's page passes it on the block
   * that is being written and on no other, and that difference is the whole of
   * the argument: a task takes dozens of turns, so a page that drew every one
   * of them open would have the work somebody came to watch scrolled off the
   * bottom — but what they came to watch is the model thinking *now*, and that
   * one block folded is the feature hidden behind a press.
   *
   * The initial state only. A block that opened because it was live stays open
   * when it settles rather than folding itself away under somebody's eyes,
   * which would read as the page losing what they were reading.
   */
  startOpen?: boolean;
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
export function Thinking({ text, live = false, millis = null, startOpen = false }: ThinkingProps) {
  const [open, setOpen] = useState(startOpen);
  /*
   * How long it has been thinking, while it still is.
   *
   * A block of text that happens to be growing does not tell anybody the model
   * is alive — it reads as a page that has stopped. A number going up does, and
   * it is the only thing on this row that moves, which is the whole of what it
   * is for. Counted here rather than sent, because the server has nothing to
   * say between two frames and this has to tick through the gaps.
   *
   * The clock starts when the block first goes live and is dropped when it
   * stops, so a second turn counts its own thinking rather than carrying on
   * from the first.
   */
  const [since, setSince] = useState(0);
  const from = useRef<number | null>(null);

  useEffect(() => {
    if (!live) {
      from.current = null;
      return;
    }
    if (from.current === null) from.current = Date.now();
    setSince(Date.now() - from.current);
    const ticking = window.setInterval(() => {
      setSince(Date.now() - (from.current ?? Date.now()));
    }, TICK);
    return () => window.clearInterval(ticking);
  }, [live]);

  // After the hooks and never before: a component that returns early above them
  // runs a different number of hooks on the render where its text arrives.
  if (text.trim() === '') return null;

  /*
   * The duration to show, and there is one either way.
   *
   * While it is thinking, what this has counted. Once it has stopped, what the
   * server measured — the request going out to the last piece of reasoning,
   * which is the wait this block is explaining. It falls back to the counted
   * figure where the server measured none, so the number cannot disappear at
   * the moment the thinking ends: a row that reads "4 seconds" and then drops
   * to nothing looks like a fault, and it is how this shipped saying only
   * "Thought" with no time at all.
   */
  const shown = live ? since : (millis ?? since);

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
        {/*
          "Thinking" while it is, "Thought for" once it has stopped, with the
          duration beside it either way.

          Deliberately not "Thought for", which is the answer's own disclosure a
          few lines below — that one reports the whole turn and, where somebody
          has turned the switch on, what it cost. Two controls under one answer
          both reading "Thought for N seconds" is how they came to be read as
          one control, and the cost on that one was taken for something this had
          attached to the reasoning.

          This block carries no bookkeeping. The only number on it is how long
          somebody waited for the thinking, which is what the block is about.
        */}
        {live ? t('Thinking') : t('Thought')}
        {shown > 0 && (
          <span className={styles.size} data-testid="thinking-elapsed">
            {/* The joining word belongs to the duration, not to the label: the
                label is what this block is, and "for" is part of saying how
                long - so it is set with the number rather than in the heavier
                ink beside it. */}
            {live ? '' : `${t('for')} `}
            {thinkingTime(shown)}
          </span>
        )}
      </button>
      {open && <pre className={styles.body}>{text}</pre>}
    </div>
  );
}

/** How often the count moves while the model is thinking. */
const TICK = 1000;
