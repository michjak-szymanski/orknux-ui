import type { MessageTarget } from './actions';
import { graphql } from './client';
import type { PageOf } from './client';

/**
 * What a connection points at.
 *
 * HTTP is the generic outbound target: a URL this installation sends a request
 * to. It was called WEBHOOK, which named the wrong end of the wire - a webhook
 * is something this installation exposes and somebody else calls, which is what
 * a webhook *trigger* is and now the only thing that word means here.
 */
export type ConnectionType = 'SLACK' | 'SMTP' | 'HTTP';
/** How the session with a mail server is secured; the port follows from it. */
export type MailSecurity = 'NONE' | 'STARTTLS' | 'TLS';
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
  /** Whether an app-level token is stored, which is what lets a Slack connection listen. */
  appTokenSet: boolean;
  /** The port a mail connection will use, which is the default one when none was chosen. */
  smtpPort: number | null;
  /** Who a mail connection logs in as; null sends without authenticating. */
  smtpUsername: string | null;
  smtpFrom: string | null;
  smtpSecurity: MailSecurity;
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
  'appTokenSet smtpPort smtpUsername smtpFrom smtpSecurity status lastCheckMessage lastCheckedAt';
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

/** The other credential a Slack connection holds, revealed the same way. */
const REVEAL_CONNECTION_APP_TOKEN_MUTATION = `
  mutation RevealWorkspaceConnectionAppToken($id: ID!) {
    revealWorkspaceConnectionAppToken(id: $id)
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
  /**
   * Where the service is. Omitted for the kinds that address themselves: a Slack
   * connection always talks to the Web API, and the server writes that in
   * whatever the client sends, so there is nothing here worth asking for.
   */
  url?: string;
  authType?: AuthType;
  secret?: string;
  /** Slack's app-level token. Given one, the connection listens as well as sends. */
  appToken?: string;
  /** Where the mail server listens; omitted takes the port the security implies. */
  smtpPort?: number;
  /** Who to log in as; omitted sends without authenticating, and the password is `secret`. */
  smtpUsername?: string;
  smtpFrom?: string;
  smtpSecurity?: MailSecurity;
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
    /**
     * What kind of service this is. The server has always accepted a change
     * here; this client simply never sent one, so a connection's kind could
     * only be chosen when it was created and never corrected afterwards.
     */
    type?: ConnectionType;
    authType?: AuthType;
    secret?: string;
    appToken?: string;
    smtpPort?: number;
    smtpUsername?: string;
    smtpFrom?: string;
    smtpSecurity?: MailSecurity;
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

export async function revealWorkspaceConnectionSecret(id: string): Promise<string | null> {
  const data = await graphql<{ revealWorkspaceConnectionSecret: string | null }>(REVEAL_CONNECTION_MUTATION, { id });
  return data.revealWorkspaceConnectionSecret;
}

export async function revealWorkspaceConnectionAppToken(id: string): Promise<string | null> {
  const data = await graphql<{ revealWorkspaceConnectionAppToken: string | null }>(
    REVEAL_CONNECTION_APP_TOKEN_MUTATION,
    { id },
  );
  return data.revealWorkspaceConnectionAppToken;
}

/**
 * What asking a Slack connection about a typed user or channel came back with.
 *
 * Three outcomes and not two, because the server refuses to collapse them: a
 * name nothing answers to and a question that was never put want opposite
 * things done about them - a name to correct against a scope to add to the
 * Slack app - and a screen that painted both as "wrong" would send somebody to
 * mend a connection that is not broken.
 */
export type SlackTargetOutcome = 'FOUND' | 'NOT_FOUND' | 'UNCHECKED';

export interface SlackTargetCheck {
  outcome: SlackTargetOutcome;
  /**
   * One sentence or two, ready to show, never empty.
   *
   * Printed as it arrives and never reworded. It is written to carry the whole
   * of the answer - including, for `UNCHECKED`, which scope to add and why a
   * token that posts perfectly well can still be unable to look anything up -
   * and the picker built over the same endpoints will show the same sentence.
   * A second copy of that wording here would be a second thing to keep true.
   */
  message: string;
  /** Slack's own id, when it was found. */
  id: string | null;
  /** What Slack calls it, when it was found: `#general`, `Alice Adams`. */
  label: string | null;
}

const SLACK_TARGET_QUERY = `
  query SlackTarget($connectionId: ID!, $target: MessageTarget!, $name: String!) {
    slackTarget(connectionId: $connectionId, target: $target, name: $name) {
      outcome
      message
      id
      label
    }
  }
`;

/**
 * Whether a Slack connection can see the user or channel typed into a field.
 *
 * A question and never a gate: nothing about saving an action asks this, and
 * `targetName` stays free text whatever it answers. `name` is sent exactly as
 * it was typed - `#general`, `@alice`, an address, an id pasted out of Slack -
 * because the server is the one that knows what each of those means.
 */
export async function checkSlackTarget(
  connectionId: string,
  target: MessageTarget,
  name: string,
): Promise<SlackTargetCheck> {
  const data = await graphql<{ slackTarget: SlackTargetCheck }>(SLACK_TARGET_QUERY, {
    connectionId,
    target,
    name,
  });
  return data.slackTarget;
}

/** One user or channel a connection can see, offered for somebody to take. */
export interface SlackSuggestion {
  /** Slack's own id - `C0123456789`, `U0123456789`. Unique, and what a row is keyed by. */
  id: string;
  /** What the field is filled with when this is taken: `#general`, `@alice`. */
  name: string;
  /**
   * What Slack calls the member, where that says something the handle does not.
   *
   * Null for a channel, whose one name is `name`, and null for a member whose
   * name only repeats their handle - so a second line is drawn only where there
   * is a second thing to say.
   */
  realName: string | null;
}

/**
 * What a Slack connection has to offer against what has been typed so far.
 *
 * The same three outcomes as the check, meaning the same things, so one field
 * can carry both answers without a second vocabulary. None of it is a verdict:
 * `matches` is what was worth offering and never what may be entered.
 */
export interface SlackSuggestions {
  outcome: SlackTargetOutcome;
  /**
   * One line, ready to show, and empty when there is nothing worth saying -
   * which is the usual answer.
   *
   * Printed as it arrives and never reworded, like the check's. The server
   * says something in exactly three cases and each of them is a case a list on
   * its own would get wrong: `UNCHECKED`, where this is the reason there are no
   * suggestions at all; `NOT_FOUND`, where it is the caveat that keeps an empty
   * list from reading as a verdict; and a `FOUND` that is not complete, where
   * it says the list was cut and narrowing will find the rest.
   */
  message: string;
  /** Best first: what the typing matches exactly, then starts with, then contains. */
  matches: SlackSuggestion[];
  /**
   * Whether `matches` is everything that matches.
   *
   * False when Slack was not read to the end, and false when more matched than
   * came back. Both mean the same thing to somebody typing - there may be more
   * - and neither is ever a reason to refuse what they type.
   */
  complete: boolean;
}

const SLACK_SUGGESTIONS_QUERY = `
  query SlackSuggestions($connectionId: ID!, $target: MessageTarget!, $typed: String) {
    slackSuggestions(connectionId: $connectionId, target: $target, typed: $typed) {
      outcome
      message
      matches { id name realName }
      complete
    }
  }
`;

/**
 * The users or channels a Slack connection can see that match what is typed.
 *
 * The reading half of the same two endpoints the check puts a question to, and
 * cheap in a way the check is not: each connection's list is read from Slack
 * once and filtered in memory, so this is a lookup in a map rather than a call
 * to Slack, and a picker may ask it on a pause between keystrokes.
 *
 * `typed` is sent exactly as it stands, sigil and all - the server strips the
 * `#` or the `@` before matching - and an empty one asks for the first few of
 * everything, which is what a picker shows when it opens.
 *
 * It suggests and never gates. Nothing that saves reads this, and plenty of
 * correct values will never appear in it: an id pasted out of somebody else's
 * message, a member who joined a minute ago, a private channel this bot was
 * never invited to.
 */
export async function fetchSlackSuggestions(
  connectionId: string,
  target: MessageTarget,
  typed: string,
): Promise<SlackSuggestions> {
  const data = await graphql<{ slackSuggestions: SlackSuggestions }>(SLACK_SUGGESTIONS_QUERY, {
    connectionId,
    target,
    typed,
  });
  return data.slackSuggestions;
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
    case 'SMTP':
      return 'Email (SMTP)';
    case 'HTTP':
      return 'HTTP endpoint';
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
