import { graphql } from './client';
import type { PageOf } from './client';

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  /** The roles that open this workspace. Empty means administrators only. */
  roles: WorkspaceRole[];
  /**
   * The roles that also administer it - its name and description, observers on its
   * issues, and moving an issue in or out. A subset of `roles`; empty means
   * installation administrators only.
   */
  adminRoles: WorkspaceRole[];
  /**
   * Whether the signed-in caller administers this workspace. True for an
   * installation administrator everywhere, and it can differ between two
   * workspaces for the same person - which is what the role is for.
   */
  administered: boolean;
  /**
   * The model used for the workspace's own small jobs — naming a chat from what
   * was said. Null means those jobs do not happen.
   */
  companionModelId: string | null;
  /**
   * The model the microphone in a chat speaks to. Null means it is not offered,
   * which is right where there is nothing to transcribe with.
   */
  transcriptionModelId: string | null;
  /**
   * The model that reads an answer aloud. Null means the speaker under one is
   * not offered, which is right where there is nothing to read it with.
   */
  speechModelId: string | null;
  /**
   * The model behind the quick chat beside the page. Null means the button is
   * not offered.
   */
  quickChatModelId: string | null;
  /**
   * Whether the quick chat may start things, or only look them up. False by
   * default, including for a workspace that has already chosen a model.
   */
  quickChatMayWrite: boolean;
}

const WORKSPACE_FIELDS =
  'id name description roles { id name } adminRoles { id name } administered ' +
  'companionModelId transcriptionModelId speechModelId quickChatModelId quickChatMayWrite';

/** Just enough of a role to name it where a workspace lists what opens it. */
export interface WorkspaceRole {
  id: string;
  name: string;
}

export async function fetchWorkspace(id: string): Promise<Workspace | null> {
  const data = await graphql<{ workspace: Workspace | null }>(
    `query Workspace($id: ID!) { workspace(id: $id) { ${WORKSPACE_FIELDS} } }`,
    { id },
  );
  return data.workspace;
}

/** Null clears it, which switches those jobs off rather than falling back. */
export async function setWorkspaceCompanionModel(workspaceId: string, modelId: string | null): Promise<Workspace> {
  const data = await graphql<{ setWorkspaceCompanionModel: Workspace }>(
    `mutation SetWorkspaceCompanionModel($workspaceId: ID!, $modelId: ID) {
       setWorkspaceCompanionModel(workspaceId: $workspaceId, modelId: $modelId) { ${WORKSPACE_FIELDS} }
     }`,
    { workspaceId, modelId },
  );
  return data.setWorkspaceCompanionModel;
}

/** Chooses the model the workspace hears with; null takes the microphone away. */
export async function setWorkspaceTranscriptionModel(
  workspaceId: string,
  modelId: string | null,
): Promise<Workspace> {
  const data = await graphql<{ setWorkspaceTranscriptionModel: Workspace }>(
    `mutation SetWorkspaceTranscriptionModel($workspaceId: ID!, $modelId: ID) {
       setWorkspaceTranscriptionModel(workspaceId: $workspaceId, modelId: $modelId) { ${WORKSPACE_FIELDS} }
     }`,
    { workspaceId, modelId },
  );
  return data.setWorkspaceTranscriptionModel;
}

/** Chooses the model the workspace speaks with; null takes the speaker away. */
export async function setWorkspaceSpeechModel(
  workspaceId: string,
  modelId: string | null,
): Promise<Workspace> {
  const data = await graphql<{ setWorkspaceSpeechModel: Workspace }>(
    `mutation SetWorkspaceSpeechModel($workspaceId: ID!, $modelId: ID) {
       setWorkspaceSpeechModel(workspaceId: $workspaceId, modelId: $modelId) { ${WORKSPACE_FIELDS} }
     }`,
    { workspaceId, modelId },
  );
  return data.setWorkspaceSpeechModel;
}

/** Chooses the model behind the quick chat; null takes the button away. */
export async function setWorkspaceQuickChatModel(
  workspaceId: string,
  modelId: string | null,
): Promise<Workspace> {
  const data = await graphql<{ setWorkspaceQuickChatModel: Workspace }>(
    `mutation SetWorkspaceQuickChatModel($workspaceId: ID!, $modelId: ID) {
       setWorkspaceQuickChatModel(workspaceId: $workspaceId, modelId: $modelId) { ${WORKSPACE_FIELDS} }
     }`,
    { workspaceId, modelId },
  );
  return data.setWorkspaceQuickChatModel;
}

/** Whether the quick chat may start things, or only look them up. */
export async function setWorkspaceQuickChatWrites(
  workspaceId: string,
  allowed: boolean,
): Promise<Workspace> {
  const data = await graphql<{ setWorkspaceQuickChatWrites: Workspace }>(
    `mutation SetWorkspaceQuickChatWrites($workspaceId: ID!, $allowed: Boolean!) {
       setWorkspaceQuickChatWrites(workspaceId: $workspaceId, allowed: $allowed) { ${WORKSPACE_FIELDS} }
     }`,
    { workspaceId, allowed },
  );
  return data.setWorkspaceQuickChatWrites;
}

export type WorkspaceOperationType = 'ADD' | 'REMOVE' | 'RENAME';

export type ActivityCategory = 'WORKSPACE' | 'WORKFLOW' | 'AGENT' | 'INTEGRATION';

export interface WorkspaceAuditEntry {
  id: string;
  workspaceId: string;
  category: ActivityCategory;
  /** Ready to show: "Workspace backend created". */
  message: string;
  oldWorkspaceName: string | null;
  newWorkspaceName: string | null;
  operationType: WorkspaceOperationType;
  /** ISO-8601 offset date-time. */
  date: string;
  userId: string;
}

const WORKSPACES_QUERY = `
  query Workspaces($page: Int!, $size: Int!) {
    workspaces(page: $page, size: $size) {
      content { ${WORKSPACE_FIELDS} }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const AUDIT_QUERY = `
  query WorkspaceAudit(
    $page: Int!
    $size: Int!
    $search: String
    $category: WorkspaceAuditCategory
    $userId: String
    $days: Int
  ) {
    workspaceAudit(
      page: $page
      size: $size
      search: $search
      category: $category
      userId: $userId
      days: $days
    ) {
      content { id workspaceId category message oldWorkspaceName newWorkspaceName operationType date userId }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const CREATE_WORKSPACE_MUTATION = `
  mutation CreateWorkspace($input: CreateWorkspaceInput!) {
    createWorkspace(input: $input) {
      id
      name
      description
    }
  }
`;

export interface NewWorkspace {
  name: string;
  description?: string;
}

export async function createWorkspace(input: NewWorkspace): Promise<Workspace> {
  const data = await graphql<{ createWorkspace: Workspace }>(CREATE_WORKSPACE_MUTATION, { input });
  return data.createWorkspace;
}

const UPDATE_WORKSPACE_MUTATION = `
  mutation UpdateWorkspace($id: ID!, $input: UpdateWorkspaceInput!) {
    updateWorkspace(id: $id, input: $input) { ${WORKSPACE_FIELDS} }
  }
`;

export interface WorkspaceSettings {
  name: string;
  description?: string;
  /** The roles that open it. Omitted leaves them alone; empty means administrators only. */
  roleIds?: string[];
  /**
   * Which of those also administer it. Omitted leaves them alone; empty means
   * installation administrators only. Only an installation administrator may
   * change either list, so the workspace-side form omits both.
   */
  adminRoleIds?: string[];
}

export async function updateWorkspace(id: string, input: WorkspaceSettings): Promise<Workspace> {
  const data = await graphql<{ updateWorkspace: Workspace }>(UPDATE_WORKSPACE_MUTATION, { id, input });
  return data.updateWorkspace;
}

const DELETE_WORKSPACE_MUTATION = `
  mutation DeleteWorkspace($id: ID!) {
    deleteWorkspace(id: $id)
  }
`;

/** Resolves to false when the workspace was already gone. */
export async function deleteWorkspace(id: string): Promise<boolean> {
  const data = await graphql<{ deleteWorkspace: boolean }>(DELETE_WORKSPACE_MUTATION, { id });
  return data.deleteWorkspace;
}

/** `page` is 0-based, matching the server. */
export async function fetchWorkspaces(page: number, size: number): Promise<PageOf<Workspace>> {
  const data = await graphql<{ workspaces: PageOf<Workspace> }>(WORKSPACES_QUERY, { page, size });
  return data.workspaces;
}

export interface AuditFilters {
  search?: string;
  category?: ActivityCategory;
  userId?: string;
  /** Only entries from the last N days; omit for all time. */
  days?: number;
}

export async function fetchWorkspaceAudit(
  page: number,
  size: number,
  filters: AuditFilters = {},
): Promise<PageOf<WorkspaceAuditEntry>> {
  const data = await graphql<{ workspaceAudit: PageOf<WorkspaceAuditEntry> }>(AUDIT_QUERY, {
    page,
    size,
    search: filters.search ?? null,
    category: filters.category ?? null,
    userId: filters.userId ?? null,
    days: filters.days ?? null,
  });
  return data.workspaceAudit;
}

const AUDIT_USERS_QUERY = `
  query AuditUsers {
    auditUsers
  }
`;

export async function fetchAuditUsers(): Promise<string[]> {
  const data = await graphql<{ auditUsers: string[] }>(AUDIT_USERS_QUERY, {});
  return data.auditUsers;
}
