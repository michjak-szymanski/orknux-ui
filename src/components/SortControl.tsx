import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './SortControl.module.css';
import { t } from '../i18n';

export interface SortChoice<Order extends string> {
  /** What somebody reading the list would call this order. */
  label: string;
  /** What the server is asked for. */
  order: Order;
}

export interface SortControlProps<Order extends string> {
  /**
   * The select's id, so the word "Sort" points at it.
   *
   * Given rather than made up, because two lists on two routes are still one
   * document to anything that looks for `#issue-order`, and a generated id
   * would be a different one on every render.
   */
  id: string;
  /**
   * What this list can be ordered by, in this list's words.
   *
   * The options belong to the caller: the issue list orders by number and last
   * comment, the workflow list by name and last run, and a control that knew
   * either of those would have to know both. `Order` is the caller's own union,
   * so what comes back out of `onOrderChange` is the type that went in.
   */
  options: readonly SortChoice<Order>[];
  order: Order;
  onOrderChange: (order: Order) => void;
  /**
   * Which way round it is now - not which way round it starts.
   *
   * The default is the caller's, and the two callers disagree on purpose: a
   * column of names is read A to Z and a column of issue numbers newest first.
   * This draws the state it is handed and says what the press would make it.
   */
  ascending: boolean;
  onDirectionChange: (ascending: boolean) => void;
}

/**
 * The order a list is in, and which way round.
 *
 * Written twice before this existed - the workflow list copied the issue
 * list's markup and about sixty lines of its CSS - and the copy came with a
 * note saying that a third would be the moment to make it a component. This is
 * that component, made one call site early, because the two copies had already
 * begun to drift in their comments if not yet in their markup.
 *
 * It holds nothing. The order and the direction are state somewhere else -
 * both current callers keep them in the address, so a sorted list is a link -
 * and this only draws them and says when they were pressed.
 */
export function SortControl<Order extends string>({
  id,
  options,
  order,
  onOrderChange,
  ascending,
  onDirectionChange,
}: SortControlProps<Order>) {
  return (
    <div className={styles.sortRow}>
      <label className={styles.sortLabel} htmlFor={id}>{t('Sort')}</label>
      <span className={styles.selectWrapper}>
        <select
          id={id}
          className={styles.sortSelect}
          value={order}
          onChange={(event) => onOrderChange(event.target.value as Order)}
        >
          {options.map((one) => (
            <option key={one.order} value={one.order}>
              {one.label}
            </option>
          ))}
        </select>
        <img src={chevronDown12Icon} alt="" width={12} height={12} />
      </span>
      {/*
        One button rather than two options, because a direction has two states
        and a control with two states is a switch. The arrow says which way it
        is now, not which way pressing it would go.
      */}
      <button
        type="button"
        className={styles.sortDirection}
        onClick={() => onDirectionChange(!ascending)}
        title={ascending ? t('Ascending - press for descending') : t('Descending - press for ascending')}
        aria-label={ascending ? t('Sorted ascending') : t('Sorted descending')}
      >
        {ascending ? '↑' : '↓'}
      </button>
    </div>
  );
}
