import { graphql } from './client';

export type ProviderType = 'OPENAI' | 'ANTHROPIC' | 'AZURE_OPENAI' | 'GOOGLE_AI' | 'OLLAMA' | 'CUSTOM';
export type ProviderAuthMethod = 'API_KEY' | 'ENTRA_ID';
/** CONNECTED only once a check reached the provider: a stored key is not a working one. */
export type ProviderStatus = 'NOT_CONFIGURED' | 'NOT_CHECKED' | 'CONNECTED' | 'FAILED';
export type ModelKind = 'CHAT' | 'EMBEDDING' | 'COMPLETION' | 'TRANSCRIPTION' | 'SPEECH';

/**
 * The kinds that do not answer a prompt.
 *
 * Anywhere a model is picked to be *talked to* — a chat, an agent, the
 * workspace's own small jobs — these are the wrong answer, and offering one
 * makes a conversation that cannot reply. Listed once so a sixth kind does not
 * have to be remembered in five places.
 */
export const VOICE_KINDS: ModelKind[] = ['TRANSCRIPTION', 'SPEECH'];

/** Whether this model is one that answers, rather than one that hears or reads. */
export function answers(model: { kind: ModelKind }): boolean {
  return !VOICE_KINDS.includes(model.kind);
}
export type ResetInterval = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'NEVER';

/** An LLM provider a workspace reaches models through. Credentials are never returned here. */
export interface ModelProvider {
  id: string;
  workspaceId: string;
  name: string;
  type: ProviderType;
  endpoint: string;
  authMethod: ProviderAuthMethod;
  apiVersion: string | null;
  deploymentName: string | null;
  region: string | null;
  tenantId: string | null;
  clientId: string | null;
  scope: string | null;
  status: ProviderStatus;
  lastCheckMessage: string | null;
  lastCheckedAt: string | null;
  secretSet: boolean;
}

export interface Model {
  id: string;
  providerId: string;
  workspaceId: string;
  providerName: string;
  name: string;
  modelId: string;
  kind: ModelKind;
  contextWindow: number | null;
  maxOutput: number | null;
  enabled: boolean;
  tokenLimit: number | null;
  resetInterval: ResetInterval;
  requestsPerMinute: number | null;
  inputCostPerMillion: number | null;
  outputCostPerMillion: number | null;
  /** Which voice a SPEECH model reads in; null sends none and takes the provider's. */
  voice: string | null;
}

/** A model the provider says it can run; `added` when the catalogue has it already. */
export interface DiscoveredModel {
  modelId: string;
  added: boolean;
}

export interface ModelUsageDay {
  day: string;
  requests: number;
  tokens: number;
}

/** Summed over recorded calls; `empty` when there have been none. */
export interface ModelUsage {
  modelId: string;
  days: number;
  from: string;
  to: string;
  empty: boolean;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  averageLatencyMillis: number;
  costEstimate: number | null;
  requestsChange: number | null;
  tokensChange: number | null;
  latencyChange: number | null;
  series: ModelUsageDay[];
  periodStart: string;
  periodTokens: number;
}

const PROVIDER_FIELDS =
  'id workspaceId name type endpoint authMethod apiVersion deploymentName region tenantId clientId scope ' +
  'status lastCheckMessage lastCheckedAt secretSet';
const MODEL_FIELDS =
  'id providerId workspaceId providerName name modelId kind contextWindow maxOutput enabled ' +
  'tokenLimit resetInterval requestsPerMinute inputCostPerMillion outputCostPerMillion voice';
const USAGE_FIELDS =
  'modelId days from to empty requests inputTokens outputTokens totalTokens averageLatencyMillis ' +
  'costEstimate requestsChange tokensChange latencyChange periodStart periodTokens ' +
  'series { day requests tokens }';

export async function fetchProviders(workspaceId: string): Promise<ModelProvider[]> {
  const data = await graphql<{ modelProviders: ModelProvider[] }>(
    `query ModelProviders($workspaceId: ID!) { modelProviders(workspaceId: $workspaceId) { ${PROVIDER_FIELDS} } }`,
    { workspaceId },
  );
  return data.modelProviders;
}

export async function fetchProvider(id: string): Promise<ModelProvider | null> {
  const data = await graphql<{ modelProvider: ModelProvider | null }>(
    `query ModelProvider($id: ID!) { modelProvider(id: $id) { ${PROVIDER_FIELDS} } }`,
    { id },
  );
  return data.modelProvider;
}

export async function fetchModels(workspaceId: string): Promise<Model[]> {
  const data = await graphql<{ models: Model[] }>(
    `query Models($workspaceId: ID!) { models(workspaceId: $workspaceId) { ${MODEL_FIELDS} } }`,
    { workspaceId },
  );
  return data.models;
}

export async function fetchModel(id: string): Promise<Model | null> {
  const data = await graphql<{ model: Model | null }>(
    `query Model($id: ID!) { model(id: $id) { ${MODEL_FIELDS} } }`,
    { id },
  );
  return data.model;
}

/**
 * What the provider itself offers. Asks the provider, so it can fail the way a
 * connection check fails — the caller shows why rather than an empty list.
 */
export async function fetchDiscoveredModels(providerId: string): Promise<DiscoveredModel[]> {
  const data = await graphql<{ discoveredModels: DiscoveredModel[] }>(
    `query DiscoveredModels($providerId: ID!) { discoveredModels(providerId: $providerId) { modelId added } }`,
    { providerId },
  );
  return data.discoveredModels;
}

export async function fetchModelUsage(id: string, days = 30): Promise<ModelUsage> {
  const data = await graphql<{ modelUsage: ModelUsage }>(
    `query ModelUsage($id: ID!, $days: Int!) { modelUsage(id: $id, days: $days) { ${USAGE_FIELDS} } }`,
    { id, days },
  );
  return data.modelUsage;
}

export interface ProviderInput {
  name: string;
  type: ProviderType;
  endpoint: string;
  authMethod: ProviderAuthMethod;
  /** Undefined leaves a stored credential alone; empty clears it. */
  secret?: string;
  apiVersion?: string | null;
  deploymentName?: string | null;
  region?: string | null;
  tenantId?: string | null;
  clientId?: string | null;
  scope?: string | null;
}

export async function createProvider(
  workspaceId: string,
  input: ProviderInput,
): Promise<ModelProvider> {
  const data = await graphql<{ createModelProvider: ModelProvider }>(
    `mutation CreateModelProvider($input: CreateModelProviderInput!) {
       createModelProvider(input: $input) { ${PROVIDER_FIELDS} }
     }`,
    { input: { workspaceId, ...input } },
  );
  return data.createModelProvider;
}

export async function updateProvider(id: string, input: ProviderInput): Promise<ModelProvider> {
  const data = await graphql<{ updateModelProvider: ModelProvider }>(
    `mutation UpdateModelProvider($id: ID!, $input: UpdateModelProviderInput!) {
       updateModelProvider(id: $id, input: $input) { ${PROVIDER_FIELDS} }
     }`,
    { id, input },
  );
  return data.updateModelProvider;
}

export async function removeProvider(id: string): Promise<boolean> {
  const data = await graphql<{ removeModelProvider: boolean }>(
    'mutation RemoveModelProvider($id: ID!) { removeModelProvider(id: $id) }',
    { id },
  );
  return data.removeModelProvider;
}

/** Asks the provider whether it answers; what comes back is what it said. */
export async function testProvider(id: string): Promise<ModelProvider> {
  const data = await graphql<{ testModelProvider: ModelProvider }>(
    `mutation TestModelProvider($id: ID!) { testModelProvider(id: $id) { ${PROVIDER_FIELDS} } }`,
    { id },
  );
  return data.testModelProvider;
}

export async function revealProviderSecret(id: string): Promise<string | null> {
  const data = await graphql<{ revealModelProviderSecret: string | null }>(
    'mutation RevealModelProviderSecret($id: ID!) { revealModelProviderSecret(id: $id) }',
    { id },
  );
  return data.revealModelProviderSecret;
}

export interface ModelDetailsInput {
  name: string;
  modelId: string;
  kind?: ModelKind;
  contextWindow?: number | null;
  maxOutput?: number | null;
  inputCostPerMillion?: number | null;
  outputCostPerMillion?: number | null;
  /** Only asked for on a SPEECH model; null sends none and takes the provider's. */
  voice?: string | null;
}

export async function createModel(
  providerId: string,
  input: Omit<ModelDetailsInput, 'modelId'> & { modelId: string },
): Promise<Model> {
  const data = await graphql<{ createModel: Model }>(
    `mutation CreateModel($input: CreateModelInput!) { createModel(input: $input) { ${MODEL_FIELDS} } }`,
    { input: { providerId, ...input } },
  );
  return data.createModel;
}

export async function updateModel(id: string, input: ModelDetailsInput): Promise<Model> {
  const data = await graphql<{ updateModel: Model }>(
    `mutation UpdateModel($id: ID!, $input: UpdateModelInput!) { updateModel(id: $id, input: $input) { ${MODEL_FIELDS} } }`,
    { id, input },
  );
  return data.updateModel;
}

export interface QuotasInput {
  tokenLimit: number | null;
  resetInterval: ResetInterval;
  requestsPerMinute: number | null;
}

export async function updateModelQuotas(id: string, input: QuotasInput): Promise<Model> {
  const data = await graphql<{ updateModelQuotas: Model }>(
    `mutation UpdateModelQuotas($id: ID!, $input: ModelQuotasInput!) {
       updateModelQuotas(id: $id, input: $input) { ${MODEL_FIELDS} }
     }`,
    { id, input },
  );
  return data.updateModelQuotas;
}

export async function setModelEnabled(id: string, enabled: boolean): Promise<Model> {
  const data = await graphql<{ setModelEnabled: Model }>(
    `mutation SetModelEnabled($id: ID!, $enabled: Boolean!) {
       setModelEnabled(id: $id, enabled: $enabled) { ${MODEL_FIELDS} }
     }`,
    { id, enabled },
  );
  return data.setModelEnabled;
}

export async function removeModel(id: string): Promise<boolean> {
  const data = await graphql<{ removeModel: boolean }>(
    'mutation RemoveModel($id: ID!) { removeModel(id: $id) }',
    { id },
  );
  return data.removeModel;
}

export function providerTypeLabel(type: ProviderType): string {
  switch (type) {
    case 'OPENAI':
      return 'OpenAI';
    case 'ANTHROPIC':
      return 'Anthropic';
    case 'AZURE_OPENAI':
      return 'Azure OpenAI';
    case 'GOOGLE_AI':
      return 'Google AI';
    case 'OLLAMA':
      return 'Ollama';
    case 'CUSTOM':
      return 'Custom';
  }
}

/**
 * "Connected" is reserved for a provider that answered a check. Everything else
 * says what it actually is, rather than borrowing the word.
 */
export function providerStatusLabel(status: ProviderStatus): string {
  switch (status) {
    case 'CONNECTED':
      return 'Connected';
    case 'FAILED':
      return 'Check failed';
    case 'NOT_CHECKED':
      return 'Not checked';
    case 'NOT_CONFIGURED':
      return 'Not connected';
  }
}

export function modelKindLabel(kind: ModelKind): string {
  switch (kind) {
    case 'CHAT':
      return 'Chat';
    case 'EMBEDDING':
      return 'Embedding';
    case 'COMPLETION':
      return 'Completion';
    case 'TRANSCRIPTION':
      return 'Transcription';
    case 'SPEECH':
      return 'Speech';
  }
}

export function resetIntervalLabel(interval: ResetInterval): string {
  switch (interval) {
    case 'DAILY':
      return 'Daily';
    case 'WEEKLY':
      return 'Weekly';
    case 'MONTHLY':
      return 'Monthly';
    case 'NEVER':
      return 'Never';
  }
}

/** 4200000 -> "4.2M", 12847 -> "12,847": big numbers shorten, countable ones do not. */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US');
}

export function formatTokens(value: number): string {
  return value.toLocaleString('en-US');
}

/** 1234 -> "1.2s", 850 -> "850ms". */
export function formatLatency(millis: number): string {
  if (millis >= 1000) return `${(millis / 1000).toFixed(1)}s`;
  return `${Math.round(millis)}ms`;
}

/** 0.082 -> "+8.2%"; null when there was no earlier window to compare with. */
export function formatChange(fraction: number | null): string | null {
  if (fraction === null) return null;
  const percent = (fraction * 100).toFixed(1);
  return `${fraction >= 0 ? '+' : ''}${percent}%`;
}
