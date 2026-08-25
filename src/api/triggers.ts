import { graphql } from './client';
import type { PageOf } from './client';
import { t } from '../i18n';

/** What kind of event a trigger definition waits for. */
export type TriggerType = 'INCOMING_CONNECTION' | 'SCHEDULED' | 'WEBHOOK';

/**
 * How a webhook decides whether its caller may start anything.
 *
 * `NONE` is open: knowing the path and the shape is enough. `FUNCTION` asks one
 * of the workspace's functions, which answers yes or no — and can check a
 * signature against a variable without the secret leaving the sandbox.
 */
export type WebhookAuthType = 'NONE' | 'FUNCTION';

/** The event on a connection that starts the workflow. */
export type TriggerAction = 'MENTION' | 'REPLY' | 'MESSAGE' | 'ISSUE_CREATED' | 'ISSUE_UPDATED';

/**
 * One entry in the workspace's trigger catalogue. It names no workflow: a workflow
 * instances it by pointing a trigger node at it, in the editor.
 */
/** What became of one firing. */
export type FiringOutcome =
  | 'STARTED'
  | 'NO_INSTANCE'
  | 'UNAUTHENTICATED'
  | 'CONDITION_DID_NOT_HOLD'
  | 'UNDECIDED'
  | 'FAILED'
  | 'WORKFLOW_DISABLED'
  | 'NOT_WATCHED';

export interface TriggerFiring {
  id: string;
  at: string;
  outcome: FiringOutcome;
  detail: string | null;
  runsStarted: number;
  /** Which trigger did it; null in a list that is one trigger's own. */
  triggerId?: string | null;
  triggerName?: string | null;
}

/** Said in the words the screen uses, so a row explains itself. */
export const FIRING_OUTCOME_LABEL: Record<FiringOutcome, string> = {
  STARTED: 'Started',
  NO_INSTANCE: t('Nothing instances it'),
  CONDITION_DID_NOT_HOLD: t('Condition said no'),
  UNDECIDED: t('Could not decide'),
  FAILED: 'Failed',
  UNAUTHENTICATED: t('Not authenticated'),
  WORKFLOW_DISABLED: t('Workflow switched off'),
  NOT_WATCHED: t('Not a watched bot'),
};

export interface Trigger {
  id: string;
  workspaceId: string;
  name: string;
  type: TriggerType;
  connectionId: string | null;
  /**
   * Whose messages a `REPLY` watches for replies to; empty on every other event.
   *
   * Not the connection it listens on. That one is the socket - the Slack app
   * whose app-level token this installation receives events over. These are the
   * bot tokens whose own messages count as a thread's parent.
   */
  watchedConnectionIds: string[];
  action: TriggerAction | null;
  cron: string | null;
  timezone: string | null;
  /** JSON object handed to the runs this starts; null when it says nothing. */
  payload: string | null;
  /** Asked of the event before anything starts; null fires on everything. */
  conditionId: string | null;
  /** The condition's name, for the list. */
  conditionName: string | null;
  /** The most recent thing this trigger did; null when it has never been asked. */
  lastFiring: TriggerFiring | null;
  enabled: boolean;
  /** Where the event comes from, ready to show: the connection, or "Cron". */
  source: string;
  /** What the event is, ready to show: "Mention", or the cron expression. */
  event: string;
  /** Which icon a node drawn from this starts with; null draws the kind's own. */
  icon: string | null;
  /** Where a webhook answers, relative to this installation: `build/finished`. */
  webhookPath: string | null;
  /** The shape a webhook's request has to have; anything else is answered 404. */
  objectId: string | null;
  /** What that shape is called, for the list. */
  objectName: string | null;
  /** How a webhook decides whether its caller may start anything. */
  authType: WebhookAuthType;
  authFunctionId: string | null;
  authFunctionName: string | null;
}

const TRIGGER_FIELDS =
  `id workspaceId name type connectionId action watchedConnectionIds cron timezone payload conditionId conditionName enabled source event icon webhookPath objectId objectName authType authFunctionId authFunctionName
   lastFiring { id at outcome detail runsStarted }`;

const WORKSPACE_TRIGGERS_QUERY = `
  query WorkspaceTriggers($workspaceId: ID!, $page: Int!, $size: Int!) {
    workspaceTriggers(workspaceId: $workspaceId, page: $page, size: $size) {
      content { ${TRIGGER_FIELDS} }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const CREATE_TRIGGER_MUTATION = `
  mutation CreateTrigger($input: CreateTriggerInput!) {
    createTrigger(input: $input) { ${TRIGGER_FIELDS} }
  }
`;

const UPDATE_TRIGGER_MUTATION = `
  mutation UpdateTrigger($id: ID!, $input: UpdateTriggerInput!) {
    updateTrigger(id: $id, input: $input) { ${TRIGGER_FIELDS} }
  }
`;

const SET_ENABLED_MUTATION = `
  mutation SetTriggerEnabled($id: ID!, $enabled: Boolean!) {
    setTriggerEnabled(id: $id, enabled: $enabled) { ${TRIGGER_FIELDS} }
  }
`;

const DELETE_TRIGGER_MUTATION = `
  mutation DeleteTrigger($id: ID!) {
    deleteTrigger(id: $id)
  }
`;

/** `page` is 0-based, matching the server. */
export async function fetchWorkspaceTriggers(workspaceId: string, page: number, size: number): Promise<PageOf<Trigger>> {
  const data = await graphql<{ workspaceTriggers: PageOf<Trigger> }>(WORKSPACE_TRIGGERS_QUERY, { workspaceId, page, size });
  return data.workspaceTriggers;
}

/**
 * One trigger, by id. What a link from a workflow node opens: the definition may
 * be on any page of the list, so the page it is on is not worth working out.
 */
export async function fetchTrigger(id: string): Promise<Trigger | null> {
  const data = await graphql<{ trigger: Trigger | null }>(
    `query TriggerById($id: ID!) { trigger(id: $id) { ${TRIGGER_FIELDS} } }`,
    { id },
  );
  return data.trigger;
}

export interface CreateTriggerInput {
  workspaceId: string;
  name: string;
  type: TriggerType;
  connectionId?: string;
  action?: TriggerAction;
  /** Whose messages a `REPLY` watches for replies to. Required on one, ignored otherwise. */
  watchedConnectionIds?: string[];
  cron?: string;
  timezone?: string;
  /** JSON object handed to the runs this starts. */
  payload?: string;
  /** Asked before anything starts; null asks nothing. */
  conditionId?: string | null;
  /** Where a webhook answers, relative to this installation. */
  webhookPath?: string;
  /** The shape a webhook's request has to have; null takes the contract off. */
  objectId?: string | null;
  authType?: WebhookAuthType;
  /** The function that authenticates a caller; null when nothing does. */
  authFunctionId?: string | null;
  /** Whether it fires at all; omitted makes one that does. */
  enabled?: boolean;
}

export async function createTrigger(input: CreateTriggerInput): Promise<Trigger> {
  const data = await graphql<{ createTrigger: Trigger }>(CREATE_TRIGGER_MUTATION, { input });
  return data.createTrigger;
}

export async function updateTrigger(
  id: string,
  input: {
    name: string;
    connectionId?: string;
    action?: TriggerAction;
    /** Whose messages a `REPLY` watches; omitted or empty watches nobody. */
    watchedConnectionIds?: string[];
    cron?: string;
    timezone?: string;
    payload?: string;
    /** Null takes the condition off, so the form can stop asking. */
    conditionId?: string | null;
    icon?: string | null;
    /** Where a webhook answers, relative to this installation. */
    webhookPath?: string;
    /** The shape a webhook's request has to have; null takes the contract off. */
    objectId?: string | null;
    authType?: WebhookAuthType;
    /** The function that authenticates a caller; null when nothing does. */
    authFunctionId?: string | null;
    /** Whether it fires at all; omitted leaves it as it stands. */
    enabled?: boolean;
  },
): Promise<Trigger> {
  const data = await graphql<{ updateTrigger: Trigger }>(UPDATE_TRIGGER_MUTATION, { id, input });
  return data.updateTrigger;
}

/**
 * What this trigger has done, newest first — including the firings no run came
 * of, which is the reason the log exists.
 */
export async function fetchTriggerFirings(
  triggerId: string,
  page = 0,
  size = 20,
): Promise<PageOf<TriggerFiring>> {
  const data = await graphql<{ triggerFirings: PageOf<TriggerFiring> }>(
    `query TriggerFirings($triggerId: ID!, $page: Int!, $size: Int!) {
       triggerFirings(triggerId: $triggerId, page: $page, size: $size) {
         content { id at outcome detail runsStarted }
         page size totalElements totalPages
       }
     }`,
    { triggerId, page, size },
  );
  return data.triggerFirings;
}

/**
 * What every trigger in the workspace has done, newest first.
 *
 * The same entries a trigger's own log holds, read the other way round: not
 * "what did this one do" but "what has happened here", which is the question
 * somebody has when a workflow did not run and they do not know whose fault
 * that was.
 */
export async function fetchWorkspaceTriggerFirings(
  workspaceId: string,
  page = 0,
  size = 20,
): Promise<PageOf<TriggerFiring>> {
  const data = await graphql<{ workspaceTriggerFirings: PageOf<TriggerFiring> }>(
    `query WorkspaceTriggerFirings($workspaceId: ID!, $page: Int!, $size: Int!) {
       workspaceTriggerFirings(workspaceId: $workspaceId, page: $page, size: $size) {
         content { id at outcome detail runsStarted triggerId triggerName }
         page size totalElements totalPages
       }
     }`,
    { workspaceId, page, size },
  );
  return data.workspaceTriggerFirings;
}

export async function setTriggerEnabled(id: string, enabled: boolean): Promise<Trigger> {
  const data = await graphql<{ setTriggerEnabled: Trigger }>(SET_ENABLED_MUTATION, { id, enabled });
  return data.setTriggerEnabled;
}

export async function deleteTrigger(id: string): Promise<boolean> {
  const data = await graphql<{ deleteTrigger: boolean }>(DELETE_TRIGGER_MUTATION, { id });
  return data.deleteTrigger;
}

/** "INCOMING_CONNECTION" -> "Connection", as the table shows it. */
export const TRIGGER_TYPE_LABEL: Record<TriggerType, string> = {
  INCOMING_CONNECTION: 'Connection',
  SCHEDULED: 'Scheduled',
  WEBHOOK: 'Webhook',
};

/**
 * The whole vocabulary, which is not the same as what is wired: only some of
 * these have anything publishing them. The form asks the server which ones it
 * can actually deliver — see `fetchSupportedTriggerActions` — so nobody
 * configures a trigger that is enabled, instanced and silent for ever. This list
 * is only the order they are offered in.
 */
export const TRIGGER_ACTIONS: TriggerAction[] = [
  'MENTION',
  'REPLY',
  'MESSAGE',
  'ISSUE_CREATED',
  'ISSUE_UPDATED',
];

/** What this installation can actually deliver today. */
export async function fetchSupportedTriggerActions(): Promise<TriggerAction[]> {
  const data = await graphql<{ supportedTriggerActions: TriggerAction[] }>(
    `query SupportedTriggerActions { supportedTriggerActions }`,
    {},
  );
  return data.supportedTriggerActions;
}

/** Whether a connection's bot token was able to say which Slack user it posts as. */
export type SlackBotUserOutcome = 'FOUND' | 'UNCHECKED';

/**
 * Which Slack user one of the workspace's Slack connections posts as.
 *
 * A bot token is a Slack user, which is why a reply trigger picks connections
 * and matches user ids. Two connections holding the same token are one Slack
 * user twice over and cannot be told apart by anything on an arriving event, so
 * `message` says so rather than leaving two rows to imply otherwise.
 */
export interface SlackBotUser {
  connectionId: string;
  name: string;
  outcome: SlackBotUserOutcome;
  /** One line, ready to draw, and empty when there is nothing worth saying. */
  message: string;
  /** Slack's own id, what `parent_user_id` is matched against, when it was found. */
  userId: string | null;
  /** What Slack calls that user: "@orknux". */
  handle: string | null;
  /** Whether the token can receive messages at all; null where Slack did not say. */
  receives: boolean | null;
}

/**
 * Which Slack user each of the workspace's Slack connections posts as.
 *
 * What the "whose messages does this watch" picker draws. It never fails: a
 * connection whose token could not be asked comes back `UNCHECKED` with one line
 * saying why, rather than being left out of the list.
 */
export async function fetchSlackBotUsers(workspaceId: string): Promise<SlackBotUser[]> {
  const data = await graphql<{ slackBotUsers: SlackBotUser[] }>(
    `query SlackBotUsers($workspaceId: ID!) {
       slackBotUsers(workspaceId: $workspaceId) {
         connectionId name outcome message userId handle receives
       }
     }`,
    { workspaceId },
  );
  return data.slackBotUsers;
}

/**
 * The events Slack only delivers to a token carrying a history scope.
 *
 * Two, and not "anything on a connection". A mention arrives as `app_mention`
 * and needs none of these, so a trigger waiting for one is perfectly healthy on
 * a token with no history scope at all — warning about it would send somebody
 * to widen a credential that is exactly right for what it is doing.
 */
const NEEDS_HISTORY: TriggerAction[] = ['MESSAGE', 'REPLY'];

/**
 * As much of a trigger as the question needs.
 *
 * Written as the three fields rather than as `Trigger` so that a half-filled
 * form can ask it about what is in its boxes right now, which is where somebody
 * is when the answer is still worth having.
 */
export interface IncomingEvent {
  type: TriggerType;
  action: TriggerAction | null;
  connectionId: string | null;
}

/**
 * The connection's own answer where it says this trigger can never fire, and
 * null everywhere else.
 *
 * **`receives === false`, never `!receives`.** Null is Slack having said
 * nothing about scopes at all — a response that carried no scope header has
 * reported no absence — and a warning drawn on it sends somebody to fix a token
 * that is fine. The field's comment on both sides says so; this is the line
 * that honours it.
 *
 * **The sentence comes back with it** rather than being written again here.
 * `SlackBotUser.message` already holds one, it is the one the Replies To rows
 * have always drawn, and a second wording is a wording that drifts from the
 * first the next time either is edited.
 */
export function cannotReceive(trigger: IncomingEvent, bots: SlackBotUser[]): SlackBotUser | null {
  if (!listensForMessages(trigger)) return null;
  const bot = bots.find((held) => held.connectionId === trigger.connectionId);
  return bot !== undefined && bot.receives === false ? bot : null;
}

/**
 * Whether this trigger waits for one of the events a history scope gates.
 *
 * Asked before the answer is there, by a list deciding whether the question is
 * worth a round trip at all: a page of schedules, webhooks and mentions has
 * nothing to learn from `slackBotUsers` and should not spend a call on it.
 */
export function listensForMessages(trigger: IncomingEvent): boolean {
  return (
    trigger.type === 'INCOMING_CONNECTION' &&
    trigger.connectionId !== null &&
    trigger.action !== null &&
    NEEDS_HISTORY.includes(trigger.action)
  );
}

export const TRIGGER_ACTION_LABEL: Record<TriggerAction, string> = {
  MENTION: 'Mention',
  REPLY: 'Reply',
  MESSAGE: 'Message',
  ISSUE_CREATED: t('Issue Created'),
  ISSUE_UPDATED: t('Issue Updated'),
};
