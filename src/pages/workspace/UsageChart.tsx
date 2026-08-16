import { useId, useState } from 'react';

import { formatCompact, formatTokens } from '../../api/models';
import type { ModelUsageDay } from '../../api/models';
import styles from './UsageChart.module.css';

export interface UsageChartProps {
  series: ModelUsageDay[];
}

/** The drawing box. The SVG scales to its container; these are its own units. */
const WIDTH = 1000;
const HEIGHT = 150;
const GRID_LINES = 3;

/**
 * Tokens over time: one series, so it needs no legend — the heading above it
 * names what is plotted. The area is the same violet as everything else that
 * means "this product", carried at low opacity so the line stays the thing
 * being read and the gridlines stay behind it.
 */
export function UsageChart({ series }: UsageChartProps) {
  const gradientId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  if (series.length === 0) return null;

  const peak = Math.max(...series.map((day) => day.tokens), 1);
  // One point sits in the middle rather than at the left edge, where a single
  // day would otherwise be drawn as a line of no length.
  const x = (index: number) =>
    series.length === 1 ? WIDTH / 2 : (index / (series.length - 1)) * WIDTH;
  const y = (tokens: number) => HEIGHT - (tokens / peak) * HEIGHT;

  const points = series.map((day, index) => `${x(index)},${y(day.tokens)}`);
  const line = `M ${points.join(' L ')}`;
  const area = `${line} L ${x(series.length - 1)},${HEIGHT} L ${x(0)},${HEIGHT} Z`;

  const active = hovered === null ? null : series[hovered];

  return (
    <div className={styles.wrapper}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Tokens used per day, peaking at ${formatTokens(peak)}`}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-brand)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-accent-brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Recessive: the grid is for reading against, not for looking at. */}
        {Array.from({ length: GRID_LINES }, (_, index) => {
          const gridY = (HEIGHT / (GRID_LINES + 1)) * (index + 1);
          return (
            <line
              key={gridY}
              className={styles.grid}
              x1={0}
              y1={gridY}
              x2={WIDTH}
              y2={gridY}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        <path d={area} fill={`url(#${gradientId})`} />
        <path className={styles.line} d={line} vectorEffect="non-scaling-stroke" />
        {/* A line through one point has no length and draws nothing; a day is a dot. */}
        {series.length === 1 && <circle className={styles.point} cx={x(0)} cy={y(series[0].tokens)} r={4} />}

        {hovered !== null && (
          <line
            className={styles.crosshair}
            x1={x(hovered)}
            y1={0}
            x2={x(hovered)}
            y2={HEIGHT}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* A hit target per day, wider than the mark, so a hover is easy to land. */}
        {series.map((day, index) => (
          <rect
            key={day.day}
            x={index === 0 ? 0 : x(index) - WIDTH / series.length / 2}
            y={0}
            width={WIDTH / series.length}
            height={HEIGHT}
            fill="transparent"
            onMouseEnter={() => setHovered(index)}
          />
        ))}
      </svg>

      {active !== undefined && active !== null && (
        <div className={styles.tooltip}>
          <span className={styles.tooltipDay}>{active.day}</span>
          <span className={styles.tooltipValue}>{formatCompact(active.tokens)} tokens</span>
          <span className={styles.tooltipMeta}>
            {active.requests.toLocaleString('en-US')} requests
          </span>
        </div>
      )}
    </div>
  );
}
