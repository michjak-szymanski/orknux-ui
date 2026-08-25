import { useEffect, useMemo, useRef, useState } from 'react';

import searchIcon from '../assets/search.svg';
import styles from './IconPicker.module.css';
import { t } from '../i18n';

/**
 * Every icon the interface ships, by name.
 *
 * A node stores the name, not a file or a URL: a graph is read at a glance, and
 * a node that draws whatever was pasted is a node that can draw nothing, or
 * something enormous. Collected from the assets directory so adding an icon to
 * the app adds it here too.
 */
export const NODE_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../assets/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  ).map(([path, url]) => [path.replace(/^.*\/(.+)\.svg$/, '$1'), url]),
);

/**
 * Icons that are part of the furniture rather than something to label a node
 * with. A chevron says nothing about what a node does, and offering one only
 * makes the useful ones harder to find.
 *
 * **Every alternative ends at a word boundary**, and that is the whole point of
 * how this is written. It used to be a bare prefix match, which hid anything
 * merely *starting* with one of these words - so `plus-circle`, `search-code`,
 * `save-all`, `sunrise`, `sunset`, `moon-star` and `pen-tool` would have
 * vanished the day somebody added them, with nothing to say they had. An icon
 * that silently fails to appear is worse than one nobody chose, because the
 * next person adds it again.
 *
 * Two shapes, deliberately. A **family** takes everything below it: there is no
 * chevron and no arrow worth labelling a node with, however it is qualified.
 * A **one-off** matches only itself: `save` is furniture, `save-all` may not
 * be, and the difference is not something a prefix can know.
 */
const CHROME_FAMILIES = /^(?:chevron|panel|arrow|toggle|trash)(?:$|-)/;

/**
 * Furniture that is exactly these names and nothing below them.
 *
 * `play`, `save`, `search`, `plus` and `copy` are deliberately **absent**: each
 * is a reasonable thing to call a node - a run, a persist, a lookup, an add, a
 * duplicate - and hiding them cost more than the tidiness gained. They were
 * hidden by the old prefix rule rather than by anybody deciding they should be.
 */
const CHROME_EXACT = new Set([
  'x-circle',
  'check-circle',
  'log-out',
  'door-open',
  'sun',
  'moon',
  'pen',
  'pencil',
  'settings-14',
  'orknux-mark',
  'undo',
  'redo',
]);

const isChrome = (name: string): boolean => CHROME_FAMILIES.test(name) || CHROME_EXACT.has(name);

const BROWSABLE = Object.keys(NODE_ICONS)
  .filter((name) => !isChrome(name))
  .sort();

export interface IconPickerProps {
  open: boolean;
  /** The name currently chosen, so it can be shown as such. */
  selected: string | null;
  onPick: (name: string) => void;
  onClose: () => void;
}

/** One icon, drawn from a mask so it takes the colour around it. */
export function Icon({ name, className }: { name: string; className: string }) {
  const url = NODE_ICONS[name];
  if (url === undefined) return null;

  return (
    <span
      className={className}
      style={{ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }}
      aria-hidden="true"
    />
  );
}

/**
 * Browse the icons and pick one.
 *
 * A window rather than a grid in the panel: there are dozens, the panel is
 * narrow, and choosing an icon is something done once per node — it should not
 * take up room permanently for that.
 */
export function IconPickerDialog({ open, selected, onPick, onClose }: IconPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      setSearch('');
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const matching = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle === '' ? BROWSABLE : BROWSABLE.filter((name) => name.includes(needle));
  }, [search]);

  return (
    /*
      The close is kept to this dialog.

      React carries a dialog's close and cancel up its own tree, and this one is
      usually opened from inside another dialog — a trigger being created, an
      action being written. Left to travel, picking an icon closed the form
      behind it as well.
    */
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={(event) => {
        event.stopPropagation();
        onClose();
      }}
      onCancel={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <header className={styles.head}>
        <h2 className={styles.title}>{t('Choose an icon')}</h2>
        <div className={styles.searchBox}>
          <Icon name="search" className={styles.searchGlyph} />
          <input
            className={styles.search}
            value={search}
            placeholder={t('Search icons')}
            spellCheck={false}
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
          />
          {/* The asset is imported so the bundler keeps it; the mask uses it. */}
          <link rel="prefetch" href={searchIcon} />
        </div>
      </header>

      {matching.length === 0 ? (
        <p className={styles.empty}>No icon matches “{search.trim()}”.</p>
      ) : (
        <div className={styles.grid}>
          {matching.map((name) => (
            <button
              key={name}
              type="button"
              className={selected === name ? `${styles.choice} ${styles.chosen}` : styles.choice}
              aria-pressed={selected === name}
              onClick={() => {
                onPick(name);
                onClose();
              }}
            >
              <Icon name={name} className={styles.glyph} />
              <span className={styles.name}>{name}</span>
            </button>
          ))}
        </div>
      )}

      <footer className={styles.actions}>
        <button type="button" className={styles.ghost} onClick={onClose}>{t('Cancel')}</button>
      </footer>
    </dialog>
  );
}
