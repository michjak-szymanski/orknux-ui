import { graphql } from './client';

/**
 * A conversation an agent kept, found by the key whoever ran it computed.
 *
 * There are no mutations here, and that is the shape of the feature rather than
 * an omission: a session appears the first time an agent node with a `sessionKey`
 * records into it. Everything this module does is look.
 */
export interface LlmSession {
  id: string;
  workspaceId: string;
  /** `prefix:key`, or the key alone where the node gave no prefix. */
  key: string;
  keyPrefix: string | null;
  eventCount: number;
  createdAt: string;
  /** Null on a session nothing has been recorded in yet. */
  lastEventAt: string | null;
}

/** What a list of sessions is ordered by, in the words the server uses. */
export type LlmSessionOrder = 'KEY' | 'CREATED' | 'LAST_EVENT';

/**
 * What one line of a transcript is.
 *
 * TOOL is the call and not what came back: the arguments the model sent, which
 * is why that one line is often JSON and often long.
 */
export type LlmSessionEventKind = 'AGENT' | 'TOOL' | 'USER' | 'SYSTEM';

/** What a transcript is ordered by. */
export type LlmSessionEventOrder = 'AT' | 'KIND';

export interface LlmSessionEvent {
  id: string;
  kind: LlmSessionEventKind;
  /** The agent, the tool, whoever asked. Every line names somebody. */
  actor: string;
  content: string | null;
  /**
   * What a call gave back, and null on every line that is not one.
   *
   * Null on a call too, while its tool has not answered — the call is recorded
   * before the tool runs, so arguments with no result is a lookup that was asked
   * for and has not come back. On a task being watched live that is a state
   * somebody sees change; everywhere else it is how a hung tool is visible at
   * all.
   */
  result: string | null;
  at: string;
}

export interface LlmSessionPage {
  totalElements: number;
  content: LlmSession[];
}

export interface LlmSessionEventPage {
  totalElements: number;
  content: LlmSessionEvent[];
}

/** What each kind is called where somebody reads it. */
export const EVENT_KIND_LABEL: Record<LlmSessionEventKind, string> = {
  AGENT: 'Agent',
  TOOL: 'Tool',
  USER: 'User',
  SYSTEM: 'System',
};

/** In the order a turn takes: something is put to the agent, it calls, it answers. */
export const EVENT_KINDS: LlmSessionEventKind[] = ['USER', 'AGENT', 'TOOL', 'SYSTEM'];

const SESSION_FIELDS = 'id workspaceId key keyPrefix eventCount createdAt lastEventAt';

const EVENT_FIELDS = 'id kind actor content result at';

export async function fetchLlmSessions(
  workspaceId: string,
  options: {
    search?: string;
    page?: number;
    size?: number;
    order?: LlmSessionOrder;
    ascending?: boolean;
  } = {},
): Promise<LlmSessionPage> {
  const data = await graphql<{ llmSessions: LlmSessionPage }>(
    `query ($workspaceId: ID!, $search: String, $page: Int, $size: Int,
            $order: LlmSessionOrder, $ascending: Boolean) {
       llmSessions(workspaceId: $workspaceId, search: $search, page: $page, size: $size,
                   order: $order, ascending: $ascending) {
         totalElements
         content { ${SESSION_FIELDS} }
       }
     }`,
    {
      workspaceId,
      search: options.search || null,
      page: options.page ?? 0,
      size: options.size ?? 20,
      order: options.order ?? null,
      ascending: options.ascending ?? null,
    },
  );
  return data.llmSessions;
}

/** Null where there is no such session, or it is not one this person may see. */
export async function fetchLlmSession(id: string): Promise<LlmSession | null> {
  const data = await graphql<{ llmSession: LlmSession | null }>(
    `query ($id: ID!) { llmSession(id: $id) { ${SESSION_FIELDS} } }`,
    { id },
  );
  return data.llmSession;
}

/**
 * Throws a session away, with everything said in it.
 *
 * False where there was nothing to remove — a second press of the button is
 * somebody making sure rather than an error.
 */
export async function removeLlmSession(id: string): Promise<boolean> {
  const data = await graphql<{ removeLlmSession: boolean }>(
    `mutation ($id: ID!) { removeLlmSession(id: $id) }`,
    { id },
  );
  return data.removeLlmSession;
}

/**
 * One session's transcript.
 *
 * `kinds` left out asks for every kind — as does an empty list, which is the
 * trap: a page where nothing is ticked means the whole transcript, not none of
 * it, so the filter sends nothing rather than an empty array only by accident.
 */
export async function fetchLlmSessionEvents(
  sessionId: string,
  options: {
    search?: string;
    kinds?: LlmSessionEventKind[];
    page?: number;
    size?: number;
    order?: LlmSessionEventOrder;
    ascending?: boolean;
  } = {},
): Promise<LlmSessionEventPage> {
  const data = await graphql<{ llmSessionEvents: LlmSessionEventPage }>(
    `query ($sessionId: ID!, $search: String, $kinds: [LlmSessionEventKind!], $page: Int, $size: Int,
            $order: LlmSessionEventOrder, $ascending: Boolean) {
       llmSessionEvents(sessionId: $sessionId, search: $search, kinds: $kinds, page: $page, size: $size,
                        order: $order, ascending: $ascending) {
         totalElements
         content { ${EVENT_FIELDS} }
       }
     }`,
    {
      sessionId,
      search: options.search || null,
      kinds: options.kinds === undefined || options.kinds.length === 0 ? null : options.kinds,
      page: options.page ?? 0,
      size: options.size ?? 20,
      order: options.order ?? null,
      ascending: options.ascending ?? null,
    },
  );
  return data.llmSessionEvents;
}
