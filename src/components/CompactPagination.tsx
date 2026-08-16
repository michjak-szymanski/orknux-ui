import styles from './CompactPagination.module.css';

export interface CompactPaginationProps {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  totalItems: number;
  /** Plural noun for the summary, e.g. "templates". */
  unit: string;
  onPageChange: (page: number) => void;
}

/** The lighter pagination used inside the workflows table. */
export function CompactPagination({ page, pageSize, totalItems, unit, onPageChange }: CompactPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const firstItem = totalItems === 0 ? 0 : (current - 1) * pageSize + 1;
  const lastItem = Math.min(current * pageSize, totalItems);

  return (
    <div className={styles.pagination}>
      <p className={styles.summary}>
        Showing {firstItem}-{lastItem} of {totalItems} {unit}
      </p>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.step}
          onClick={() => onPageChange(current - 1)}
          disabled={current === 1}
        >
          Previous
        </button>
        <span className={styles.current} aria-current="page">
          {current}
        </span>
        <button
          type="button"
          className={styles.step}
          onClick={() => onPageChange(current + 1)}
          disabled={current === totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}
