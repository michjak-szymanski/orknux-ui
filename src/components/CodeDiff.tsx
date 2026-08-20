import { useEffect, useRef } from 'react';

import { EDITOR_FONT_FAMILY, EDITOR_FONT_SIZE, editorTheme, monaco } from './monaco';
import styles from './CodeDiff.module.css';

export interface CodeDiffProps {
  /** What the code says now. */
  original: string;
  /** What it would say. */
  modified: string;
  language?: 'javascript' | 'typescript';
  ariaLabel?: string;
}

/**
 * A change drawn against the code it would change, in the editor's own terms.
 *
 * Monaco's diff view rather than the panel's line-by-line list: this sits where
 * the code editor sits, so it reads like the editor - same font, same theme,
 * same highlighting - with the removals struck through beside the additions.
 * Inline rather than side by side, because the code column shares its row with
 * a properties panel and two columns of code in half a page is two columns of
 * nothing readable.
 *
 * Read-only on both sides. What is being asked here is yes or no; editing the
 * proposal would make it nobody's - not what the assistant offered, not what
 * the person wrote - and the editor is one Reject away for anybody who wants
 * to write it themselves.
 */
export function CodeDiff({ original, modified, language = 'typescript', ariaLabel = 'Suggested change' }: CodeDiffProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (host.current === null) return;

    const shown = monaco.editor.createDiffEditor(host.current, {
      theme: editorTheme(),
      readOnly: true,
      renderSideBySide: false,
      automaticLayout: true,
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize: EDITOR_FONT_SIZE,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      renderOverviewRuler: false,
      // The arrows that revert a change belong to an editable diff; this one
      // is answered with the buttons above it.
      renderMarginRevertIcon: false,
    });

    /*
     * A diff is two editors, and only they can be named.
     *
     * `ariaLabel` in the options above reaches neither - nor do the diff's own
     * `originalAriaLabel` and `modifiedAriaLabel`, which land empty - so the
     * proposal read to a screen reader as two unnamed code boxes. Set on the
     * editors themselves it takes, and says which side is which, which is the
     * whole question being asked here.
     */
    shown.getOriginalEditor().updateOptions({ ariaLabel: `${ariaLabel}: the code as it is` });
    shown.getModifiedEditor().updateOptions({ ariaLabel: `${ariaLabel}: what is proposed` });

    const before = monaco.editor.createModel(original, language);
    const after = monaco.editor.createModel(modified, language);
    shown.setModel({ original: before, modified: after });

    return () => {
      shown.dispose();
      before.dispose();
      after.dispose();
    };
  }, [original, modified, language, ariaLabel]);

  return <div ref={host} className={styles.host} />;
}
