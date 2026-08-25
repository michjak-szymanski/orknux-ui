import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './CompactPagination.module.css';
import { t, tf } from '../i18n';

export interface CompactPaginationProps {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  totalItems: number;
  /** Plural noun for the summary, e.g. "templates". */
  unit: string;
  onPageChange: (page: number) => void;
  /**
   * The sizes on offer, and what to do when one is chosen.
   *
   * Beside the count rather than up with the filters, because "showing 11-20
   * of 35" is the sentence this changes - somebody reading that line is
   * already asking how many they see at once. Left out where a list has a
   * fixed size, which is most of them.
   */
  pageSizes?: number[];
  onPageSizeChange?: (size: number) => void;
}

/** The lighter pagination used inside the workflows table. */
export function CompactPagination({
  page,
  pageSize,
  totalItems,
  unit,
  onPageChange,
  pageSizes,
  onPageSizeChange,
}: CompactPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const firstItem = totalItems === 0 ? 0 : (current - 1) * pageSize + 1;
  const lastItem = Math.min(current * pageSize, totalItems);

  return (
    <div className={styles.pagination}>
      <p className={styles.summary}>
        {tf('Showing {first}-{last} of {total} {unit}', {
          first: firstItem,
          last: lastItem,
          total: totalItems,
          unit,
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
                  aria-label={`How many ${unit} to show at once`}
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

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.step}
          onClick={() => onPageChange(current - 1)}
          disabled={current === 1}
        >{t('Previous')}</button>
        <span className={styles.current} aria-current="page">
          {current}
        </span>
        <button
          type="button"
          className={styles.step}
          onClick={() => onPageChange(current + 1)}
          disabled={current === totalPages}
        >{t('Next')}</button>
      </div>
    </div>
  );
}
