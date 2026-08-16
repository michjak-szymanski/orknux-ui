import { graphql } from './client';
import type { PageOf } from './client';

export type ActivityCategory =
  | 'WORKSPACE'
  | 'WORKFLOW'
  | 'AGENT'
  | 'INTEGRATION'
  | 'MODEL'
  | 'MEMORY'
  | 'OBJECT'
  | 'CHAT';

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  category: ActivityCategory;
  /** Ready to show: "Agent Research Agent enabled". */
  message: string;
  date: string;
  userId: string;
}

export interface ActivityFilters {
  search?: string;
  category?: ActivityCategory;
  userId?: string;
  /** Only entries from the last N days; omit for all time. */
  days?: number;
}

const WORKSPACE_ACTIVITY_QUERY = `
  query WorkspaceActivity(
    $workspaceId: ID!
    $page: Int!
    $size: Int!
    $search: String
    $category: WorkspaceAuditCategory
    $userId: String
    $days: Int
  ) {
    workspaceActivity(
      workspaceId: $workspaceId
      page: $page
      size: $size
      search: $search
      category: $category
      userId: $userId
      days: $days
    ) {
      content { id workspaceId category message date userId }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const ACTIVITY_USERS_QUERY = `
  query WorkspaceActivityUsers($workspaceId: ID!) {
    workspaceActivityUsers(workspaceId: $workspaceId)
  }
`;

/** `page` is 0-based, matching the server. */
export async function fetchWorkspaceActivity(
  workspaceId: string,
  page: number,
  size: number,
  filters: ActivityFilters = {},
): Promise<PageOf<ActivityEntry>> {
  const data = await graphql<{ workspaceActivity: PageOf<ActivityEntry> }>(WORKSPACE_ACTIVITY_QUERY, {
    workspaceId,
    page,
    size,
    search: filters.search ?? null,
    category: filters.category ?? null,
    userId: filters.userId ?? null,
    days: filters.days ?? null,
  });
  return data.workspaceActivity;
}

export async function fetchActivityUsers(workspaceId: string): Promise<string[]> {
  const data = await graphql<{ workspaceActivityUsers: string[] }>(ACTIVITY_USERS_QUERY, { workspaceId });
  return data.workspaceActivityUsers;
}
