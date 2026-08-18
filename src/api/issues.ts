import { graphql } from './client';

/** Where an issue is in its life. Two states; a third would need a reason. */
export type IssueStatus = 'OPEN' | 'CLOSED';

/**
 * What kind of thing an issue is assigned to.
 *
 * A person is the obvious one and not the only one: this is a product where
 * the thing doing the work is often an agent.
 */
export type AssigneeKind = 'USER' | 'AGENT' | 'MODEL';

export interface Assignee {
  kind: AssigneeKind;
  id: string;
  name: string;
  /** The second line: a username, a provider, or what kind of thing it is. */
  hint: string;
}

export interface IssueComment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface Issue {
  id: string;
  workspaceId: string;
  /** Its number in this workspace: what "#3" means. */
  number: number;
  title: string;
  description: string | null;
  status: IssueStatus;
  reporter: string;
  assignee: Assignee | null;
  labels: string[];
  comments: IssueComment[];
  createdAt: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

export interface IssuePage {
  totalElements: number;
  content: Issue[];
}

/**
 * A row's worth, without the comments.
 *
 * The list shows what an issue is, not what was said about it, and fetching
 * every comment of every issue to draw twenty rows is a page that gets slower
 * the more the tracker is used.
 */
const ROW_FIELDS =
  'id workspaceId number title status reporter assignee { kind id name hint } labels lastModifiedAt lastModifiedBy';

const FULL_FIELDS = `
  id workspaceId number title description status reporter
  assignee { kind id name hint }
  labels
  comments { id author content createdAt }
  createdAt lastModifiedAt lastModifiedBy
`;

export async function fetchIssues(
  workspaceId: string,
  options: { status?: IssueStatus; search?: string; page?: number; size?: number } = {},
): Promise<IssuePage> {
  const data = await graphql<{ workspaceIssues: IssuePage }>(
    `query ($workspaceId: ID!, $status: IssueStatus, $search: String, $page: Int, $size: Int) {
       workspaceIssues(workspaceId: $workspaceId, status: $status, search: $search, page: $page, size: $size) {
         totalElements
         content { ${ROW_FIELDS} }
       }
     }`,
    {
      workspaceId,
      status: options.status ?? null,
      search: options.search || null,
      page: options.page ?? 0,
      size: options.size ?? 20,
    },
  );
  return data.workspaceIssues;
}

export async function fetchIssue(id: string): Promise<Issue | null> {
  const data = await graphql<{ workspaceIssue: Issue | null }>(
    `query ($id: ID!) { workspaceIssue(id: $id) { ${FULL_FIELDS} } }`,
    { id },
  );
  return data.workspaceIssue;
}

export async function fetchIssueLabels(workspaceId: string): Promise<string[]> {
  const data = await graphql<{ workspaceIssueLabels: string[] }>(
    `query ($workspaceId: ID!) { workspaceIssueLabels(workspaceId: $workspaceId) }`,
    { workspaceId },
  );
  return data.workspaceIssueLabels;
}

/** People, agents and models together: the box searches all three at once. */
export async function fetchAssignees(workspaceId: string, search?: string): Promise<Assignee[]> {
  const data = await graphql<{ issueAssignees: Assignee[] }>(
    `query ($workspaceId: ID!, $search: String) {
       issueAssignees(workspaceId: $workspaceId, search: $search) { kind id name hint }
     }`,
    { workspaceId, search: search || null },
  );
  return data.issueAssignees;
}

export interface IssueInput {
  workspaceId?: string;
  title?: string;
  /** Empty clears it; absent leaves it alone. */
  description?: string;
  status?: IssueStatus;
  labels?: string[];
  /** Both together, or neither. */
  assigneeKind?: AssigneeKind | null;
  assigneeId?: string | null;
}

export async function createIssue(input: IssueInput): Promise<Issue> {
  const data = await graphql<{ createIssue: Issue }>(
    `mutation ($input: IssueInput!) { createIssue(input: $input) { ${FULL_FIELDS} } }`,
    { input },
  );
  return data.createIssue;
}

export async function updateIssue(id: string, input: IssueInput): Promise<Issue> {
  const data = await graphql<{ updateIssue: Issue }>(
    `mutation ($id: ID!, $input: IssueInput!) { updateIssue(id: $id, input: $input) { ${FULL_FIELDS} } }`,
    { id, input },
  );
  return data.updateIssue;
}

export async function deleteIssue(id: string): Promise<boolean> {
  const data = await graphql<{ deleteIssue: boolean }>(
    `mutation ($id: ID!) { deleteIssue(id: $id) }`,
    { id },
  );
  return data.deleteIssue;
}

export async function commentOnIssue(id: string, content: string): Promise<Issue> {
  const data = await graphql<{ commentOnIssue: Issue }>(
    `mutation ($id: ID!, $content: String!) { commentOnIssue(id: $id, content: $content) { ${FULL_FIELDS} } }`,
    { id, content },
  );
  return data.commentOnIssue;
}

/** What each kind is called where one is shown beside a name. */
export const ASSIGNEE_KIND_LABEL: Record<AssigneeKind, string> = {
  USER: 'User',
  AGENT: 'Agent',
  MODEL: 'Model',
};
