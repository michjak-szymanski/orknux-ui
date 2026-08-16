import { graphql } from './client';

/**
 * One conversation.
 *
 * The messages are not on it: they live in Spring AI's chat memory store on the
 * server, keyed by a conversation id, which is what lets a workflow run key one
 * the same way and share a single thread between its agents.
 */
export interface ChatSession {
  id: string;
  workspaceId: string;
  title: string;
  pinned: boolean;
  modelId: string | null;
  modelName: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  /** Set when an agent is answering rather than a bare model. */
  agentId: string | null;
  /** What that agent is called, or null once it has been deleted. */
  agentName: string | null;
}

/** Role is user, assistant, system or tool, as the store recorded it. */
export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatAnswer {
  session: ChatSession;
  answer: ChatMessage;
  /** How long the model took, shown as what it thought for. */
  millis: number;
}

const SESSION_FIELDS = 'id workspaceId title pinned modelId modelName createdAt lastMessageAt agentId agentName';

export async function fetchChatSessions(workspaceId: string): Promise<ChatSession[]> {
  const data = await graphql<{ chatSessions: ChatSession[] }>(
    `query ChatSessions($workspaceId: ID!) { chatSessions(workspaceId: $workspaceId) { ${SESSION_FIELDS} } }`,
    { workspaceId },
  );
  return data.chatSessions;
}

/**
 * Which chats said this, for the search that looks inside them rather than at
 * their names. Asked of the server: the sidebar holds the chats, not what was
 * said in them.
 */
export async function fetchChatsMentioning(workspaceId: string, text: string): Promise<string[]> {
  const data = await graphql<{ chatsMentioning: string[] }>(
    'query ChatsMentioning($workspaceId: ID!, $text: String!) { chatsMentioning(workspaceId: $workspaceId, text: $text) }',
    { workspaceId, text },
  );
  return data.chatsMentioning;
}

export async function fetchChatMessages(id: string): Promise<ChatMessage[]> {
  const data = await graphql<{ chatMessages: ChatMessage[] }>(
    'query ChatMessages($id: ID!) { chatMessages(id: $id) { role content } }',
    { id },
  );
  return data.chatMessages;
}

export async function startChat(
  workspaceId: string,
  title?: string,
  modelId?: string,
): Promise<ChatSession> {
  const data = await graphql<{ startChat: ChatSession }>(
    `mutation StartChat($input: StartChatInput!) { startChat(input: $input) { ${SESSION_FIELDS} } }`,
    { input: { workspaceId, title, modelId } },
  );
  return data.startChat;
}

export async function renameChat(id: string, title: string): Promise<ChatSession> {
  const data = await graphql<{ renameChat: ChatSession }>(
    `mutation RenameChat($id: ID!, $title: String!) { renameChat(id: $id, title: $title) { ${SESSION_FIELDS} } }`,
    { id, title },
  );
  return data.renameChat;
}

export async function setChatPinned(id: string, pinned: boolean): Promise<ChatSession> {
  const data = await graphql<{ setChatPinned: ChatSession }>(
    `mutation SetChatPinned($id: ID!, $pinned: Boolean!) {
       setChatPinned(id: $id, pinned: $pinned) { ${SESSION_FIELDS} }
     }`,
    { id, pinned },
  );
  return data.setChatPinned;
}

/** Hands the chat to an agent; null hands it back to a bare model. */
export async function chooseChatAgent(id: string, agentId: string | null): Promise<ChatSession> {
  const data = await graphql<{ chooseChatAgent: ChatSession }>(
    `mutation ChooseChatAgent($id: ID!, $agentId: ID) {
       chooseChatAgent(id: $id, agentId: $agentId) { ${SESSION_FIELDS} }
     }`,
    { id, agentId },
  );
  return data.chooseChatAgent;
}

export async function chooseChatModel(id: string, modelId: string | null): Promise<ChatSession> {
  const data = await graphql<{ chooseChatModel: ChatSession }>(
    `mutation ChooseChatModel($id: ID!, $modelId: ID) {
       chooseChatModel(id: $id, modelId: $modelId) { ${SESSION_FIELDS} }
     }`,
    { id, modelId },
  );
  return data.chooseChatModel;
}

export async function deleteChat(id: string): Promise<boolean> {
  const data = await graphql<{ deleteChat: boolean }>(
    'mutation DeleteChat($id: ID!) { deleteChat(id: $id) }',
    { id },
  );
  return data.deleteChat;
}

export async function sendChatMessage(id: string, text: string): Promise<ChatAnswer> {
  const data = await graphql<{ sendChatMessage: ChatAnswer }>(
    `mutation SendChatMessage($id: ID!, $text: String!) {
       sendChatMessage(id: $id, text: $text) {
         session { ${SESSION_FIELDS} }
         answer { role content }
         millis
       }
     }`,
    { id, text },
  );
  return data.sendChatMessage;
}

/** An SSE frame ends with a blank line. */
const BLANK_LINE = '\n\n';

/** What a streaming send reports as it goes. */
export interface ChatStreamHandlers {
  onChunk: (text: string) => void;
  onDone: (millis: number) => void;
  onError: (reason: string) => void;
}

/**
 * Sends, and reads the answer as the model writes it.
 *
 * Server-sent events over a POST, so `fetch` rather than `EventSource` — which
 * only does GET, and there is a message to send. The session cookie rides along
 * as it does on every other call.
 *
 * Frames can split across reads, so the buffer is only consumed up to the last
 * complete one: an event ends with a blank line, and half of one parses as
 * nothing.
 */
export async function streamChatMessage(
  id: string,
  text: string,
  handlers: ChatStreamHandlers,
  /**
   * What was attached to this message.
   *
   * Sent with it rather than linked afterwards: the model is called during the
   * send, and a picture that arrives after the answer is one the answer could
   * not have seen.
   */
  attachmentIds: string[] = [],
): Promise<void> {
  const response = await fetch(`/api/chats/${id}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ text, attachmentIds }),
  });

  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail === '' ? `The server answered ${response.status}.` : detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf(BLANK_LINE);
    while (split !== -1) {
      handleFrame(buffer.slice(0, split), handlers);
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf(BLANK_LINE);
    }
  }
}

/** One `event:`/`data:` pair. Anything else on the wire is ignored. */
function handleFrame(frame: string, handlers: ChatStreamHandlers): void {
  let event = 'message';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
  }
  if (data === '') return;

  let payload: { text?: string; millis?: number; reason?: string };
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }

  if (event === 'chunk' && payload.text !== undefined) handlers.onChunk(payload.text);
  else if (event === 'done') handlers.onDone(payload.millis ?? 0);
  else if (event === 'error') handlers.onError(payload.reason ?? 'The model could not answer.');
}

/** 2400 -> "2 seconds", 800 -> "0.8 seconds": what the model thought for. */
export function thinkingTime(millis: number): string {
  if (millis < 1000) return `${(millis / 1000).toFixed(1)} seconds`;
  const seconds = Math.round(millis / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}
