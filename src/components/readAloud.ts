import { speak } from '../api/speech';
import { spokenText } from './spokenText';

/**
 * Reading an answer aloud in pieces, while the rest of it is still being
 * written.
 *
 * The naive shape is one request for the whole answer and one clip played at
 * the end of it, and its cost is silence: a speech model is handed the finished
 * text, takes seconds over it, and only then does anybody hear anything - so
 * the longer the answer, the longer the pause before its first word, which is
 * exactly backwards. This asks for the first sentences as soon as they exist,
 * plays them, and makes the next while the current one is in the air.
 *
 * One reading is one answer being read. Everything that has to be abandoned
 * together - what is queued, what is in flight, what is playing - belongs to
 * the object rather than to the panel that made it, so cutting in is
 * `stop()` on this one and a new one for the next turn. That is not
 * housekeeping: the old arrangement kept a `draining` flag across turns, and an
 * interruption at the wrong moment left it stuck true, which turned every later
 * reading into a silent no-op - voice mode went on listening and answering and
 * never spoke again for the rest of the session. A flag that cannot outlive the
 * turn it belongs to cannot do that.
 *
 * What is read is what the message *renders to*, never its markdown: see
 * `spokenText`.
 *
 * **Where the cuts fall is the workspace's to say.** Sentence ends are the
 * default and the shape described above; a workspace that would rather hear
 * fewer joins asks for paragraphs, and one that would rather have a single
 * clip asks for none at all and waits. See `SpeechChunking`. Everything else
 * here is the same whichever it is: the same queue, the same one-ahead lid, the
 * same reading abandoned by one `stop()`.
 */

/**
 * Where a workspace has said an answer may be cut.
 *
 * Named exactly as the server's enum names them, so nothing translates at the
 * boundary and a value read off a workspace is handed straight to this.
 */
export type SpeechChunking = 'NONE' | 'SENTENCE' | 'PARAGRAPH';

/**
 * What a workspace that has said nothing gets, and what this file was before
 * any of them could be said.
 */
export const CHUNKING_DEFAULT: SpeechChunking = 'SENTENCE';

/**
 * Where the text so far can be cut without reading half a sentence aloud.
 *
 * A full stop, question mark or exclamation followed by a space, or the end of
 * a line. Prose only: nothing here tries to be clever about "Dr. Smith", and
 * being wrong costs a clause read as two, not a wrong word.
 */
export const SENTENCE_END = /[.!?…]["')\]]*(?=\s)|\n/g;

/**
 * Where the text so far can be cut without reading half a paragraph aloud.
 *
 * A blank line, which is what a paragraph break survives as: `spokenText` draws
 * the rendered document as lines and leaves exactly one empty line between two
 * blocks, so this is the same seam the eye sees on the screen. A run of them is
 * one cut - two blank lines are not two paragraph endings.
 *
 * A paragraph is deliberately not a heading, a list or a table row. Those are
 * lines inside a block and reading them separately is the seam-per-sentence
 * this mode exists to avoid; a heading and the paragraph under it being spoken
 * in one breath is what somebody choosing this asked for.
 */
export const PARAGRAPH_END = /\n[ \t]*\n+/g;

/**
 * Short fragments are not worth a request of their own.
 *
 * "Yes." spoken alone, then the rest, sounds like two answers. Anything under
 * this waits for the sentence after it, unless the answer has finished.
 */
export const SHORTEST_TO_SPEAK = 24;

/**
 * About as much as anybody says in one breath.
 *
 * A piece is whole sentences, and sentences are added to it until it reaches
 * about this. Two reasons for a ceiling rather than "everything that has
 * arrived": a request for a page of text takes as long as a page of text takes,
 * which is the silence this exists to remove, and a model that answers in one
 * paragraph would otherwise be one request either way.
 */
export const LONGEST_TO_SPEAK = 220;

/** A reading in progress: hand it the answer so far, or stop it. */
export interface Reading {
  /**
   * Reads whatever whole pieces have arrived since the last time.
   *
   * `whole` is the answer so far, always from the beginning, so an offset is
   * the only state this needs. `done` means there is no more coming, and takes
   * the remainder punctuated or not - the last thing somebody says often is
   * not.
   */
  push: (whole: string, done: boolean) => void;
  /** Abandons it: nothing already asked for is played, and nothing more is asked for. */
  stop: () => void;
}

export interface Listener {
  /** Called once, when audio actually begins - not when it was asked for. */
  onStart?: () => void;
  /** Called when the last of the answer has been played, and not when it is stopped. */
  onEnd?: () => void;
  /** Called at most once, with why nothing could be read. */
  onFailure?: (reason: string) => void;
}

/**
 * Cuts prose into pieces, where the workspace has said it may be cut.
 *
 * `upTo` is how much of `text` those pieces account for, which is what the
 * caller advances its offset by - the leftover is a piece still being written,
 * and it is read the next time round.
 *
 * Under `NONE` there is no boundary to look for, so nothing is cut until the
 * answer is over and the tail below is the whole of it. That is the one request
 * this mode exists to make, and it is also why it can produce nothing at all
 * from a half-written answer: `push` must not take that for "there was nothing
 * to say" and drain on it.
 */
function pieces(
  text: string,
  whole: boolean,
  chunking: SpeechChunking,
): { parts: string[]; upTo: number } {
  const boundary = chunking === 'SENTENCE' ? SENTENCE_END : chunking === 'PARAGRAPH' ? PARAGRAPH_END : null;

  const cuts: number[] = [];
  if (boundary !== null) {
    boundary.lastIndex = 0;
    for (let found = boundary.exec(text); found !== null; found = boundary.exec(text)) {
      cuts.push(found.index + found[0].length);
    }
  }
  // Nothing more is coming, so what is left is a piece whether or not it ended
  // the way one does.
  if (whole && cuts[cuts.length - 1] !== text.length) cuts.push(text.length);

  const parts: string[] = [];
  let start = 0;
  let at = 0;
  while (at < cuts.length) {
    let end = cuts[at];
    /*
     * Take the sentences after it too, while they still fit in one breath.
     *
     * Sentences only. A paragraph is already the size somebody asked for when
     * they chose paragraphs, and gathering two of them up to a ceiling would be
     * this mode quietly cutting inside a paragraph the moment one ran long -
     * which is the seam it was chosen to remove. Under `NONE` there is at most
     * one cut and nothing to gather.
     */
    if (chunking === 'SENTENCE') {
      while (at + 1 < cuts.length && cuts[at + 1] - start <= LONGEST_TO_SPEAK) {
        at += 1;
        end = cuts[at];
      }
    }
    parts.push(text.slice(start, end));
    start = end;
    at += 1;
  }

  return { parts: parts.map((part) => part.trim()).filter((part) => part !== ''), upTo: start };
}

/**
 * Starts a reading. Nothing is asked for until something is pushed into it.
 *
 * `chunking` is what the workspace has said about where an answer may be cut,
 * and it is fixed for the reading: a turn that changed shape halfway through
 * would be heard as two different readings of one answer.
 */
export function readAloud(
  workspaceId: string,
  listener: Listener = {},
  chunking: SpeechChunking = CHUNKING_DEFAULT,
): Reading {
  /** Pieces that have not been asked for yet, in the order they must be heard. */
  const pending: string[] = [];
  /**
   * The next clip, already being made while the current one plays.
   *
   * One ahead and no more. Asking for every piece at once would put a burst of
   * requests on a speech provider the moment a long answer landed, for audio
   * that will not be wanted for minutes - and if the answer is cut short, most
   * of it never will be.
   */
  let ahead: Promise<Blob> | null = null;
  let playing: { element: HTMLAudioElement; url: string; done: () => void } | null = null;
  /** How much of the spoken text has been handed over to be read. */
  let read = 0;
  let finished = false;
  let draining = false;
  let stopped = false;
  let started = false;
  let complained = false;

  function fail(cause: unknown) {
    if (complained) return;
    complained = true;
    listener.onFailure?.(cause instanceof Error ? cause.message : 'That could not be read aloud.');
  }

  /**
   * Stops whatever is playing and lets go of it.
   *
   * The object URL is revoked rather than left: a blob held by one keeps its
   * bytes for as long as the page is open, and a conversation somebody listens
   * through would accumulate every answer it ever read.
   *
   * The waiting promise is resolved here too, because a paused element fires no
   * `ended` and the loop below is otherwise left awaiting a clip that has
   * stopped playing. Resolving twice is harmless; a promise settles once.
   */
  function hush() {
    const held = playing;
    if (held === null) return;
    playing = null;
    held.element.pause();
    URL.revokeObjectURL(held.url);
    held.done();
  }

  /** Asks for the next piece, or answers null when there is none waiting. */
  function ask(): Promise<Blob> | null {
    const next = pending.shift();
    return next === undefined ? null : speak(workspaceId, next);
  }

  /** Plays one clip and resolves when it has finished, or at once if it cannot. */
  function play(clip: Blob) {
    return new Promise<void>((done) => {
      if (stopped) {
        done();
        return;
      }
      const url = URL.createObjectURL(clip);
      const element = new Audio(url);
      playing = { element, url, done };
      /*
       * The panel says it is speaking when it is speaking.
       *
       * Not when the answer started arriving, and not when the clip was asked
       * for: both of those are a claim about the model rather than about the
       * room, and the wait between them is seconds during which the screen said
       * one thing and the speakers said nothing. `playing` is the browser
       * saying sound is coming out.
       */
      element.addEventListener(
        'playing',
        () => {
          if (started || stopped) return;
          started = true;
          listener.onStart?.();
        },
        { once: true },
      );
      element.addEventListener('ended', () => done(), { once: true });
      // A clip that will not play must not stop the ones behind it.
      element.addEventListener('error', () => done(), { once: true });
      element.play().catch(() => done());
    });
  }

  async function drain() {
    if (draining) return;
    draining = true;

    while (!stopped) {
      const next = ahead ?? ask();
      ahead = null;
      if (next === null) break;
      // The one after it, made while this one is in the air.
      ahead = ask();
      // A piece that could not be read is skipped rather than ending the
      // answer: the rest of it is still worth hearing.
      const clip = await next.catch((cause: unknown) => {
        fail(cause);
        return null;
      });
      if (stopped) break;
      if (clip !== null) await play(clip);
      hush();
    }

    draining = false;
    if (stopped) return;
    // Nothing left and nothing more coming: this answer has been read.
    if (finished && pending.length === 0 && ahead === null) listener.onEnd?.();
  }

  return {
    push(whole, done) {
      if (stopped) return;
      if (done) finished = true;

      const spoken = spokenText(whole);
      const rest = spoken.slice(read);
      const { parts, upTo } = pieces(rest, done, chunking);

      /*
       * The short-fragment gate is a sentence's affair.
       *
       * "Yes." spoken alone and then the rest sounds like two answers, which is
       * a thing that only happens where a sentence is a piece. A paragraph is
       * one by definition however short it is - a one-line paragraph held back
       * for the next one would be a mode that cuts at paragraph ends except
       * when it does not - and under `NONE` there is one piece and nothing to
       * hold it for.
       */
      const tooShort = chunking === 'SENTENCE' && !done && upTo < SHORTEST_TO_SPEAK;

      if (parts.length === 0 || tooShort) {
        // Still worth draining when the answer is over: an answer that was
        // empty, or all code, has been read as far as anybody is concerned.
        // Never on a half-written one, which is what `NONE` looks like right up
        // until its single piece exists.
        if (done) void drain();
        return;
      }

      read += upTo;
      pending.push(...parts);
      void drain();
    },
    stop() {
      stopped = true;
      pending.length = 0;
      ahead = null;
      hush();
    },
  };
}
