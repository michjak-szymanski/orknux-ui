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
): Promise<string> {
  const answer = await fetch(`/api/workspaces/${workspaceId}/quick-chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, page }),
    credentials: 'include',
  });

  const said = (await answer.json().catch(() => null)) as { answer?: string; error?: string } | null;
  if (!answer.ok) throw new Error(said?.error ?? 'That could not be answered.');
  return said?.answer ?? '';
}
