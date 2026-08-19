import { graphql } from './client';

/**
 * One installation-wide answer to "does this address need a proxy".
 *
 * There is no password on this and no way to ask for one. `passwordSet` is
 * everything the server will say about a stored password, which is all the form
 * needs in order to tell somebody it is about to replace one.
 */
export interface ProxyRule {
  id: string;
  name: string;
  /**
   * A regular expression, matched against the whole request URL and found
   * anywhere in it rather than end to end, ignoring case.
   */
  pattern: string;
  proxyHost: string;
  proxyPort: number;
  username: string | null;
  passwordSet: boolean;
  enabled: boolean;
  /** Ascending. The first enabled rule that matches a URL is the one used. */
  position: number;
  createdAt: string;
  lastModifiedAt: string;
}

export interface ProxyRuleInput {
  name: string;
  pattern: string;
  proxyHost: string;
  proxyPort: number;
  username?: string | null;
  /** Left out entirely to keep the stored password; empty to clear it. */
  password?: string | null;
  enabled?: boolean;
}

/** What would happen to one URL, for the box that asks. */
export interface ProxyRoute {
  url: string;
  matched: ProxyRule | null;
  /** Rules that also match but never get the chance. */
  beaten: ProxyRule[];
  refusedBecause: string | null;
  proxyProblem: string | null;
}

const RULE_FIELDS =
  'id name pattern proxyHost proxyPort username passwordSet enabled position createdAt lastModifiedAt';

const PROXY_RULES_QUERY = `
  query ProxyRules {
    proxyRules { ${RULE_FIELDS} }
  }
`;

const PROXY_ROUTE_QUERY = `
  query ProxyRoute($url: String!) {
    proxyRoute(url: $url) {
      url
      matched { ${RULE_FIELDS} }
      beaten { ${RULE_FIELDS} }
      refusedBecause
      proxyProblem
    }
  }
`;

const CREATE_PROXY_RULE_MUTATION = `
  mutation CreateProxyRule($input: ProxyRuleInput!) {
    createProxyRule(input: $input) { ${RULE_FIELDS} }
  }
`;

const UPDATE_PROXY_RULE_MUTATION = `
  mutation UpdateProxyRule($id: ID!, $input: ProxyRuleInput!) {
    updateProxyRule(id: $id, input: $input) { ${RULE_FIELDS} }
  }
`;

const SET_PROXY_RULE_ENABLED_MUTATION = `
  mutation SetProxyRuleEnabled($id: ID!, $enabled: Boolean!) {
    setProxyRuleEnabled(id: $id, enabled: $enabled) { ${RULE_FIELDS} }
  }
`;

const MOVE_PROXY_RULE_MUTATION = `
  mutation MoveProxyRule($id: ID!, $up: Boolean!) {
    moveProxyRule(id: $id, up: $up) { ${RULE_FIELDS} }
  }
`;

const DELETE_PROXY_RULE_MUTATION = `
  mutation DeleteProxyRule($id: ID!) { deleteProxyRule(id: $id) }
`;

export async function fetchProxyRules(): Promise<ProxyRule[]> {
  const data = await graphql<{ proxyRules: ProxyRule[] }>(PROXY_RULES_QUERY);
  return data.proxyRules;
}

/**
 * Which rule a URL would go through, answered by the thing that actually routes
 * requests. Worked out here instead, it would be a second implementation of the
 * matching, and the day the two disagreed this screen would be the confident one.
 */
export async function fetchProxyRoute(url: string): Promise<ProxyRoute> {
  const data = await graphql<{ proxyRoute: ProxyRoute }>(PROXY_ROUTE_QUERY, { url });
  return data.proxyRoute;
}

export async function createProxyRule(input: ProxyRuleInput): Promise<ProxyRule> {
  const data = await graphql<{ createProxyRule: ProxyRule }>(CREATE_PROXY_RULE_MUTATION, { input });
  return data.createProxyRule;
}

export async function updateProxyRule(id: string, input: ProxyRuleInput): Promise<ProxyRule> {
  const data = await graphql<{ updateProxyRule: ProxyRule }>(UPDATE_PROXY_RULE_MUTATION, { id, input });
  return data.updateProxyRule;
}

export async function setProxyRuleEnabled(id: string, enabled: boolean): Promise<ProxyRule> {
  const data = await graphql<{ setProxyRuleEnabled: ProxyRule }>(SET_PROXY_RULE_ENABLED_MUTATION, {
    id,
    enabled,
  });
  return data.setProxyRuleEnabled;
}

/** Gives back the whole order, because moving one rule changes what its neighbours do. */
export async function moveProxyRule(id: string, up: boolean): Promise<ProxyRule[]> {
  const data = await graphql<{ moveProxyRule: ProxyRule[] }>(MOVE_PROXY_RULE_MUTATION, { id, up });
  return data.moveProxyRule;
}

export async function deleteProxyRule(id: string): Promise<boolean> {
  const data = await graphql<{ deleteProxyRule: boolean }>(DELETE_PROXY_RULE_MUTATION, { id });
  return data.deleteProxyRule;
}
