import { useEffect, useRef } from 'react';

import styles from './VoiceMeter.module.css';

export interface VoiceMeterProps {
  /** The live microphone, while it is being recorded from. */
  stream: MediaStream;
}

/**
 * The bands, low to high, in hertz.
 *
 * Voice is not one number: a vowel sits low, a consonant lives up near 4 kHz,
 * and a meter that averages everything into a single bar moves the same amount
 * whether somebody is speaking or a door closed. Five registers is enough to see
 * speech as speech — the shape moves with the words — without turning the
 * composer into a spectrum analyser.
 */
const BANDS: Array<[number, number]> = [
  [60, 250],
  [250, 500],
  [500, 2000],
  [2000, 4000],
  [4000, 8000],
];

/** How fast a bar falls back: enough to see a syllable end, not enough to flicker. */
const DECAY = 0.82;

/**
 * What the microphone is hearing, while it hears it.
 *
 * There to answer one question — is this thing on? — which a static red dot
 * cannot: a muted microphone and a working one look identical until the
 * transcript comes back empty.
 *
 * Drawn by setting the height of five elements rather than into a canvas: five
 * writes a frame is nothing, and the bars then take their colour from the theme
 * like everything else.
 */
export function VoiceMeter({ stream }: VoiceMeterProps) {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    // Small window: this is being looked at, not measured, and a big one costs
    // resolution nobody can see at 40 pixels tall.
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;

    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);

    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const hertzPerBin = context.sampleRate / analyser.fftSize;
    const held = BANDS.map(() => 0);
    let frame = 0;

    function draw() {
      analyser.getByteFrequencyData(spectrum);

      BANDS.forEach(([low, high], index) => {
        const from = Math.floor(low / hertzPerBin);
        const to = Math.min(spectrum.length - 1, Math.ceil(high / hertzPerBin));

        let sum = 0;
        for (let bin = from; bin <= to; bin += 1) sum += spectrum[bin];
        const loudness = sum / Math.max(1, to - from + 1) / 255;

        // Rises with the sound and falls on its own, so a bar that jumps is a
        // sound that started rather than a frame that happened to catch one.
        held[index] = Math.max(loudness, held[index] * DECAY);

        const bar = bars.current[index];
        if (bar !== null && bar !== undefined) {
          // A floor, so silence is a row of dots rather than nothing at all:
          // the meter has to say "listening" as well as "hearing".
          bar.style.height = `${Math.round(15 + held[index] * 85)}%`;
        }
      });

      frame = requestAnimationFrame(draw);
    }

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [stream]);

  return (
    <span className={styles.meter} aria-hidden="true">
      {BANDS.map((band, index) => (
        <span
          key={band[0]}
          ref={(element) => {
            bars.current[index] = element;
          }}
          className={styles.bar}
        />
      ))}
    </span>
  );
}
