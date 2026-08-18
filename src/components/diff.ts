/**
 * The difference between two versions of a file, line by line.
 *
 * Written here rather than taken from a library: what this needs is a few
 * hundred lines compared once, when somebody is offered a change, and the
 * shortest edit script is a first-year algorithm. A dependency for it would be
 * more code to audit than the code it saves, in a bundle that a browser
 * downloads.
 */
export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/** How big a comparison is worth doing exactly; beyond it, say so instead. */
const MOST_LINES = 800;

/**
 * The lines of `after`, marked against `before`.
 *
 * A longest common subsequence, walked back to produce the removals and
 * additions in the order somebody reads them. Equal lines are kept so the
 * change can be read in its surroundings — a diff of only the changed lines is
 * a list of edits, not a description of the result.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.split('\n');
  const right = after.split('\n');

  // Too big to compare cell by cell: honest rather than slow.
  if (left.length > MOST_LINES || right.length > MOST_LINES) {
    return [
      ...left.map((text): DiffLine => ({ kind: 'removed', text })),
      ...right.map((text): DiffLine => ({ kind: 'added', text })),
    ];
  }

  // How long a common subsequence starts at each pair of positions.
  const common: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let l = left.length - 1; l >= 0; l -= 1) {
    for (let r = right.length - 1; r >= 0; r -= 1) {
      common[l][r] =
        left[l] === right[r] ? common[l + 1][r + 1] + 1 : Math.max(common[l + 1][r], common[l][r + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let l = 0;
  let r = 0;
  while (l < left.length && r < right.length) {
    if (left[l] === right[r]) {
      lines.push({ kind: 'same', text: left[l] });
      l += 1;
      r += 1;
    } else if (common[l + 1][r] >= common[l][r + 1]) {
      lines.push({ kind: 'removed', text: left[l] });
      l += 1;
    } else {
      lines.push({ kind: 'added', text: right[r] });
      r += 1;
    }
  }
  while (l < left.length) {
    lines.push({ kind: 'removed', text: left[l] });
    l += 1;
  }
  while (r < right.length) {
    lines.push({ kind: 'added', text: right[r] });
    r += 1;
  }

  return lines;
}

/** What changed, in words, for the line above a diff. */
export function diffSummary(lines: DiffLine[]): string {
  const added = lines.filter((line) => line.kind === 'added').length;
  const removed = lines.filter((line) => line.kind === 'removed').length;
  if (added === 0 && removed === 0) return 'No change';
  const parts = [];
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  return parts.join(', ');
}
