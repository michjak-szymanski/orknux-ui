import { Link } from 'react-router-dom';

import arrowLeftIcon from '../assets/arrow-left.svg';
import styles from './BackLink.module.css';

export interface BackLinkProps {
  /** Where the page came from: the list it belongs to. */
  to: string;
  /** What that place is called, for the label a screen reader reads. */
  label: string;
}

/**
 * The way back from a page that was opened from a list.
 *
 * A breadcrumb says where you are; this is the thing to click to leave, and
 * every detail page should have one in the same place.
 */
export function BackLink({ to, label }: BackLinkProps) {
  return (
    <Link className={styles.back} to={to} aria-label={`Back to ${label}`} title={`Back to ${label}`}>
      <img src={arrowLeftIcon} alt="" width={16} height={16} />
    </Link>
  );
}
