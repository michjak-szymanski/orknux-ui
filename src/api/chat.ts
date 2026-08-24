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
  /** The LLM session this chat is continuing, or null for one continuing none. */
  llmSessionId: string | null;
}

/**
 * One line of a chat, as it is read.
 *
 * Role is user, assistant, system or tool. A `tool` line is not a turn: it is a
 * call the agent made in the session this chat continues, drawn between the
 * turns it was made between so that an answer is not read as something the
 * agent simply knew. `content` is the arguments as the model sent them.
 *
 * The model is never shown one. What is sent is what was said, which is why
 * these arrive from the query rather than being anything the chat can produce.
 */
export interface ChatMessage {
  role: string;
  content: string;
  /**
   * Who said it, for a line carried into this chat from the session it
   * continues - the agent, the tool or the person, as the session recorded it.
   *
   * Null for everything the chat said itself. So it is also the boundary: lines
   * with a name were already there when the chat opened, turns without were
   * said in it.
   */
  actor: string | null;
  /**
   * What this answer said the earlier times it was given, oldest first.
   *
   * Empty for an answer nobody has asked again for, and for every other kind of
   * line. Asking again takes the model's last turn off the thread before it is
   * asked - a conversation holding two answers to one question was never had -
   * so these are the turns that came off, kept so the button cannot lose the
   * answer somebody was about to keep.
   */
  takes: string[];
}

/** The role a call reads under, which is not a turn anybody took. */
export const CALL_ROLE = 'tool';

export interface ChatAnswer {
  session: ChatSession;
  answer: ChatMessage;
  /** How long the model took, shown as what it thought for. */
  millis: number;
}

const SESSION_FIELDS =
  'id workspaceId title pinned modelId modelName createdAt lastMessageAt agentId agentName llmSessionId';

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
    'query ChatMessages($id: ID!) { chatMessages(id: $id) { role content actor takes } }',
    { id },
  );
  return data.chatMessages;
}

/**
 * Opens a chat.
 *
 * `llmSessionId` is the session it continues, when it was opened from one: what
 * was already said there comes back as the chat's first messages, and what is
 * said from here on is written into it. Left out - every chat started from the
 * sidebar - it continues nothing.
 */
export async function startChat(
  workspaceId: string,
  title?: string,
  modelId?: string,
  llmSessionId?: string,
): Promise<ChatSession> {
  const data = await graphql<{ startChat: ChatSession }>(
    `mutation StartChat($input: StartChatInput!) { startChat(input: $input) { ${SESSION_FIELDS} } }`,
    { input: { workspaceId, title, modelId, llmSessionId } },
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
         answer { role content actor takes }
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
  await read(response, handlers);
}

/**
 * Asks for the last answer again, and reads the new one as it is written.
 *
 * No body: nothing is being said. The server takes the answer off the thread,
 * keeps what it said as a take and asks whatever the chat says answers it —
 * which is the model or agent that produced it, unless the picker has been
 * moved since.
 */
export async function regenerateChatAnswer(id: string, handlers: ChatStreamHandlers): Promise<void> {
  const response = await fetch(`/api/chats/${id}/regenerate`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  await read(response, handlers);
}

/**
 * The answer coming back, frame by frame.
 *
 * Shared by both doors because they differ only in what was sent: what comes
 * back is the same three events either way, and a second copy of this loop is a
 * second place for the buffering to be got wrong.
 */
async function read(response: Response, handlers: ChatStreamHandlers): Promise<void> {
  if (!response.ok || response.body === null) {
    const body = await response.text().catch(() => '');
    const said = refusal(body);
    throw new Error(said ?? (body === '' ? `The server answered ${response.status}.` : body));
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

/**
 * The sentence out of a refusal, where there is one.
 *
 * These two endpoints are the only ones that are not GraphQL, so `ApiError` is
 * not what a refusal arrives as: it is a `ProblemDetail`, and its `detail` is
 * the line the server wrote for a person to read. Without this the chat put the
 * whole JSON object on screen.
 */
function refusal(body: string): string | null {
  try {
    const held = JSON.parse(body) as { detail?: unknown };
    return typeof held.detail === 'string' && held.detail !== '' ? held.detail : null;
  } catch {
    return null;
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
