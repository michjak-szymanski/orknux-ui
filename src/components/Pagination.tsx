import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './Pagination.module.css';
import { t, tf } from '../i18n';

export interface PaginationProps {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  /** Announced to screen readers, e.g. "workspaces". */
  label: string;
  /**
   * The sizes on offer, and what to do when one is chosen.
   *
   * Beside the count, the same place CompactPagination keeps it: "showing 1-4
   * of 9" is the sentence this changes, and somebody reading that line is
   * already asking how many they see at once.
   */
  pageSizes?: number[];
  onPageSizeChange?: (size: number) => void;
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  label,
  pageSizes,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const firstItem = totalItems === 0 ? 0 : (current - 1) * pageSize + 1;
  const lastItem = Math.min(current * pageSize, totalItems);

  return (
    <div className={styles.pagination}>
      <p className={styles.summary}>
        {tf('Showing {first}-{last} of {total}', {
          first: firstItem,
          last: lastItem,
          total: totalItems,
        })}
        {pageSizes !== undefined && onPageSizeChange !== undefined && (
          <>
            {' · '}
            <label className={styles.perPage}>
              {t('Show')}
              <span className={styles.selectWrapper}>
                <select
                  className={styles.perPageSelect}
                  value={pageSize}
                  aria-label={`How many ${label} to show at once`}
                  onChange={(event) => onPageSizeChange(Number(event.target.value))}
                >
                  {pageSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </span>
            </label>
          </>
        )}
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => onPageChange(current - 1)}
          disabled={current === 1}
        >{t('Previous')}</button>

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
        >{t('Next')}</button>
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
