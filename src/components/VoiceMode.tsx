import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';

import { speak } from '../api/speech';
import { transcribe } from '../api/transcription';
import styles from './VoiceMode.module.css';

/**
 * Hands-free conversation: it listens, sends what it heard, and reads the
 * answer back before listening again.
 *
 * The loop is the feature. A microphone button that puts a transcript in the
 * box is a faster way to type; this is a way to talk to the thing without
 * touching it, which means nobody presses anything between turns — so the end
 * of a turn has to be noticed rather than declared. That is what the level
 * watching below is for: speech, then quiet for long enough to mean "your go".
 *
 * The transcript stays on screen beside this, because a conversation you cannot
 * scroll back through is a conversation you have to remember.
 */
export type VoicePhase = 'listening' | 'thinking' | 'speaking';

export interface VoiceModeProps {
  workspaceId: string;
  /**
   * Sends what was heard and resolves with the answer, to be read back.
   *
   * `onProgress` is handed the answer so far, as often as the chat grows it.
   * Reading only starts on the whole answer means the pause between a question
   * and the first word is however long the model takes to finish - and a long
   * answer makes that pause longer, which is exactly backwards.
   */
  onSay: (text: string, onProgress: (soFar: string) => void) => Promise<string>;
  onClose: () => void;
  /**
   * Told whenever listening becomes thinking becomes speaking.
   *
   * The panel shows the phase in its own circle, but the button in the title
   * bar is what somebody is looking at when the panel is off to the side - and
   * a control that looks the same whether it is listening or talking is a
   * control that says nothing.
   */
  onPhase?: (phase: VoicePhase) => void;
  /** Cuts the answer short and goes back to listening, from outside this panel. */
  ref?: Ref<VoiceModeHandle>;
}

export interface VoiceModeHandle {
  interrupt: () => void;
}

/** Loud enough to be somebody talking rather than a room being quiet. */
const SPEECH_LEVEL = 0.045;

/** Quiet for this long, after speech, ends the turn. */
const SILENCE_MS = 1_200;

/** No single turn runs longer than this, however quiet it never gets. */
const LONGEST_TURN_MS = 30_000;

/** Below this, the circle is still: a room's own noise is not a voice. */
const VISIBLE_LEVEL = 0.01;

/**
 * Where the text so far can be cut without reading half a sentence aloud.
 *
 * A full stop, question mark or exclamation followed by a space, or the end of
 * a line. Prose only: nothing here tries to be clever about "Dr. Smith", and
 * being wrong costs a clause read as two, not a wrong word.
 */
const SENTENCE_END = /[.!?…]["')\]]*(?=\s)|\n/g;

/**
 * Short fragments are not worth a request of their own.
 *
 * "Yes." spoken alone, then the rest, sounds like two answers. Anything under
 * this waits for the sentence after it, unless the answer has finished.
 */
const SHORTEST_TO_SPEAK = 24;

export function VoiceMode({ workspaceId, onSay, onClose, onPhase, ref }: VoiceModeProps) {
  const [phase, setPhase] = useState<VoicePhase>('listening');
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Everything the loop has to be able to stop.
   *
   * In refs rather than state because the loop reads them from callbacks and
   * animation frames that were created several renders ago: state read there is
   * whatever it was when the closure was made, which for a recorder that must
   * be stopped is the wrong answer.
   */
  const live = useRef(true);
  /*
   * The sender, held in a ref.
   *
   * The page it comes from re-renders on every chunk of every answer, so a new
   * function arrives constantly; depending on it directly would tear the loop
   * down and start it again mid-sentence. What it does never changes, so only
   * the latest one is kept.
   */
  const say = useRef(onSay);
  useEffect(() => {
    say.current = onSay;
  }, [onSay]);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audio = useRef<{ element: HTMLAudioElement; url: string } | null>(null);
  /**
   * The next turn, held in a ref.
   *
   * The reading is defined above the listening and finishes by starting it,
   * which is a circle the language will not let either side of close directly.
   */
  const listenAgain = useRef<() => void>(() => undefined);
  const context = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);

  /** Everything this turn is holding open, closed in the order it was opened. */
  const release = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    void context.current?.close().catch(() => undefined);
    context.current = null;
    setLevel(0);
  }, []);

  const hush = useCallback(() => {
    if (audio.current === null) return;
    audio.current.element.pause();
    URL.revokeObjectURL(audio.current.url);
    audio.current = null;
  }, []);

  /*
   * The reading, which runs a sentence behind the writing.
   *
   * `clips` are requests already made, in the order they must be heard; the
   * drain plays them one at a time and the next is being fetched while the
   * current one plays. `generation` is what makes an interruption final: a
   * request that lands after somebody cut in belongs to a turn that is over,
   * and playing it would be the panel talking over the person.
   */
  const clips = useRef<Promise<Blob>[]>([]);
  const draining = useRef(false);
  const finished = useRef(false);
  const generation = useRef(0);
  /** How much of the answer has been sent to be read. */
  const read = useRef(0);

  /** Plays one clip and resolves when it has finished, or at once if it cannot. */
  const play = useCallback(
    (clip: Blob, mine: number) =>
      new Promise<void>((done) => {
        if (!live.current || mine !== generation.current) {
          done();
          return;
        }
        const url = URL.createObjectURL(clip);
        const element = new Audio(url);
        audio.current = { element, url };
        element.addEventListener('ended', () => done(), { once: true });
        // A clip that will not play must not stop the ones behind it.
        element.addEventListener('error', () => done(), { once: true });
        element.play().catch(() => done());
      }),
    [],
  );

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    const mine = generation.current;

    while (clips.current.length > 0 && live.current && mine === generation.current) {
      const next = clips.current.shift();
      if (next === undefined) break;
      // A sentence that could not be read is skipped rather than ending the
      // answer: the rest of it is still worth hearing.
      const clip = await next.catch(() => null);
      if (clip === null) continue;
      await play(clip, mine);
      hush();
    }

    draining.current = false;
    if (!live.current || mine !== generation.current) return;
    // Nothing left and nothing more coming: the turn is over, so listen again.
    if (finished.current && clips.current.length === 0) void listenAgain.current();
  }, [hush, play]);

  /**
   * Reads whatever whole sentences have arrived since the last time.
   *
   * `whole` is the answer so far, always from the beginning, so the offset is
   * the only state this needs. When the answer is done the remainder goes too,
   * punctuated or not - the last thing somebody says often is not.
   */
  const readOn = useCallback(
    (whole: string, done: boolean) => {
      if (!live.current) return;
      const mine = generation.current;
      const rest = whole.slice(read.current);

      let upTo = 0;
      SENTENCE_END.lastIndex = 0;
      for (let found = SENTENCE_END.exec(rest); found !== null; found = SENTENCE_END.exec(rest)) {
        upTo = found.index + found[0].length;
      }

      const piece = (done ? rest : rest.slice(0, upTo)).trim();
      if (piece === '') return;
      if (!done && piece.length < SHORTEST_TO_SPEAK) return;

      read.current += done ? rest.length : upTo;
      clips.current.push(
        speak(workspaceId, piece).then((clip) => {
          if (mine !== generation.current) throw new Error('interrupted');
          return clip;
        }),
      );
      void drain();
    },
    [drain, workspaceId],
  );

  /**
   * One turn: listen until the talking stops, then answer and read it back.
   *
   * Recursive rather than a loop with awaits, because each step ends in an
   * event — the recorder stopping, the audio finishing — and a turn can be
   * abandoned at any of them by the panel being closed.
   */
  const listen = useCallback(async () => {
    if (!live.current) return;
    setPhase('listening');

    let opened: MediaStream;
    try {
      opened = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('The microphone could not be opened. The browser may have refused it.');
      return;
    }
    if (!live.current) {
      opened.getTracks().forEach((track) => track.stop());
      return;
    }

    stream.current = opened;
    const ears = new AudioContext();
    context.current = ears;
    const analyser = ears.createAnalyser();
    analyser.fftSize = 1024;
    ears.createMediaStreamSource(opened).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const held = new MediaRecorder(opened);
    recorder.current = held;
    const pieces: Blob[] = [];
    held.ondataavailable = (event) => {
      if (event.data.size > 0) pieces.push(event.data);
    };

    const startedAt = performance.now();
    let spokeAt: number | null = null;

    const watch = () => {
      if (!live.current || recorder.current !== held) return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const loudness = Math.sqrt(sum / samples.length);
      setLevel(loudness < VISIBLE_LEVEL ? 0 : Math.min(1, loudness * 6));

      const now = performance.now();
      if (loudness > SPEECH_LEVEL) spokeAt = now;

      const quietLongEnough = spokeAt !== null && now - spokeAt > SILENCE_MS;
      const goneOnTooLong = now - startedAt > LONGEST_TURN_MS;
      if (quietLongEnough || (goneOnTooLong && spokeAt !== null)) {
        held.stop();
        return;
      }
      // Nothing said at all: keep listening rather than sending silence.
      if (goneOnTooLong && spokeAt === null) {
        held.stop();
        return;
      }
      frame.current = requestAnimationFrame(watch);
    };

    held.onstop = () => {
      const said = new Blob(pieces, { type: held.mimeType });
      const anythingSaid = spokeAt !== null;
      release();
      if (!live.current) return;

      // Nobody spoke: round again, without troubling the transcriber.
      if (!anythingSaid || said.size === 0) {
        void listen();
        return;
      }

      setPhase('thinking');
      transcribe(workspaceId, said)
        .then(async (text) => {
          if (!live.current) return;
          if (text.trim() === '') {
            void listen();
            return;
          }
          setHeard(text.trim());
          setError(null);

          /*
           * A turn of its own, so anything left over from the last one - a clip
           * still arriving, an offset into an answer that is finished with -
           * belongs to a generation nobody is listening to any more.
           */
          generation.current += 1;
          clips.current = [];
          read.current = 0;
          finished.current = false;

          /*
           * Speaking starts on the first whole sentence, not on the last one.
           *
           * The phase changes as soon as there is anything to read, which is
           * what the circle in the middle is showing; the drain below is
           * already fetching that sentence while the model writes the next.
           */
          const answer = await say.current(text.trim(), (soFar) => {
            if (!live.current) return;
            setPhase('speaking');
            readOn(soFar, false);
          });
          if (!live.current) return;
          if (answer.trim() === '') {
            void listen();
            return;
          }

          setPhase('speaking');
          // Whatever is left, punctuated or not: the end of an answer often is
          // not a sentence.
          finished.current = true;
          readOn(answer, true);
          void drain();
        })
        .catch((cause: unknown) => {
          if (!live.current) return;
          setError(cause instanceof Error ? cause.message : 'That turn did not work.');
          // A turn that failed is not a reason to stop listening — the next one
          // may be fine, and the alternative is a panel that sits there dead.
          void listen();
        });
    };

    held.start();
    frame.current = requestAnimationFrame(watch);
  }, [drain, hush, readOn, release, workspaceId]);

  useEffect(() => {
    listenAgain.current = () => void listen();
  }, [listen]);

  useEffect(() => {
    live.current = true;
    void listen();
    return () => {
      live.current = false;
      // Nothing that arrives after this belongs to anybody.
      generation.current += 1;
      clips.current = [];
      recorder.current?.stop();
      release();
      hush();
    };
  }, [hush, listen, release]);

  /**
   * The circle is a button, because the one thing somebody wants mid-sentence
   * is to interrupt: while it is talking, stop and listen; while it is
   * listening, take what has been said so far as the whole turn.
   */
  /*
   * The phase, told to whoever is showing it elsewhere.
   *
   * An effect rather than a call beside each setPhase: there are five places
   * the phase changes, and one of them forgetting to report would be a button
   * that quietly stops matching what is happening.
   */
  useEffect(() => {
    onPhase?.(phase);
  }, [phase, onPhase]);

  useImperativeHandle(ref, () => ({ interrupt }));

  function interrupt() {
    if (phase === 'speaking') {
      // The generation moves, so a clip already asked for is not played at
      // somebody who has started talking again.
      generation.current += 1;
      clips.current = [];
      hush();
      void listen();
      return;
    }
    if (phase === 'listening') recorder.current?.stop();
  }

  const caption =
    phase === 'listening' ? 'Listening' : phase === 'thinking' ? 'Thinking' : 'Speaking';

  return (
    <aside className={styles.panel} aria-label="Voice mode">
      <header className={styles.head}>
        <h2 className={styles.title}>Voice</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Leave voice mode">
          Leave
        </button>
      </header>

      <button
        type="button"
        className={`${styles.orb} ${styles[phase]}`}
        // The circle grows with what it hears, so the loudness is visible
        // before the transcript proves anything was heard at all.
        style={{ ['--level' as string]: level.toFixed(3) }}
        onClick={interrupt}
        aria-label={
          phase === 'speaking' ? 'Stop speaking and listen' : phase === 'listening' ? 'Finish speaking' : 'Thinking'
        }
      >
        <span className={styles.ring} aria-hidden="true" />
        <span className={styles.core} aria-hidden="true" />
      </button>

      <p className={styles.caption} aria-live="polite">
        {caption}
      </p>

      <p className={styles.hint}>
        {phase === 'listening'
          ? 'Speak — it answers when you stop.'
          : phase === 'speaking'
            ? 'Tap the circle to cut in.'
            : 'Working out what to say.'}
      </p>

      {heard !== null && (
        <p className={styles.heard}>
          <span className={styles.heardLabel}>Heard</span>
          {heard}
        </p>
      )}

      {error !== null && <p className={styles.error}>{error}</p>}
    </aside>
  );
}
