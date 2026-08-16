import { useEffect, useId, useState } from 'react';

import styles from './Loader.module.css';

/**
 * How long a wait has to last before it is worth saying anything about.
 *
 * Most of these loads finish in well under a second, and a spinner that appears
 * and vanishes reads as a flicker — it makes a fast screen feel unsettled. So
 * nothing is drawn until the wait is long enough to be a wait.
 */
const QUIET_MS = 5000;

export interface LoaderProps {
  /** Shown beside the mark, and what a screen reader announces. */
  label?: string;
  /**
   * Edge of the mark in pixels. The graph inside the kernel void stops being
   * legible below about 24, which is why that is the floor rather than 16.
   */
  size?: number;
  /** Milliseconds to stay silent before appearing. 0 shows it at once. */
  delay?: number;
}

/**
 * The Orknux mark, waiting: a dash chases the triad's perimeter while the whole
 * graph turns slowly inside the kernel void.
 *
 * It is a status, not a decoration, so it announces itself politely rather than
 * interrupting — a page that swaps a loader for a table has not raised an alert.
 * Under `prefers-reduced-motion` the animation stops and the mark stays whole.
 */
export function Loader({ label = 'Loading…', size = 28, delay = QUIET_MS }: LoaderProps) {
  // Two loaders can be on screen at once, and duplicate ids would make the
  // second one reference the first one's gradient.
  const id = useId();
  const moss = `${id}-moss`;
  const cutout = `${id}-void`;

  const [waited, setWaited] = useState(delay <= 0);

  useEffect(() => {
    if (delay <= 0) return;
    const timer = window.setTimeout(() => setWaited(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);

  // Nothing at all rather than a placeholder: reserving space for something
  // that usually never appears leaves a hole in the page.
  if (!waited) return null;

  return (
    <span className={styles.loader} role="status">
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={moss} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#668A6B" />
            <stop offset="100%" stopColor="#4A6B52" />
          </linearGradient>
          {/* A knockout rather than a disc in the background colour, so the
              mark sits on either theme. */}
          <mask id={cutout}>
            <rect width="200" height="200" fill="#fff" />
            <circle cx="100" cy="109" r="47" fill="#000" />
          </mask>
        </defs>

        <path
          d="M42 29 L67 50 L133 50 L158 29 L154 64 L181 113 L151 167 L49 167 L19 113 L46 64 Z"
          fill={`url(#${moss})`}
          mask={`url(#${cutout})`}
        />

        <g className={styles.spinner}>
          {/* Centres the triad's centroid (104.667, 116.667) on the kernel. */}
          <g transform="translate(-4.667 -7.667)">
            <path className={styles.edge} d="M81 125 L112 129 L121 96 Z" />
            <circle className={styles.node} cx="81" cy="125" r="11" />
            <circle className={`${styles.node} ${styles.node2}`} cx="112" cy="129" r="11" />
            <circle className={`${styles.node} ${styles.node3}`} cx="121" cy="96" r="11" />
          </g>
        </g>
      </svg>
      {label}
    </span>
  );
}
