import styles from './Pagination.module.css';

export interface PaginationProps {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  /** Announced to screen readers, e.g. "workspaces". */
  label: string;
}

export function Pagination({ page, pageSize, totalItems, onPageChange, label }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const firstItem = totalItems === 0 ? 0 : (current - 1) * pageSize + 1;
  const lastItem = Math.min(current * pageSize, totalItems);

  return (
    <div className={styles.pagination}>
      <p className={styles.summary}>
        Showing {firstItem}-{lastItem} of {totalItems}
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => onPageChange(current - 1)}
          disabled={current === 1}
        >
          Previous
        </button>

        <div className={styles.pageNumbers}>
          {pageWindow(current, totalPages).map((entry, index) =>
            entry === ELLIPSIS ? (
              <span key={`gap-${index}`} className={styles.ellipsis} aria-hidden="true">
                ...
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                className={entry === current ? `${styles.pageButton} ${styles.pageButtonActive}` : styles.pageButton}
                onClick={() => onPageChange(entry)}
                aria-label={`Page ${entry} of ${label}`}
                aria-current={entry === current ? 'page' : undefined}
              >
                {entry}
              </button>
            ),
          )}
        </div>

        <button
          type="button"
          className={styles.pageButton}
          onClick={() => onPageChange(current + 1)}
          disabled={current === totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

const ELLIPSIS = 'ellipsis';

/** First page, last page and the current page's neighbours, with gaps collapsed. */
function pageWindow(current: number, totalPages: number): Array<number | typeof ELLIPSIS> {
  if (totalPages <= 7) {
    return range(1, totalPages);
  }

  const shown = new Set([1, totalPages, current - 1, current, current + 1]);
  const pages = [...shown].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);

  return pages.flatMap((page, index) =>
    index > 0 && page - pages[index - 1] > 1 ? [ELLIPSIS, page] : [page],
  );
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
