import { t } from '../i18n';
/** One turn of the panel's conversation. Nothing here is stored anywhere. */
export interface QuickChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Where the person is, sent with every question.
 *
 * The label is what the interface itself calls the page, so the model answers
 * about "Executions" rather than about a URL; the path carries the ids, which is
 * what makes "why did this fail" answerable without asking which one.
 */
export interface QuickChatPage {
  label: string | null;
  path: string;
}

/**
 * A change the assistant is offering for a function's code.
 *
 * Beside the answer rather than inside it: it is not prose, and the panel draws
 * it against what the function says now with an accept and a reject under it.
 * Nothing has been saved when this arrives — that is what the accept is for.
 */
export interface QuickChatSuggestion {
  functionId: string;
  /** What the function is called, for the line above the diff. */
  function: string;
  note: string | null;
  code: string;
}

/**
 * The same offer, made about a tool's code.
 *
 * Its own type rather than the one above with the names changed, because the
 * two are settled in different places: a function's change is saved with a
 * parameter list read off the declaration, and a tool has no parameter list —
 * it is a default export handed one argument.
 */
export interface QuickChatToolSuggestion {
  toolId: string;
  /** What the tool is called, for the line above the diff. */
  tool: string;
  note: string | null;
  code: string;
}

export interface QuickChatAnswer {
  answer: string;
  suggestion?: QuickChatSuggestion;
  toolSuggestion?: QuickChatToolSuggestion;
}

/**
 * Asks the quick chat.
 *
 * REST rather than GraphQL to sit beside the other things a chat needs, and
 * because there is no record being made: the panel keeps its conversation in
 * the browser for as long as it is open and nowhere else.
 */
export async function askQuickChat(
  workspaceId: string,
  messages: QuickChatTurn[],
  page: QuickChatPage,
): Promise<QuickChatAnswer> {
  const answer = await fetch(`/api/workspaces/${workspaceId}/quick-chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, page }),
    credentials: 'include',
  });

  const said = (await answer.json().catch(() => null)) as
    | {
        answer?: string;
        error?: string;
        suggestion?: QuickChatSuggestion;
        toolSuggestion?: QuickChatToolSuggestion;
      }
    | null;
  if (!answer.ok) throw new Error(said?.error ?? t('That could not be answered.'));
  return { answer: said?.answer ?? '', suggestion: said?.suggestion, toolSuggestion: said?.toolSuggestion };
}
