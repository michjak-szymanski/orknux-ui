import { graphql } from './client';
import { payloadOf, readEventStream } from './sse';
import { t } from '../i18n';

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

/**
 * What one turn took and what it cost.
 *
 * The turn and not the last call in it: an agent that looked something up
 * before it answered paid for two rounds, and the server adds them up the same
 * way it has always added up `millis`. The screen says so in as many words,
 * because a number about money that quietly means "some of it" is worse than no
 * number.
 */
export interface ChatSpend {
  /** How long the model took, shown as what it thought for. */
  millis: number;
  /**
   * What the provider said it charged for. Zero means it reported nothing, not
   * that nothing was spent - so zero is drawn as nothing at all.
   */
  inputTokens: number;
  outputTokens: number;
  /**
   * What those tokens cost at the prices recorded on the model, or null when it
   * carries none. Worked out by the server: the prices are the model's, and two
   * places rounding money is one too many.
   */
  cost: number | null;
}

export interface ChatAnswer extends ChatSpend {
  session: ChatSession;
  answer: ChatMessage;
}

/**
 * What was drawn, and what it cost.
 *
 * Not a [ChatSpend]: an image model reports no tokens, so the two counts on that
 * would be a pair of noughts that read as "the provider charged for nothing"
 * rather than "there is nothing of that kind to report". What it does have is a
 * price per picture, and `cost` is null where the model carries none — nothing
 * recorded is not nothing spent.
 */
export interface ChatPicture {
  /** The attachment the picture was filed as; `/api/attachments/{id}` serves it. */
  attachmentId: string;
  /** What was asked for, trimmed. */
  prompt: string;
  /** The line written into the chat as the answer: a markdown image. */
  said: string;
  /** How long the provider took to draw it. */
  millis: number;
  cost: number | null;
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
         millis inputTokens outputTokens cost
       }
     }`,
    { id, text },
  );
  return data.sendChatMessage;
}

/**
 * One lookup an agent made while answering, as it is watched.
 *
 * `at` is where the call came in the round, counted from nought across every
 * round the answer took, and it is what pairs a result with the call it belongs
 * to. Not the provider's own call id, which the model chooses and which more
 * than one OpenAI-compatible server has sent as an empty string, and not the
 * transcript line's id, which does not exist for a round nobody is recording.
 */
export interface ChatCall {
  at: number;
  tool: string;
  arguments: string;
  /** What came back. Null while the tool has not answered yet. */
  result: string | null;
  /** Whether the tool could not be run at all. Meaningless while running. */
  failed: boolean;
}

/**
 * Draws a picture from a description, and puts it in the chat.
 *
 * A door of its own rather than a flag on the send above, because it is a
 * different model at a different endpoint. What comes back is the id of the
 * attachment the picture was filed as; the chat is re-read afterwards, since the
 * exchange the server wrote into the history is the record of it.
 */
export async function drawChatPicture(chatId: string, prompt: string): Promise<ChatPicture> {
  const data = await graphql<{ drawChatPicture: ChatPicture }>(
    `mutation DrawChatPicture($chatId: ID!, $prompt: String!) {
       drawChatPicture(chatId: $chatId, prompt: $prompt) {
         attachmentId prompt said millis cost
       }
     }`,
    { chatId, prompt },
  );
  return data.drawChatPicture;
}

/** What a streaming send reports as it goes. */
export interface ChatStreamHandlers {
  onChunk: (text: string) => void;
  /**
   * A piece of what the model thought, where it is a model that thinks.
   *
   * Separate from `onChunk` all the way down rather than sorted out here: the
   * server reads it out of a field of its own, or out of the `<think>` block a
   * local server leaves in the content, and hands the two halves over already
   * apart. A screen that had to split them would be a second place to get it
   * wrong, and getting it wrong means the thinking is read aloud.
   */
  onThinking: (text: string) => void;
  /** A lookup, the moment the agent makes it and before its tool has run. */
  onCall: (call: { at: number; tool: string; arguments: string }) => void;
  /** And what that lookup gave back. */
  onCalled: (answer: { at: number; result: string; failed: boolean }) => void;
  onDone: (spend: ChatSpend) => void;
  onError: (reason: string) => void;
}

/**
 * Sends, and reads the answer as the model writes it.
 *
 * Server-sent events over a POST, so `fetch` rather than `EventSource` — which
 * only does GET, and there is a message to send. The session cookie rides along
 * as it does on every other call.
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
 * back is the same six events either way. The buffering underneath is
 * `readEventStream`'s and is shared further still — the task page follows a
 * running agent through the same reader, and a second copy of that loop is a
 * second place for half a frame to be parsed as a whole one.
 *
 * The vocabulary is the chat's own and is not the task stream's, which says
 * `step` about the same underlying facts. That is deliberate and is written out
 * on the server's `ServerSentEvents`: a task's page follows a durable log it can
 * rejoin at any point, and this follows one answer being composed inside one
 * request. Folding the two sets of names together would mean a reader having to
 * know which endpoint it was talking to in order to know what a frame meant.
 */
async function read(response: Response, handlers: ChatStreamHandlers): Promise<void> {
  await readEventStream(response, (frame) => {
    const payload = payloadOf<{
      text?: string;
      at?: number;
      tool?: string;
      arguments?: string;
      result?: string;
      failed?: boolean;
      millis?: number;
      inputTokens?: number;
      outputTokens?: number;
      cost?: number | null;
      reason?: string;
    }>(frame);
    if (payload === null) return;

    if (frame.event === 'chunk' && payload.text !== undefined) handlers.onChunk(payload.text);
    else if (frame.event === 'thinking' && payload.text !== undefined) handlers.onThinking(payload.text);
    else if (frame.event === 'call' && payload.at !== undefined) {
      handlers.onCall({
        at: payload.at,
        tool: payload.tool ?? '',
        arguments: payload.arguments ?? '',
      });
    } else if (frame.event === 'called' && payload.at !== undefined) {
      handlers.onCalled({
        at: payload.at,
        result: payload.result ?? '',
        failed: payload.failed === true,
      });
    } else if (frame.event === 'done') {
      handlers.onDone({
        millis: payload.millis ?? 0,
        inputTokens: payload.inputTokens ?? 0,
        outputTokens: payload.outputTokens ?? 0,
        cost: payload.cost ?? null,
      });
    } else if (frame.event === 'error') {
      handlers.onError(payload.reason ?? t('The model could not answer.'));
    }
  });
}

/** 2400 -> "2 seconds", 800 -> "0.8 seconds": what the model thought for. */
export function thinkingTime(millis: number): string {
  if (millis < 1000) return `${(millis / 1000).toFixed(1)} seconds`;
  const seconds = Math.round(millis / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

/**
 * Whether there is anything to say about what a turn cost.
 *
 * Both counts at nought is a provider that reported none - a local server that
 * sends no usage object at all - and printing "0 tokens" under such an answer
 * would be this installation asserting something it does not know. The line is
 * left out instead, which is also what every message loaded from the history
 * gets: the counts belong to the answer as it was given and are not written
 * down.
 *
 * A price with no counts behind it is the exception, and it is a drawn picture.
 * An image model reports no tokens and is billed per picture, so tokens alone
 * left a drawing that cost four cents saying nothing at all about money - the
 * same mistake as printing $0.00, made quietly.
 */
export function spendKnown(spend: ChatSpend): boolean {
  return spend.inputTokens > 0 || spend.outputTokens > 0 || spend.cost !== null;
}

/** 1620 -> "1,620". Grouped, because these run to five figures on a long thread. */
export function tokenCount(tokens: number): string {
  return tokens.toLocaleString('en-US');
}

/**
 * 0.00214 -> "$0.0021", and anything under the fourth place said in words.
 *
 * Four places rather than the two the metrics card uses: one answer at ordinary
 * prices is a fraction of a cent, and rounded to cents every line would read
 * $0.00. Below what four places can show it says so rather than printing a zero,
 * which is the same rule as `spendKnown` - the number is small, not nothing.
 */
export function costAmount(cost: number): string {
  if (cost > 0 && cost < 0.0001) return 'under $0.0001';
  return `$${cost.toFixed(4)}`;
}
