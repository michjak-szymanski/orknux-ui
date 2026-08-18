import { useCallback, useEffect, useRef, useState } from 'react';

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
  /** Sends what was heard and resolves with the answer, to be read back. */
  onSay: (text: string) => Promise<string>;
  onClose: () => void;
}

/** Loud enough to be somebody talking rather than a room being quiet. */
const SPEECH_LEVEL = 0.045;

/** Quiet for this long, after speech, ends the turn. */
const SILENCE_MS = 1_200;

/** No single turn runs longer than this, however quiet it never gets. */
const LONGEST_TURN_MS = 30_000;

/** Below this, the circle is still: a room's own noise is not a voice. */
const VISIBLE_LEVEL = 0.01;

export function VoiceMode({ workspaceId, onSay, onClose }: VoiceModeProps) {
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

          const answer = await say.current(text.trim());
          if (!live.current) return;
          if (answer.trim() === '') {
            void listen();
            return;
          }

          setPhase('speaking');
          const spoken = await speak(workspaceId, answer);
          if (!live.current) return;

          const url = URL.createObjectURL(spoken);
          const element = new Audio(url);
          audio.current = { element, url };
          element.addEventListener(
            'ended',
            () => {
              hush();
              void listen();
            },
            { once: true },
          );
          await element.play();
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
  }, [hush, release, workspaceId]);

  useEffect(() => {
    live.current = true;
    void listen();
    return () => {
      live.current = false;
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
  function interrupt() {
    if (phase === 'speaking') {
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
