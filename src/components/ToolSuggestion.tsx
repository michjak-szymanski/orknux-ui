import { useEffect, useState } from 'react';

import type { QuickChatToolSuggestion } from '../api/quickChat';
import { fetchTool, updateTool } from '../api/tools';
import { compile } from './monaco';
import { diffLines, diffSummary } from './diff';
import type { DiffLine } from './diff';
import styles from './CodeSuggestion.module.css';

export interface ToolSuggestionProps {
  suggestion: QuickChatToolSuggestion;
  /**
   * What happened, in the words the assistant is told it in.
   *
   * Three outcomes rather than two: saved, rejected outright, and accepted but
   * refused by the compiler are different things for it to answer.
   */
  onSettled: (said: string) => void;
}

/**
 * A change the assistant is offering for a tool, drawn against what is there now.
 *
 * The sibling of [CodeSuggestion], and deliberately shorter: a tool declares no
 * parameters, so there is no signature to read back off the code and nothing to
 * keep in step with a panel. What is left is the part that matters — the diff,
 * and two buttons that are the only things that touch the workspace.
 *
 * Shown here only when no editor claimed the offer. A page open on this tool
 * takes it and draws it where the code is; this card is what a question asked
 * from somewhere else lands in, because a suggestion still has to go somewhere.
 *
 * Accepting compiles in the browser, exactly as the tool editor's Save does:
 * what runs is the JavaScript stored beside the TypeScript it came from, and
 * there is no compiler on the server to make that pair afterwards.
 */
export function ToolSuggestion({ suggestion, onSettled }: ToolSuggestionProps) {
  const [before, setBefore] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settled, setSettled] = useState<'accepted' | 'rejected' | null>(null);

  useEffect(() => {
    let current = true;
    fetchTool(suggestion.toolId)
      .then((found) => {
        if (!current) return;
        setBefore(found === null ? '' : (found.typescript ?? found.source));
      })
      .catch(() => {
        if (current) setBefore('');
      });
    return () => {
      current = false;
    };
  }, [suggestion.toolId]);

  async function accept() {
    if (saving) return;
    setSaving(true);
    setFailed(null);
    try {
      const emitted = await compile(suggestion.code);
      if (!emitted.ok) {
        const reason = emitted.line === null ? emitted.reason : `line ${emitted.line}: ${emitted.reason}`;
        setFailed(`That would not compile — ${reason}`);
        // Told, not swallowed: the assistant wrote it and can write it again.
        onSettled(`I tried to accept it and it would not compile — ${reason}. It was not saved.`);
        setSettled('rejected');
        return;
      }

      await updateTool(suggestion.toolId, { source: emitted.javascript, typescript: suggestion.code });
      setSettled('accepted');
      /*
       * An editor open on this tool is holding the version from before. Told
       * rather than left to notice: the alternative is somebody saving over
       * what they have just accepted.
       */
      window.dispatchEvent(new CustomEvent('orknux:tool-saved', { detail: { id: suggestion.toolId } }));
      onSettled('I accepted the change and it is saved.');
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'It could not be saved.';
      setFailed(reason);
      onSettled(`I tried to accept it and it could not be saved — ${reason}`);
      setSettled('rejected');
    } finally {
      setSaving(false);
    }
  }

  function reject() {
    setSettled('rejected');
    onSettled('I rejected the change. The tool is unchanged.');
  }

  if (before === null) return <p className={styles.loading}>Reading what is there now…</p>;

  const lines: DiffLine[] = diffLines(before, suggestion.code);

  return (
    <section className={styles.card} aria-label={`Suggested change to ${suggestion.tool}`}>
      <header className={styles.head}>
        <span className={styles.name}>{suggestion.tool}</span>
        <span className={styles.count}>{diffSummary(lines)}</span>
      </header>

      {suggestion.note !== null && suggestion.note !== '' && <p className={styles.note}>{suggestion.note}</p>}

      <pre className={styles.diff}>
        {lines.map((line, at) => (
          <code
            key={at}
            className={
              line.kind === 'added' ? styles.added : line.kind === 'removed' ? styles.removed : styles.same
            }
          >
            {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} {line.text}
          </code>
        ))}
      </pre>

      {failed !== null && (
        <p className={styles.failed} role="alert">
          {failed}
        </p>
      )}

      {settled === null ? (
        <div className={styles.buttons}>
          <button type="button" className={styles.accept} onClick={() => void accept()} disabled={saving}>
            {saving ? 'Saving…' : 'Accept'}
          </button>
          <button type="button" className={styles.reject} onClick={reject} disabled={saving}>
            Reject
          </button>
        </div>
      ) : (
        <p className={settled === 'accepted' ? styles.accepted : styles.rejected}>
          {settled === 'accepted' ? 'Accepted and saved.' : 'Rejected. Nothing was changed.'}
        </p>
      )}
    </section>
  );
}
