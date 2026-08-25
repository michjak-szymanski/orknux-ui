import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useLocation } from 'react-router-dom';

import { askQuickChat } from '../api/quickChat';
import type { QuickChatSuggestion } from '../api/quickChat';
import { CodeSuggestion } from './CodeSuggestion';
import { ToolSuggestion } from './ToolSuggestion';
import type { QuickChatToolSuggestion, QuickChatTurn } from '../api/quickChat';
import { fetchWorkspace } from '../api/workspaces';
import botIcon from '../assets/bot.svg';
import { Markdown } from './Markdown';
import { PAGES } from '../navigation';
import styles from './QuickChat.module.css';
import { t } from '../i18n';

export interface QuickChatProps {
  /** The workspace it asks about, or undefined while none is known. */
  workspacePath?: string;
}

/**
 * What the interface calls the page somebody is on.
 *
 * Read from the same list the router and Quick actions read, matched by shape rather
 * than by string: `/workspace/12/executions/9` is the run page, and the label
 * that page carries is what the model should be told. A page with no label of
 * its own — a particular run, a particular function — borrows the label of the
 * list it belongs to, which is still the right word for where somebody is.
 */
function labelFor(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);

  const matches = PAGES.filter((page) => {
    const shape = page.path.split('/').filter(Boolean);
    if (shape.length !== parts.length) return false;
    return shape.every((piece, at) => piece.startsWith(':') || piece === parts[at]);
  });

  const exact = matches.find((page) => page.goTo !== false);
  if (exact?.goTo) return exact.goTo.label;

  // Nothing with a label of its own: walk up to the list it came from.
  for (let depth = parts.length - 1; depth > 0; depth -= 1) {
    const found = PAGES.find((page) => {
      const shape = page.path.split('/').filter(Boolean);
      if (shape.length !== depth) return false;
      return shape.every((piece, at) => piece.startsWith(':') || piece === parts[at]) && page.goTo !== false;
    });
    if (found?.goTo !== undefined && found.goTo !== false) return found.goTo.label;
  }
  return null;
}

/**
 * A small chat that opens over whatever is on screen.
 *
 * Not the Chat page shrunk: there is no history, no model picker, no files and
 * no voice. It is for the question somebody has *while looking at something* —
 * why did this fail, what is this page for — so the one thing it carries that
 * the Chat page does not is where they are.
 *
 * It appears only where the workspace has chosen a model for it. A button that
 * opens onto an apology is worse than no button.
 */
export function QuickChat({ workspacePath }: QuickChatProps) {
  const { pathname } = useLocation();
  const workspaceId = workspacePath?.split('/').filter(Boolean)[1];

  const [offered, setOffered] = useState(false);
  /** Whether this workspace lets it start things; only wording depends on it here. */
  const [mayWrite, setMayWrite] = useState(false);
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<QuickChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  /*
   * The changes offered, by the turn each was offered in.
   *
   * Beside the conversation rather than in it: a turn is text, and this is a
   * thing with two buttons whose answer goes back into the conversation as the
   * next thing said. Kept after it has been answered, because a card that
   * disappears the moment it is accepted leaves somebody scrolling back for
   * what they just agreed to.
   */
  const [offers, setOffers] = useState<Record<number, { suggestion: QuickChatSuggestion; inEditor: boolean }>>({});
  /** The same, for a change offered to a tool: same rule, different editor. */
  const [toolOffers, setToolOffers] = useState<
    Record<number, { suggestion: QuickChatToolSuggestion; inEditor: boolean }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (workspaceId === undefined) {
      setOffered(false);
      return;
    }
    let live = true;
    fetchWorkspace(workspaceId)
      .then((held) => {
        if (!live) return;
        setOffered(held?.quickChatModelId != null);
        setMayWrite(held?.quickChatMayWrite ?? false);
      })
      .catch(() => {
        if (live) setOffered(false);
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);

  // The newest answer, and the box, without hunting for either.
  useEffect(() => {
    if (!open) return;
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    inputRef.current?.focus();
  }, [open, said, asking]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (question === '' || asking || workspaceId === undefined) return;
    setDraft('');
    await send(question);
  }

  /**
   * One turn, from wherever it came.
   *
   * Accepting or rejecting a change is a thing said in the conversation, not a
   * side channel: the model is told in the same place it is told everything
   * else, so its next answer is about what actually happened rather than about
   * what it offered.
   */
  async function send(question: string) {
    if (asking || workspaceId === undefined) return;

    const conversation: QuickChatTurn[] = [...said, { role: 'user', content: question }];
    setSaid(conversation);
    setAsking(true);
    setError(null);
    try {
      // The page is read at the moment of asking rather than when the panel
      // opened: somebody can navigate with it open, and "this" then means the
      // page they are looking at now.
      const answer = await askQuickChat(workspaceId, conversation, {
        label: labelFor(pathname),
        path: pathname,
      });
      const grown: QuickChatTurn[] = [...conversation, { role: 'assistant', content: answer.answer }];
      setSaid(grown);
      if (answer.suggestion !== undefined) {
        const suggestion = answer.suggestion;
        /*
         * Offered to the editor first. A page showing the function claims the
         * event, and then the diff is drawn there - in the editor's own terms,
         * where the code is - and this panel only points at it. Unclaimed, the
         * change is shown here, because a suggestion can be made from any page
         * and it still has to land somewhere.
         */
        const announced = new CustomEvent('orknux:function-suggestion', {
          detail: suggestion,
          cancelable: true,
        });
        const unclaimed = window.dispatchEvent(announced);
        setOffers((held) => ({ ...held, [grown.length - 1]: { suggestion, inEditor: !unclaimed } }));
      }
      // A change to a tool, announced the same way and to the same rule: the
      // tool editor claims one for the tool it has open, and anything it does
      // not claim is drawn here.
      if (answer.toolSuggestion !== undefined) {
        const suggestion = answer.toolSuggestion;
        const announced = new CustomEvent('orknux:tool-suggestion', { detail: suggestion, cancelable: true });
        const unclaimed = window.dispatchEvent(announced);
        setToolOffers((held) => ({ ...held, [grown.length - 1]: { suggestion, inEditor: !unclaimed } }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That could not be answered.'));
    } finally {
      setAsking(false);
    }
  }

  /*
   * A page asking for this panel to open.
   *
   * The wand on the function editor sends this. The opener is only asked on a
   * conversation that has not started: somebody who has already been talking
   * to the panel is joined, not talked over with a scripted question.
   */
  useEffect(() => {
    function onAsked(event: Event) {
      const opener = (event as CustomEvent<{ opener?: string }>).detail?.opener;
      setOpen(true);
      if (typeof opener === 'string' && said.length === 0) void send(opener);
    }
    window.addEventListener('orknux:quick-chat', onAsked);
    return () => window.removeEventListener('orknux:quick-chat', onAsked);
  });

  /*
   * The editor settling an offer this panel handed it.
   *
   * Re-bound every render on purpose: `send` closes over the conversation as
   * it stands, and answering into last render's conversation would drop turns.
   */
  useEffect(() => {
    function onSettled(event: Event) {
      const said = (event as CustomEvent<{ said: string }>).detail?.said;
      if (typeof said === 'string') void send(said);
    }
    window.addEventListener('orknux:function-suggestion-settled', onSettled);
    // The tool editor settles its own the same way, under its own name: the
    // two editors know nothing about each other, and both answers are just the
    // next thing said in this conversation.
    window.addEventListener('orknux:tool-suggestion-settled', onSettled);
    return () => {
      window.removeEventListener('orknux:function-suggestion-settled', onSettled);
      window.removeEventListener('orknux:tool-suggestion-settled', onSettled);
    };
  });

  /** Enter sends, Shift+Enter is a new line — the way the Chat page does it. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void ask(event as unknown as FormEvent);
    }
  }

  if (!offered) return null;

  return (
    <>
      {open && (
        <section className={styles.panel} aria-label={t('Quick chat')}>
          <header className={styles.header}>
            <span className={styles.title}>{t('Ask about this page')}</span>
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label={t('Close')}>
              ×
            </button>
          </header>

          <div className={styles.log} ref={logRef}>
            {said.length === 0 && (
              <p className={styles.empty}>
                Ask about what is on screen, or about this workspace — its workflows, its runs and what they
                did.{' '}
                {mayWrite
                  ? t('It can look those up, and change things here if you ask it to.')
                  : t('It can look those up; it cannot change anything.')}
              </p>
            )}
            {said.map((turn, index) =>
              turn.role === 'user' ? (
                <p key={index} className={styles.asked}>
                  {turn.content}
                </p>
              ) : (
                <div key={index} className={styles.answered}>
                  <Markdown>{turn.content}</Markdown>
                  {/* Under the answer that offered it, where it was explained. */}
                  {offers[index] !== undefined &&
                    (offers[index].inEditor ? (
                      <p className={styles.inEditor}>
                        {t('The change is shown in the editor, against the code it would change.')}
                      </p>
                    ) : (
                      <CodeSuggestion suggestion={offers[index].suggestion} onSettled={(detail) => void send(detail)} />
                    ))}
                  {toolOffers[index] !== undefined &&
                    (toolOffers[index].inEditor ? (
                      <p className={styles.inEditor}>
                        {t('The change is shown in the editor, against the code it would change.')}
                      </p>
                    ) : (
                      <ToolSuggestion
                        suggestion={toolOffers[index].suggestion}
                        onSettled={(detail) => void send(detail)}
                      />
                    ))}
                </div>
              ),
            )}
            {asking && <p className={styles.thinking}>{t('Looking…')}</p>}
            {error !== null && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>

          <form className={styles.composer} onSubmit={ask}>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('Ask about this page…')}
              rows={2}
              aria-label={t('Ask about this page')}
            />
            <button type="submit" className={styles.send} disabled={asking || draft.trim() === ''}>
              {asking ? '…' : 'Ask'}
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className={open ? `${styles.launcher} ${styles.launcherOpen}` : styles.launcher}
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-label={open ? t('Close the quick chat') : t('Ask about this page')}
        title={open ? 'Close' : t('Ask about this page')}
      >
        <img src={botIcon} alt="" width={18} height={18} />
        <span className={styles.launcherLabel}>AI</span>
      </button>
    </>
  );
}
