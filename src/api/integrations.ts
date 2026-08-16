import { graphql } from './client';
import type { PageOf } from './client';

export type ConnectionType = 'SLACK_SOCKET_MODE' | 'SLACK' | 'GITHUB' | 'JIRA' | 'WEBHOOK';
export type AuthType = 'NONE' | 'API_KEY' | 'BEARER_TOKEN' | 'BASIC';
/** CONNECTED only once a check has reached the service. */
export type ConnectionStatus = 'NOT_CONFIGURED' | 'NOT_CHECKED' | 'CONNECTED' | 'FAILED';

export interface HttpHeader {
  name: string;
  value: string;
}

/** An admin-wide default connection. */
export interface Connection {
  id: string;
  name: string;
  type: ConnectionType;
  url: string;
}

/** A connection as one workspace holds it. Credentials are never returned here. */
export interface WorkspaceConnection {
  id: string;
  workspaceId: string;
  name: string;
  type: ConnectionType;
  url: string;
  urlOverride: string | null;
  effectiveUrl: string;
  authType: AuthType;
  headers: HttpHeader[];
  inherited: boolean;
  secretSet: boolean;
  /** Whether a Socket Mode app-level token is stored, which is what lets orknux listen. */
  appTokenSet: boolean;
  status: ConnectionStatus;
  lastCheckMessage: string | null;
  lastCheckedAt: string | null;
}

export interface McpServer {
  id: string;
  workspaceId: string;
  name: string;
  address: string;
  authType: AuthType;
  headers: HttpHeader[];
  secretSet: boolean;
}

const CONNECTION_FIELDS = 'id name type url';
const WORKSPACE_CONNECTION_FIELDS =
  'id workspaceId name type url urlOverride effectiveUrl authType headers { name value } inherited secretSet ' +
  'appTokenSet status lastCheckMessage lastCheckedAt';
const MCP_SERVER_FIELDS = 'id workspaceId name address authType headers { name value } secretSet';

const CONNECTIONS_QUERY = `
  query Connections($page: Int!, $size: Int!) {
    connections(page: $page, size: $size) {
      content { ${CONNECTION_FIELDS} }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const CREATE_CONNECTION_MUTATION = `
  mutation CreateConnection($input: ConnectionInput!) {
    createConnection(input: $input) { ${CONNECTION_FIELDS} }
  }
`;

const UPDATE_CONNECTION_MUTATION = `
  mutation UpdateConnection($id: ID!, $input: ConnectionInput!) {
    updateConnection(id: $id, input: $input) { ${CONNECTION_FIELDS} }
  }
`;

const DELETE_CONNECTION_MUTATION = `
  mutation DeleteConnection($id: ID!) {
    deleteConnection(id: $id)
  }
`;

const TEST_CONNECTION_MUTATION = `
  mutation TestWorkspaceConnection($id: ID!) {
    testWorkspaceConnection(id: $id) { ${WORKSPACE_CONNECTION_FIELDS} }
  }
`;

const WORKSPACE_CONNECTIONS_QUERY = `
  query WorkspaceConnections($workspaceId: ID!) {
    workspaceConnections(workspaceId: $workspaceId) { ${WORKSPACE_CONNECTION_FIELDS} }
  }
`;

const WORKSPACE_CONNECTION_QUERY = `
  query WorkspaceConnection($id: ID!) {
    workspaceConnection(id: $id) { ${WORKSPACE_CONNECTION_FIELDS} }
  }
`;

const CREATE_WORKSPACE_CONNECTION_MUTATION = `
  mutation CreateWorkspaceConnection($input: CreateWorkspaceConnectionInput!) {
    createWorkspaceConnection(input: $input) { ${WORKSPACE_CONNECTION_FIELDS} }
  }
`;

const UPDATE_WORKSPACE_CONNECTION_MUTATION = `
  mutation UpdateWorkspaceConnection($id: ID!, $input: UpdateWorkspaceConnectionInput!) {
    updateWorkspaceConnection(id: $id, input: $input) { ${WORKSPACE_CONNECTION_FIELDS} }
  }
`;

const DISCONNECT_MUTATION = `
  mutation DisconnectWorkspaceConnection($id: ID!) {
    disconnectWorkspaceConnection(id: $id)
  }
`;

const REVEAL_CONNECTION_MUTATION = `
  mutation RevealWorkspaceConnectionSecret($id: ID!) {
    revealWorkspaceConnectionSecret(id: $id)
  }
`;

const MCP_SERVERS_QUERY = `
  query McpServers($workspaceId: ID!) {
    mcpServers(workspaceId: $workspaceId) { ${MCP_SERVER_FIELDS} }
  }
`;

const MCP_SERVER_QUERY = `
  query McpServer($id: ID!) {
    mcpServer(id: $id) { ${MCP_SERVER_FIELDS} }
  }
`;

const CREATE_MCP_SERVER_MUTATION = `
  mutation CreateMcpServer($input: CreateMcpServerInput!) {
    createMcpServer(input: $input) { ${MCP_SERVER_FIELDS} }
  }
`;

const UPDATE_MCP_SERVER_MUTATION = `
  mutation UpdateMcpServer($id: ID!, $input: UpdateMcpServerInput!) {
    updateMcpServer(id: $id, input: $input) { ${MCP_SERVER_FIELDS} }
  }
`;

const REMOVE_MCP_SERVER_MUTATION = `
  mutation RemoveMcpServer($id: ID!) {
    removeMcpServer(id: $id)
  }
`;

const REVEAL_MCP_SECRET_MUTATION = `
  mutation RevealMcpServerSecret($id: ID!) {
    revealMcpServerSecret(id: $id)
  }
`;

/** `page` is 0-based, matching the server. */
export async function fetchConnections(page: number, size: number): Promise<PageOf<Connection>> {
  const data = await graphql<{ connections: PageOf<Connection> }>(CONNECTIONS_QUERY, { page, size });
  return data.connections;
}

export interface ConnectionInput {
  name: string;
  type: ConnectionType;
  url: string;
  /** Also hand the connection to the workspaces that already exist. */
  addToExistingWorkspaces?: boolean;
}

export async function createConnection(input: ConnectionInput): Promise<Connection> {
  const data = await graphql<{ createConnection: Connection }>(CREATE_CONNECTION_MUTATION, { input });
  return data.createConnection;
}

export async function updateConnection(id: string, input: ConnectionInput): Promise<Connection> {
  const data = await graphql<{ updateConnection: Connection }>(UPDATE_CONNECTION_MUTATION, { id, input });
  return data.updateConnection;
}

/** Workspaces keep the copy they hold, credentials included; it becomes their own. */
export async function deleteConnection(id: string): Promise<boolean> {
  const data = await graphql<{ deleteConnection: boolean }>(DELETE_CONNECTION_MUTATION, { id });
  return data.deleteConnection;
}

/** Calls the service and stores what came back, which is what `status` reports. */
export async function testWorkspaceConnection(id: string): Promise<WorkspaceConnection> {
  const data = await graphql<{ testWorkspaceConnection: WorkspaceConnection }>(TEST_CONNECTION_MUTATION, { id });
  return data.testWorkspaceConnection;
}

export async function fetchWorkspaceConnections(workspaceId: string): Promise<WorkspaceConnection[]> {
  const data = await graphql<{ workspaceConnections: WorkspaceConnection[] }>(WORKSPACE_CONNECTIONS_QUERY, { workspaceId });
  return data.workspaceConnections;
}

export async function fetchWorkspaceConnection(id: string): Promise<WorkspaceConnection | null> {
  const data = await graphql<{ workspaceConnection: WorkspaceConnection | null }>(WORKSPACE_CONNECTION_QUERY, { id });
  return data.workspaceConnection;
}

export async function createWorkspaceConnection(input: {
  workspaceId: string;
  name: string;
  type: ConnectionType;
  url: string;
  authType?: AuthType;
  secret?: string;
  /** Slack's Socket Mode app-level token, for the type that opens a websocket. */
  appToken?: string;
  headers?: HttpHeader[];
}): Promise<WorkspaceConnection> {
  const data = await graphql<{ createWorkspaceConnection: WorkspaceConnection }>(CREATE_WORKSPACE_CONNECTION_MUTATION, { input });
  return data.createWorkspaceConnection;
}

/** Omitting `secret` or `appToken` keeps what is stored; an empty string clears it. */
export async function updateWorkspaceConnection(
  id: string,
  input: {
    /** Ignored for inherited connections, which follow the admin default. */
    name?: string;
    authType?: AuthType;
    secret?: string;
    appToken?: string;
    urlOverride?: string;
    headers?: HttpHeader[];
  },
): Promise<WorkspaceConnection> {
  const data = await graphql<{ updateWorkspaceConnection: WorkspaceConnection }>(UPDATE_WORKSPACE_CONNECTION_MUTATION, {
    id,
    input,
  });
  return data.updateWorkspaceConnection;
}

export async function disconnectWorkspaceConnection(id: string): Promise<boolean> {
  const data = await graphql<{ disconnectWorkspaceConnection: boolean }>(DISCONNECT_MUTATION, { id });
  return data.disconnectWorkspaceConnection;
}

/**
 * Makes an admin default out of a connection this workspace set up.
 *
 * Its name, kind and URL — the part that was worked out once and would
 * otherwise be typed again in every other workspace. Credentials stay here,
 * as they do for every default. Administrators only.
 */
export async function exportWorkspaceConnectionAsDefault(
  id: string,
  addToExistingWorkspaces: boolean,
): Promise<Connection> {
  const data = await graphql<{ exportWorkspaceConnectionAsDefault: Connection }>(
    `mutation ExportWorkspaceConnection($id: ID!, $addToExistingWorkspaces: Boolean) {
       exportWorkspaceConnectionAsDefault(id: $id, addToExistingWorkspaces: $addToExistingWorkspaces) {
         id name type url
       }
     }`,
    { id, addToExistingWorkspaces },
  );
  return data.exportWorkspaceConnectionAsDefault;
}

export async function revealWorkspaceConnectionSecret(id: string): Promise<string | null> {
  const data = await graphql<{ revealWorkspaceConnectionSecret: string | null }>(REVEAL_CONNECTION_MUTATION, { id });
  return data.revealWorkspaceConnectionSecret;
}

export async function fetchMcpServers(workspaceId: string): Promise<McpServer[]> {
  const data = await graphql<{ mcpServers: McpServer[] }>(MCP_SERVERS_QUERY, { workspaceId });
  return data.mcpServers;
}

export async function fetchMcpServer(id: string): Promise<McpServer | null> {
  const data = await graphql<{ mcpServer: McpServer | null }>(MCP_SERVER_QUERY, { id });
  return data.mcpServer;
}

export async function createMcpServer(input: {
  workspaceId: string;
  name: string;
  address: string;
  authType?: AuthType;
  secret?: string;
  headers?: HttpHeader[];
}): Promise<McpServer> {
  const data = await graphql<{ createMcpServer: McpServer }>(CREATE_MCP_SERVER_MUTATION, { input });
  return data.createMcpServer;
}

/** Omitting `secret` keeps the stored credentials; an empty string clears them. */
export async function updateMcpServer(
  id: string,
  input: { name: string; address: string; authType?: AuthType; secret?: string; headers?: HttpHeader[] },
): Promise<McpServer> {
  const data = await graphql<{ updateMcpServer: McpServer }>(UPDATE_MCP_SERVER_MUTATION, { id, input });
  return data.updateMcpServer;
}

export async function removeMcpServer(id: string): Promise<boolean> {
  const data = await graphql<{ removeMcpServer: boolean }>(REMOVE_MCP_SERVER_MUTATION, { id });
  return data.removeMcpServer;
}

export async function revealMcpServerSecret(id: string): Promise<string | null> {
  const data = await graphql<{ revealMcpServerSecret: string | null }>(REVEAL_MCP_SECRET_MUTATION, { id });
  return data.revealMcpServerSecret;
}

/** How the status column reads. */
export function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'CONNECTED':
      return 'Connected';
    case 'FAILED':
      return 'Check failed';
    case 'NOT_CHECKED':
      return 'Not checked';
    case 'NOT_CONFIGURED':
      return 'Not configured';
  }
}

/** "SLACK" -> "Slack", as the tables show it. */
export function connectionTypeLabel(type: ConnectionType): string {
  switch (type) {
    case 'SLACK':
      return 'Slack';
    case 'SLACK_SOCKET_MODE':
      return 'Slack (Socket Mode)';
    case 'GITHUB':
      return 'GitHub';
    case 'JIRA':
      return 'Jira';
    case 'WEBHOOK':
      return 'Webhook';
  }
}

/** The auth column reads "API Key ••••" once credentials are stored. */
export function authLabel(authType: AuthType, secretSet: boolean): string {
  const name = authTypeLabel(authType);
  if (authType === 'NONE') return name;
  return secretSet ? `${name} ••••` : name;
}

export function authTypeLabel(authType: AuthType): string {
  switch (authType) {
    case 'NONE':
      return 'None';
    case 'API_KEY':
      return 'API Key';
    case 'BEARER_TOKEN':
      return 'Bearer Token';
    case 'BASIC':
      return 'Basic';
  }
}
