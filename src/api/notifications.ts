import { graphql } from './client';

/**
 * What kind of thing happened.
 *
 * Nearly all of them are about an issue. The last two are about a task, which is
 * why the subject on a notification is two nullable pairs rather than one: a
 * task that stops for permission has to reach somebody, and there is one desk in
 * this product where an event becomes news.
 */
export type NotificationKind =
  | 'OPENED'
  | 'ASSIGNED'
  | 'STATUS'
  | 'COMMENT'
  | 'MENTIONED'
  | 'OBSERVING'
  | 'LINKED'
  | 'TASK_WAITING'
  | 'TASK_FINISHED';

/**
 * One thing that happened, as the bell shows it.
 *
 * The same feed an assistant reads over MCP: one record of what happened, read
 * two ways, rather than two records that can disagree.
 */
export interface Notification {
  id: string;
  workspaceId: string;
  /** The issue it is about, and null when it is about a task. */
  issueNumber: number | null;
  issueTitle: string | null;
  /** The task it is about, and null when it is about an issue. */
  taskId: string | null;
  taskTitle: string | null;
  kind: NotificationKind;
  /** Whoever did it; never the person reading, since your own doing is not news. */
  actor: string;
  /** What was said, the status it moved to, or the link that was made as "BLOCKS #4". */
  says: string | null;
  at: string;
  /** Still unread when it was asked for. The bell counts these; the panel shows everything. */
  unread: boolean;
}

const FIELDS = 'id workspaceId issueNumber issueTitle taskId taskTitle kind actor says at unread';

export async function fetchNotifications(limit?: number): Promise<Notification[]> {
  const data = await graphql<{ myNotifications: Notification[] }>(
    `query ($limit: Int) { myNotifications(limit: $limit) { ${FIELDS} } }`,
    { limit: limit ?? null },
  );
  return data.myNotifications;
}

/** Just the number, which is all the bell itself needs and is asked for often. */
export async function fetchNotificationCount(): Promise<number> {
  const data = await graphql<{ myNotificationCount: number }>(`query { myNotificationCount }`);
  return data.myNotificationCount;
}

/** Says they have been seen. Separate from reading them, or the count would never show. */
export async function readNotifications(): Promise<number> {
  const data = await graphql<{ readMyNotifications: number }>(`mutation { readMyNotifications }`);
  return data.readMyNotifications;
}
