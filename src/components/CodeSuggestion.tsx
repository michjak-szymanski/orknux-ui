import { useEffect, useState } from 'react';

import { fetchFunction, updateFunction } from '../api/functions';
import type { QuickChatSuggestion } from '../api/quickChat';
import { compile } from './monaco';
import { diffLines, diffSummary } from './diff';
import type { DiffLine } from './diff';
import styles from './CodeSuggestion.module.css';

export interface CodeSuggestionProps {
  suggestion: QuickChatSuggestion;
  /**
    * What happened, in the words the assistant is told it in.
    *
    * Words rather than a verdict, because the interesting cases are not two:
    * accepted and saved, rejected outright, and accepted but refused by the
    * compiler are three different things for it to answer.
    */
  onSettled: (said: string) => void;
}

/**
 * A change the assistant is offering, drawn against what is there now.
 *
 * The point of it is that nothing happens until somebody says so. The model
 * writes code, this shows what that would do to the function, and the two
 * buttons are the only things that touch the workspace - so a suggestion nobody
 * reads changes nothing, which is the difference between an assistant and a
 * thing that edits your code while you are talking to it.
 *
 * Accepting compiles here, in the browser, the same way the editor does: the
 * JavaScript that runs is stored beside the TypeScript it came from, and there
 * is no compiler on the server to make that pair afterwards. Code that will not
 * compile is refused with the reason, which the assistant is then told, so its
 * next attempt is an attempt at the actual problem.
 */
export function CodeSuggestion({ suggestion, onSettled }: CodeSuggestionProps) {
  const [before, setBefore] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settled, setSettled] = useState<'accepted' | 'rejected' | null>(null);

  useEffect(() => {
    let current = true;
    fetchFunction(suggestion.functionId)
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
  }, [suggestion.functionId]);

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

      await updateFunction(suggestion.functionId, {
        source: emitted.javascript,
        typescript: suggestion.code,
      });
      setSettled('accepted');
      /*
       * An editor open on this function is holding the version from before.
       * Told rather than left to notice: the alternative is somebody saving
       * over what they just accepted.
       */
      window.dispatchEvent(
        new CustomEvent('orknux:function-saved', { detail: { id: suggestion.functionId } }),
      );
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
    onSettled('I rejected the change. The function is unchanged.');
  }

  if (before === null) return <p className={styles.loading}>Reading what is there now…</p>;

  const lines: DiffLine[] = diffLines(before, suggestion.code);

  return (
    <section className={styles.card} aria-label={`Suggested change to ${suggestion.function}`}>
      <header className={styles.head}>
        <span className={styles.name}>{suggestion.function}</span>
        <span className={styles.count}>{diffSummary(lines)}</span>
      </header>

      {suggestion.note !== null && suggestion.note !== '' && (
        <p className={styles.note}>{suggestion.note}</p>
      )}

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
