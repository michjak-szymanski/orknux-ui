import { useState } from 'react';

import styles from './Thinking.module.css';
import { t } from '../i18n';

export interface ThinkingProps {
  /** What the model thought, as it arrived. Empty draws nothing at all. */
  text: string;
  /** Whether it is still arriving, which is worth saying while it is. */
  live?: boolean;
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
export function Thinking({ text, live = false }: ThinkingProps) {
  const [open, setOpen] = useState(false);
  if (text.trim() === '') return null;

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
        {live ? t('Thinking') : t('Thought')}
        {/*
          How much of it there is, which is what somebody deciding whether to
          open it wants. An expression rather than a sentence, and the whole of
          what this says about the content: reading it is what opening it is
          for.
        */}
        <span className={styles.size}>{text.length.toLocaleString()}</span>
      </button>
      {open && <pre className={styles.body}>{text}</pre>}
    </div>
  );
}
