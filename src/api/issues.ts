import { graphql } from './client';
import { t } from '../i18n';

/** Where an issue is in its life. Two states; a third would need a reason. */
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

/** What a list is ordered by, in the words the server uses. */
export type IssueOrder = 'NUMBER' | 'TITLE' | 'UPDATED' | 'LAST_COMMENT' | 'TYPE';

/**
 * What kind of thing an issue is: a bug, a feature, or whatever else a
 * workspace decides it files.
 *
 * Not a label, and the difference is worth knowing before reading the pages
 * that draw both. A label is free text and a set, so an issue has as many as
 * somebody typed and a label exists only while an issue carries it. A type is
 * one row in the workspace's own list: exactly one per issue or none at all,
 * kept whether anything carries it or not, and renamed in one place.
 */
export interface IssueType {
  id: string;
  workspaceId: string;
  name: string;
  /** How many issues here carry it. Read by the settings card, and by nothing else. */
  issues: number;
}

/**
 * What the type filter is set to, as the list's own three states.
 *
 * `null` is every issue; `''` is the ones nobody has classified, which the
 * server also spells as an empty id; anything else is a type's id. Untyped is a
 * state somebody filters for and not the absence of a filter, which is why
 * there are three values here rather than two.
 */
export type IssueTypeFilter = string | null;

/** What each state is called where somebody reads it. */
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: t('In progress'),
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
 * What one issue has to do with another.
 *
 * Three relations and five names, because two of the three read differently
 * from each end: a link is one row on the server, and the same row is "blocks
 * #7" on one issue and "is blocked by #4" on the other. Which of the two this
 * page is looking at has already been decided by the time it arrives.
 */
export type IssueRelationKind =
  | 'RELATES_TO'
  | 'BLOCKS'
  | 'BLOCKED_BY'
  | 'DUPLICATES'
  | 'DUPLICATED_BY';

/** What each relation is called where it is read as a heading over the issue it names. */
export const ISSUE_RELATION_LABEL: Record<IssueRelationKind, string> = {
  RELATES_TO: t('Relates to'),
  BLOCKS: 'Blocks',
  BLOCKED_BY: t('Blocked by'),
  DUPLICATES: 'Duplicates',
  DUPLICATED_BY: t('Duplicated by'),
};

/**
 * The same five as the middle of a sentence about the issue reading them.
 *
 * "#7 is blocked by #4" rather than "#7 Blocked by #4". Two sets of words
 * because the two places they are read are different shapes: a heading over a
 * row of links names the relation, and a line in a history says what somebody
 * did.
 */
export const ISSUE_RELATION_READS: Record<IssueRelationKind, string> = {
  RELATES_TO: 'relates to',
  BLOCKS: 'blocks',
  BLOCKED_BY: 'is blocked by',
  DUPLICATES: 'duplicates',
  DUPLICATED_BY: 'is duplicated by',
};

/**
 * "is blocked by #4" from the "BLOCKED_BY #4" the server writes.
 *
 * The history and the news each have one text field to say what happened in,
 * and both carry the relation and the other issue's number in it. Read back in
 * one place so the bell and the history tab cannot phrase it differently.
 */
export function readRelation(said: string | null): string | null {
  if (said === null) return null;
  const at = said.indexOf(' ');
  if (at < 0) return null;
  const reads = ISSUE_RELATION_READS[said.slice(0, at) as IssueRelationKind];
  return reads === undefined ? null : `${reads} ${said.slice(at + 1)}`;
}

/**
 * The five as something to choose from, in the order they are offered.
 *
 * The cheap one first, because it is the honest answer far more often than a
 * link menu usually admits, and each directed pair kept together so that
 * picking the wrong end of one is a mistake made next to its correction.
 */
export const ISSUE_RELATION_KINDS: IssueRelationKind[] = [
  'RELATES_TO',
  'BLOCKS',
  'BLOCKED_BY',
  'DUPLICATES',
  'DUPLICATED_BY',
];

/**
 * Another issue this one is linked to, read from this one's side.
 *
 * The far issue's number, title and status come with it because the row is read
 * rather than clicked through: whether the thing blocking this one is closed is
 * the whole question somebody has when they see the word "blocked".
 */
export interface IssueRelation {
  /** The link's own id, which is what taking it off again needs. */
  id: string;
  kind: IssueRelationKind;
  /** The issue at the far end. */
  issueId: string;
  number: number;
  title: string;
  status: IssueStatus;
  linkedBy: string;
  linkedAt: string;
}

/** An issue as a row in the box that offers something to link to. */
export interface IssueRef {
  id: string;
  number: number;
  title: string;
  status: IssueStatus;
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
  /**
   * Whether they may take it off: whoever wrote it, or an administrator of the
   * workspace. Wider than `mine`, so it is the server's own answer rather than
   * something this page works out - the button and the refusal have to agree.
   */
  mayRemove: boolean;
}

export interface Issue {
  id: string;
  workspaceId: string;
  /** Its number in this workspace: what "#3" means. */
  number: number;
  title: string;
  description: string | null;
  status: IssueStatus;
  /** What kind of thing it is, or null for untyped - a real state, not a gap. */
  type: IssueType | null;
  reporter: string;
  assignee: Assignee | null;
  labels: string[];
  /** What is on the issue itself; a comment's files are on the comment. */
  attachments: IssueAttachment[];
  /** Addresses hung on the issue, oldest first. */
  links: IssueLink[];
  /** Other issues this one is linked to, oldest first, each read from this one's side. */
  related: IssueRelation[];
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
 * Six of these are recorded when they happen; OPENED is read off the issue
 * itself and COMMENT off its comments, because both were already kept
 * faithfully and a second copy of a comment goes stale the moment somebody
 * edits it.
 */
export type IssueEventKind =
  | 'OPENED'
  | 'RECORDING'
  | 'STATUS'
  | 'TYPE'
  | 'LABEL'
  | 'ASSIGNEE'
  | 'OBSERVER'
  | 'LINK'
  | 'COMMENT'
  /**
   * A comment was taken off, and this line is all that is left of it.
   *
   * `was` is who wrote it; what it said is deliberately nowhere. The one kind
   * here written because a row went away rather than because something changed.
   */
  | 'COMMENT_REMOVED';

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
  'id workspaceId number title status type { id workspaceId name issues } reporter ' +
  'assignee { kind id name hint } labels createdAt lastModifiedAt lastCommentAt lastModifiedBy';

const ATTACHMENT_FIELDS = 'id filename contentType sizeBytes uploadedBy uploadedAt mine';

const LINK_FIELDS = 'id url title github addedBy addedAt mine';

const OBSERVER_FIELDS = 'kind id name hint addedBy addedAt mine';

const RELATION_FIELDS = 'id kind issueId number title status linkedBy linkedAt';

const FULL_FIELDS = `
  id workspaceId number title description status reporter
  type { id workspaceId name issues }
  assignee { kind id name hint }
  labels
  attachments { ${ATTACHMENT_FIELDS} }
  links { ${LINK_FIELDS} }
  related { ${RELATION_FIELDS} }
  observers { ${OBSERVER_FIELDS} }
  comments { id author content createdAt editedAt mine mayRemove attachments { ${ATTACHMENT_FIELDS} } }
  createdAt lastModifiedAt lastCommentAt lastModifiedBy
`;

export async function fetchIssues(
  workspaceId: string,
  options: {
    status?: IssueStatus;
    /**
     * Which type. Absent is every issue; `''` is the untyped ones; an id is
     * that type. Passed through as it stands, because the server reads the
     * same three states off the same one argument.
     */
    typeId?: IssueTypeFilter;
    search?: string;
    page?: number;
    size?: number;
    order?: IssueOrder;
    ascending?: boolean;
  } = {},
): Promise<IssuePage> {
  const data = await graphql<{ workspaceIssues: IssuePage }>(
    `query ($workspaceId: ID!, $status: IssueStatus, $typeId: ID, $search: String, $page: Int, $size: Int,
            $order: IssueOrder, $ascending: Boolean) {
       workspaceIssues(workspaceId: $workspaceId, status: $status, typeId: $typeId, search: $search,
                       page: $page, size: $size, order: $order, ascending: $ascending) {
         totalElements
         content { ${ROW_FIELDS} }
       }
     }`,
    {
      workspaceId,
      status: options.status ?? null,
      typeId: options.typeId ?? null,
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

/**
 * The kinds of thing this workspace files, alphabetically.
 *
 * Its own read rather than a field on the workspace: the filter, the issue page
 * and the settings card all want it, and only the last of the three cares about
 * the counts it carries.
 */
export async function fetchIssueTypes(workspaceId: string): Promise<IssueType[]> {
  const data = await graphql<{ workspaceIssueTypes: IssueType[] }>(
    `query ($workspaceId: ID!) {
       workspaceIssueTypes(workspaceId: $workspaceId) { id workspaceId name issues }
     }`,
    { workspaceId },
  );
  return data.workspaceIssueTypes;
}

export async function createIssueType(workspaceId: string, name: string): Promise<IssueType> {
  const data = await graphql<{ createIssueType: IssueType }>(
    `mutation ($workspaceId: ID!, $name: String!) {
       createIssueType(workspaceId: $workspaceId, name: $name) { id workspaceId name issues }
     }`,
    { workspaceId, name },
  );
  return data.createIssueType;
}

export async function renameIssueType(id: string, name: string): Promise<IssueType> {
  const data = await graphql<{ renameIssueType: IssueType }>(
    `mutation ($id: ID!, $name: String!) {
       renameIssueType(id: $id, name: $name) { id workspaceId name issues }
     }`,
    { id, name },
  );
  return data.renameIssueType;
}

/** Refused while issues carry it; the refusal says how many, and is shown as it stands. */
export async function deleteIssueType(id: string): Promise<boolean> {
  const data = await graphql<{ deleteIssueType: boolean }>(
    `mutation ($id: ID!) { deleteIssueType(id: $id) }`,
    { id },
  );
  return data.deleteIssueType;
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
  /**
   * Which type. Empty is untyped, which is a state somebody chooses from the
   * picker; absent leaves it alone, the way an absent description does.
   */
  typeId?: string | null;
  labels?: string[];
  /**
   * Both together, or neither.
   *
   * Absent leaves the assignee alone, which is what a caller sending part of
   * the form means; an empty assigneeId is how "No one" is said, and is the
   * only way to clear one. An id without a kind is refused rather than
   * guessed at.
   */
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

/**
 * Takes a comment off an issue, for good.
 *
 * Whoever wrote it may, and so may an administrator of the workspace - which
 * the server answers on the comment as `mayRemove` rather than leaving this
 * page to guess. Nothing comes back but the issue without it: the row is gone,
 * its files are gone, and what is left is a line in the history saying a
 * comment was removed.
 */
export async function removeIssueComment(id: string): Promise<Issue> {
  const data = await graphql<{ removeIssueComment: Issue }>(
    `mutation ($id: ID!) { removeIssueComment(id: $id) { ${FULL_FIELDS} } }`,
    { id },
  );
  return data.removeIssueComment;
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
    throw new Error(said?.error ?? said?.message ?? t('Those files could not be uploaded.'));
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

/**
 * What this issue could be linked to, narrowed by what was typed.
 *
 * Asked of the server rather than filtered here, and asked about the number
 * first: issues are said out loud as numbers in this tracker, so `#124` has to
 * find #124 and not the eleven issues with 124 somewhere in their titles. What
 * is already linked, and the issue itself, are left out of the answer.
 */
export async function fetchIssuesToLink(id: string, search?: string): Promise<IssueRef[]> {
  const data = await graphql<{ issuesToLink: IssueRef[] }>(
    `query ($id: ID!, $search: String) {
       issuesToLink(id: $id, search: $search) { id number title status }
     }`,
    { id, search: search || null },
  );
  return data.issuesToLink;
}

/**
 * Says that this issue has something to do with another one.
 *
 * The relation is given as this issue reads it - "blocked by" is what somebody
 * picks on this page - and the server stores the single row that fact makes,
 * facing whichever way it stores such things. Both issues then show it, each
 * from its own side, which is why the answer is the whole issue.
 */
export async function relateIssue(
  id: string,
  otherId: string,
  kind: IssueRelationKind,
): Promise<Issue> {
  const data = await graphql<{ relateIssue: Issue }>(
    `mutation ($id: ID!, $otherId: ID!, $kind: IssueRelationKind!) {
       relateIssue(id: $id, otherId: $otherId, kind: $kind) { ${FULL_FIELDS} }
     }`,
    { id, otherId, kind },
  );
  return data.relateIssue;
}

/**
 * Takes a link between two issues off, from either end.
 *
 * Anybody who can see them, unlike an address or a file: a link is a claim
 * about both issues rather than something one person said, and the team at the
 * far end never made it.
 */
export async function unrelateIssue(id: string): Promise<boolean> {
  const data = await graphql<{ unrelateIssue: boolean }>(
    `mutation ($id: ID!) { unrelateIssue(id: $id) }`,
    { id },
  );
  return data.unrelateIssue;
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
