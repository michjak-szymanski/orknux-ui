import { useEffect, useState } from 'react';

import { fetchFunction, parametersOf, sameParameters, updateFunction } from '../api/functions';
import type { WorkspaceFunction } from '../api/functions';
import { fetchWorkspaceObjects } from '../api/objects';
import type { WorkflowObject } from '../api/objects';
import type { QuickChatSuggestion } from '../api/quickChat';
import { compile } from './monaco';
import { diffLines, diffSummary } from './diff';
import type { DiffLine } from './diff';
import styles from './CodeSuggestion.module.css';
import { t } from '../i18n';

/** Enough of a workspace's objects that an annotation naming one is found. */
const OBJECT_PAGE_SIZE = 100;

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
  /**
   * The function as it stands, kept for what accepting has to know about it.
   *
   * Not only the code: the parameters the change would be moving away from, and
   * the workspace's variables it is handed after them. A parameter list read off
   * the offered code means nothing without both.
   */
  const [held, setHeld] = useState<WorkspaceFunction | null>(null);
  /** What an object annotation can name, for a parameter that is one. */
  const [objects, setObjects] = useState<WorkflowObject[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settled, setSettled] = useState<'accepted' | 'rejected' | null>(null);

  useEffect(() => {
    let current = true;
    fetchFunction(suggestion.functionId)
      .then((found) => {
        if (!current) return;
        setHeld(found);
        setBefore(found === null ? '' : (found.typescript ?? found.source));
        if (found?.workspaceId == null) return;
        return fetchWorkspaceObjects(found.workspaceId, 0, OBJECT_PAGE_SIZE)
          .then((page) => {
            if (current) setObjects(page.content);
          })
          .catch(() => undefined);
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

      /*
       * The parameter list, read back off the code that was offered — the same
       * way the editor reads it when the change is shown there instead. It is
       * the code that says what the function takes, so the two cannot disagree.
       */
      const read = parametersOf(suggestion.code, held?.externals ?? [], objects, held?.params ?? []);
      if ('problem' in read) {
        setFailed(`The parameters could not be read — ${read.problem}.`);
        onSettled(
          `I could not accept it: ${read.problem}. Nothing was saved. Offer it again with a ` +
            'declaration I can read.',
        );
        setSettled('rejected');
        return;
      }
      const moved = held !== null && !sameParameters(read.params, held.params);

      const stored = await updateFunction(suggestion.functionId, {
        source: emitted.javascript,
        typescript: suggestion.code,
        params: moved ? read.params : undefined,
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
      onSettled(
        moved
          ? `I accepted the change and it is saved. The function now takes ${stored.signature}.`
          : t('I accepted the change and it is saved.'),
      );
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : t('It could not be saved.');
      setFailed(reason);
      onSettled(`I tried to accept it and it could not be saved — ${reason}`);
      setSettled('rejected');
    } finally {
      setSaving(false);
    }
  }

  function reject() {
    setSettled('rejected');
    onSettled(t('I rejected the change. The function is unchanged.'));
  }

  if (before === null) return <p className={styles.loading}>{t('Reading what is there now…')}</p>;

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
            {saving ? t('Saving…') : 'Accept'}
          </button>
          <button type="button" className={styles.reject} onClick={reject} disabled={saving}>
            {t('Reject')}
          </button>
        </div>
      ) : (
        <p className={settled === 'accepted' ? styles.accepted : styles.rejected}>
          {settled === 'accepted' ? t('Accepted and saved.') : t('Rejected. Nothing was changed.')}
        </p>
      )}
    </section>
  );
}
