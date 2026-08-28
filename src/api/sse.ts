/**
 * Reading server-sent events, in the one place that knows the wire format.
 *
 * There are two streams in this product — a chat's answer arriving as the model
 * writes it, and a task's session arriving as the agent works — and they share
 * exactly this: the buffering. It lived inside `chat.ts`, and the task page
 * would have been a second copy of the one loop in it that is easy to get
 * wrong.
 *
 * That loop is the reason this is a module rather than three lines at each call
 * site. A frame ends with a blank line and arrives in whatever pieces the
 * network chose, so a reader that parses whatever a `read()` handed it will
 * eventually parse half of one — and half a frame parses as nothing at all,
 * silently, on a fast connection under load and never on a developer's machine.
 * The buffer is consumed only up to the last complete frame.
 *
 * `fetch` and not `EventSource`, for both of them. The chat has a message to
 * send and `EventSource` only does GET; the task could use one, and does not,
 * because then the two would be two readers again and only one of them would
 * have this comment on it.
 */

/** An SSE frame ends with a blank line. */
const BLANK_LINE = '\n\n';

/** One frame, as the protocol spells it. */
export interface EventFrame {
  /** What `event:` said, or `message` where it said nothing. */
  event: string;
  /** What `data:` said, unparsed. */
  data: string;
  /** What `id:` said, or null. The cursor a reconnect resumes from. */
  id: string | null;
}

/**
 * Reads a response as a stream of frames until it ends.
 *
 * Resolves when the server closes. Rejects only where the response itself was a
 * refusal — after the first byte there is no status left to fail on, so
 * everything past that point is something the frames have to say.
 */
export async function readEventStream(
  response: Response,
  onFrame: (frame: EventFrame) => void,
): Promise<void> {
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
      const frame = parse(buffer.slice(0, split));
      if (frame !== null) onFrame(frame);
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf(BLANK_LINE);
    }
  }
}

/**
 * Whether this failure is the page having stopped the request itself.
 *
 * A stream that is aborted rejects — at the `fetch`, or at the next `read()` if
 * it had already started arriving — and it rejects the same way a network that
 * dropped does. The difference matters at every call site: a dropped stream is
 * something to put on the screen in red, and a stream somebody stopped on
 * purpose is not news. Told apart by the name rather than by the message, which
 * is a sentence each browser writes for itself.
 */
export function givenUp(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/**
 * The sentence out of a refusal, where there is one.
 *
 * The streaming endpoints are the only ones here that are not GraphQL, so a
 * refusal is not an `ApiError`: it is a `ProblemDetail`, and its `detail` is the
 * line the server wrote for a person to read. Without this the chat put the
 * whole JSON object on screen.
 */
export function refusal(body: string): string | null {
  try {
    const held = JSON.parse(body) as { detail?: unknown };
    return typeof held.detail === 'string' && held.detail !== '' ? held.detail : null;
  } catch {
    return null;
  }
}

/**
 * One frame's fields. Null for a frame carrying no data — a keep-alive comment,
 * which is a colon and nothing else and is meant to be ignored.
 */
function parse(frame: string): EventFrame | null {
  let event = 'message';
  let data = '';
  let id: string | null = null;
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
    else if (line.startsWith('id:')) id = line.slice('id:'.length).trim();
  }
  return data === '' ? null : { event, data, id };
}

/** The frame's payload as JSON, or null where it was not any. */
export function payloadOf<T>(frame: EventFrame): T | null {
  try {
    return JSON.parse(frame.data) as T;
  } catch {
    return null;
  }
}
