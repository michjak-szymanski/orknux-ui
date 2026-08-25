import styles from './Attribution.module.css';
import { t } from '../i18n';

/**
 * Who wrote this, under what licence, and where the source is.
 *
 * Here because the licence says so, and because a licence term about visible
 * attribution only means anything if the program is visibly attributed. The
 * clauses that carry an attribution forward — AGPL section 5(d) for interactive
 * interfaces, and the section 7(b) term in NOTICE — oblige a derivative to
 * display what the original displays. A product that shows nothing obliges
 * nobody to show anything, so this is not decoration: it is the thing the term
 * attaches to.
 *
 * The link to the source is also the offer section 13 requires of anyone running
 * a modified version for other people over a network. Kept as one component so
 * there is one wording, in one place, rather than a version of it per screen
 * that can drift apart.
 */
export interface AttributionProps {
  /** Quieter, for the shell where it sits under the sidebar all day. */
  compact?: boolean;
}

/** Where the source is offered, which is what section 13 asks for. */
const SOURCE = 'https://github.com/michjak-szymanski/orknux-server';

const LICENCE = 'https://www.gnu.org/licenses/agpl-3.0.html';

export function Attribution({ compact = false }: AttributionProps) {
  return (
    <p className={compact ? `${styles.attribution} ${styles.compact}` : styles.attribution}>
      <span className={styles.name}>Orknux</span>
      {/*
        The version, beside the name rather than as another item in the list:
        it says which Orknux this is, so it belongs to the name and not to the
        licence or the source beside it.

        `__APP_VERSION__` is `package.json`'s version, stamped in at build time
        by `vite.config.ts` - so what a running installation shows is what was
        built, and there is no second place to remember to update. It is the
        first thing anybody is asked for in a bug report and, until now, the
        one thing this footer did not say.
      */}
      <span className={styles.version}>{__APP_VERSION__}</span>
      <span className={styles.separator}>·</span>
      {/* The copyright holder, named rather than implied by the product name. */}
      <span>© 2026 Michał Szymański</span>
      <span className={styles.separator}>·</span>
      <a className={styles.link} href={LICENCE} target="_blank" rel="noreferrer noopener">
        {'AGPL-3.0'}
      </a>
      <span className={styles.separator}>·</span>
      <a className={styles.link} href={SOURCE} target="_blank" rel="noreferrer noopener">
        {t('Source')}
      </a>
    </p>
  );
}
