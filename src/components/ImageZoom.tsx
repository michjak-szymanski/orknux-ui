import { useEffect, useRef } from 'react';

import styles from './ImageZoom.module.css';
import { t } from '../i18n';

export interface Picture {
  src: string;
  /** What the picture is, as the prose that carried it said — the caption. */
  alt: string;
}

export interface ImageZoomProps {
  /** The picture being looked at, or null when nothing is open. */
  picture: Picture | null;
  onClose: () => void;
}

/**
 * One picture, opened over the page it was drawn in.
 *
 * The manual is written in a column about seven hundred pixels wide and
 * illustrated with screenshots of a 1440-wide application, so every picture in
 * it arrives at roughly half size and the field names it was taken to show are
 * unreadable. Opening the file in a tab is the only thing that was left, and
 * that loses the sentence the picture belongs to.
 *
 * Not [AttachmentViewer], which is the same gesture over different material: an
 * attachment is a row with an id, a filename and a size, stepped through with
 * the arrow keys and offered as a download. A picture in the prose has none of
 * those — it has an address and a caption — and passing it through that
 * component would mean inventing a filename and a byte count to put in the bar.
 * What they do share is the reason for a native `<dialog>`: Escape closes it,
 * focus stays inside and returns where it was, and it draws in the top layer,
 * so nothing here has to have an opinion about z-index.
 */
export function ImageZoom({ picture, onClose }: ImageZoomProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (picture !== null && !dialog.open) dialog.showModal();
    else if (picture === null && dialog.open) dialog.close();
  }, [picture]);

  /*
   * Clicking away from the picture closes it. Tested against what was clicked
   * rather than against the dialog itself: the frame is stretched over the
   * whole element, so every click lands on a child and the dialog never sees
   * one — the same trap `AttachmentViewer` fell into.
   */
  function handleClick(event: React.MouseEvent<HTMLDialogElement>) {
    if ((event.target as HTMLElement).closest('img, button, header') === null) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.viewer}
      onCancel={onClose}
      onClose={onClose}
      onClick={handleClick}
      aria-label={picture?.alt === '' || picture === null ? 'Picture' : picture.alt}
    >
      {picture !== null && (
        <div className={styles.frame}>
          <header className={styles.bar}>
            <span className={styles.caption}>{picture.alt}</span>
            <button type="button" className={styles.close} onClick={onClose} aria-label={t('Close')} title={t('Close')}>
              ×
            </button>
          </header>

          <div className={styles.stage}>
            {/*
              `data-keeps-colour` because this is a screenshot, not an icon: the
              light theme darkens every `<img>` to keep the stroked icon files
              readable on white, and a photograph of the product put through
              that is a photograph of a different product.
            */}
            <img
              className={styles.picture}
              src={picture.src}
              alt={picture.alt}
              data-keeps-colour=""
            />
          </div>
        </div>
      )}
    </dialog>
  );
}
