import { graphql } from './client';

/** What kind of thing happened on an issue. */
export type NotificationKind = 'ASSIGNED' | 'STATUS' | 'COMMENT' | 'MENTIONED' | 'OBSERVING';

/**
 * One thing that happened, as the bell shows it.
 *
 * The same feed an assistant reads over MCP: one record of what happened, read
 * two ways, rather than two records that can disagree.
 */
export interface Notification {
  id: string;
  workspaceId: string;
  issueNumber: number;
  issueTitle: string;
  kind: NotificationKind;
  /** Whoever did it; never the person reading, since your own doing is not news. */
  actor: string;
  /** What was said, or the status it moved to. */
  says: string | null;
  at: string;
}

const FIELDS = 'id workspaceId issueNumber issueTitle kind actor says at';

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
