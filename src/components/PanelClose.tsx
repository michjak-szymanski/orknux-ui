import type { KeyboardEvent } from 'react';

import styles from './Dialog.module.css';

export interface PanelCloseProps {
  onClose: () => void;
}

/**
 * The × in the top-right corner of a dialog shown as a panel.
 *
 * A modal has three ways out - Escape, the backdrop, and the Cancel beside its
 * Save. A panel has none of the first two: it is opened with `show()` rather
 * than `showModal()`, because the graph beside it is the reason it is a panel at
 * all, and a non-modal dialog gets no backdrop and no Escape. That left the
 * Cancel at the foot of the form as the only way to put it away, which on a
 * trigger's settings means scrolling past the whole form to reach it.
 *
 * So this, and Escape handled by hand where the panel is drawn. The Cancel
 * stays: it sits beside Save and Delete and belongs to the form - "leave this
 * without saving" is a different sentence from "put this panel away", even
 * though today they do the same thing.
 *
 * Written once rather than five times because the wording is the part that has
 * to match: the same glyph, the same name, and the same corner as the node
 * panel on a run's page, which is where anybody who has used this product has
 * already met one.
 */
export function PanelClose({ onClose }: PanelCloseProps) {
  return (
    <button type="button" className={styles.panelClose} onClick={onClose} aria-label="Close" title="Close">
      ✕
    </button>
  );
}

/**
 * Escape, for a dialog that the browser will not send a `cancel` to.
 *
 * `showModal()` gets Escape for nothing; `show()` gets none of it, which is what
 * a panel is opened with. Anything carrying an × is expected to answer Escape,
 * so the panels handle it themselves - from the keydown on the dialog, which is
 * every key pressed inside the form, so it works wherever the cursor is in it.
 *
 * The press stops there rather than carrying on up: the canvas behind this panel
 * has keys of its own, and Escape on it clears the selection. Closing the panel
 * and dropping the node it was opened for are two answers to one press.
 *
 * A modal is handed back to the browser, which already does this and does it in
 * whatever way the platform expects.
 */
export function panelEscape(placement: 'modal' | 'panel', onClose: () => void) {
  return (event: KeyboardEvent<HTMLDialogElement>) => {
    if (placement !== 'panel' || event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  };
}
