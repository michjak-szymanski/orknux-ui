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
  /**
   * How much of its model's context window one of its sessions may take back,
   * as a percentage of that window. Null is the built-in default.
   *
   * One number rather than five: how many turns come back, how much of them,
   * how much of what its tools returned and how much of any one result are all
   * worked out from it, server-side. Nothing here does that arithmetic — ask
   * [fetchMemoryBudget] what a share works out to.
   */
  memoryShare: number | null;
}

/**
 * What a session may put back in front of a model, worked out.
 *
 * Every count is in **tokens** and every one is approximate: the server
 * measures characters, which is the unit every model agrees on, and reports
 * them here at four characters to the token. Do not relabel them and do not
 * recompute them — this whole object is one calculation that the mutation
 * saving a share performs as well, and a second copy of it here is a second
 * answer to "may this be saved".
 */
export interface SessionMemoryBudget {
  /** The share asked for; null when nothing is set and the default applies. */
  share: number | null;
  /** The model's context window in tokens, or null where it has none recorded. */
  contextWindow: number | null;
  /** True when the share and the window produced the figures; false when the default did. */
  derived: boolean;
  /** What a session may add to one prompt altogether. */
  totalTokens: number;
  /** Of that, what turns somebody said may take. */
  conversationTokens: number;
  /** And what tool results may take — a separate allowance, not a slice of the one above. */
  toolResultTokens: number;
  /** The most any one tool result may take; a longer one is cut. */
  longestResultTokens: number;
  /** How many said turns come back at most. */
  turns: number;
  /** How many tool lookups are considered: a ceiling on a query, not an allowance. */
  toolResults: number;
  /**
   * Why this share cannot be saved, or null when it can.
   *
   * The sentence `updateAgent` would raise, in the server's own words, naming
   * the model and its numbers. Print it as it arrives: rewording it here would
   * be a second account of a rule this does not own.
   */
  refusal: string | null;
}

const AGENT_FIELDS =
  'id workspaceId name type description systemPrompt enabled modelId modelName mcpServers orknuxAccess shellAccess memoryCatalogs skillCatalogs tools icon memoryShare';

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

const MEMORY_BUDGET_FIELDS =
  'share contextWindow derived totalTokens conversationTokens toolResultTokens longestResultTokens turns toolResults refusal';

const MEMORY_BUDGET_QUERY = `
  query MemoryBudget($workspaceId: ID!, $modelId: ID, $share: Int) {
    memoryBudget(workspaceId: $workspaceId, modelId: $modelId, share: $share) { ${MEMORY_BUDGET_FIELDS} }
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
    /**
     * How much of the model's window a session may take back, 1 to 50, or null
     * for the built-in default.
     *
     * Sent whenever the form saves rather than left out to mean "leave it
     * alone", which is the rule the icon above follows and what lets a screen
     * put it back to the default. A share the chosen model cannot give is
     * refused here, in the same words `memoryBudget` previews.
     */
    memoryShare?: number | null;
  },
): Promise<Agent> {
  const data = await graphql<{ updateAgent: Agent }>(UPDATE_AGENT_MUTATION, { id, input });
  return data.updateAgent;
}

/**
 * What a share would work out to, for the model chosen **in the form**.
 *
 * Asked of a workspace and a model rather than of an agent, deliberately: the
 * form setting a share may have changed the model in the same edit, and a
 * preview read off the stored agent would answer for the model it used to
 * have. So the caller passes what the picker is showing, not `agent.modelId`.
 *
 * It never fails. A share that could not be saved comes back with `refusal`
 * set, which is why a slider can say why while it is being dragged instead of
 * finding out at Save — or, worse, at the provider.
 */
export async function fetchMemoryBudget(
  workspaceId: string,
  modelId: string | null,
  share: number | null,
): Promise<SessionMemoryBudget> {
  const data = await graphql<{ memoryBudget: SessionMemoryBudget }>(MEMORY_BUDGET_QUERY, {
    workspaceId,
    modelId,
    share,
  });
  return data.memoryBudget;
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
