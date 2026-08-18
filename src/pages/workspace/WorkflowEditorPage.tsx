import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  getBezierPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import type { Connection, Edge, EdgeProps, Node, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  NODE_KIND_LABEL,
  fetchActionParameterDefaults,
  fetchWorkflowGraph,
  fetchWorkflowGraphPreview,
  publishWorkflow,
  saveWorkflowGraph,
} from '../../api/graph';
import type {
  GraphNode,
  GraphPort,
  GraphProblem,
  MappingMode,
  NodeKind,
  NodeMapping,
  WorkflowStatus,
} from '../../api/graph';
import type { SessionUser } from '../../api/session';
import { fetchWorkspaceActions } from '../../api/actions';
import { fetchWorkspaceAgents } from '../../api/agents';
import type { Action } from '../../api/actions';
import type { Agent } from '../../api/agents';
import { fetchWorkspaceConditions } from '../../api/conditions';
import type { Condition } from '../../api/conditions';
import { createObject, fetchWorkspaceObjects } from '../../api/objects';
import type { WorkflowObject } from '../../api/objects';
import { fetchWorkspaceTriggers } from '../../api/triggers';
import type { Trigger } from '../../api/triggers';
import { removeWorkflow } from '../../api/workflows';
import arrowLeftIcon from '../../assets/arrow-left.svg';
import pencilIcon from '../../assets/pencil.svg';
import { ActionDialog } from '../../components/ActionDialog';
import { AppShell } from '../../components/AppShell';
import { ConditionDialog } from '../../components/ConditionDialog';
import { CreateAgentDialog } from '../../components/CreateAgentDialog';
import { NameDialog } from '../../components/NameDialog';
import { CreateTriggerDialog } from '../../components/CreateTriggerDialog';
import { FieldPicker } from '../../components/FieldPicker';
import type { FieldOption } from '../../components/FieldPicker';
import { Icon, IconPickerDialog } from '../../components/IconPicker';
import { TrashIcon } from '../../components/TrashIcon';
import { WorkflowConfirmDialog } from '../../components/WorkflowConfirmDialog';
import { shellUser } from '../../session/user';
import styles from './WorkflowEditorPage.module.css';

export interface WorkflowEditorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** What each canvas node carries; React Flow keeps it under `data`. */
interface NodeData extends Record<string, unknown> {
  kind: NodeKind;
  name: string;
  description: string | null;
  /** The agent an agent node instances; it supplies the model and instructions. */
  agentId: string | null;
  /** The catalogue entry a trigger node instances; what wires an event here. */
  triggerId: string | null;
  /** The action an action node instances; what it does when the run reaches it. */
  actionId: string | null;
  /** The condition a condition node asks; the run stops when it does not hold. */
  conditionId: string | null;
  /**
   * The saved shape an object node makes; null is a shape of the node's own,
   * whose fields are the ones it holds.
   */
  objectId: string | null;
  /**
   * What this node calls what it produces, so a later node can point a
   * reference at it. Only an agent node has one.
   */
  outputName: string | null;
  /** Which icon the canvas draws on this node; empty leaves the plain node. */
  icon: string | null;
  /**
   * What this node passes on. Seeded from the action when one is picked and the
   * node's own from then on — editing it here never writes to the definition,
   * so two nodes running the same action can pass different things.
   */
  mappings: NodeMapping[];
  /**
   * What the server worked out this node needs and gives, from the last load or
   * save. Carried on the node so the canvas can show the data flowing through
   * the graph rather than only the order things happen in.
   */
  inputs?: GraphPort[];
  outputs?: GraphPort[];
}

/**
 * Order matters as much as content: the panel lists them as they are held.
 *
 * The mode counts too. Switching a parameter between a value and a reference
 * leaves the text alone, and comparing only the text would call that no change —
 * so the switch would move, the canvas would not, and the save would keep the
 * old meaning.
 */
function sameMappings(left: NodeMapping[], right: NodeMapping[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (mapping, index) =>
        mapping.name === right[index].name &&
        mapping.expression === right[index].expression &&
        mapping.mode === right[index].mode &&
        (mapping.sourceNodeKey ?? null) === (right[index].sourceNodeKey ?? null),
    )
  );
}

/** The whole of a workspace's catalogue fits in the picker. */
const TRIGGER_PAGE_SIZE = 100;
const ACTION_PAGE_SIZE = 100;
const CONDITION_PAGE_SIZE = 100;
const AGENT_PAGE_SIZE = 100;
const OBJECT_PAGE_SIZE = 100;

/**
 * What an agent node can be given. `prompt` is the question it is asked, and
 * `systemPrompt` replaces the agent's own briefing for this node only. Either
 * can be written out or pointed at a field, so a node can ask about one part of
 * what arrived rather than handing over the whole payload.
 */
const AGENT_PARAMETERS = ['prompt', 'systemPrompt'];

/** How long a graph has to stop changing before it is worth asking about. */
const PREVIEW_PAUSE_MS = 400;

/**
 * How long the panel waits before the canvas follows what is being typed.
 *
 * The canvas keeping up is the point of the live edit, but keeping up with
 * every keystroke made a node redraw its fields six times while a name was
 * typed - chips appearing, disappearing and resizing the box under the
 * cursor. Long enough to be after a word, short enough to feel immediate.
 */
const CANVAS_PAUSE_MS = 250;

/**
 * The node's own version of what the panel holds.
 *
 * A field with no name is not a field yet: it cannot be pointed at, the server
 * cannot work out a port for it, and drawn on the node it is an empty chip.
 * It stays in the panel, where somebody is in the middle of naming it, and it
 * is left out of everything downstream of that - which is what stops an empty
 * one being saved and coming back.
 */
function named(data: NodeData): NodeData {
  return { ...data, mappings: data.mappings.filter((mapping) => mapping.name.trim() !== '') };
}

/**
 * The panel's fields, with one name held at what it was.
 *
 * While a field's name is being typed, the node keeps the name the field had
 * and takes the new one when the input is left. Following the typing itself
 * meant the chip renamed letter by letter through a server round trip and
 * vanished outright while a rename backspaced through empty - a node that
 * blinks and jumps under the cursor. Nothing about the field is lost: the
 * panel has the live name, and the canvas is a picture of it, a beat behind.
 */
function withHeldName(data: NodeData, held: { index: number; was: string } | null): NodeData {
  if (held === null) return data;
  return {
    ...data,
    mappings: data.mappings.map((mapping, at) => (at === held.index ? { ...mapping, name: held.was } : mapping)),
  };
}

/** Enough to see what a line is for; the panel has the rest. */
const FIELDS_ON_A_LINE = 4;

/** One thing a line carries: the field read, and the parameter it answers. */
interface Carried {
  from: string;
  to: string;
}

/** How far a label has been dragged from where its line would have put it. */
export interface LabelOffset {
  x: number;
  y: number;
}

const NO_OFFSET: LabelOffset = { x: 0, y: 0 };

/**
 * A line, and what it carries written beside it — one field per row.
 *
 * The label is HTML rather than the built-in one, which is a single run of SVG
 * text: two fields on one row read as one long sentence, and a node passing four
 * of them produced a label wider than the graph.
 */
function CarriedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const says = (data?.says as Carried[] | undefined) ?? [];
  const shown = says.slice(0, FIELDS_ON_A_LINE);
  const rest = says.length - shown.length;

  /*
   * Where this label has been dragged to.
   *
   * A busy graph stacks labels on each other and over nodes, and the line they
   * belong to is what decides where they land. Dragging moves the label alone:
   * the edge, and what it says, are untouched by it.
   */
  const offset = (data?.offset as LabelOffset | undefined) ?? NO_OFFSET;
  const moveLabel = data?.onMoveLabel as ((edgeId: string, to: LabelOffset) => void) | undefined;
  // The label sits in flow coordinates; a pointer moves in screen ones, and the
  // difference between them is exactly the zoom.
  const zoom = useStore((state) => state.transform[2]);
  const [drag, setDrag] = useState<{ x: number; y: number; from: LabelOffset } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (moveLabel === undefined || event.button !== 0) return;
    // Kept from the canvas underneath, which would otherwise pan instead.
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: event.clientX, y: event.clientY, from: offset });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (drag === null || moveLabel === undefined) return;
    event.stopPropagation();
    moveLabel(id, {
      x: drag.from.x + (event.clientX - drag.x) / zoom,
      y: drag.from.y + (event.clientY - drag.y) / zoom,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (drag === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  };

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {says.length > 0 && (
        <EdgeLabelRenderer>
          <ul
            className={[styles.edgeLabel, drag !== null ? styles.edgeLabelDragging : '', 'nodrag', 'nopan']
              .filter(Boolean)
              .join(' ')}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX + offset.x}px, ${labelY + offset.y}px)`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={(event) => {
              // Back to where the line would have put it — for a label dragged
              // somewhere unhelpful and now hard to aim at.
              event.stopPropagation();
              moveLabel?.(id, NO_OFFSET);
            }}
            title={moveLabel === undefined ? undefined : 'Drag to move; double-click to put it back'}
          >
            {shown.map((one) => (
              <li className={styles.edgeLabelRow} key={`${one.from}->${one.to}`}>
                <span className={styles.edgeLabelFrom}>{one.from}</span>
                <span className={styles.edgeLabelArrow} aria-hidden="true">
                  →
                </span>
                <span className={styles.edgeLabelTo}>{one.to}</span>
              </li>
            ))}
            {rest > 0 && (
              <li className={`${styles.edgeLabelRow} ${styles.edgeLabelMore}`}>
                +{rest} more
              </li>
            )}
          </ul>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { carried: CarriedEdge };

/** A name for the next field of a shape being made up as it is drawn. */
function nextFieldName(held: NodeMapping[]): string {
  for (let at = held.length + 1; ; at += 1) {
    const name = `field${at}`;
    if (!held.some((one) => one.name === name)) return name;
  }
}

/** The agent's own briefing as it stands now, or empty when there is none. */
function briefingFor(draft: NodeData, agents: Agent[]): string {
  if (draft.kind !== 'AGENT') return '';
  return agents.find((candidate) => candidate.id === draft.agentId)?.systemPrompt?.trim() ?? '';
}

/** What an empty box would fall back to, shown in grey. */
function parameterPlaceholder(draft: NodeData, name: string): string | undefined {
  if (draft.kind !== 'AGENT') return undefined;

  return name === 'prompt'
    ? 'Everything that reached this node'
    : name === 'systemPrompt'
      ? "The agent's own briefing"
      : undefined;
}

/**
 * What each kind is in the minimap, which is its accent bar's colour.
 *
 * Written out rather than taken from the tokens because the minimap draws SVG
 * shapes and a `var(--…)` in a fill is not resolved. At that size the shape says
 * nothing on its own — one grey block looks like every other — so the colour is
 * the only thing that says which node you are looking at.
 */
const KIND_COLOUR: Record<NodeKind, string> = {
  TRIGGER: '#22c55e',
  AGENT: '#5f8467',
  ACTION: '#06b6d4',
  CONDITION: '#f59e0b',
  OBJECT: '#a855f7',
};

const KIND_CLASS: Record<NodeKind, string> = {
  TRIGGER: 'trigger',
  AGENT: 'agent',
  ACTION: 'action',
  CONDITION: 'condition',
  OBJECT: 'objectNode',
};

function GraphNodeView({ data, selected }: NodeProps) {
  const node = data as NodeData;
  const hasInput = node.kind !== 'TRIGGER';

  return (
    <div className={selected ? `${styles.node} ${styles.nodeSelected}` : styles.node}>
      {/*
        Only on the selected node, so the canvas is not covered in handles. A
        node grows on its own to fit what it holds; this is for when a graph
        reads better with one node wider than the rest.
      */}
      <NodeResizer isVisible={selected} minWidth={220} minHeight={96} />
      <span className={`${styles.accentBar} ${styles[KIND_CLASS[node.kind]]}`} aria-hidden="true" />
      {hasInput && <Handle className={styles.handle} type="target" position={Position.Left} />}
      <Handle className={styles.handle} type="source" position={Position.Right} />

      <div className={styles.nodeContent}>
        <div className={styles.metaRow}>
          {node.icon !== null && <Icon name={node.icon} className={styles.nodeIcon} />}
          <span className={styles.kindLabel}>{NODE_KIND_LABEL[node.kind]}</span>
          {node.kind === 'AGENT' && <span className={styles.activeDot} aria-hidden="true" />}
        </div>
        <div className={styles.nodeText}>
          <span className={styles.nodeName}>{node.name}</span>
          <span className={styles.nodeDescription}>{node.description ?? ''}</span>
        </div>

        {/*
          What flows through, not just what runs next. The edges say the order;
          these say what is actually carried along them — which is the thing you
          cannot otherwise see until a run either works or does not.
        */}
        {((node.inputs?.length ?? 0) > 0 || (node.outputs?.length ?? 0) > 0) && (
          <div className={styles.portRows}>
            {(node.inputs?.length ?? 0) > 0 && (
              <div className={styles.portRow}>
                <span className={styles.portArrow} aria-hidden="true">
                  ↓
                </span>
                <span className={styles.portChips}>
                  {node.inputs?.map((port) => (
                    <span className={styles.portChip} key={`in-${port.name}`} title={`Needs ${port.display}`}>
                      {port.name}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {(node.outputs?.length ?? 0) > 0 && (
              <div className={styles.portRow}>
                <span className={`${styles.portArrow} ${styles.portArrowOut}`} aria-hidden="true">
                  ↑
                </span>
                <span className={styles.portChips}>
                  {node.outputs?.map((port) => (
                    <span
                      className={`${styles.portChip} ${styles.portChipOut}`}
                      key={`out-${port.name}`}
                      title={`Gives ${port.display}`}
                    >
                      {port.name}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { graphNode: GraphNodeView };

export function WorkflowEditorPage(props: WorkflowEditorPageProps) {
  // The canvas hooks need the provider above them.
  return (
    <ReactFlowProvider>
      <WorkflowEditor {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowEditor({ session, onSignOut }: WorkflowEditorPageProps) {
  const { workspaceId = '', workflowId = '' } = useParams();

  /*
   * Where each edge's label has been dragged to, per workflow.
   *
   * Kept in the browser rather than on the server, because the graph has
   * nowhere to put it: an edge is a source and a target and nothing else. So
   * this is one person's arrangement of their own view, and it behaves like
   * one — it does not travel to anybody else looking at the same workflow.
   */
  const labelKey = `orknux.edge-labels.${workflowId}`;
  const [labelOffsets, setLabelOffsets] = useState<Record<string, LabelOffset>>({});

  useEffect(() => {
    try {
      const held = window.localStorage.getItem(labelKey);
      setLabelOffsets(held === null ? {} : (JSON.parse(held) as Record<string, LabelOffset>));
    } catch {
      // Unreadable or turned off: the labels simply start where the lines put them.
      setLabelOffsets({});
    }
  }, [labelKey]);

  const moveLabel = useCallback(
    (edgeId: string, to: LabelOffset) => {
      setLabelOffsets((held) => {
        const next = { ...held };
        // Back at the line's own position is the absence of an offset, not an
        // offset of nothing, so a reset leaves nothing behind to remember.
        if (to.x === 0 && to.y === 0) delete next[edgeId];
        else next[edgeId] = to;
        try {
          window.localStorage.setItem(labelKey, JSON.stringify(next));
        } catch {
          // A browser that will not remember is no reason to refuse the drag.
        }
        return next;
      });
    },
    [labelKey],
  );
  const navigate = useNavigate();
  const { updateNode } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<WorkflowStatus>('DRAFT');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<NodeData | null>(null);
  /** The field whose name is mid-edit, if any, and the name it had. */
  const [fieldEdit, setFieldEdit] = useState<{ index: number; was: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [browsingIcons, setBrowsingIcons] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  /*
   * Which definition is being made from the panel, if any.
   *
   * A node kind rather than a boolean per picker: only one node is selected, so
   * only one of these dialogs can be open, and the kind says which.
   */
  const [creating, setCreating] = useState<NodeKind | null>(null);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [justUpdated, setJustUpdated] = useState(false);
  const [problems, setProblems] = useState<GraphProblem[]>([]);
  /** What the server said each node needs and gives, from the last save or load. */
  const [ports, setPorts] = useState<Record<string, { inputs?: GraphPort[]; outputs?: GraphPort[] }>>({});

  function portsFor(key: string | null) {
    return key === null ? undefined : ports[key];
  }

  /**
   * Every field any other node produces, for a parameter to be pointed at.
   *
   * The whole graph rather than only what is upstream: a graph is drawn in any
   * order, and refusing to offer a field because the edge has not been drawn yet
   * would be the editor arguing with someone mid-thought. What cannot actually
   * reach the node is the validator's business, and it says so.
   *
   * A trigger's fields are stored with their `trigger.` prefix, so they keep
   * reading the event that started the run even if a later node produces a field
   * by the same name.
   */
  const fieldOptions = useMemo<FieldOption[]>(() => {
    return nodes
      .filter((node) => node.id !== selectedKey)
      .flatMap((node) => {
        const data = node.data as NodeData;
        const produced = ports[node.id]?.outputs ?? data.outputs ?? [];
        return produced.map((port) => ({
          nodeKey: node.id,
          nodeName: data.name === '' ? node.id : data.name,
          field: port.name,
          expression: data.kind === 'TRIGGER' ? `trigger.${port.name}` : port.name,
          type: port.type,
        }));
      });
  }, [nodes, ports, selectedKey]);

  /**
   * What each pair of nodes actually carries between them: one entry per
   * parameter pointed at a field the other node produces, read as
   * `reply → content`.
   *
   * Which node a reference reads from is the node's own to say, and it does —
   * but a graph drawn before that was recorded says nothing, so the field is
   * looked up among what every node produces. Longest match first: `response`
   * is produced whole, and `response.status` is a field of it.
   */
  const carried = useMemo(() => {
    const producers = new Map<string, string>();
    nodes.forEach((node) => {
      const data = node.data as NodeData;
      const produced = ports[node.id]?.outputs ?? data.outputs ?? [];
      produced.forEach((port) => {
        const name = data.kind === 'TRIGGER' ? `trigger.${port.name}` : port.name;
        if (!producers.has(name)) producers.set(name, node.id);
      });
    });

    function producerOf(mapping: NodeMapping): string | null {
      if (mapping.sourceNodeKey != null && nodes.some((node) => node.id === mapping.sourceNodeKey)) {
        return mapping.sourceNodeKey;
      }
      const parts = mapping.expression.trim().split('.').filter((part) => part !== '');
      for (let take = parts.length; take > 0; take -= 1) {
        const held = producers.get(parts.slice(0, take).join('.'));
        if (held !== undefined) return held;
      }
      return null;
    }

    const between = new Map<string, { source: string; target: string; says: Carried[] }>();
    nodes.forEach((node) => {
      const data = node.data as NodeData;
      data.mappings.forEach((mapping) => {
        if (mapping.mode !== 'REFERENCE' || mapping.expression.trim() === '') return;
        const from = producerOf(mapping);
        if (from === null || from === node.id) return;

        const pair = `${from}->${node.id}`;
        const held = between.get(pair) ?? { source: from, target: node.id, says: [] };
        held.says.push({ from: mapping.expression.trim(), to: mapping.name });
        between.set(pair, held);
      });
    });
    return between;
  }, [nodes, ports]);

  /**
   * The edges as drawn: the graph's own, labelled with what they carry, plus a
   * dashed one wherever a node reads a field from somewhere it is not wired to.
   *
   * Those dashed ones are usually a mistake worth seeing — the validator warns
   * that nothing before the node produces the field — but a line is how somebody
   * notices, rather than reading a list. They are not part of the graph and are
   * never saved: [edges] stays what the workflow is.
   */
  const drawnEdges = useMemo<Edge[]>(() => {
    const carrying = edges.map((edge) => {
      const held = carried.get(`${edge.source}->${edge.target}`);
      if (held === undefined) return edge;
      return {
        ...edge,
        type: 'carried',
        data: { says: held.says, offset: labelOffsets[edge.id], onMoveLabel: moveLabel },
      };
    });

    const loose = [...carried.values()]
      .filter((held) => !edges.some((edge) => edge.source === held.source && edge.target === held.target))
      .map((held) => ({
        id: `reads:${held.source}->${held.target}`,
        source: held.source,
        target: held.target,
        type: 'carried',
        data: {
          says: held.says,
          offset: labelOffsets[`reads:${held.source}->${held.target}`],
          onMoveLabel: moveLabel,
        },
        style: { stroke: 'var(--color-accent-brand)', strokeDasharray: '6 4' },
        // Not the graph's, so not something a drag can move or a key can delete.
        selectable: false,
        deletable: false,
        focusable: false,
      }));

    return [...carrying, ...loose];
  }, [edges, carried, labelOffsets, moveLabel]);

  /**
   * Puts what the server said onto the nodes themselves, so the canvas can draw
   * it. The panel could read `ports` directly because it only ever shows one
   * node; a node view is handed nothing but its own data.
   */
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const found = ports[node.id];
        const data = node.data as NodeData;
        if (data.inputs === found?.inputs && data.outputs === found?.outputs) return node;
        return { ...node, data: { ...data, inputs: found?.inputs, outputs: found?.outputs } };
      }),
    );
  }, [ports, setNodes]);
  const [actions, setActions] = useState<Action[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [objects, setObjects] = useState<WorkflowObject[]>([]);

  /**
   * The saved graph, put on the canvas.
   *
   * Named because two things ask for it: opening the editor, and discarding —
   * which is the same act, since what is on the server is what "as it was"
   * means.
   */
  const loadGraph = useCallback(() => {
    if (workspaceId === '' || workflowId === '') return;
    fetchWorkflowGraph(workspaceId, workflowId)
      .then((graph) => {
        setName(graph.name);
        setStatus(graph.status);
        setNodes(
          graph.nodes.map((node) => ({
            id: node.key,
            type: 'graphNode',
            position: { x: node.x, y: node.y },
            data: {
              kind: node.kind,
              name: node.name,
              description: node.description,
              agentId: node.agentId,
              triggerId: node.triggerId,
              actionId: node.actionId,
              conditionId: node.conditionId,
              objectId: node.objectId ?? null,
              outputName: node.outputName ?? null,
              icon: node.icon ?? null,
              mappings: node.mappings ?? [],
            },
          })),
        );
        setProblems(graph.problems);
        setPorts(Object.fromEntries(graph.nodes.map((node) => [node.key, { inputs: node.inputs, outputs: node.outputs }])));
        setEdges(
          graph.edges.map((edge) => ({
            id: `${edge.source}->${edge.target}`,
            source: edge.source,
            target: edge.target,
          })),
        );
        // Freshly loaded is in step with the server, which is what `saved`
        // means to the buttons. Leaving it false lights Publish on a graph
        // nobody has touched.
        setSaved(true);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the workflow.');
      });
  }, [workspaceId, workflowId, setNodes, setEdges]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // The catalogues a trigger node and an action node pick from.
  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceTriggers(workspaceId, 0, TRIGGER_PAGE_SIZE)
      .then((page) => setTriggers(page.content))
      .catch(() => setTriggers([]));
    fetchWorkspaceActions(workspaceId, 0, ACTION_PAGE_SIZE)
      .then((page) => setActions(page.content))
      .catch(() => setActions([]));

    fetchWorkspaceAgents(workspaceId, 0, AGENT_PAGE_SIZE)
      .then((page) => setAgents(page.content))
      .catch(() => setAgents([]));
    fetchWorkspaceConditions(workspaceId, 0, CONDITION_PAGE_SIZE)
      .then((page) => setConditions(page.content))
      .catch(() => setConditions([]));
    fetchWorkspaceObjects(workspaceId, 0, OBJECT_PAGE_SIZE)
      .then((page) => setObjects(page.content))
      .catch(() => setObjects([]));
  }, [workspaceId]);

  // Clicking on the canvas is React Flow's business, but a node we have just added
  // is not in its store yet, so the key is tracked here and its selection wins.
  const flowSelectedKey = useMemo(() => nodes.find((node) => node.selected)?.id ?? null, [nodes]);

  useEffect(() => {
    if (flowSelectedKey !== null) setSelectedKey(flowSelectedKey);
  }, [flowSelectedKey]);

  useEffect(() => {
    const node = nodes.find((candidate) => candidate.id === selectedKey);
    setDraft(node === undefined ? null : { ...(node.data as NodeData) });
    // Only re-seed the form when the selection changes, not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge({ ...connection, id: `${connection.source}->${connection.target}` }, current),
      );
      setSaved(false);
    },
    [setEdges],
  );

  function addNode(kind: NodeKind) {
    const key = `${kind.toLowerCase()}-${Date.now().toString(36)}`;
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id: key,
        type: 'graphNode',
        position: { x: 80 + current.length * 40, y: 80 + current.length * 30 },
        data: {
          kind,
          name: NODE_KIND_LABEL[kind],
          description: null,
          agentId: null,
          triggerId: null,
          actionId: null,
          conditionId: null,
          objectId: null,
          outputName: null,
          icon: null,
          mappings: [],
        },
      },
    ]);
    setSelectedKey(key);
    // The store only learns about the node on the next tick, so select it then.
    requestAnimationFrame(() => updateNode(key, { selected: true }));
    setSaved(false);
  }

  /**
   * The panel edits the node as it is typed in, so the canvas keeps up: the
   * name changes as you type it, and picking a trigger or an action takes
   * effect where it can be seen. Update Node then confirms rather than being
   * the only thing that does anything — a button that looked inert was what
   * this replaced.
   */
  useEffect(() => {
    if (selectedKey === null || draft === null) return;
    const shown = named(withHeldName(draft, fieldEdit));
    const timer = window.setTimeout(() => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== selectedKey) return node;
        const data = node.data as NodeData;
        const same =
          data.name === draft.name &&
          data.description === draft.description &&
          data.agentId === draft.agentId &&
          data.triggerId === draft.triggerId &&
          data.actionId === draft.actionId &&
          data.conditionId === draft.conditionId &&
          data.objectId === draft.objectId &&
          data.outputName === draft.outputName &&
          data.icon === draft.icon &&
          sameMappings(data.mappings, shown.mappings);
        if (same) return node;
        setSaved(false);
        /*
         * Merged, not replaced. The panel owns what it edits; the ports the
         * server worked out for this node — what it needs and what it gives —
         * are not the panel's to know, and replacing the data wholesale dropped
         * them. They came back on the next save, which made an edit look like it
         * had removed a field until the graph was saved.
         */
        return { ...node, data: { ...data, ...shown } };
      }),
    );
    }, CANVAS_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, fieldEdit, selectedKey, setNodes]);

  /**
   * An agent node takes two, and takes them from nowhere else: an agent has no
   * declared parameters to read, so without seeding the panel showed nothing and
   * the agent was asked whatever arrived along the edge, raw.
   *
   * Left blank they change nothing — the edge's value is still the question, and
   * the agent keeps its own briefing.
   */
  useEffect(() => {
    if (draft === null || draft.kind !== 'AGENT') return;
    const briefing = briefingFor(draft, agents);

    setDraft((held) => {
      if (held === null || held.kind !== 'AGENT') return held;
      const seeded = AGENT_PARAMETERS.map((name) => {
        const existing = held.mappings.find((mapping) => mapping.name === name);
        // The agent's briefing is written in so it can be edited. An empty box
        // is filled — the agent list arrives after the panel does, and picking a
        // different agent brings different wording — but anything already typed
        // is left alone.
        if (name === 'systemPrompt' && briefing !== '' && (existing === undefined || existing.expression === '')) {
          return { name, expression: briefing, mode: 'VALUE' as MappingMode };
        }
        return existing ?? { name, expression: '', mode: 'VALUE' as MappingMode };
      });
      return sameMappings(held.mappings, seeded) ? held : { ...held, mappings: seeded };
    });
  }, [draft?.kind, draft?.agentId, agents]);

  /**
   * A node takes the icon of whatever it points at, once.
   *
   * The definition is where the icon belongs — ten nodes running one action
   * should not each be given the same one by hand — but a node that has been
   * given an icon keeps it, the same rule its parameters follow.
   */
  useEffect(() => {
    if (draft === null || draft.icon !== null) return;

    const inherited =
      draft.kind === 'ACTION'
        ? (actions.find((one) => one.id === draft.actionId)?.icon ?? null)
        : draft.kind === 'TRIGGER'
          ? (triggers.find((one) => one.id === draft.triggerId)?.icon ?? null)
          : draft.kind === 'CONDITION'
            ? (conditions.find((one) => one.id === draft.conditionId)?.icon ?? null)
            : (agents.find((one) => one.id === draft.agentId)?.icon ?? null);
    if (inherited === null) return;

    setDraft((held) => (held === null || held.icon !== null ? held : { ...held, icon: inherited }));
  }, [
    draft,
    draft?.kind,
    draft?.actionId,
    draft?.triggerId,
    draft?.conditionId,
    draft?.agentId,
    actions,
    triggers,
    conditions,
    agents,
  ]);

  /**
   * Picking a saved shape seeds the fields it has.
   *
   * The shape decides which fields there are — one it does not have is dropped,
   * and one it gained arrives empty — so a shape edited afterwards shows up here
   * without anything having to be tidied by hand. What is *in* each field stays
   * the node's, which is the whole point of the node.
   */
  useEffect(() => {
    if (draft === null || draft.kind !== 'OBJECT' || draft.objectId === null) return;

    const shape = objects.find((one) => one.id === draft.objectId);
    if (shape === undefined) return;

    const seeded = shape.properties.map(
      (property) =>
        draft.mappings.find((held) => held.name === property.name) ?? {
          name: property.name,
          expression: '',
          mode: 'VALUE' as MappingMode,
        },
    );
    if (sameMappings(draft.mappings, seeded)) return;

    setDraft((held) => (held === null ? held : { ...held, mappings: seeded }));
  }, [draft, draft?.kind, draft?.objectId, objects]);

  /**
   * Picking an action seeds the parameters it takes, so the panel has something
   * to show before anything is saved. Only names the node does not already hold
   * are taken: an expression already typed here is the node's, and re-reading
   * the action would throw it away.
   */
  useEffect(() => {
    const actionId = draft?.actionId ?? null;
    if (draft === null || draft.kind !== 'ACTION' || actionId === null || workspaceId === '') return;
    let live = true;
    fetchActionParameterDefaults(workspaceId, actionId)
      .then((defaults) => {
        if (!live) return;
        setDraft((held) => {
          // The panel may have moved on to another node while this was in flight.
          if (held === null || held.actionId !== actionId) return held;
          const kept = held;
          const seeded = defaults.map(
            (suggestion) => kept.mappings.find((mapping) => mapping.name === suggestion.name) ?? suggestion,
          );
          return sameMappings(kept.mappings, seeded) ? kept : { ...kept, mappings: seeded };
        });
      })
      .catch(() => {
        /* The action's suggestion is a convenience; the node still saves without it. */
      });
    return () => {
      live = false;
    };
    // Keyed by the node as well as the action: two nodes can share an action,
    // and the second one still needs its own seed.
  }, [selectedKey, draft?.actionId, draft?.kind, workspaceId]);

  /*
   * Both buttons light up for the same reason: there is something on screen the
   * server has not been told about. A node's fields already apply as they are
   * typed — the effect above puts them straight into the graph — so what is
   * pending is never the panel, it is the save.
   */
  const pending = !saved;

  function applyDraft() {
    if (selectedKey === null || draft === null) return;
    const shown = named(draft);
    setNodes((current) =>
      current.map((node) =>
        /*
         * Merged, for the reason the live edit above is merged: the ports the
         * server worked out are on the node and are not the panel's to know.
         * Replacing the data wholesale dropped them, so Update Node took the
         * fields off the node until the next save put them back - which is
         * exactly what it looked like: a button that deleted your work.
         */
        node.id === selectedKey ? { ...node, data: { ...(node.data as NodeData), ...shown } } : node,
      ),
    );
    setSaved(false);
    setJustUpdated(true);
    window.setTimeout(() => setJustUpdated(false), 1500);
  }

  function toGraph(): { nodes: GraphNode[]; edges: { source: string; target: string }[] } {
    return {
      nodes: nodes.map((node) => {
        /*
         * The panel is the truth of the node it is editing; the canvas is a
         * picture of it, a beat behind - held back on purpose while a field's
         * name is typed. Saving from the picture could save the beat before,
         * so the selected node is read from the panel.
         */
        const data =
          node.id === selectedKey && draft !== null
            ? { ...(node.data as NodeData), ...named(draft) }
            : (node.data as NodeData);
        return {
          key: node.id,
          kind: data.kind,
          name: data.name,
          description: data.description,
          agentId: data.agentId,
          triggerId: data.triggerId,
          actionId: data.actionId,
          conditionId: data.conditionId,
          objectId: data.objectId,
          outputName: data.outputName,
          icon: data.icon,
          mappings: data.mappings,
          x: node.position.x,
          y: node.position.y,
        };
      }),
      edges: edges.map((edge) => ({ source: edge.source, target: edge.target })),
    };
  }

  /** What the server says about the graph it was just given. */
  function applyGraphFeedback(graph: {
    problems: GraphProblem[];
    nodes: { key: string; inputs?: GraphPort[]; outputs?: GraphPort[] }[];
  }) {
    setProblems(graph.problems);
    setPorts(Object.fromEntries(graph.nodes.map((node) => [node.key, { inputs: node.inputs, outputs: node.outputs }])));
  }

  /**
   * What the graph is, as far as ports and problems are concerned.
   *
   * Positions are left out on purpose: dragging a node changes the picture and
   * nothing about what it needs, and asking again on every frame of a drag would
   * be a request per pixel. What the answer comes back as — the ports — is left
   * out too, or writing it down would ask the question again, for ever.
   */
  const graphShape = useMemo(
    () =>
      JSON.stringify({
        nodes: nodes.map((node) => {
          const data = node.data as NodeData;
          return [
            node.id,
            data.kind,
            data.name,
            data.agentId,
            data.triggerId,
            data.actionId,
            data.conditionId,
            data.objectId,
            data.outputName,
            data.mappings,
          ];
        }),
        edges: edges.map((edge) => [edge.source, edge.target]),
      }),
    [nodes, edges],
  );

  /**
   * Ports and problems follow the graph on screen rather than the last save.
   *
   * They used to be worked out only when the graph was written down, so a node
   * given an output name showed nothing to point at until somebody saved — and
   * the list of things to fix described a graph that had since been edited.
   */
  /*
   * Which ask is the current one, so an answer can tell whether it still is.
   *
   * Clearing the timeout stops a preview being asked, not one already in
   * flight - and two in flight can land in either order. A stale answer is a
   * picture of the graph from before the last edit: applied, it renamed a
   * field's chip back, or took a new field's chip off the node entirely, some
   * seconds after everything had settled. Everything that applies feedback
   * moves this on, and an answer that is no longer the newest is dropped.
   */
  const asked = useRef(0);

  useEffect(() => {
    if (workspaceId === '' || workflowId === '' || nodes.length === 0) return;

    const timer = window.setTimeout(() => {
      const mine = ++asked.current;
      fetchWorkflowGraphPreview(workspaceId, workflowId, toGraph())
        .then((graph) => {
          if (asked.current === mine) applyGraphFeedback(graph);
        })
        // Advice, and asking again is cheap: a failed ask leaves what the last
        // answer said rather than putting an error over the canvas.
        .catch(() => undefined);
    }, PREVIEW_PAUSE_MS);
    return () => window.clearTimeout(timer);
    // The shape is what makes this worth asking again; the rest is read when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphShape, workspaceId, workflowId]);

  /** @returns whether the graph is now on the server. */
  async function handleSave(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const graph = await saveWorkflowGraph(workspaceId, workflowId, toGraph());
      setStatus(graph.status);
      // What is left to fix is decided by the server, and saving is when it
      // decides again. Keeping the list from the last load means the panel
      // describes a graph that is no longer on screen. The save is the newest
      // word on the graph, so any preview still in flight is out of date.
      asked.current += 1;
      applyGraphFeedback(graph);
      setSaved(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the workflow.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Following a link to a definition saves the graph first. The link is one
   * click away from work that only exists on screen, and coming back to find a
   * node reverted is the kind of loss nobody thinks to expect. A save the
   * server refuses keeps the editor where it is, with the reason showing —
   * leaving anyway would discard exactly what could not be stored.
   */
  async function leaveFor(destination: string) {
    if (pending && !(await handleSave())) return;
    navigate(destination);
  }

  async function handlePublish() {
    setBusy(true);
    setError(null);
    try {
      await saveWorkflowGraph(workspaceId, workflowId, toGraph());
      const graph = await publishWorkflow(workspaceId, workflowId);
      setStatus(graph.status);
      asked.current += 1;
      applyGraphFeedback(graph);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not publish the workflow.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={null}
      hideSidebar
    >
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => navigate(`/workspace/${workspaceId}`)}
            aria-label="Back to workflows"
          >
            <img src={arrowLeftIcon} alt="" width={14} height={14} />
          </button>
          <button type="button" className={styles.crumbLink} onClick={() => navigate(`/workspace/${workspaceId}`)}>
            Workflows
          </button>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.workflowName}>{name}</span>
          <button
            type="button"
            className={styles.renameButton}
            onClick={() => navigate(`/workspace/${workspaceId}/workflows/${workflowId}/settings`)}
            aria-label="Rename workflow"
            title="Rename workflow"
          >
            <img src={pencilIcon} alt="" width={14} height={14} />
          </button>
          <span className={status === 'PUBLISHED' ? `${styles.badge} ${styles.badgeLive}` : styles.badge}>
            {status === 'PUBLISHED' ? 'Published' : 'Draft'}
          </span>
          {error !== null && (
            <span className={styles.error} role="alert">
              {error}
            </span>
          )}
          {saved && error === null && <span className={styles.savedNote}>Saved.</span>}
        </div>

        <div className={styles.toolbarRight}>
          <div className={styles.addMenu}>
            <span className={styles.addLabel}>Add:</span>
            {(Object.keys(NODE_KIND_LABEL) as NodeKind[]).map((kind) => (
              <button key={kind} type="button" className={styles.addButton} onClick={() => addNode(kind)}>
                {NODE_KIND_LABEL[kind]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => setRemoving(true)}
            aria-label="Remove workflow from workspace"
            title="Remove workflow from workspace"
          >
            <TrashIcon />
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setDiscarding(true)}
            disabled={busy}
          >
            Discard
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => void handleSave()} disabled={busy}>
            {busy ? 'Working…' : 'Save'}
          </button>
          {/*
            Violet while there is something to publish, quiet once there is not:
            a call to action that is always lit says nothing about whether it
            needs pressing.
          */}
          <button
            type="button"
            className={pending ? styles.publishButton : styles.publishButtonQuiet}
            onClick={() => void handlePublish()}
            disabled={busy}
          >
            Publish
          </button>
        </div>
      </div>

      <div className={styles.editor}>
        <div className={styles.canvas}>
          {loadError !== null ? (
            <p className={styles.loadError} role="alert">
              {loadError}
            </p>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={drawnEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={(changes) => {
                onNodesChange(changes);
                if (changes.some((change) => change.type === 'position')) setSaved(false);
              }}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#27272a" />
              <MiniMap
                className={styles.minimap}
                nodeColor={(node) => KIND_COLOUR[(node.data as NodeData).kind] ?? '#27272a'}
                nodeStrokeColor={(node) => ((node.selected ?? false) ? '#fafafa' : 'transparent')}
                nodeStrokeWidth={4}
                nodeBorderRadius={3}
                maskColor="rgba(9,9,11,0.6)"
                pannable
                zoomable
              />
              <Controls className={styles.controls} showInteractive={false} />
            </ReactFlow>
          )}
        </div>

        <aside className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Node Properties</h2>
            <p className={styles.panelSubtitle}>Configure selected graph object</p>
          </div>
          <hr className={styles.panelDivider} />

          {problems.length > 0 && (
            <section className={styles.problems}>
              <h3 className={styles.problemsTitle}>
                {problems.length} {problems.length === 1 ? 'thing to fix' : 'things to fix'}
              </h3>
              <ul className={styles.problemList}>
                {problems.map((problem, index) => (
                  <li
                    key={`${problem.nodeKey}-${index}`}
                    className={
                      problem.severity === 'ERROR'
                        ? `${styles.problem} ${styles.problemError}`
                        : styles.problem
                    }
                  >
                    <button
                      type="button"
                      className={styles.problemButton}
                      onClick={() => setSelectedKey(problem.nodeKey)}
                    >
                      {problem.message}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {draft === null ? (
            <p className={styles.panelEmpty}>Select a node on the canvas to edit it.</p>
          ) : (
            <>
              <div className={styles.fields}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="node-name">
                    Node Name
                  </label>
                  <div className={`${styles.inputWrapper} ${styles.inputActive}`}>
                    <input
                      id="node-name"
                      className={styles.input}
                      type="text"
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </div>
                </div>

                {draft.kind === 'AGENT' && (
                  <div className={styles.field}>
                    <span className={styles.labelRow}>
                      <label className={styles.label} htmlFor="node-agent">
                        Agent
                      </label>
                      <span className={styles.labelLinks}>
                        <button
                          type="button"
                          className={styles.definitionLink}
                          onClick={() => setCreating('AGENT')}
                        >
                          New
                        </button>
                        {draft.agentId !== null && (
                          <button
                            type="button"
                            className={styles.definitionLink}
                            onClick={() => leaveFor(`/workspace/${workspaceId}/agents/${draft.agentId}/settings`)}
                          >
                            Open definition
                          </button>
                        )}
                      </span>
                    </span>
                    <div className={styles.inputWrapper}>
                      <select
                        id="node-agent"
                        className={`${styles.input} ${styles.select}`}
                        value={draft.agentId ?? ''}
                        onChange={(event) => setDraft({ ...draft, agentId: event.target.value || null })}
                      >
                        <option value="">—</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* The agent brings its own, so the node chooses no model. */}
                    <p className={styles.parameterHint}>
                      The agent supplies the model it answers on, its instructions, and the catalogs it was granted.
                    </p>
                  </div>
                )}

                {draft.kind === 'TRIGGER' && (
                  <div className={styles.field}>
                    <span className={styles.labelRow}>
                      <label className={styles.label} htmlFor="node-trigger">
                        Trigger
                      </label>
                      <span className={styles.labelLinks}>
                        <button
                          type="button"
                          className={styles.definitionLink}
                          onClick={() => setCreating('TRIGGER')}
                        >
                          New
                        </button>
                        {/* Where the node points, so the definition is one click away. */}
                        {draft.triggerId !== null && (
                          <button
                            type="button"
                            className={styles.definitionLink}
                            onClick={() => leaveFor(`/workspace/${workspaceId}/triggers/${draft.triggerId}`)}
                          >
                            Open definition
                          </button>
                        )}
                      </span>
                    </span>
                    <div className={styles.inputWrapper}>
                      <select
                        id="node-trigger"
                        className={`${styles.input} ${styles.select}`}
                        value={draft.triggerId ?? ''}
                        onChange={(event) => setDraft({ ...draft, triggerId: event.target.value || null })}
                      >
                        <option value="">—</option>
                        {triggers.map((trigger) => (
                          <option key={trigger.id} value={trigger.id}>
                            {trigger.name} · {trigger.source} · {trigger.event}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {draft.kind === 'ACTION' && (
                  <div className={styles.field}>
                    <span className={styles.labelRow}>
                      <label className={styles.label} htmlFor="node-action">
                        Action
                      </label>
                      <span className={styles.labelLinks}>
                        <button
                          type="button"
                          className={styles.definitionLink}
                          onClick={() => setCreating('ACTION')}
                        >
                          New
                        </button>
                        {draft.actionId !== null && (
                          <button
                            type="button"
                            className={styles.definitionLink}
                            onClick={() => leaveFor(`/workspace/${workspaceId}/actions/${draft.actionId}`)}
                          >
                            Open definition
                          </button>
                        )}
                      </span>
                    </span>
                    <div className={styles.inputWrapper}>
                      <select
                        id="node-action"
                        className={`${styles.input} ${styles.select}`}
                        value={draft.actionId ?? ''}
                        onChange={(event) => setDraft({ ...draft, actionId: event.target.value || null })}
                      >
                        <option value="">—</option>
                        {actions.map((action) => (
                          <option key={action.id} value={action.id}>
                            {action.name} · {action.subtypeLabel}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/*
                  The shape comes before the fields it decides. A saved shape fixes
                  which fields there are, so meeting the list first means reading
                  contents before knowing whether they are this node's to edit.
                */}
                {draft.kind === 'OBJECT' && (
                  <div className={styles.field}>
                    <span className={styles.labelRow}>
                      <label className={styles.label} htmlFor="node-object">
                        Shape
                      </label>
                      <span className={styles.labelLinks}>
                        <button
                          type="button"
                          className={styles.definitionLink}
                          onClick={() => setCreating('OBJECT')}
                        >
                          New
                        </button>
                        {draft.objectId !== null && (
                          <button
                            type="button"
                            className={styles.definitionLink}
                            onClick={() => leaveFor(`/workspace/${workspaceId}/objects/${draft.objectId}`)}
                          >
                            Open definition
                          </button>
                        )}
                      </span>
                    </span>
                    <div className={styles.inputWrapper}>
                      <select
                        id="node-object"
                        className={`${styles.input} ${styles.select}`}
                        value={draft.objectId ?? ''}
                        onChange={(event) => setDraft({ ...draft, objectId: event.target.value || null })}
                      >
                        <option value="">Custom &mdash; this node&apos;s own fields</option>
                        {objects.map((shape) => (
                          <option key={shape.id} value={shape.id}>
                            {shape.name} &middot; {shape.propertyCount} fields
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className={styles.parameterHint}>
                      A saved shape fixes which fields there are; this node decides what goes in them.
                      Custom means the fields are this node&apos;s own.
                    </p>
                  </div>
                )}

                {((draft.kind === 'ACTION' && draft.actionId !== null) ||
                  draft.kind === 'AGENT' ||
                  draft.kind === 'OBJECT') && (
                  <div className={styles.field}>
                    <span className={styles.labelRow}>
                      <span className={styles.label}>{draft.kind === 'OBJECT' ? 'Fields' : 'Parameters'}</span>
                      {/* A shape of the node's own is added to here, one field at a time. */}
                      {draft.kind === 'OBJECT' && draft.objectId === null && (
                        <button
                          type="button"
                          className={styles.parameterSync}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              mappings: [
                                ...draft.mappings,
                                { name: nextFieldName(draft.mappings), expression: '', mode: 'VALUE' },
                              ],
                            })
                          }
                        >
                          + Add field
                        </button>
                      )}
                    </span>
                    {draft.mappings.length === 0 ? (
                      <p className={styles.parameterHint}>
                        {draft.kind === 'OBJECT'
                          ? 'No fields yet, so this node would make nothing.'
                          : 'This action takes no parameters.'}
                      </p>
                    ) : (
                      <>
                        <div className={styles.parameterList}>
                          {/*
                            Keyed by position, not by name. Keyed by name, editing
                            a field's name changed its key on every keystroke: React
                            threw the input away and mounted a new one, focus went
                            with it, and the next Backspace reached the canvas — where
                            it deleted the selected node.
                          */}
                          {draft.mappings.map((mapping, index) => (
                            <div className={styles.parameter} key={index}>
                              <span className={styles.parameterHead}>
                                {draft.kind === 'OBJECT' && draft.objectId === null ? (
                                  <input
                                    className={`${styles.input} ${styles.fieldName}`}
                                    value={mapping.name}
                                    aria-label={`Name of field ${index + 1}`}
                                    spellCheck={false}
                                    // While this is focused, the node keeps the
                                    // name the field had; leaving applies it.
                                    onFocus={() => setFieldEdit({ index, was: mapping.name })}
                                    onBlur={() => setFieldEdit(null)}
                                    /*
                                      A field is pointed at by one name, so anything
                                      that could not be one is refused as it is typed.
                                    */
                                    onChange={(event) =>
                                      setDraft({
                                        ...draft,
                                        mappings: draft.mappings.map((held, at) =>
                                          at === index
                                            ? { ...held, name: event.target.value.replace(/[^A-Za-z0-9_]/g, '') }
                                            : held,
                                        ),
                                      })
                                    }
                                  />
                                ) : (
                                  <label className={styles.parameterName} htmlFor={`node-mapping-${mapping.name}`}>
                                    {mapping.name}
                                  </label>
                                )}
                                {draft.kind === 'OBJECT' && draft.objectId === null && (
                                  <button
                                    type="button"
                                    className={styles.parameterSync}
                                    aria-label={`Remove field ${index + 1}`}
                                    onClick={() =>
                                      setDraft({
                                        ...draft,
                                        mappings: draft.mappings.filter((_, at) => at !== index),
                                      })
                                    }
                                  >
                                    Remove
                                  </button>
                                )}
                                {(() => {
                                  // The node holds a copy on purpose, and a copy
                                  // drifts. This is how the definition's wording
                                  // is taken again, when that is what is wanted.
                                  const briefing = briefingFor(draft, agents);
                                  const drifted =
                                    draft.kind === 'AGENT' &&
                                    mapping.name === 'systemPrompt' &&
                                    briefing !== '' &&
                                    briefing !== mapping.expression;

                                  return drifted ? (
                                    <button
                                      type="button"
                                      className={styles.parameterSync}
                                      title="Replace this with the agent's own briefing as it is now"
                                      onClick={() =>
                                        setDraft({
                                          ...draft,
                                          mappings: draft.mappings.map((held) =>
                                            held.name === 'systemPrompt' ? { ...held, expression: briefing } : held,
                                          ),
                                        })
                                      }
                                    >
                                      Sync
                                    </button>
                                  ) : null;
                                })()}
                              </span>
                              {/*
                                Written, or read from somewhere. The switch is
                                what replaces knowing to type `{{input.reply}}`:
                                a name that is nearly right used to read as
                                ordinary text and be sent as those characters.
                              */}
                              <div className={styles.modeSwitch} role="group" aria-label={`${mapping.name} source`}>
                                {(['VALUE', 'REFERENCE'] as MappingMode[]).map((mode) => (
                                  <button
                                    key={mode}
                                    type="button"
                                    className={
                                      mapping.mode === mode
                                        ? `${styles.modeOption} ${styles.modeOptionOn}`
                                        : styles.modeOption
                                    }
                                    aria-pressed={mapping.mode === mode}
                                    onClick={() =>
                                      setDraft({
                                        ...draft,
                                        mappings: draft.mappings.map((held, at) =>
                                          at === index
                                            ? // Switching starts the other kind
                                              // empty rather than carrying text
                                              // across as a field name.
                                              { ...held, mode, expression: '', sourceNodeKey: null }
                                            : held,
                                        ),
                                      })
                                    }
                                  >
                                    {mode === 'VALUE' ? 'Value' : 'Reference'}
                                  </button>
                                ))}
                              </div>

                              {mapping.mode === 'REFERENCE' ? (
                                <FieldPicker
                                  options={fieldOptions}
                                  value={mapping.expression}
                                  onChange={(option) =>
                                    setDraft({
                                      ...draft,
                                      mappings: draft.mappings.map((held, at) =>
                                        at === index
                                          ? {
                                              ...held,
                                              expression: option.expression,
                                              sourceNodeKey: option.nodeKey,
                                            }
                                          : held,
                                      ),
                                    })
                                  }
                                />
                              ) : (
                                <div className={styles.inputWrapper}>
                                  <input
                                    id={`node-mapping-${mapping.name}`}
                                    className={`${styles.input} ${styles.parameterValue}`}
                                    value={mapping.expression}
                                    placeholder={parameterPlaceholder(draft, mapping.name)}
                                    spellCheck={false}
                                    onChange={(event) =>
                                      setDraft({
                                        ...draft,
                                        mappings: draft.mappings.map((held, at) =>
                                          at === index ? { ...held, expression: event.target.value } : held,
                                        ),
                                      })
                                    }
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className={styles.parameterHint}>
                          {draft.kind === 'AGENT' ? (
                            <>
                              <strong>prompt</strong> is what the agent is asked; <strong>systemPrompt</strong>{' '}
                              replaces its own briefing, for this node only. Leave either empty to keep what
                              the agent already does.
                            </>
                          ) : draft.kind === 'OBJECT' ? (
                            <>
                              Each field is written here or read from another node; together they are what this
                              node hands on. Give the node an output name to pass them as one object.
                            </>
                          ) : (
                            <>What is here is what this node sends — the action definition is not changed.</>
                          )}
                        </p>
                        <p className={styles.parameterHint}>
                          <strong>Value</strong> is used exactly as written. <strong>Reference</strong> reads a
                          field another node produces — a trigger&apos;s event, an agent&apos;s named answer —
                          and keeps reading it however far down the graph this node sits.
                        </p>
                      </>
                    )}
                  </div>
                )}


                {draft.kind === 'CONDITION' && (
                  <div className={styles.field}>
                    <span className={styles.labelRow}>
                      <label className={styles.label} htmlFor="node-condition">
                        Condition
                      </label>
                      <span className={styles.labelLinks}>
                        <button
                          type="button"
                          className={styles.definitionLink}
                          onClick={() => setCreating('CONDITION')}
                        >
                          New
                        </button>
                        {draft.conditionId !== null && (
                          <button
                            type="button"
                            className={styles.definitionLink}
                            onClick={() => leaveFor(`/workspace/${workspaceId}/conditions/${draft.conditionId}`)}
                          >
                            Open definition
                          </button>
                        )}
                      </span>
                    </span>
                    <div className={styles.inputWrapper}>
                      <select
                        id="node-condition"
                        className={`${styles.input} ${styles.select}`}
                        value={draft.conditionId ?? ''}
                        onChange={(event) =>
                          setDraft({ ...draft, conditionId: event.target.value || null })
                        }
                      >
                        <option value="">—</option>
                        {conditions.map((condition) => (
                          <option key={condition.id} value={condition.id}>
                            {condition.name} · {condition.typeLabel}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className={styles.field}>
                  <span className={styles.labelRow}>
                    <span className={styles.label}>Icon</span>
                    {draft.icon !== null && (
                      <button
                        type="button"
                        className={styles.parameterSync}
                        onClick={() => setDraft({ ...draft, icon: null })}
                      >
                        Clear
                      </button>
                    )}
                  </span>
                  <div className={styles.inputWrapper}>
                    {draft.icon !== null && <Icon name={draft.icon} className={styles.iconPreview} />}
                    <span className={draft.icon === null ? styles.iconNone : styles.iconName}>
                      {draft.icon ?? 'None'}
                    </span>
                    <button type="button" className={styles.parameterSync} onClick={() => setBrowsingIcons(true)}>
                      Browse…
                    </button>
                  </div>
                </div>

                {(draft.kind === 'AGENT' || draft.kind === 'ACTION' || draft.kind === 'OBJECT') && (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="node-output-name">
                      Output name
                    </label>
                    <div className={styles.inputWrapper}>
                      <input
                        id="node-output-name"
                        className={`${styles.input} ${styles.parameterValue}`}
                        value={draft.outputName ?? ''}
                        placeholder={draft.kind === 'AGENT' ? 'reply' : 'result'}
                        spellCheck={false}
                        /*
                         * A field is pointed at by one name, so anything that
                         * could not be one is refused as it is typed — a space
                         * or a dash would make a name that reads as accepted
                         * and can never be referred to.
                         */
                        onChange={(event) => {
                          const cleaned = event.target.value.replace(/[^A-Za-z0-9_]/g, '');
                          setDraft({ ...draft, outputName: cleaned || null });
                        }}
                      />
                    </div>
                    <p className={styles.parameterHint}>
                      {draft.kind === 'AGENT' ? (
                        <>
                          An agent answers in prose, which has no fields to point at. Naming the answer is what
                          puts it in the list a later node picks from — call it <code>reply</code> and a send
                          step can reference it.
                        </>
                      ) : (
                        <>
                          What this node hands on is wrapped under this name, so a later node references{' '}
                          <code>result</code> rather than depending on what the function happened to return.
                        </>
                      )}{' '}
                      Left empty, the output is passed on as it is and nothing downstream can name it.
                    </p>
                  </div>
                )}

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="node-description">
                    Description
                  </label>
                  <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
                    <textarea
                      id="node-description"
                      className={`${styles.input} ${styles.textarea}`}
                      value={draft.description ?? ''}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value || null })}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.ports}>
                <p className={styles.portsHeading}>Needs</p>
                <p className={styles.portsList}>
                  {(nodes.find((node) => node.id === selectedKey)?.data as NodeData | undefined) &&
                  (portsFor(selectedKey)?.inputs?.length ?? 0) > 0
                    ? portsFor(selectedKey)
                        ?.inputs?.map((port) => port.display)
                        .join(', ')
                    : 'Nothing'}
                </p>
                <p className={styles.portsHeading}>Hands on</p>
                <p className={styles.portsList}>
                  {(portsFor(selectedKey)?.outputs?.length ?? 0) > 0
                    ? portsFor(selectedKey)
                        ?.outputs?.map((port) => port.display)
                        .join(', ')
                    : 'What it was given'}
                </p>
              </div>

              <div className={styles.panelFooter}>
                <button
                  type="button"
                  className={pending ? styles.updateButtonPending : styles.updateButton}
                  onClick={applyDraft}
                >
                  {justUpdated ? 'Updated ✓' : 'Update Node'}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      <IconPickerDialog
        open={browsingIcons}
        selected={draft?.icon ?? null}
        onPick={(name) => setDraft(draft === null ? draft : { ...draft, icon: name })}
        onClose={() => setBrowsingIcons(false)}
      />

      <WorkflowConfirmDialog
        workflowName={removing ? name : null}
        kind="remove"
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          await removeWorkflow(workflowId);
          setRemoving(false);
          navigate(`/workspace/${workspaceId}`);
        }}
      />

      {/*
        A way back to the last save.

        The canvas is the only copy of what has been drawn since, so this asks
        first, and then reloads rather than undoing: what the server holds is
        what the graph was, whatever the panel has been doing to it since.
      */}
      <WorkflowConfirmDialog
        workflowName={discarding ? name : null}
        kind="discard"
        onClose={() => setDiscarding(false)}
        onConfirm={async () => {
          setSelectedKey(null);
          setDraft(null);
          setDiscarding(false);
          loadGraph();
        }}
      />

      {/*
        Making a definition without leaving the graph.

        Each of these is the dialog its own page uses, so a trigger made here is
        made exactly as it would be there. What is added is picked straight away:
        somebody who reached for New wanted this node to use it.
      */}
      <CreateTriggerDialog
        open={creating === 'TRIGGER'}
        workspaceId={workspaceId}
        onClose={() => setCreating(null)}
        onCreated={(trigger) => {
          setTriggers((all) => [trigger, ...all]);
          setDraft((current) => (current === null ? current : { ...current, triggerId: trigger.id }));
          setCreating(null);
        }}
      />

      <ActionDialog
        open={creating === 'ACTION'}
        workspaceId={workspaceId}
        action={null}
        onClose={() => setCreating(null)}
        onSaved={(action) => {
          setActions((all) => [action, ...all]);
          setDraft((current) => (current === null ? current : { ...current, actionId: action.id }));
          setCreating(null);
        }}
      />

      <ConditionDialog
        open={creating === 'CONDITION'}
        workspaceId={workspaceId}
        condition={null}
        onClose={() => setCreating(null)}
        onSaved={(condition) => {
          setConditions((all) => [condition, ...all]);
          setDraft((current) => (current === null ? current : { ...current, conditionId: condition.id }));
          setCreating(null);
        }}
      />

      {/*
        An object is named here and given its fields on its own page.

        Unlike the other four, what this makes is empty: an object is a shape,
        and a shape with no fields is a name and nothing else. It is still worth
        making from here - the node points at it straight away, and Open
        definition beside the picker is one click from filling it in - but it is
        why this asks for a name rather than opening the object editor, which
        would take the graph off the screen to do what a line of text can.
      */}
      <NameDialog
        open={creating === 'OBJECT'}
        title="Create Object"
        message="An object names a shape, so a mapping can be offered rather than typed blind."
        nameLabel="Name"
        namePlaceholder="SlackMessage"
        descriptionPlaceholder="Represents an incoming Slack message with metadata"
        submitLabel="Create Object"
        onClose={() => setCreating(null)}
        onSubmit={async (name, description) => {
          const made = await createObject(workspaceId, { name, description: description || undefined });
          setObjects((all) => [made, ...all]);
          setDraft((current) => (current === null ? current : { ...current, objectId: made.id }));
          setCreating(null);
        }}
      />

      <CreateAgentDialog
        open={creating === 'AGENT'}
        workspaceId={workspaceId}
        onClose={() => setCreating(null)}
        onCreated={(agent) => {
          setAgents((all) => [agent, ...all]);
          setDraft((current) => (current === null ? current : { ...current, agentId: agent.id }));
          setCreating(null);
        }}
      />
    </AppShell>
  );
}
