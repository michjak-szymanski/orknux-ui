import { useEffect, useRef } from 'react';

import { attachmentUrl, formatSize } from '../api/attachments';
import type { Attachment } from '../api/attachments';
import arrowLeftIcon from '../assets/arrow-left.svg';
import downloadIcon from '../assets/download.svg';
import styles from './AttachmentViewer.module.css';

export interface AttachmentViewerProps {
  /**
   * The pictures that can be stepped through, in the order they are shown.
   *
   * Only what the server will serve inline belongs here. Anything else is a
   * download, and a viewer that opened one would have nothing to put in it.
   */
  images: Attachment[];
  /** Which one is open, or null when the viewer is closed. */
  openId: string | null;
  onClose: () => void;
  /** Asks for a different one — the arrows, and the arrow keys. */
  onOpen: (id: string) => void;
}

/**
 * A picture, opened over the chat instead of in a tab.
 *
 * A tab is the wrong place for this: it loses the conversation the picture was
 * part of, and getting back means finding the window again. Somebody checking
 * what they just attached wants to look and carry on typing.
 *
 * A native `<dialog>` rather than a div over the page, for what the element
 * already does correctly — Escape closes it, focus stays inside while it is
 * open and returns where it was on close, and it draws in the top layer, so no
 * z-index here can be wrong about the sidebar.
 */
export function AttachmentViewer({ images, openId, onClose, onOpen }: AttachmentViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const at = images.findIndex((image) => image.id === openId);
  const showing = at === -1 ? null : images[at];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (showing !== null && !dialog.open) dialog.showModal();
    else if (showing === null && dialog.open) dialog.close();
  }, [showing]);

  /*
   * The pictures either side, fetched before anybody asks for them.
   *
   * Stepping replaces the element rather than its `src`, so without this there
   * is a blank frame while the next one is fetched and decoded — nothing on a
   * local server, a visible flash over a real network. Only the neighbours: a
   * chat with forty screenshots should not fetch forty because one was opened.
   */
  useEffect(() => {
    if (at === -1 || images.length < 2) return;

    [-1, 1].forEach((by) => {
      const neighbour = images[(at + by + images.length) % images.length];
      new Image().src = attachmentUrl(neighbour.id);
    });
  }, [at, images]);

  /** Wraps, so the arrows never dead-end on the first or last picture. */
  function step(by: number) {
    if (at === -1 || images.length < 2) return;
    onOpen(images[(at + by + images.length) % images.length].id);
  }

  /**
   * Clicking away from the picture closes it.
   *
   * Not a test for the dialog element itself, which is what this was and why it
   * did nothing: the frame is stretched over the whole dialog, so every click
   * lands on a child and the element never sees one. What "outside" means is
   * therefore the other way round — anything that is not the picture, a control,
   * or the bar they sit in.
   */
  function handleClick(event: React.MouseEvent<HTMLDialogElement>) {
    if ((event.target as HTMLElement).closest('img, button, a, header') === null) onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.viewer}
      onCancel={onClose}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      aria-label={showing?.filename ?? 'Attachment'}
    >
      {showing !== null && (
        <div className={styles.frame}>
          <header className={styles.bar}>
            <span className={styles.name} title={showing.filename}>
              {showing.filename}
            </span>
            <span className={styles.size}>{formatSize(showing.sizeBytes)}</span>
            {images.length > 1 && (
              <span className={styles.counter}>
                {at + 1} of {images.length}
              </span>
            )}

            <a
              className={styles.barButton}
              href={attachmentUrl(showing.id)}
              download={showing.filename}
              title={`Download ${showing.filename}`}
            >
              <span
                className={styles.icon}
                style={{ maskImage: `url("${downloadIcon}")`, WebkitMaskImage: `url("${downloadIcon}")` }}
                aria-hidden="true"
              />
              <span className={styles.barButtonLabel}>Download</span>
            </a>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close" title="Close">
              ×
            </button>
          </header>

          <div className={styles.stage}>
            {images.length > 1 && (
              <button
                type="button"
                className={`${styles.step} ${styles.stepBack}`}
                onClick={() => step(-1)}
                aria-label="Previous"
                title="Previous"
              >
                <span
                  className={styles.icon}
                  style={{ maskImage: `url("${arrowLeftIcon}")`, WebkitMaskImage: `url("${arrowLeftIcon}")` }}
                  aria-hidden="true"
                />
              </button>
            )}

            {/*
              Keyed by id so switching pictures replaces the element rather than
              swapping its src: without it the browser keeps the old image on
              screen until the new one decodes, and the wrong picture is showing
              under the new one's name.
            */}
            <img
              key={showing.id}
              className={styles.picture}
              src={attachmentUrl(showing.id)}
              alt={showing.filename}
            />

            {images.length > 1 && (
              <button
                type="button"
                className={`${styles.step} ${styles.stepOn}`}
                onClick={() => step(1)}
                aria-label="Next"
                title="Next"
              >
                <span
                  className={styles.icon}
                  style={{ maskImage: `url("${arrowLeftIcon}")`, WebkitMaskImage: `url("${arrowLeftIcon}")` }}
                  aria-hidden="true"
                />
              </button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
