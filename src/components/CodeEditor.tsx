import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';

import { EDITOR_FONT_FAMILY, EDITOR_FONT_SIZE, editorTheme, monaco, overflowWidgetsNode } from './monaco';
import styles from './CodeEditor.module.css';

/** What the screen around an editor can ask it to do. */
export interface CodeEditorHandle {
  /**
   * Lays the code out again.
   *
   * The editor's own formatter, which is the language service — the same one that
   * completes and checks — so what it does to the code agrees with everything else
   * the editor says about it. Applied as an edit rather than by replacing the text,
   * which is what makes it undoable with the usual key and keeps the caret where the
   * code it was next to ended up.
   */
  format: () => void;
  /**
   * Measures the box again and redraws to fit it.
   *
   * Monaco does not lay itself out from the DOM: it caches the width and height
   * it was last given and positions every glyph, the caret and the click-to-
   * offset arithmetic against them. Change the box under it and it goes on
   * drawing at the old measure - so the text is clipped or floating, and a click
   * lands the caret several characters from where the pointer was.
   *
   * `automaticLayout` covers the sizes a page arrives at, but it observes on its
   * own schedule and a drag changes the width every frame. Whatever moves the
   * split says so here, and the editor is right on the frame it happens.
   */
  layout: () => void;
}

export interface CodeEditorProps {
  /** React 19 passes a ref as an ordinary prop; there is nothing to forward. */
  ref?: Ref<CodeEditorHandle>;
  value: string;
  onChange: (value: string) => void;
  /** Line and column, 1-based, for whatever shows the caret position. */
  onCaretChange?: (line: number, column: number) => void;
  language?: 'javascript' | 'typescript';
  readOnly?: boolean;
  ariaLabel?: string;
}

/**
 * A real code editor.
 *
 * This replaced a textarea with a syntax-highlighted copy of the code behind it,
 * which worked until it had to do anything an editor does: Tab moved focus out of
 * the box, there was no completion to offer, and every metric of the two layers had
 * to be kept in step by hand.
 *
 * Monaco is created imperatively and told about changes afterwards, rather than
 * re-rendered. An editor holds things React does not know about — the caret, the
 * selection, the undo history, the fold state — and throwing those away on every
 * keystroke is what makes a controlled editor feel wrong.
 */
export function CodeEditor({
  ref,
  value,
  onChange,
  onCaretChange,
  language = 'javascript',
  readOnly = false,
  ariaLabel = 'Code',
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  /*
   * The latest callbacks, without them being dependencies of the editor's own
   * lifecycle: a new function identity each render must not tear down the editor.
   */
  const changed = useRef(onChange);
  const moved = useRef(onCaretChange);
  changed.current = onChange;
  moved.current = onCaretChange;

  useEffect(() => {
    if (host.current === null) return;

    const created = monaco.editor.create(host.current, {
      value,
      language,
      theme: editorTheme(),
      readOnly,
      ariaLabel,
      automaticLayout: true,
      // From the same constants the font measurement uses: measuring one font and
      // drawing another is what put the caret several characters out.
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize: EDITOR_FONT_SIZE,
      lineHeight: 20,
      tabSize: 2,
      insertSpaces: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      /*
       * Wrapped, not scrolled sideways. The editor shares its row with a properties
       * panel, so on a 1150px window it gets about 425px — narrow enough that a line
       * of ordinary JavaScript runs off the end, and the last columns of it can only
       * be reached by finding a scrollbar. Wrapping keeps every character on screen.
       */
      wordWrap: 'on',
      wrappingIndent: 'indent',
      padding: { top: 12, bottom: 12 },
      smoothScrolling: true,
      /*
       * The pair matters. Fixed positioning keeps the suggestion list from being
       * clipped by the `overflow: hidden` this editor sits inside; the host node
       * keeps that fixed positioning honest, by living outside the transformed
       * element that would otherwise become its frame of reference.
       */
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: overflowWidgetsNode(),
    });

    editor.current = created;

    const onDidChange = created.onDidChangeModelContent(() => {
      changed.current(created.getValue());
    });
    const onDidMove = created.onDidChangeCursorPosition((event) => {
      moved.current?.(event.position.lineNumber, event.position.column);
    });

    return () => {
      onDidChange.dispose();
      onDidMove.dispose();
      created.getModel()?.dispose();
      created.dispose();
      editor.current = null;
    };
    // Created once. Everything that changes afterwards is pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      format: () => {
        // Nothing to lay out before there is an editor, and nothing to do to
        // output: a read-only model refuses the edit anyway.
        void editor.current?.getAction('editor.action.formatDocument')?.run();
      },
      // No argument: measuring the host is the whole point, and passing a size
      // would pin the editor to whatever the caller believed the box to be.
      layout: () => editor.current?.layout(),
    }),
    [],
  );

  /*
   * Only when it genuinely differs — a load, or a revert. Writing the value back
   * on every keystroke would move the caret to the end of the document mid-word.
   */
  useEffect(() => {
    const created = editor.current;
    if (created === null) return;
    if (created.getValue() !== value) created.setValue(value);
  }, [value]);

  useEffect(() => {
    editor.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (model != null) monaco.editor.setModelLanguage(model, language);
  }, [language]);

  return <div className={styles.host} ref={host} />;
}
