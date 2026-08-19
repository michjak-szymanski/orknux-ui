import { graphql } from './client';
import type { PageOf } from './client';

export type AgentType = 'LLM';

export interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  type: AgentType;
  description: string | null;
  systemPrompt: string | null;
  enabled: boolean;
  /** The model this agent thinks with; null when none has been chosen. */
  modelId: string | null;
  /** What that model is called, or null when it has been removed. */
  modelName: string | null;
  mcpServers: string[];
  /**
   * Whether it may ask orknux about orknux.
   *
   * The built-in server, deliberately not among `mcpServers`: those are
   * addresses somebody registered, and this one is the application the agent is
   * already inside.
   */
  orknuxAccess: boolean;
  /** Whether it may open a shell on one of the installation's machines. */
  shellAccess: boolean;
  /** Memory catalogs this agent may read, by name. */
  memoryCatalogs: string[];
  /** Which skill catalogs it may draw on. */
  skillCatalogs: string[];
  /** Which of the workspace's tools it may call. */
  tools: string[];
  /** Which icon a node drawn from this starts with; null draws the kind's own. */
  icon: string | null;
}

const AGENT_FIELDS =
  'id workspaceId name type description systemPrompt enabled modelId modelName mcpServers orknuxAccess shellAccess memoryCatalogs skillCatalogs tools icon';

const WORKSPACE_AGENTS_QUERY = `
  query WorkspaceAgents($workspaceId: ID!, $page: Int!, $size: Int!) {
    workspaceAgents(workspaceId: $workspaceId, page: $page, size: $size) {
      content { ${AGENT_FIELDS} }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const AGENT_QUERY = `
  query Agent($id: ID!) {
    agent(id: $id) { ${AGENT_FIELDS} }
  }
`;

const CREATE_AGENT_MUTATION = `
  mutation CreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) { ${AGENT_FIELDS} }
  }
`;

const UPDATE_AGENT_MUTATION = `
  mutation UpdateAgent($id: ID!, $input: UpdateAgentInput!) {
    updateAgent(id: $id, input: $input) { ${AGENT_FIELDS} }
  }
`;

const SET_ENABLED_MUTATION = `
  mutation SetAgentEnabled($id: ID!, $enabled: Boolean!) {
    setAgentEnabled(id: $id, enabled: $enabled) { ${AGENT_FIELDS} }
  }
`;

const DELETE_AGENT_MUTATION = `
  mutation DeleteAgent($id: ID!) {
    deleteAgent(id: $id)
  }
`;

/** `page` is 0-based, matching the server. */
export async function fetchWorkspaceAgents(workspaceId: string, page: number, size: number): Promise<PageOf<Agent>> {
  const data = await graphql<{ workspaceAgents: PageOf<Agent> }>(WORKSPACE_AGENTS_QUERY, { workspaceId, page, size });
  return data.workspaceAgents;
}

export async function fetchAgent(id: string): Promise<Agent | null> {
  const data = await graphql<{ agent: Agent | null }>(AGENT_QUERY, { id });
  return data.agent;
}

export async function createAgent(input: {
  workspaceId: string;
  name: string;
  type: AgentType;
  description?: string;
}): Promise<Agent> {
  const data = await graphql<{ createAgent: Agent }>(CREATE_AGENT_MUTATION, { input });
  return data.createAgent;
}

export async function updateAgent(
  id: string,
  input: {
    name: string;
    description?: string;
    systemPrompt?: string;
    /** Null clears the model. */
    modelId?: string | null;
    mcpServers?: string[];
    /** Whether it may ask orknux about orknux; left out, the grant is unchanged. */
    orknuxAccess?: boolean;
    /** Whether it may open a shell on a machine; left out, the grant is unchanged. */
    shellAccess?: boolean;
    memoryCatalogs?: string[];
    /** Which skill catalogs it may draw on; left out, the grant is unchanged. */
    skillCatalogs?: string[];
    /** Which tools it may call; left out, the grant is unchanged. */
    tools?: string[];
    /** Which icon a node drawn from this agent starts with; null clears it. */
    icon?: string | null;
  },
): Promise<Agent> {
  const data = await graphql<{ updateAgent: Agent }>(UPDATE_AGENT_MUTATION, { id, input });
  return data.updateAgent;
}

export async function setAgentEnabled(id: string, enabled: boolean): Promise<Agent> {
  const data = await graphql<{ setAgentEnabled: Agent }>(SET_ENABLED_MUTATION, { id, enabled });
  return data.setAgentEnabled;
}

export async function deleteAgent(id: string): Promise<boolean> {
  const data = await graphql<{ deleteAgent: boolean }>(DELETE_AGENT_MUTATION, { id });
  return data.deleteAgent;
}

/** How the table names an agent's type. There is only one. */
export function agentTypeLabel(_type: AgentType): string {
  return 'LLM Agent';
}
