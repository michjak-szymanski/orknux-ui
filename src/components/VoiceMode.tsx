import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';

import { CHUNKING_DEFAULT, readAloud } from './readAloud';
import type { Reading, SpeechChunking } from './readAloud';
import { transcribe } from '../api/transcription';
import styles from './VoiceMode.module.css';
import { t } from '../i18n';

/**
 * Hands-free conversation: it listens, sends what it heard, and reads the
 * answer back — while going on listening.
 *
 * The loop is the feature. A microphone button that puts a transcript in the
 * box is a faster way to type; this is a way to talk to the thing without
 * touching it, which means nobody presses anything between turns — so the end
 * of a turn has to be noticed rather than declared. That is what the level
 * watching below is for: speech, then quiet for long enough to mean "your go".
 *
 * **The microphone does not close between turns.** It used to: it opened when
 * it was this person's turn and shut for as long as the model was thinking or
 * talking, so anything said in that gap — which is most of a conversation — was
 * said to nothing at all. It is held now and what changes is where the words
 * go: this turn if there is no turn in flight, and otherwise into the one thing
 * waiting to be sent, shown on the panel so that it is waiting visibly.
 *
 * The transcript stays on screen beside this, because a conversation you cannot
 * scroll back through is a conversation you have to remember. And typing is not
 * the other mode: a message typed into the composer while this is open is a
 * turn like any other, held and sent by exactly the same rules.
 */
export type VoicePhase = 'listening' | 'thinking' | 'speaking';

/**
 * What a workspace has decided about how a turn ends, in the units it states
 * them in. Any of the three may be null, which is what a workspace that has
 * decided nothing sends, and null takes the value below.
 */
export interface VoiceTurnTaking {
  pauseEndsTurnMs: number | null;
  speechOverRoomPercent: number | null;
  unattendedMicrophoneMs: number | null;
}

export interface VoiceModeProps {
  workspaceId: string;
  /**
   * What this workspace has decided about turn-taking, or nothing.
   *
   * A workspace can move these because the numbers below are a judgement about
   * how people talk rather than a fact about audio, and getting one wrong ends
   * somebody's sentence for them. Whatever it has not decided stays on the
   * value defined here — which is why the server stores only a departure and
   * holds no default of its own.
   */
  turnTaking?: VoiceTurnTaking | null;
  /**
   * Where this workspace has said an answer may be cut for the speech model.
   *
   * Handed in rather than fetched for the reason `turnTaking` is: the page that
   * opens this panel has already asked the server about the workspace, and it
   * is the same answer. Omitted is the default, which is what a hands-free
   * conversation wants anyway - it is the shape that gets a first word out
   * soonest.
   */
  chunking?: SpeechChunking;
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
  /**
   * Takes a message that was typed rather than spoken.
   *
   * The composer stays live while this panel is open, and what is typed into it
   * has to arrive here rather than beside it: two senders on one chat means two
   * turns in flight, an answer nobody reads aloud, and a microphone still
   * listening for a turn that has already been taken.
   */
  say: (text: string) => void;
}

/**
 * Loud enough to be somebody talking rather than a room being quiet.
 *
 * This was 0.045, which is a good level for the middle of a word and a poor one
 * for the end of a phrase. A voice falls away as a sentence closes, and under
 * this line the silence clock starts - so somebody pausing between clauses was
 * cut off while they were still speaking, quietly. It sits just above the level
 * the circle already treats as a room rather than a voice.
 */
const SPEECH_LEVEL = 0.02;

/**
 * How far above the room's own noise counts as a voice.
 *
 * Speech is several times the level of the room it is spoken in, whatever that
 * room is - which is why this travels between microphones where a fixed level
 * does not.
 */
const SPEECH_OVER_ROOM = 2.5;

/**
 * Quiet for this long, after speech, ends the turn.
 *
 * 1.2 seconds is shorter than an ordinary pause. People stop to think in the
 * middle of a sentence, and every one of those stops was read as "your go" -
 * the turn ended, what had been said so far was sent, and the rest was spoken
 * to a microphone that was no longer listening.
 *
 * Two and a half seconds is long enough for a clause break and still short
 * enough to feel like a conversation. It is a judgement about how people talk
 * rather than a fact about audio, so it is the first number to move if this
 * still cuts somebody off - together with SPEECH_LEVEL above, since the two
 * decide the same thing between them.
 *
 * And because it is a judgement rather than a fact, a workspace may take it
 * somewhere else: this is what it starts from and falls back to, not the only
 * answer. See VOICE_TURN_TAKING_DEFAULTS below.
 */
const SILENCE_MS = 2_500;

/**
 * No single turn runs longer than this, however quiet it never gets.
 *
 * A backstop against a room that never falls silent, not a limit on how much
 * somebody may say.
 *
 * It has now cut somebody off twice. Thirty seconds is a short answer to a
 * question and a very short explanation; two minutes still stopped a person
 * mid-sentence while they were working through a thought out loud. Both were
 * this number being read as a limit when it is only a fuse.
 *
 * Ten minutes is past anything a person says in one breath and well short of a
 * microphone left open in an empty room until the tab is closed - which is the
 * only thing this is here to catch. The pause above is what actually ends a
 * turn, and it should be allowed to.
 */
const LONGEST_TURN_MS = 600_000;

/**
 * The three above, in the units a workspace states a decision about them in.
 *
 * The one place anything outside this file may learn what "the default" is.
 * The settings form that offers these has to say what happens when nothing is
 * set, and the only honest way for it to say so is to read the numbers that
 * would really be used — a copy typed into that form would go on saying 2.5
 * seconds long after this file said something else, which is a form that lies
 * about the product it configures.
 *
 * `SPEECH_OVER_ROOM` is a ratio where it is used and a percentage here, because
 * the percentage is what a person reads and what the workspace stores; the
 * multiplication is the whole of the conversion and it lives here.
 *
 * `SPEECH_LEVEL` is deliberately not among them. It and the ratio decide the
 * same thing and are OR'd together, and the fixed level is only there so that a
 * silent room is not absurdly sensitive — every breath is three times nothing.
 * It is a guard against the ratio's failure mode rather than a knob, and
 * offering it would be offering the same question twice.
 */
export const VOICE_TURN_TAKING_DEFAULTS = {
  pauseEndsTurnMs: SILENCE_MS,
  speechOverRoomPercent: SPEECH_OVER_ROOM * 100,
  unattendedMicrophoneMs: LONGEST_TURN_MS,
} as const;

/** What is really in force: whatever the workspace decided, else the above. */
function inForce(chosen: VoiceTurnTaking | null | undefined) {
  return {
    pauseMs: chosen?.pauseEndsTurnMs ?? VOICE_TURN_TAKING_DEFAULTS.pauseEndsTurnMs,
    overRoom:
      (chosen?.speechOverRoomPercent ?? VOICE_TURN_TAKING_DEFAULTS.speechOverRoomPercent) / 100,
    unattendedMs:
      chosen?.unattendedMicrophoneMs ?? VOICE_TURN_TAKING_DEFAULTS.unattendedMicrophoneMs,
  };
}

/** Below this, the circle is still: a room's own noise is not a voice. */
const VISIBLE_LEVEL = 0.01;

/**
 * What the microphone is asked for, and why it is asked for by name.
 *
 * These are a browser's defaults for a bare `audio: true` and they are stated
 * anyway, because one of them is now load-bearing rather than a nicety. The
 * microphone stays open while the answer is being read aloud, so the room it is
 * listening to contains this application talking: without echo cancellation the
 * panel hears itself, transcribes itself, and sends its own last sentence back
 * as the next thing somebody said. A default that is relied upon is a default
 * worth writing down.
 */
const HEARING: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** The last thing sent, and whether it was said out loud or typed. */
interface Said {
  text: string;
  spoken: boolean;
}

export function VoiceMode({
  workspaceId,
  turnTaking,
  chunking = CHUNKING_DEFAULT,
  onSay,
  onClose,
  onPhase,
  ref,
}: VoiceModeProps) {
  const [phase, setPhase] = useState<VoicePhase>('listening');
  const [level, setLevel] = useState(0);
  const [said, setSaid] = useState<Said | null>(null);
  /** What was said into the gap and has not been sent yet, for the panel to show. */
  const [waiting, setWaiting] = useState<string | null>(null);
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
  /**
   * Which mount is asking, so an answer meant for an earlier one is refused.
   *
   * `live` on its own is not enough: it is a single flag shared by every mount
   * of this panel, and a mount that arrives while the last one's `getUserMedia`
   * is still in flight sets it back to true. The microphone then lands in a
   * panel that never asked for it, takes the place of the one it did ask for,
   * and is left with nobody to close it — which is a recording light that stays
   * on until the page is reloaded. A number that only goes up settles which
   * mount a stream belongs to.
   */
  const session = useRef(0);
  /*
   * The sender, held in a ref.
   *
   * The page it comes from re-renders on every chunk of every answer, so a new
   * function arrives constantly; depending on it directly would tear the loop
   * down and start it again mid-sentence. What it does never changes, so only
   * the latest one is kept.
   */
  const sender = useRef(onSay);
  useEffect(() => {
    sender.current = onSay;
  }, [onSay]);
  /*
   * What the workspace decided, held in a ref for the reason the sender above
   * is.
   *
   * The frame that watches the level was made when the turn began, and the page
   * that hands these down re-renders on every chunk of every answer — so a
   * dependency on them would tear the loop down mid-sentence over a number that
   * has not changed. Read every frame rather than captured at the start of a
   * turn, which also means a setting saved in another tab reaches the turn
   * already running instead of the one after it.
   *
   * The three primitives are the effect's dependencies rather than the object
   * around them, because that object is built fresh on every one of those
   * renders and is a new object each time whatever it holds.
   */
  const pauseSetting = turnTaking?.pauseEndsTurnMs ?? null;
  const overRoomSetting = turnTaking?.speechOverRoomPercent ?? null;
  const unattendedSetting = turnTaking?.unattendedMicrophoneMs ?? null;
  const decided = useRef(inForce(turnTaking));
  useEffect(() => {
    decided.current = inForce({
      pauseEndsTurnMs: pauseSetting,
      speechOverRoomPercent: overRoomSetting,
      unattendedMicrophoneMs: unattendedSetting,
    });
  }, [pauseSetting, overRoomSetting, unattendedSetting]);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const context = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);

  /**
   * The turn in flight, and which one it is.
   *
   * `busy` is what decides whether the next thing heard is this turn or the one
   * after it, and it has to be a ref because it is read from a recorder that
   * stopped several renders ago. `turn` only goes up, and everything a turn
   * starts — a chunk of answer, a clip, the end of a reading — checks that it
   * still belongs to the turn that is running before it does anything.
   */
  const busy = useRef(false);
  const turn = useRef(0);
  /** The reading of the current answer, and the only thing that can stop it. */
  const reading = useRef<Reading | null>(null);
  /** The one message waiting for its turn, in a ref for the reason `busy` is. */
  const queued = useRef<Said | null>(null);
  /**
   * Starting the next turn, held in a ref.
   *
   * A turn ends by starting the next one where something is waiting, which is a
   * circle the language will not let either side of close directly.
   */
  const nextTurn = useRef<() => void>(() => undefined);

  /**
   * Everything the microphone is holding open, closed in the order it was opened.
   *
   * The only place the microphone is given back, so every way out of voice mode
   * — the panel's own button, the cross beside the control, walking away from
   * the page mid-sentence — arrives here instead of carrying its own copy of
   * the stopping. The copy somebody forgets is a light that stays on.
   *
   * Safe to call twice, and safe to call on a turn that never started.
   */
  const release = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const held = recorder.current;
    recorder.current = null;
    // A recorder still running is holding the stream it was handed; stopping
    // the tracks under it is not the same thing as stopping it.
    if (held !== null && held.state !== 'inactive') held.stop();
    // The light on the machine goes out when the tracks do — not when the
    // recorder stops, and not when the last reference to the stream is dropped.
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    // A separate resource from the stream, and one the browser counts too.
    void context.current?.close().catch(() => undefined);
    context.current = null;
    setLevel(0);
  }, []);

  /**
   * One turn: send it, and read the answer back as it is written.
   *
   * Nothing here waits for the microphone, because the microphone never
   * stopped. What the panel shows is the conversation's state and not the
   * device's: thinking while the model writes, speaking once sound is actually
   * coming out, and listening again when there is nothing left to play.
   */
  const begin = useCallback(
    (starting: Said) => {
      if (!live.current) return;
      const mine = (turn.current += 1);
      busy.current = true;
      setSaid(starting);
      setError(null);
      setPhase('thinking');

      reading.current?.stop();
      const say = readAloud(
        workspaceId,
        {
          onStart: () => {
            if (live.current && mine === turn.current) setPhase('speaking');
          },
          onEnd: () => {
            if (live.current && mine === turn.current) nextTurn.current();
          },
          onFailure: (reason) => {
            if (live.current && mine === turn.current) setError(reason);
          },
        },
        chunking,
      );
      reading.current = say;

      void (async () => {
        try {
          const answer = await sender.current(starting.text, (soFar) => {
            if (!live.current || mine !== turn.current) return;
            say.push(soFar, false);
          });
          if (!live.current || mine !== turn.current) return;
          // Whatever is left, punctuated or not: the end of an answer often is
          // not a sentence. An answer that was empty ends the turn here too.
          say.push(answer, true);
        } catch (cause: unknown) {
          if (!live.current || mine !== turn.current) return;
          setError(cause instanceof Error ? cause.message : t('That turn did not work.'));
          say.stop();
          // A turn that failed is not a reason to stop listening — the next one
          // may be fine, and the alternative is a panel that sits there dead.
          nextTurn.current();
        }
      })();
    },
    [workspaceId, chunking],
  );

  /*
   * The turn is over: send what was waiting, or go back to listening.
   *
   * In an effect rather than beside `begin` because the two call each other,
   * and a ref is the seam that lets them.
   */
  useEffect(() => {
    nextTurn.current = () => {
      busy.current = false;
      const next = queued.current;
      if (next === null) {
        setPhase('listening');
        return;
      }
      queued.current = null;
      setWaiting(null);
      begin(next);
    };
  }, [begin]);

  /**
   * Where a finished message goes: into this turn, or into the one waiting.
   *
   * The decision is made when the words are complete rather than when they were
   * started, which is what makes cutting in work: somebody who interrupts is
   * already speaking, and the sentence they are in the middle of belongs to the
   * turn they have just taken rather than to the queue.
   *
   * A second message while one is already waiting is **added to it**, not put
   * behind it and not thrown away. Both were said into the same gap and to the
   * same turn, and holding a queue of them would answer a question somebody has
   * already rephrased. What does throw the waiting message away is cutting in
   * deliberately — see `interrupt`: pressing the circle means "listen to me
   * now", and sending what was said before that press would be answering
   * something the person has visibly moved on from.
   */
  const hand = useCallback(
    (next: Said) => {
      if (!busy.current) {
        begin(next);
        return;
      }
      const held = queued.current;
      queued.current =
        held === null
          ? next
          : { text: `${held.text} ${next.text}`, spoken: held.spoken || next.spoken };
      setWaiting(queued.current.text);
    },
    [begin],
  );

  /**
   * Listens for one utterance, and starts listening for the next as it ends.
   *
   * Recursive rather than a loop with awaits, because each step ends in an
   * event — the recorder stopping — and listening can be abandoned at any of
   * them by the panel being closed.
   */
  const listen = useCallback(async () => {
    if (!live.current) return;
    const mine = session.current;

    let opened: MediaStream;
    try {
      opened = await navigator.mediaDevices.getUserMedia({ audio: HEARING });
    } catch {
      setError(t('The microphone could not be opened. The browser may have refused it.'));
      return;
    }
    // Asked for by a panel that has since gone. Nobody is going to close this
    // one later, so it is closed here.
    if (!live.current || mine !== session.current) {
      opened.getTracks().forEach((track) => track.stop());
      return;
    }

    // Whatever the last utterance is still holding, in case it ended without
    // saying so: two open microphones means one of them has nobody.
    release();
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

    /*
     * What this room sounds like with nobody talking.
     *
     * A fixed level cannot answer "is somebody speaking": it is a question about
     * a microphone, a room and a voice, and those differ by more than the
     * numbers between one person's setup and another's. Held at a fixed 0.045 it
     * cut people off in the middle of a sentence - not because they had stopped,
     * but because their voice had dropped under a line drawn for somebody else's
     * equipment.
     *
     * So the line is drawn from what is actually heard. The floor follows the
     * quiet parts quickly and the loud parts barely at all, which makes it the
     * room rather than the voice; speech is what stands well clear of it.
     */
    let floor = SPEECH_LEVEL;

    const watch = () => {
      if (!live.current || recorder.current !== held) return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const loudness = Math.sqrt(sum / samples.length);
      setLevel(loudness < VISIBLE_LEVEL ? 0 : Math.min(1, loudness * 6));

      const now = performance.now();
      floor = loudness < floor ? loudness : floor * 0.999 + loudness * 0.001;

      // Whatever is in force this frame: the workspace's, where it has decided
      // anything, and the constants above where it has not.
      const { pauseMs, overRoom, unattendedMs } = decided.current;

      /*
       * Clear of the room, or loud in its own right.
       *
       * Two ways to count, because either alone fails somewhere. A ratio alone
       * makes a silent room absurdly sensitive - every breath is three times
       * nothing. A fixed level alone is what was here before. Whichever is
       * easier to satisfy wins, so a quiet voice in a quiet room passes on the
       * ratio and a normal voice in a noisy one passes on the level.
       */
      if (loudness > Math.max(floor * overRoom, VISIBLE_LEVEL) || loudness > SPEECH_LEVEL) {
        spokeAt = now;
      }

      const quietLongEnough = spokeAt !== null && now - spokeAt > pauseMs;
      const goneOnTooLong = now - startedAt > unattendedMs;
      if (quietLongEnough || goneOnTooLong) {
        // Nothing said at all is caught below rather than here: the recorder is
        // stopped either way, and only what it produced decides what happens
        // next.
        held.stop();
        return;
      }
      frame.current = requestAnimationFrame(watch);
    };

    held.onstop = () => {
      const heard = new Blob(pieces, { type: held.mimeType });
      const anythingSaid = spokeAt !== null;
      release();
      if (!live.current) return;

      /*
       * Straight back on the microphone, before anything is made of what it
       * just heard.
       *
       * The transcript takes a moment and the answer takes longer, and every
       * one of those moments used to be a closed microphone. Listening again
       * first is what makes the next sentence somebody says land somewhere,
       * whether it is their turn or not.
       */
      void listen();

      // Nobody spoke: round again, without troubling the transcriber.
      if (!anythingSaid || heard.size === 0) return;

      transcribe(workspaceId, heard)
        .then((text) => {
          if (!live.current) return;
          const words = text.trim();
          if (words === '') return;
          setError(null);
          hand({ text: words, spoken: true });
        })
        .catch((cause: unknown) => {
          if (!live.current) return;
          setError(cause instanceof Error ? cause.message : t('That could not be transcribed.'));
        });
    };

    held.start();
    frame.current = requestAnimationFrame(watch);
  }, [hand, release, workspaceId]);

  useEffect(() => {
    live.current = true;
    void listen();
    return () => {
      live.current = false;
      // Nothing that arrives after this belongs to anybody — including a
      // microphone this mount asked for and is no longer here to receive.
      turn.current += 1;
      session.current += 1;
      queued.current = null;
      reading.current?.stop();
      reading.current = null;
      release();
    };
  }, [listen, release]);

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

  useImperativeHandle(ref, () => ({ interrupt, say }));

  function interrupt() {
    if (phase === 'speaking' || phase === 'thinking') {
      /*
       * The turn moves, so a clip already asked for and a chunk still arriving
       * belong to a turn nobody is listening to any more. The microphone is not
       * touched: it has been open the whole time, and restarting it here would
       * cut off the first words of whatever this press was made in order to
       * say.
       */
      turn.current += 1;
      reading.current?.stop();
      reading.current = null;
      queued.current = null;
      setWaiting(null);
      busy.current = false;
      setPhase('listening');
      return;
    }
    // Only a recorder that is actually running can be stopped; a second press
    // while the first one is still ending would otherwise throw.
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  function say(text: string) {
    const typed = text.trim();
    if (typed === '') return;
    hand({ text: typed, spoken: false });
  }

  const caption =
    phase === 'listening' ? 'Listening' : phase === 'thinking' ? 'Thinking' : 'Speaking';

  return (
    <aside className={styles.panel} aria-label={t('Voice mode')}>
      <header className={styles.head}>
        <h2 className={styles.title}>{t('Voice')}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('Leave voice mode')}>
          {t('Leave')}
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
          phase === 'listening' ? t('Finish speaking') : t('Stop this turn and listen')
        }
      >
        <span className={styles.ring} aria-hidden="true" />
        <span className={styles.core} aria-hidden="true" />
      </button>

      <p className={styles.caption} aria-live="polite">
        {caption}
      </p>

      {/*
        A reading of what the thing is doing now and what to do about it, which
        changes every few seconds - not a note about a field. It stays printed
        for the same reason the caption above it does.
      */}
      <p className={styles.hint}>
        {phase === 'listening'
          ? t('Speak — it answers when you stop.')
          : phase === 'speaking'
            ? t('Tap the circle to cut in.')
            : t('Working out what to say.')}
      </p>

      <div className={styles.said}>
        {/*
          What is waiting, above what has been sent, because it is the half
          somebody can still do something about.
        */}
        {waiting !== null && (
          <p className={styles.waiting} aria-live="polite">
            <span className={styles.saidLabel}>{t('Waiting')}</span>
            {waiting}
          </p>
        )}

        {said !== null && (
          <p className={styles.heard}>
            <span className={styles.saidLabel}>{said.spoken ? 'Heard' : 'Typed'}</span>
            {said.text}
          </p>
        )}
      </div>

      {error !== null && <p className={styles.error}>{error}</p>}
    </aside>
  );
}
