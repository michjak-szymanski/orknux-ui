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

/**
 * How many of its own values the editor will remember having said.
 *
 * One is not enough: renders lag typing, and the prop that arrives is whichever
 * value the editor said when that render was started, not the latest one. Two or
 * three deep is what fast typing actually produces. This is far past that, and it
 * is a bound rather than a size - the queue below is drained by the props coming
 * back, and only a caller that never returns what it is given could grow it.
 */
const ECHOES_KEPT = 64;

export interface CodeEditorProps {
  /** React 19 passes a ref as an ordinary prop; there is nothing to forward. */
  ref?: Ref<CodeEditorHandle>;
  /**
   * The code.
   *
   * A seed, and afterwards a way to *replace* what is in the editor - not a
   * mirror of it. See the note on the effect that writes it in: a value that is
   * simply this editor's own text coming back around is recognised and ignored,
   * and anything else replaces the document. Which means the caller must hand
   * back exactly what `onChange` gave it. A caller that stores something else -
   * trimmed, reformatted, normalised on its way through - is telling this editor
   * its text was replaced from outside, on every keystroke, and will get the
   * caret sent home for its trouble.
   */
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

  /**
   * What this editor has said, and has not yet heard back.
   *
   * Every keystroke sends a string out through `onChange` and, some renders
   * later, the same string comes back as `value`. In between there may be one,
   * two or three more keystrokes - so the `value` that arrives is routinely not
   * the model's text, and is not meant to be. This is the list of the strings
   * that are still in the air; a `value` found in it is this editor's own echo
   * and means nothing, and a `value` that is not in it came from somewhere else
   * and is a real replacement.
   */
  const echoes = useRef<string[]>([]);

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

    /*
     * Every change, whoever made it — a keystroke, a paste, or the effect below
     * writing a value in. All of them are remembered and all of them are
     * announced, which is what it was doing before and what the pages around it
     * are written against: a rewritten declaration is a change to the code, and
     * a Validate result that outlived it would describe a version that no longer
     * exists. What the model normalises on its way in — line endings, most of
     * all — is carried back out by the same route, so the value on screen and
     * the value the caller is holding cannot drift apart.
     */
    const onDidChange = created.onDidChangeModelContent(() => {
      const said = created.getValue();
      echoes.current.push(said);
      if (echoes.current.length > ECHOES_KEPT) echoes.current.shift();
      changed.current(said);
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

  /**
   * The value arriving from outside, and the one case where it is written in.
   *
   * This used to be `if (created.getValue() !== value) created.setValue(value)`,
   * which is the right shape for an `<input>` and the wrong one for an editor.
   * An input holds a string; this holds a document, a caret, a selection and an
   * undo history, and `setValue` throws the last three away. That would be a
   * price worth paying for a load - it is not a price worth paying for an echo
   * of a keystroke, and issue #198 is what happens when the two are confused.
   *
   * The race, exactly. A passive effect does not run at commit; it is flushed
   * after paint. Type at any speed a person types at and a keystroke lands in
   * that gap - so the effect runs holding the `value` of the render *before* the
   * last character, compares it against a model that has moved on, decides they
   * differ and writes the older text back. The document loses a character and
   * the caret goes to the top, so the next few characters are typed into the
   * beginning of the line. At a 15ms key delay the reporter's ordinary sentence
   * came out as `';n 'o' retu) 4154262ion1787`. Slower than that it is a caret
   * that jumps now and then, which is why it read as cosmetic and was not.
   *
   * So the question is not "does the prop differ from the model" - while
   * somebody is typing it always does, and that is normal. The question is
   * "where did this prop come from". A value this editor said is in `echoes`,
   * and is by definition older than the model: it is dropped, along with
   * anything it overtook. A value that is not in `echoes` is somebody else's -
   * a function loaded, a suggestion accepted, a revision restored, a parameter
   * added in the panel rewriting the declaration - and that is a replacement, so
   * it is written in.
   *
   * `indexOf` and not `lastIndexOf`, deliberately: the first match is the one
   * that keeps a stale echo out of the model even when the same text has been
   * reached twice, and the failure it errs towards - ignoring an outside write
   * that happens to be character-identical to a keystroke still in the air - is
   * one nobody can see, while the other direction is this bug again.
   */
  useEffect(() => {
    const created = editor.current;
    if (created === null) return;

    const said = echoes.current.indexOf(value);
    if (said !== -1) {
      // Ours, coming back. Everything before it has been overtaken by it.
      echoes.current.splice(0, said + 1);
      return;
    }

    // Somebody else's. Whatever was still in the air is answered by this.
    echoes.current.length = 0;
    if (created.getValue() === value) return;
    created.setValue(value);
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
