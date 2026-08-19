import { graphql } from './client';

export type WorkflowStatus = 'DRAFT' | 'PUBLISHED';
export type NodeKind = 'TRIGGER' | 'AGENT' | 'ACTION' | 'CONDITION' | 'OBJECT';


/**
 * Which side of a node its input and output sit on.
 *
 * Layout only - it moves the handles and nothing else - so a graph can run
 * down a screen instead of off the side of it.
 */
export type NodeOrientation = 'LEFT_TO_RIGHT' | 'TOP_TO_BOTTOM' | 'RIGHT_TO_LEFT' | 'BOTTOM_TO_TOP';

export interface GraphNode {
  /** Stable within a workflow; what edges refer to. */
  key: string;
  kind: NodeKind;
  name: string;
  description: string | null;
  /** The agent an AGENT node instances; the agent supplies its model. */
  agentId: string | null;
  /** The trigger definition a TRIGGER node instances; null until one is picked. */
  triggerId: string | null;
  /** The action an ACTION node instances; null until one is picked. */
  actionId: string | null;
  /** The condition a CONDITION node asks; null until one is picked. */
  conditionId: string | null;
  /**
   * The saved shape an OBJECT node makes; null is a shape of the node's own,
   * whose fields are simply the ones it holds.
   */
  objectId?: string | null;
  /**
   * What this node calls what it produces, so a later node can point a
   * reference at it. Null hands the output on unchanged.
   */
  outputName?: string | null;
  /** Which icon the canvas draws on this node; a name from the interface's own set. */
  icon?: string | null;
  /** Which way round the node faces; null is the left-to-right it always was. */
  orientation?: NodeOrientation | null;
  /**
   * What a condition node's two ways out are called.
   *
   * Null means the default - Yes and No - which is what most conditions want.
   * "Escalate" and "File it" is what makes a graph legible at a glance, so the
   * words belong to the node rather than to the edges leaving it.
   */
  yesLabel?: string | null;
  noLabel?: string | null;
  /**
   * What this node passes, decided here rather than on the definition. Seeded
   * from the action when one is picked; editing it touches only this node.
   */
  mappings?: NodeMapping[];
  /** What the node needs; the server reads it off the catalogue entry. */
  inputs?: GraphPort[];
  /** What it hands on. */
  outputs?: GraphPort[];
  x: number;
  y: number;
}

/** One parameter and what the node puts in it: an expression, or a plain value. */
/** Whether a parameter holds something written or something read from the run. */
export type MappingMode = 'VALUE' | 'REFERENCE';

/** One parameter and what fills it: a written value, or a field read from the run. */
export interface NodeMapping {
  name: string;
  /** The written value, or the field a reference reads. */
  expression: string;
  mode: MappingMode;
  /** Which node produces the referenced field; what the canvas draws a line from. */
  sourceNodeKey?: string | null;
}

/** How much a problem matters: an error is refused on save, a warning is advice. */
export type GraphProblemSeverity = 'ERROR' | 'WARNING';

export interface GraphProblem {
  severity: GraphProblemSeverity;
  /** The node it is about; an edge is reported against the node it reaches. */
  nodeKey: string;
  message: string;
}

/** What a node needs or hands on, read off whatever it points at. */
export interface GraphPort {
  name: string;
  type: string;
  display: string;
}

/** Which way out of a condition an edge leaves by. */
export type EdgeBranch = 'YES' | 'NO';

export interface GraphEdge {
  source: string;
  target: string;
  /**
   * The answer this edge carries, or absent for every edge that is not
   * leaving a condition - which is most of them, and every edge drawn before
   * branches existed.
   */
  branch?: EdgeBranch | null;
}

export interface WorkflowGraph {
  workflowId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  /**
   * Whether the workspace has it switched on. Off means nothing starts it by
   * itself - no trigger, no schedule, no tool call - while Run still does.
   */
  enabled: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** What the graph is missing, worst first; empty when it holds together. */
  problems: GraphProblem[];
}

const GRAPH_FIELDS = `
  workflowId
  name
  description
  status
  enabled
  nodes {
    key kind name description agentId triggerId actionId conditionId objectId outputName icon orientation
    yesLabel noLabel x y
    mappings { name expression mode sourceNodeKey }
    inputs { name type display }
    outputs { name type display }
  }
  edges { source target branch }
  problems { severity nodeKey message }
`;

const GRAPH_QUERY = `
  query WorkflowGraph($workspaceId: ID!, $workflowId: ID!) {
    workflowGraph(workspaceId: $workspaceId, workflowId: $workflowId) { ${GRAPH_FIELDS} }
  }
`;

const SAVE_GRAPH_MUTATION = `
  mutation SaveWorkflowGraph($workspaceId: ID!, $workflowId: ID!, $input: WorkflowGraphInput!) {
    saveWorkflowGraph(workspaceId: $workspaceId, workflowId: $workflowId, input: $input) { ${GRAPH_FIELDS} }
  }
`;

const PREVIEW_QUERY = `
  query WorkflowGraphPreview($workspaceId: ID!, $workflowId: ID!, $input: WorkflowGraphInput!) {
    workflowGraphPreview(workspaceId: $workspaceId, workflowId: $workflowId, input: $input) { ${GRAPH_FIELDS} }
  }
`;

const PUBLISH_MUTATION = `
  mutation PublishWorkflow($workspaceId: ID!, $workflowId: ID!) {
    publishWorkflow(workspaceId: $workspaceId, workflowId: $workflowId) { ${GRAPH_FIELDS} }
  }
`;

export async function fetchWorkflowGraph(workspaceId: string, workflowId: string): Promise<WorkflowGraph> {
  const data = await graphql<{ workflowGraph: WorkflowGraph }>(GRAPH_QUERY, { workspaceId, workflowId });
  return data.workflowGraph;
}

export async function saveWorkflowGraph(
  workspaceId: string,
  workflowId: string,
  input: { nodes: GraphNode[]; edges: GraphEdge[] },
): Promise<WorkflowGraph> {
  const data = await graphql<{ saveWorkflowGraph: WorkflowGraph }>(SAVE_GRAPH_MUTATION, {
    workspaceId,
    workflowId,
    input,
  });
  return data.saveWorkflowGraph;
}

/**
 * What the graph on screen would be, without writing it down.
 *
 * The same answer a save gives — what each node needs and gives, and what is
 * wrong with the shape — so the editor can show both while a workflow is still
 * being drawn rather than only after it has been saved.
 */
export async function fetchWorkflowGraphPreview(
  workspaceId: string,
  workflowId: string,
  input: { nodes: GraphNode[]; edges: GraphEdge[] },
): Promise<WorkflowGraph> {
  const data = await graphql<{ workflowGraphPreview: WorkflowGraph }>(PREVIEW_QUERY, {
    workspaceId,
    workflowId,
    input,
  });
  return data.workflowGraphPreview;
}

/**
 * What the action suggests for a node just pointed at it. Asked when the action
 * is picked, so the panel can show parameters before anything has been saved.
 */
export async function fetchActionParameterDefaults(
  workspaceId: string,
  actionId: string,
): Promise<NodeMapping[]> {
  const data = await graphql<{ actionParameterDefaults: NodeMapping[] }>(
    `query ActionParameterDefaults($workspaceId: ID!, $actionId: ID!) {
       actionParameterDefaults(workspaceId: $workspaceId, actionId: $actionId) { name expression mode sourceNodeKey }
     }`,
    { workspaceId, actionId },
  );
  return data.actionParameterDefaults;
}

export async function publishWorkflow(workspaceId: string, workflowId: string): Promise<WorkflowGraph> {
  const data = await graphql<{ publishWorkflow: WorkflowGraph }>(PUBLISH_MUTATION, { workspaceId, workflowId });
  return data.publishWorkflow;
}

/** The label shown above the node name, and its accent colour. */
export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  TRIGGER: 'Trigger',
  AGENT: 'LLM Agent',
  ACTION: 'Action',
  CONDITION: 'Condition',
  OBJECT: 'Object',
};

