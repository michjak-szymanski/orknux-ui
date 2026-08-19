import { graphql } from './client';

/** Where an issue is in its life. Two states; a third would need a reason. */
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

/** What a list is ordered by, in the words the server uses. */
export type IssueOrder = 'NUMBER' | 'TITLE' | 'UPDATED' | 'LAST_COMMENT';

/** What each state is called where somebody reads it. */
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  CLOSED: 'Closed',
};

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

/**
 * A file on an issue, or on a comment.
 *
 * The same storage the chat's attachments use, and the same switch governs both
 * - which is why the size and the type read the same way here. What differs is
 * only where it hangs: an issue, or one thing said about it.
 */
export interface IssueAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  /** Whether the person reading this attached it, and so may remove it. */
  mine: boolean;
}

/**
 * A web address hung on an issue.
 *
 * Three things to show it by, in order: what somebody called it, what GitHub
 * would call it, and failing both the address itself. The server works the
 * middle one out from the shape of the address alone and never asks GitHub
 * anything, so `github` means "this is shaped like pull request 12" rather than
 * "pull request 12 exists".
 */
export interface IssueLink {
  id: string;
  url: string;
  /** What whoever added it called it, or null when they let the address speak. */
  title: string | null;
  /** `owner/repo`, `owner/repo#12`, `owner/repo@abc1234`, or null when it is not GitHub's. */
  github: string | null;
  addedBy: string;
  addedAt: string;
  /** Whether the person reading this added it, and so may remove it. */
  mine: boolean;
}

/**
 * Somebody who asked to hear about an issue without being given it.
 *
 * A person or an agent; never a model, which has nowhere to read its news.
 * Only the ones explicitly added - the reporter and the assignee already hear
 * about everything and are shown in their own places on the page.
 */
export interface IssueObserver {
  kind: AssigneeKind;
  id: string;
  name: string;
  /** The second line: a username, or what kind of thing it is. */
  hint: string;
  /** Themselves, in the ordinary case, or the administrator who decided. */
  addedBy: string;
  addedAt: string;
  /** Whether this is the person reading, so the page knows which button to draw. */
  mine: boolean;
}

export interface IssueComment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  /** Null until somebody changes it. */
  editedAt: string | null;
  /** What came with it. */
  attachments: IssueAttachment[];
  /** Whether the person reading this wrote it, and so may change it. */
  mine: boolean;
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
  /** What is on the issue itself; a comment's files are on the comment. */
  attachments: IssueAttachment[];
  /** Addresses hung on the issue, oldest first. */
  links: IssueLink[];
  /** Whoever asked to hear about it, oldest first. */
  observers: IssueObserver[];
  comments: IssueComment[];
  createdAt: string;
  lastModifiedAt: string;
  /** When somebody last said something here, or null if nobody has. */
  lastCommentAt: string | null;
  lastModifiedBy: string;
}

export interface IssuePage {
  totalElements: number;
  content: Issue[];
}

/**
 * What kind of change one line in an issue's history is.
 *
 * Five of these are recorded when they happen; OPENED is read off the issue
 * itself and COMMENT off its comments, because both were already kept
 * faithfully and a second copy of a comment goes stale the moment somebody
 * edits it.
 */
export type IssueEventKind =
  | 'OPENED'
  | 'RECORDING'
  | 'STATUS'
  | 'LABEL'
  | 'ASSIGNEE'
  | 'OBSERVER'
  | 'COMMENT';

export interface IssueEvent {
  /** Unique across all three sources: an event and a comment can both be row 5. */
  id: string;
  kind: IssueEventKind;
  /** Who did it. Every entry names somebody. */
  actor: string;
  at: string;
  /** What it was: the old status, who it was taken from, the label removed. */
  was: string | null;
  /** What it became: the new status, who it went to, the label added. */
  became: string | null;
  /** What a comment said, shortened. Null for everything that is not one. */
  said: string | null;
  /** Whether that comment has been changed since it was written. */
  edited: boolean;
  /** Which comment it is, so the page can go and show it in full. */
  commentId: string | null;
}

export interface IssueHistory {
  /** Oldest first. */
  entries: IssueEvent[];
  /** How many older entries were not returned. */
  earlier: number;
}

/**
 * What happened to one issue.
 *
 * Its own query rather than a field on the issue, and asked for only when the
 * tab is opened: the issue page is loaded by everybody who reads a report, and
 * the history is read by the few who want to know how it got here.
 */
export async function fetchIssueHistory(
  workspaceId: string,
  number: number,
  limit?: number,
): Promise<IssueHistory | null> {
  const data = await graphql<{ issueHistory: IssueHistory | null }>(
    `query ($workspaceId: ID!, $number: Int!, $limit: Int) {
       issueHistory(workspaceId: $workspaceId, number: $number, limit: $limit) {
         earlier
         entries { id kind actor at was became said edited commentId }
       }
     }`,
    { workspaceId, number, limit: limit ?? null },
  );
  return data.issueHistory;
}

/**
 * A row's worth, without the comments.
 *
 * The list shows what an issue is, not what was said about it, and fetching
 * every comment of every issue to draw twenty rows is a page that gets slower
 * the more the tracker is used.
 */
const ROW_FIELDS =
  'id workspaceId number title status reporter assignee { kind id name hint } labels createdAt lastModifiedAt lastCommentAt lastModifiedBy';

const ATTACHMENT_FIELDS = 'id filename contentType sizeBytes uploadedBy uploadedAt mine';

const LINK_FIELDS = 'id url title github addedBy addedAt mine';

const OBSERVER_FIELDS = 'kind id name hint addedBy addedAt mine';

const FULL_FIELDS = `
  id workspaceId number title description status reporter
  assignee { kind id name hint }
  labels
  attachments { ${ATTACHMENT_FIELDS} }
  links { ${LINK_FIELDS} }
  observers { ${OBSERVER_FIELDS} }
  comments { id author content createdAt editedAt mine attachments { ${ATTACHMENT_FIELDS} } }
  createdAt lastModifiedAt lastCommentAt lastModifiedBy
`;

export async function fetchIssues(
  workspaceId: string,
  options: {
    status?: IssueStatus;
    search?: string;
    page?: number;
    size?: number;
    order?: IssueOrder;
    ascending?: boolean;
  } = {},
): Promise<IssuePage> {
  const data = await graphql<{ workspaceIssues: IssuePage }>(
    `query ($workspaceId: ID!, $status: IssueStatus, $search: String, $page: Int, $size: Int,
            $order: IssueOrder, $ascending: Boolean) {
       workspaceIssues(workspaceId: $workspaceId, status: $status, search: $search, page: $page, size: $size,
                       order: $order, ascending: $ascending) {
         totalElements
         content { ${ROW_FIELDS} }
       }
     }`,
    {
      workspaceId,
      status: options.status ?? null,
      order: options.order ?? null,
      ascending: options.ascending ?? null,
      search: options.search || null,
      page: options.page ?? 0,
      size: options.size ?? 20,
    },
  );
  return data.workspaceIssues;
}

/**
  * One issue, by the number people say.
  *
  * Not by its row id. "#4" is what the page shows and what somebody types in a
  * message, so it is what the address carries - an address holding the id
  * instead showed `/issues/17` above a page titled `#15`.
  */
export async function fetchIssue(workspaceId: string, number: number): Promise<Issue | null> {
  const data = await graphql<{ workspaceIssue: Issue | null }>(
    `query ($workspaceId: ID!, $number: Int!) {
       workspaceIssue(workspaceId: $workspaceId, number: $number) { ${FULL_FIELDS} }
     }`,
    { workspaceId, number },
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

export async function editIssueComment(id: string, content: string): Promise<Issue> {
  const data = await graphql<{ editIssueComment: Issue }>(
    `mutation ($id: ID!, $content: String!) { editIssueComment(id: $id, content: $content) { ${FULL_FIELDS} } }`,
    { id, content },
  );
  return data.editIssueComment;
}

export async function commentOnIssue(
  id: string,
  content: string,
  attachmentIds: string[] = [],
): Promise<Issue> {
  const data = await graphql<{ commentOnIssue: Issue }>(
    `mutation ($id: ID!, $content: String!, $attachmentIds: [ID!]) {
       commentOnIssue(id: $id, content: $content, attachmentIds: $attachmentIds) { ${FULL_FIELDS} }
     }`,
    { id, content, attachmentIds },
  );
  return data.commentOnIssue;
}

/**
 * Uploads files against the workspace, before there is anything to hang them on.
 *
 * REST, because what crosses is bytes: a multipart form is what a browser makes
 * of a file picker. Uploaded as they are picked rather than when the issue is
 * saved, so a large screenshot travels while the report is still being written -
 * which is also why the answer has to be tied to something afterwards.
 */
export async function uploadIssueAttachments(
  workspaceId: string,
  files: File[],
): Promise<IssueAttachment[]> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file, file.name));

  const answer = await fetch(`/api/workspaces/${workspaceId}/issue-attachments`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  const said = (await answer.json().catch(() => null)) as
    | { attachments?: IssueAttachment[]; error?: string; message?: string }
    | null;
  if (!answer.ok) {
    throw new Error(said?.error ?? said?.message ?? 'Those files could not be uploaded.');
  }
  return said?.attachments ?? [];
}

/** Says which issue the uploaded files belong to; sent once it has been filed. */
export async function attachToIssue(id: string, attachmentIds: string[]): Promise<Issue> {
  const data = await graphql<{ attachToIssue: Issue }>(
    `mutation ($id: ID!, $attachmentIds: [ID!]!) {
       attachToIssue(id: $id, attachmentIds: $attachmentIds) { ${FULL_FIELDS} }
     }`,
    { id, attachmentIds },
  );
  return data.attachToIssue;
}

/** Takes one off again. Only whoever attached it may, administrators included. */
export async function removeIssueAttachment(id: string): Promise<boolean> {
  const data = await graphql<{ removeIssueAttachment: boolean }>(
    `mutation ($id: ID!) { removeIssueAttachment(id: $id) }`,
    { id },
  );
  return data.removeIssueAttachment;
}

/**
 * Hangs an address on an issue.
 *
 * Refused by the server unless it is http or https - a link is rendered as an
 * anchor on a page other people click, and the check is there rather than here
 * so that it holds for anything else that ever writes one.
 */
export async function addIssueLink(id: string, url: string, title?: string): Promise<Issue> {
  const data = await graphql<{ addIssueLink: Issue }>(
    `mutation ($id: ID!, $url: String!, $title: String) {
       addIssueLink(id: $id, url: $url, title: $title) { ${FULL_FIELDS} }
     }`,
    { id, url, title: title?.trim() || null },
  );
  return data.addIssueLink;
}

/**
 * Moves an issue to another workspace. Administrators only.
 *
 * Its number changes, because numbers are per workspace: it is given one that
 * is free where it is going, and the one it had is free for the next issue
 * filed where it came from. So the answer carries the whole issue rather than a
 * confirmation, and the page has to go to the new address rather than reload
 * the old one - which now belongs to nothing, or to something else.
 *
 * The server refuses rather than tidies where something on the issue could not
 * exist in the destination, and says which thing. That message is worth putting
 * in front of somebody unchanged.
 */
export async function moveIssue(id: string, workspaceId: string): Promise<Issue> {
  const data = await graphql<{ moveIssue: Issue }>(
    `mutation ($id: ID!, $workspaceId: ID!) {
       moveIssue(id: $id, workspaceId: $workspaceId) { ${FULL_FIELDS} }
     }`,
    { id, workspaceId },
  );
  return data.moveIssue;
}

/** Takes one off again. Only whoever added it may, administrators included. */
export async function removeIssueLink(id: string): Promise<boolean> {
  const data = await graphql<{ removeIssueLink: boolean }>(
    `mutation ($id: ID!) { removeIssueLink(id: $id) }`,
    { id },
  );
  return data.removeIssueLink;
}

/**
 * Asks to hear about an issue, or asks on somebody else's behalf.
 *
 * Nobody named means yourself, which anybody in the workspace may do; naming
 * somebody else needs the administrator role. One mutation for both, because
 * two would be the same two rules written twice.
 */
export async function observeIssue(
  id: string,
  observer?: { kind: AssigneeKind; id: string },
): Promise<Issue> {
  const data = await graphql<{ observeIssue: Issue }>(
    `mutation ($id: ID!, $observerKind: AssigneeKind, $observerId: ID) {
       observeIssue(id: $id, observerKind: $observerKind, observerId: $observerId) { ${FULL_FIELDS} }
     }`,
    { id, observerKind: observer?.kind ?? null, observerId: observer?.id ?? null },
  );
  return data.observeIssue;
}

/** Takes one off again, under the same two rules. */
export async function unobserveIssue(
  id: string,
  observer?: { kind: AssigneeKind; id: string },
): Promise<Issue> {
  const data = await graphql<{ unobserveIssue: Issue }>(
    `mutation ($id: ID!, $observerKind: AssigneeKind, $observerId: ID) {
       unobserveIssue(id: $id, observerKind: $observerKind, observerId: $observerId) { ${FULL_FIELDS} }
     }`,
    { id, observerKind: observer?.kind ?? null, observerId: observer?.id ?? null },
  );
  return data.unobserveIssue;
}

/** Where the browser reads one from; checked against the workspace on the way. */
export function issueAttachmentUrl(id: string): string {
  return `/api/issue-attachments/${id}`;
}

/** What each kind is called where one is shown beside a name. */
export const ASSIGNEE_KIND_LABEL: Record<AssigneeKind, string> = {
  USER: 'User',
  AGENT: 'Agent',
  MODEL: 'Model',
};
