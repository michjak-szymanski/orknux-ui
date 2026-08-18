import { graphql } from './client';
import type { PageOf } from './client';

/** What an action does when a workflow reaches it. */
export type ActionType = 'EXECUTE' | 'WAIT';

/** How it does it; each subtype belongs to one type. */
export type ActionSubtype =
  | 'OUTGOING_CONNECTION'
  | 'SEND_EMAIL'
  | 'HTTP_REQUEST'
  | 'FUNCTION'
  | 'INLINE_CONDITION'
  | 'CONDITION'
  | 'TIME';

export type ConnectionActionKind = 'SEND_MESSAGE' | 'REPLY_IN_THREAD' | 'CREATE_ISSUE' | 'UPDATE_ISSUE';

export type MessageTarget = 'CHANNEL' | 'USER';

/**
 * The shape of a value crossing between a workflow and a script.
 *
 * `OBJECT` names one of the workspace's objects and carries its id alongside;
 * `MAP` is keys and values with no defined shape, which is what `OBJECT` meant
 * before objects could be named.
 */
export type ValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'OBJECT' | 'MAP' | 'ARRAY' | 'NONE';

export interface ArgumentMapping {
  argument: string;
  expression: string;
}

/** Read off the action's settings by the server, not stored. */
export interface ActionParam {
  name: string;
  type: ValueType;
  /** "message: string", as the list and the form show it. */
  display: string;
}

export interface Action {
  id: string;
  workspaceId: string;
  name: string;
  type: ActionType;
  subtype: ActionSubtype;
  subtypeLabel: string;
  connectionId: string | null;
  connectionName: string | null;
  connectionAction: ConnectionActionKind | null;
  content: string | null;
  target: MessageTarget | null;
  targetName: string | null;
  /** A mail's recipients and copy list, comma-separated, and what it is about. */
  emailTo: string | null;
  emailCc: string | null;
  emailSubject: string | null;
  emailReplyTo: string | null;
  url: string | null;
  method: string | null;
  headers: string | null;
  functionId: string | null;
  functionName: string | null;
  mappings: ArgumentMapping[];
  conditionExpression: string | null;
  conditionId: string | null;
  conditionName: string | null;
  timeoutSeconds: number | null;
  retryIntervalSeconds: number | null;
  durationSeconds: number | null;
  /** Which icon a node drawn from this starts with; null draws the kind's own. */
  icon: string | null;
  inputParams: ActionParam[];
  outputParams: ActionParam[];
}

const ACTION_FIELDS = `
  id workspaceId name type subtype subtypeLabel
  connectionId connectionName connectionAction content target targetName
  emailTo emailCc emailSubject emailReplyTo
  url method headers
  functionId functionName mappings { argument expression }
  conditionExpression conditionId conditionName timeoutSeconds retryIntervalSeconds durationSeconds
  icon
  inputParams { name type display }
  outputParams { name type display }
`;

const WORKSPACE_ACTIONS_QUERY = `
  query WorkspaceActions($workspaceId: ID!, $page: Int!, $size: Int!) {
    workspaceActions(workspaceId: $workspaceId, page: $page, size: $size) {
      content { ${ACTION_FIELDS} }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const CREATE_ACTION_MUTATION = `
  mutation CreateAction($input: CreateActionInput!) {
    createAction(input: $input) { ${ACTION_FIELDS} }
  }
`;

const UPDATE_ACTION_MUTATION = `
  mutation UpdateAction($id: ID!, $input: UpdateActionInput!) {
    updateAction(id: $id, input: $input) { ${ACTION_FIELDS} }
  }
`;

const DELETE_ACTION_MUTATION = `
  mutation DeleteAction($id: ID!) {
    deleteAction(id: $id)
  }
`;

const ACTION_QUERY = `
  query Action($id: ID!) {
    action(id: $id) { ${ACTION_FIELDS} }
  }
`;

/** One action by id — what a link from a run opens. */
export async function fetchAction(id: string): Promise<Action | null> {
  const data = await graphql<{ action: Action | null }>(ACTION_QUERY, { id });
  return data.action;
}

/** `page` is 0-based, matching the server. */
export async function fetchWorkspaceActions(workspaceId: string, page: number, size: number): Promise<PageOf<Action>> {
  const data = await graphql<{ workspaceActions: PageOf<Action> }>(WORKSPACE_ACTIONS_QUERY, { workspaceId, page, size });
  return data.workspaceActions;
}

export interface ActionInput {
  name: string;
  subtype: ActionSubtype;
  connectionId?: string | null;
  connectionAction?: ConnectionActionKind | null;
  content?: string | null;
  target?: MessageTarget | null;
  targetName?: string | null;
  emailTo?: string | null;
  emailCc?: string | null;
  emailSubject?: string | null;
  emailReplyTo?: string | null;
  url?: string | null;
  method?: string | null;
  headers?: string | null;
  functionId?: string | null;
  mappings?: ArgumentMapping[];
  conditionExpression?: string | null;
  conditionId?: string | null;
  timeoutSeconds?: number | null;
  retryIntervalSeconds?: number | null;
  durationSeconds?: number | null;
}

export async function createAction(
  input: ActionInput & { workspaceId: string; type: ActionType },
): Promise<Action> {
  const data = await graphql<{ createAction: Action }>(CREATE_ACTION_MUTATION, { input });
  return data.createAction;
}

/** The type is what an action is, so only the settings under it can change. */
export async function updateAction(id: string, input: ActionInput): Promise<Action> {
  const data = await graphql<{ updateAction: Action }>(UPDATE_ACTION_MUTATION, { id, input });
  return data.updateAction;
}

export async function deleteAction(id: string): Promise<boolean> {
  const data = await graphql<{ deleteAction: boolean }>(DELETE_ACTION_MUTATION, { id });
  return data.deleteAction;
}

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  EXECUTE: 'Execute',
  WAIT: 'Wait',
};

/** Which subtypes an action of each type can be, in the order the form offers them. */
export const SUBTYPES_BY_TYPE: Record<ActionType, ActionSubtype[]> = {
  EXECUTE: ['OUTGOING_CONNECTION', 'SEND_EMAIL', 'HTTP_REQUEST', 'FUNCTION'],
  WAIT: ['INLINE_CONDITION', 'CONDITION', 'TIME'],
};

export const ACTION_SUBTYPE_LABEL: Record<ActionSubtype, string> = {
  OUTGOING_CONNECTION: 'Outgoing Connection',
  SEND_EMAIL: 'Send Email',
  HTTP_REQUEST: 'HTTP Request',
  FUNCTION: 'Function',
  INLINE_CONDITION: 'Inline Condition',
  CONDITION: 'Condition',
  TIME: 'Time',
};

/**
 * What can be picked, which is what the server actually does.
 *
 * Issues are missing on purpose. `ActionNodeRunner.send` never looks at which
 * connection action was chosen — it sends a Slack message whatever it says — so
 * offering "Create Issue" was offering something that quietly did something else.
 * The values stay in the type and in the labels below, because rows created while
 * they were on offer still have to read as what they are.
 *
 * Put them back when the runner branches on them and something can create an issue.
 */
export const CONNECTION_ACTIONS: ConnectionActionKind[] = ['SEND_MESSAGE', 'REPLY_IN_THREAD'];

export const CONNECTION_ACTION_LABEL: Record<ConnectionActionKind, string> = {
  SEND_MESSAGE: 'Send Message',
  REPLY_IN_THREAD: 'Reply in Thread',
  CREATE_ISSUE: 'Create Issue',
  UPDATE_ISSUE: 'Update Issue',
};

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** "message: string, channel: string", or an em dash when there are none. */
export function paramSummary(params: ActionParam[]): string {
  return params.length === 0 ? '—' : params.map((param) => param.display).join(', ');
}
