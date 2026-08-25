import { graphql } from './client';
import type { PageOf } from './client';
import { t } from '../i18n';

/** What a condition asks about. */
export type ConditionType = 'SLACK' | 'JIRA' | 'TIME' | 'FUNCTION' | 'ANY_OF' | 'ALL_OF';

export type ConditionProperty =
  | 'MESSAGE_AUTHOR'
  | 'MESSAGE_CHANNEL'
  | 'MESSAGE_TEXT'
  | 'ISSUE_PRIORITY'
  | 'ISSUE_STATUS'
  | 'ISSUE_TYPE'
  | 'CURRENT_TIME';

export type ConditionCheck = 'IN_LIST' | 'EQUALS' | 'CONTAINS' | 'MATCHES' | 'BETWEEN' | 'WORKSPACEMATE';

export interface Condition {
  id: string;
  workspaceId: string;
  name: string;
  type: ConditionType;
  typeLabel: string;
  property: ConditionProperty | null;
  check: ConditionCheck | null;
  negate: boolean;
  functionId: string | null;
  functionName: string | null;
  values: string[];
  members: string[];
  memberNames: string[];
  /** What it asks, in words; the server reads it off the definition. */
  description: string;
  /** Which icon a node drawn from this starts with; null draws the kind's own. */
  icon: string | null;
}

const CONDITION_FIELDS = `
  id workspaceId name type typeLabel property check negate
  functionId functionName values members memberNames description icon
`;

const WORKSPACE_CONDITIONS_QUERY = `
  query WorkspaceConditions($workspaceId: ID!, $page: Int!, $size: Int!) {
    workspaceConditions(workspaceId: $workspaceId, page: $page, size: $size) {
      content { ${CONDITION_FIELDS} }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const CREATE_CONDITION_MUTATION = `
  mutation CreateCondition($input: CreateConditionInput!) {
    createCondition(input: $input) { ${CONDITION_FIELDS} }
  }
`;

const UPDATE_CONDITION_MUTATION = `
  mutation UpdateCondition($id: ID!, $input: UpdateConditionInput!) {
    updateCondition(id: $id, input: $input) { ${CONDITION_FIELDS} }
  }
`;

const DELETE_CONDITION_MUTATION = `
  mutation DeleteCondition($id: ID!) {
    deleteCondition(id: $id)
  }
`;

const CONDITION_QUERY = `
  query Condition($id: ID!) {
    condition(id: $id) { ${CONDITION_FIELDS} }
  }
`;

/** One condition by id — what a link from a run opens. */
export async function fetchCondition(id: string): Promise<Condition | null> {
  const data = await graphql<{ condition: Condition | null }>(CONDITION_QUERY, { id });
  return data.condition;
}

/** `page` is 0-based, matching the server. */
export async function fetchWorkspaceConditions(
  workspaceId: string,
  page: number,
  size: number,
): Promise<PageOf<Condition>> {
  const data = await graphql<{ workspaceConditions: PageOf<Condition> }>(WORKSPACE_CONDITIONS_QUERY, {
    workspaceId,
    page,
    size,
  });
  return data.workspaceConditions;
}

export interface ConditionInput {
  name: string;
  type: ConditionType;
  property?: ConditionProperty | null;
  check?: ConditionCheck | null;
  negate?: boolean;
  functionId?: string | null;
  values?: string[];
  members?: string[];
}

export async function createCondition(input: ConditionInput & { workspaceId: string }): Promise<Condition> {
  const data = await graphql<{ createCondition: Condition }>(CREATE_CONDITION_MUTATION, { input });
  return data.createCondition;
}

export async function updateCondition(id: string, input: ConditionInput): Promise<Condition> {
  const data = await graphql<{ updateCondition: Condition }>(UPDATE_CONDITION_MUTATION, { id, input });
  return data.updateCondition;
}

export async function deleteCondition(id: string): Promise<boolean> {
  const data = await graphql<{ deleteCondition: boolean }>(DELETE_CONDITION_MUTATION, { id });
  return data.deleteCondition;
}

/**
 * The types a condition may be offered as.
 *
 * JIRA is deliberately absent, for the same reason WORKSPACEMATE is below: it
 * asks about an issue's priority, status or type, and nothing in the product
 * delivers a Jira issue for it to read. There is no Jira trigger and no
 * incoming Jira connection, so the evaluator looks for a `priority` field on an
 * event that never arrives and the condition can only ever answer no. Offering
 * it meant offering a test that cannot be met.
 *
 * It stays in the type, the label and the properties, so a condition already
 * saved as one still opens, still reads, and still lists its own choices.
 */
export const CONDITION_TYPES: ConditionType[] = ['SLACK', 'TIME', 'FUNCTION', 'ANY_OF', 'ALL_OF'];

export const CONDITION_TYPE_LABEL: Record<ConditionType, string> = {
  SLACK: 'Slack',
  JIRA: 'Jira',
  TIME: 'Time',
  FUNCTION: 'Function',
  ANY_OF: t('Any Of'),
  ALL_OF: t('All Of'),
};

/** Which properties each type can ask about; the server enforces the same. */
export const PROPERTIES_BY_TYPE: Record<ConditionType, ConditionProperty[]> = {
  SLACK: ['MESSAGE_AUTHOR', 'MESSAGE_CHANNEL', 'MESSAGE_TEXT'],
  JIRA: ['ISSUE_PRIORITY', 'ISSUE_STATUS', 'ISSUE_TYPE'],
  TIME: ['CURRENT_TIME'],
  FUNCTION: [],
  ANY_OF: [],
  ALL_OF: [],
};

/**
 * Which checks make sense for a property.
 *
 * WORKSPACEMATE is deliberately absent. It promised a directory-membership test
 * and never performed one: the evaluator matched the author against a
 * hand-typed list, exactly as IN_LIST does. A real test needs something that
 * links a Slack user id like `U0BQE00FCJV` to a person in the workspace's
 * directory group, and nothing in the product does that yet. Offering it meant
 * offering a promise the code did not keep.
 *
 * The value stays in the type and on the server so conditions already saved with
 * it keep working; it is only withdrawn from the choices.
 */
export const CHECKS_BY_PROPERTY: Record<ConditionProperty, ConditionCheck[]> = {
  MESSAGE_AUTHOR: ['IN_LIST', 'EQUALS', 'MATCHES'],
  MESSAGE_CHANNEL: ['IN_LIST', 'EQUALS', 'MATCHES'],
  MESSAGE_TEXT: ['CONTAINS', 'MATCHES', 'EQUALS'],
  ISSUE_PRIORITY: ['IN_LIST', 'EQUALS'],
  ISSUE_STATUS: ['IN_LIST', 'EQUALS'],
  ISSUE_TYPE: ['IN_LIST', 'EQUALS'],
  CURRENT_TIME: ['BETWEEN'],
};

export const PROPERTY_LABEL: Record<ConditionProperty, string> = {
  MESSAGE_AUTHOR: t('Message Author'),
  MESSAGE_CHANNEL: t('Message Channel'),
  MESSAGE_TEXT: t('Message Text'),
  ISSUE_PRIORITY: t('Issue Priority'),
  ISSUE_STATUS: t('Issue Status'),
  ISSUE_TYPE: t('Issue Type'),
  CURRENT_TIME: t('Current Time'),
};

export const CHECK_LABEL: Record<ConditionCheck, string> = {
  IN_LIST: t('In List'),
  EQUALS: 'Equals',
  CONTAINS: 'Contains',
  MATCHES: 'Matches',
  BETWEEN: 'Between',
  WORKSPACEMATE: 'Workspacemate',
};

/** Whether the check needs a list of values, and what to call it. */
export function valuesLabel(check: ConditionCheck | null): string | null {
  switch (check) {
    case 'IN_LIST':
    case 'WORKSPACEMATE':
      return t('List Values');
    case 'EQUALS':
    case 'CONTAINS':
      return 'Value';
    case 'MATCHES':
      return 'Pattern';
    case 'BETWEEN':
      return t('From and until, as HH:mm');
    default:
      return null;
  }
}

export function composite(type: ConditionType): boolean {
  return type === 'ANY_OF' || type === 'ALL_OF';
}

/**
 * What a picker holds while a condition is being made rather than chosen.
 *
 * The same trick as NEW_FUNCTION, and for the same reason: a stored id is a
 * number the server printed, so a word can never collide with one. What it means
 * is the form's business - here it opens a Create Condition dialog on top of the
 * form, because a condition is more than a name and there is already a dialog
 * that asks for the rest.
 */
export const NEW_CONDITION = 'new';
