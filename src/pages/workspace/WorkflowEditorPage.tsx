import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
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
  NodeOrientation,
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
import { startExecution } from '../../api/executions';
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
import { DefinitionPicker } from '../../components/DefinitionPicker';
import { CreateAgentDialog } from '../../components/CreateAgentDialog';
import { NameDialog } from '../../components/NameDialog';
import { CreateTriggerDialog } from '../../components/CreateTriggerDialog';
import { FieldPicker } from '../../components/FieldPicker';
import type { FieldOption } from '../../components/FieldPicker';
import { Icon, IconPickerDialog } from '../../components/IconPicker';
import { Loader } from '../../components/Loader';
import { TrashIcon } from '../../components/TrashIcon';
import { WorkflowConfirmDialog } from '../../components/WorkflowConfirmDialog';
import {
  matches,
  useDuplicateShortcut,
  useRedoShortcut,
  useSaveShortcut,
  useTurnShortcut,
  useUndoShortcut,
} from '../../session/shortcut';
import { shellUser } from '../../session/user';
import styles from './WorkflowEditorPage.module.css';

export interface WorkflowEditorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** What each canvas node carries; React Flow keeps it under `data`. */
interface NodeData extends Record<string, unknown> {
  kind: NodeKind;
  /** What a condition's two ways out are called; null means Yes and No. */
  yesLabel?: string | null;
  noLabel?: string | null;
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
   * Which way round the node faces on the canvas.
   *
   * Layout, not meaning: it moves where the handles sit and changes nothing
   * about what runs. Null is the left-to-right every node had before, so an
   * existing graph keeps its shape.
   */
  orientation?: NodeOrientation | null;
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
 *
 * The other two say which conversation this node's turn belongs to, and the
 * names are the server's: `sessionKey` is the identity, `sessionKeyPrefix` what
 * it is filed under. Reference is the mode that matters here — a key read out of
 * what the run carries is how two different workflows land in one session, which
 * a key typed into the node can never do.
 */
const AGENT_PARAMETERS = ['prompt', 'systemPrompt', 'sessionKeyPrefix', 'sessionKey'];

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
 * How long a change has to settle before it is a step to come back to.
 *
 * A step per change would mean pressing Ctrl+Z once per letter to get back to a
 * name typed in one go, and once per frame to get back from a drag. Longer than
 * the pause the canvas itself waits on, so what was typed in the panel is on the
 * node before the step that holds it is taken - a step taken any sooner would
 * record the graph from before the edit reached it, and undoing would look like
 * it had done nothing.
 */
const HISTORY_PAUSE_MS = 500;

/**
 * How far back the editor can go.
 *
 * Each step holds a copy of the whole graph, so a stack with no end to it is an
 * editor that grows for as long as the tab is open. Fifty is further back than
 * anybody walks in one sitting, and the oldest is dropped rather than the newest
 * refused.
 */
const HISTORY_STEPS = 50;

/** The whole graph as it stood, kept so it can be put back. */
interface Step {
  nodes: Node<NodeData>[];
  edges: Edge[];
  /** What of it counted as an edit, so two steps can be told apart cheaply. */
  shape: string;
}

/**
 * The graph reduced to what somebody would call an edit.
 *
 * Which node is selected and the ports the server worked out are left out on
 * purpose: clicking a node is not something anybody asks to have undone, and a
 * preview landing is the server answering rather than anybody typing. A step
 * taken for either would be a Ctrl+Z that changes nothing on screen, and the
 * one before it - the edit actually being reached for - would need a second
 * press. Positions are in, because moving a node is exactly the kind of thing
 * somebody wants back.
 */
function editShape(nodes: Node<NodeData>[], edges: Edge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => {
      const { inputs: _inputs, outputs: _outputs, ...data } = node.data as NodeData;
      return [node.id, node.position.x, node.position.y, node.width ?? null, node.height ?? null, data];
    }),
    edges: edges.map((edge) => [edge.id, edge.source, edge.target, edge.sourceHandle ?? null]),
  });
}

/**
 * Whether the caret is somewhere the browser's own undo is the better one.
 *
 * Inside a text box Ctrl+Z means the letters just typed, and the browser does
 * that better than this could: it puts the caret back where it was, and undoes
 * only the box. Nothing is lost by leaving it to do so - every box here is
 * controlled, so what it puts back arrives as an ordinary edit and reaches the
 * canvas like any other typing. Stepping the whole graph back from under
 * somebody mid-word would be the wrong undo in the one place they are looking.
 * A code editor's own hidden textarea counts as one of these too.
 */
function typingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

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
 * What an edge is called, which is where it leaves from and where it arrives.
 *
 * The branch is in it as well as on the handle: two edges between the same pair
 * of nodes - one for each answer - are a shape somebody will draw, and they
 * would otherwise share an id.
 *
 * Written once because three places need the same answer: the graph arriving
 * from the server, a line just drawn, and a line dragged onto somewhere else.
 * An id worked out differently in any of them would be a second edge where
 * there is one.
 */
function edgeName(connection: { source: string; sourceHandle?: string | null; target: string }): string {
  return `${connection.source}-${connection.sourceHandle ?? 'plain'}->${connection.target}`;
}

/**
 * Where a node's input and output sit, for each way round it can face.
 *
 * A graph could only be drawn left to right, which is fine for four nodes and
 * wrong for a screen: a long chain runs off the side while the space below it
 * stays empty. Turning a node moves its handles and nothing else, so the lines
 * still leave the output and arrive at the input - they just do it downwards.
 */
const FACING: Record<NodeOrientation, { input: Position; output: Position }> = {
  LEFT_TO_RIGHT: { input: Position.Left, output: Position.Right },
  TOP_TO_BOTTOM: { input: Position.Top, output: Position.Bottom },
  RIGHT_TO_LEFT: { input: Position.Right, output: Position.Left },
  BOTTOM_TO_TOP: { input: Position.Bottom, output: Position.Top },
};

/** In the order pressing the button walks through them. */
const FACINGS: NodeOrientation[] = ['LEFT_TO_RIGHT', 'TOP_TO_BOTTOM', 'RIGHT_TO_LEFT', 'BOTTOM_TO_TOP'];

/**
 * Two handles on one edge, spaced along it.
 *
 * A condition leaves by two doors, and which way they are spread depends on
 * which edge they are on: down a side, across a top. Given as a percentage so
 * a node resized by hand keeps them evenly placed.
 */
/** The next way round, so pressing until it looks right is one gesture. */
function turned(from: NodeOrientation | null): NodeOrientation {
  const at = FACINGS.indexOf(from ?? 'LEFT_TO_RIGHT');
  return FACINGS[(at + 1) % FACINGS.length];
}

function alongEdge(side: Position, at: string): { top?: string; left?: string } {
  return side === Position.Left || side === Position.Right ? { top: at } : { left: at };
}

const FACING_LABEL: Record<NodeOrientation, string> = {
  LEFT_TO_RIGHT: 'Left to right',
  TOP_TO_BOTTOM: 'Top to bottom',
  RIGHT_TO_LEFT: 'Right to left',
  BOTTOM_TO_TOP: 'Bottom to top',
};

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
  const [straight, labelX, labelY] = getBezierPath({
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

  /*
   * A moved label takes its line with it.
   *
   * The label used to slide away on its own, leaving the line where it was -
   * so on a graph with more than a couple of them, nothing said which label
   * belonged to which line, which is the one thing a label has to say. The
   * line is now drawn through wherever the label has been put: in by the left
   * of it, out by the right, each half the same curve React Flow would have
   * drawn on its own.
   *
   * Only when it has been moved. An untouched label sits on its line already,
   * and routing through it would bend a straight run for nothing.
   */
  const at = { x: labelX + offset.x, y: labelY + offset.y };
  const moved = offset.x !== 0 || offset.y !== 0;
  const [into] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX: at.x,
    targetY: at.y,
    targetPosition: Position.Left,
  });
  const [outOf] = getBezierPath({
    sourceX: at.x,
    sourceY: at.y,
    sourcePosition: Position.Right,
    targetX,
    targetY,
    targetPosition,
  });
  const path = moved ? `${into} ${outOf}` : straight;
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
            // Which line it belongs to, said in the markup: a label that has been
            // dragged away is otherwise attributable only by eye.
            data-edge={id}
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

/**
 * The first of `first`, `then(2)`, `then(3)` … that nothing has taken.
 *
 * A copy needs a free one of three things - a key, a name and an output name -
 * and each is counted on differently: `-2`, ` 2`, `2`. One walk, and the caller
 * says how its step is spelled.
 */
function untaken(first: string, then: (at: number) => string, taken: Set<string>): string {
  if (!taken.has(first)) return first;
  for (let at = 2; ; at += 1) {
    const next = then(at);
    if (!taken.has(next)) return next;
  }
}

/**
 * What a copy of this node is called.
 *
 * `Fetch the order` copied is `Fetch the order copy`, and copying that is
 * `Fetch the order copy 2` rather than `Fetch the order copy copy`. Pressing
 * the key twice in a row is the ordinary way to get three of something - the
 * copy is what ends up selected, so the second press copies the copy - and a
 * name that grows a word each time is a name nobody can read by the fourth.
 *
 * A node called nothing but `copy` keeps its word: stripping it would leave a
 * stem of nothing, and ` copy` is not a name.
 */
function copyName(of: string, taken: Set<string>): string {
  const stem = of.replace(/ copy(?: \d+)?$/, '') || of;
  return untaken(`${stem} copy`, (at) => `${stem} copy ${at}`, taken);
}

/**
 * The same, for the name a node gives what it produces.
 *
 * Spelled without the space, because a field is pointed at by its name and the
 * panel refuses anything but letters, digits and underscores in one.
 */
function copyOutputName(of: string, taken: Set<string>): string {
  const stem = of.replace(/Copy\d*$/, '') || of;
  return untaken(`${stem}Copy`, (at) => `${stem}Copy${at}`, taken);
}

/**
 * How far a copy sits from what it was copied from.
 *
 * Far enough to be visibly a second node rather than one hiding the other, and
 * near enough to read as belonging to it. The same step the Add buttons put
 * between successive nodes.
 */
const COPY_OFFSET = 40;

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
      : name === 'sessionKeyPrefix'
        ? 'No prefix'
        : name === 'sessionKey'
          ? 'Nothing is kept'
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
  const facing = FACING[node.orientation ?? 'LEFT_TO_RIGHT'];

  return (
    <div className={selected ? `${styles.node} ${styles.nodeSelected}` : styles.node}>
      {/*
        Only on the selected node, so the canvas is not covered in handles. A
        node grows on its own to fit what it holds; this is for when a graph
        reads better with one node wider than the rest.
      */}
      <NodeResizer isVisible={selected} minWidth={220} minHeight={96} />
      {/*
        A condition's two ways out have to be spaced along whichever edge they
        leave by, or turning the node stacks them on top of each other.
      */}
      <span className={`${styles.accentBar} ${styles[KIND_CLASS[node.kind]]}`} aria-hidden="true" />
      {hasInput && (
        <Handle className={`${styles.handle} ${styles.handleIn}`} type="target" position={facing.input} />
      )}
      {/*
        A condition leaves by one of two doors, and each says which answer it
        is. Everything else has the one way out it always had - a node that
        asks nothing has nothing to answer.
      */}
      {node.kind === 'CONDITION' ? (
        <>
          <Handle
            id="yes"
            className={`${styles.handle} ${styles.handleYes}`}
            type="source"
            position={facing.output}
            style={alongEdge(facing.output, '35%')}
          />
          <span className={`${styles.branchLabel} ${styles.branchYes}`}>{node.yesLabel ?? 'Yes'}</span>
          <Handle
            id="no"
            className={`${styles.handle} ${styles.handleNo}`}
            type="source"
            position={facing.output}
            style={alongEdge(facing.output, '70%')}
          />
          <span className={`${styles.branchLabel} ${styles.branchNo}`}>{node.noLabel ?? 'No'}</span>
        </>
      ) : (
        <Handle className={`${styles.handle} ${styles.handleOut}`} type="source" position={facing.output} />
      )}

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

/**
 * Whether this click is the browser's to deal with rather than the editor's.
 *
 * Ctrl, Cmd, Shift, Alt or a button other than the first means a new tab, a new
 * window or a download: the editor is not being left at all, so there is nothing
 * to store on the way out and nothing to take off the screen. Everything else is
 * the plain click, which saves the graph first and then follows the link in
 * place.
 */
function opensAway(event: ReactMouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/**
 * A catalogue with this definition in it: in place where it was already there,
 * at the front where it is new.
 *
 * The panel saves both kinds - New makes one, Open definition changes one - and
 * a list that only ever grew would answer the next picker with the definition
 * twice, once as it was and once as it is now.
 */
function withDefinition<T extends { id: string }>(all: T[], one: T): T[] {
  return all.some((held) => held.id === one.id)
    ? all.map((held) => (held.id === one.id ? one : held))
    : [one, ...all];
}

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

  /**
   * Takes a label's position from one edge id to another.
   *
   * An edge is named after the two nodes it joins, so rewiring one renames it,
   * and a position kept against the old name would be left behind on a line
   * that no longer exists. Nothing is stored for a label still sitting where
   * its line put it, so there is usually nothing to carry.
   */
  const carryLabel = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      setLabelOffsets((held) => {
        const moved = held[from];
        if (moved === undefined) return held;
        const next = { ...held, [to]: moved };
        delete next[from];
        try {
          window.localStorage.setItem(labelKey, JSON.stringify(next));
        } catch {
          // As above: a browser that will not remember is not an error here.
        }
        return next;
      });
    },
    [labelKey],
  );
  const navigate = useNavigate();
  const { updateNode } = useReactFlow();
  /*
   * React Flow measures a node's handles once and remembers where they are.
   *
   * Turning a node moves them in the markup, so the dots move on screen - and
   * every line still leaves and arrives where the handles used to be, because
   * nothing told the library to look again. The result is a node that appears
   * to have turned and cannot be wired as though it had.
   */
  const remeasure = useUpdateNodeInternals();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<WorkflowStatus>('DRAFT');
  /**
   * Whether the workspace has this workflow switched on.
   *
   * Run works either way - trying the graph in front of you is how a workflow
   * that is off gets fixed - so the editor says so instead of refusing, and
   * nobody publishes into a silence they cannot see from here.
   */
  const [enabled, setEnabled] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<NodeData | null>(null);
  /** The field whose name is mid-edit, if any, and the name it had. */
  const [fieldEdit, setFieldEdit] = useState<{ index: number; was: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /*
   * Whether the saved graph has arrived. An empty canvas and a workflow with
   * nothing on it are drawn identically, so without this the editor spends the
   * fetch claiming the workflow is empty and then contradicts itself. Also
   * false while Discard re-reads, which is the same fetch and the same lie.
   */
  const [graphArrived, setGraphArrived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  /** A run is being started, and the editor is on its way to it. */
  const [running, setRunning] = useState(false);
  const [browsingIcons, setBrowsingIcons] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  /*
   * Which definition the builder panel is holding, if any.
   *
   * A node kind rather than a boolean per picker: only one node is selected, so
   * only one of these forms can be open, and the kind says which. The id says
   * which one of that kind - null for one being made, so New and Open
   * definition are the same panel asked for two different things.
   */
  const [building, setBuilding] = useState<{ kind: NodeKind; id: string | null } | null>(null);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
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
          groupKey: node.id,
          groupName: data.name === '' ? node.id : data.name,
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
        /*
         * Nor rewired. This line is drawn because a node reads a field from
         * somewhere it is not wired to; where it runs is worked out from the
         * references, and dragging its end would be an instruction the graph
         * has nowhere to keep. Wiring the two nodes together is what makes it
         * a real edge.
         */
        reconnectable: false,
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

  /*
   * Where the graph has been, so Ctrl+Z can put it back.
   *
   * Copies of the whole graph rather than a list of what was done to it. A node
   * is edited from the panel, moved on the canvas and wired by its handles, and
   * describing each of those as something to reverse would be three vocabularies
   * to keep in step with the editor for ever. All an undo has to achieve is that
   * the graph reads as it did, which a copy of it says outright.
   *
   * `settled` is the graph as the last step left it. What is on screen runs
   * ahead of it while something is being typed or dragged and becomes a step of
   * its own once it stops changing, which is what keeps a name from costing one
   * step per letter. Kept in refs: nothing on screen depends on the stacks
   * except the two buttons, and those read the count below.
   */
  const back = useRef<Step[]>([]);
  const forward = useRef<Step[]>([]);
  const settled = useRef<Step | null>(null);
  /** How far each way there is to go, for the buttons that say so. */
  const [steps, setSteps] = useState({ back: 0, forward: 0 });

  useEffect(() => {
    const now: Step = { nodes, edges, shape: editShape(nodes, edges) };
    /*
     * The first graph to arrive is where the history starts. Anything that is
     * not an edit - a preview landing, a node being selected - moves what the
     * next step is measured against without becoming one, so the copy held here
     * stays the newest picture of a graph nobody has changed.
     */
    if (settled.current === null || settled.current.shape === now.shape) {
      settled.current = now;
      return;
    }

    const timer = window.setTimeout(() => {
      back.current = [...back.current, settled.current as Step].slice(-HISTORY_STEPS);
      // Editing after going back starts another way forward, and what was ahead
      // was the one not taken.
      forward.current = [];
      settled.current = now;
      setSteps({ back: back.current.length, forward: 0 });
    }, HISTORY_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [nodes, edges]);

  /**
   * Puts a step back on the canvas, and the panel with it.
   *
   * The panel is the truth of the node it is editing, so a graph restored under
   * a panel still holding the fields from before would have them written
   * straight back over it a quarter of a second later - the undo would appear
   * to work and then reverse itself. Re-seeding from what was just restored is
   * what makes the panel show what the graph now holds.
   *
   * Which node is selected is kept as it is rather than taken from the step: a
   * step remembers what happened to be selected when it was taken, and undoing
   * a move should not also move the panel to whatever node was being looked at
   * then. A node coming back from a deletion is the exception - if the panel is
   * still pointed at it, it comes back selected, which is where it was.
   */
  function goTo(step: Step) {
    const chosen = new Map(nodes.map((node) => [node.id, node.selected ?? false]));
    const put = step.nodes.map((node) => ({ ...node, selected: chosen.get(node.id) ?? node.id === selectedKey }));
    setNodes(put);
    setEdges(step.edges);
    settled.current = { nodes: put, edges: step.edges, shape: step.shape };

    const node = put.find((candidate) => candidate.id === selectedKey);
    if (node === undefined) {
      setSelectedKey(null);
      setDraft(null);
    } else {
      // Without the ports, for the reason the selection effect gives.
      const { inputs: _inputs, outputs: _outputs, ...its } = node.data as NodeData;
      setDraft(its as NodeData);
    }
    // The held name belongs to a field of the draft that has just been replaced.
    setFieldEdit(null);
    // The server holds neither this nor what it was undone from.
    setSaved(false);
  }

  function undo() {
    const now: Step = { nodes, edges, shape: editShape(nodes, edges) };
    /*
     * Whatever has happened since the last step becomes one first. Ctrl+Z
     * pressed before a change has settled would otherwise reach past it to the
     * edit before, undoing two things at once and leaving no way to the one in
     * between.
     */
    if (settled.current !== null && settled.current.shape !== now.shape) {
      back.current = [...back.current, settled.current].slice(-HISTORY_STEPS);
      settled.current = now;
    }

    const step = back.current[back.current.length - 1];
    if (step === undefined) return;
    back.current = back.current.slice(0, -1);
    forward.current = [...forward.current, settled.current ?? now];
    setSteps({ back: back.current.length, forward: forward.current.length });
    goTo(step);
  }

  function redo() {
    const step = forward.current[forward.current.length - 1];
    if (step === undefined) return;
    forward.current = forward.current.slice(0, -1);
    const now: Step = settled.current ?? { nodes, edges, shape: editShape(nodes, edges) };
    back.current = [...back.current, now].slice(-HISTORY_STEPS);
    setSteps({ back: back.current.length, forward: forward.current.length });
    goTo(step);
  }

  /**
   * The saved graph, put on the canvas.
   *
   * Named because two things ask for it: opening the editor, and discarding —
   * which is the same act, since what is on the server is what "as it was"
   * means.
   */
  const loadGraph = useCallback(() => {
    if (workspaceId === '' || workflowId === '') return;
    setGraphArrived(false);
    fetchWorkflowGraph(workspaceId, workflowId)
      .then((graph) => {
        /*
         * A loaded graph has no history. Opening the editor is the obvious one,
         * but Discard is the same act, and steps kept across it would walk
         * forward into the graph that was just thrown away - putting back the
         * nodes the button was pressed to be rid of. Cleared before the graph
         * arrives, so the first step is measured against what the server holds.
         */
        back.current = [];
        forward.current = [];
        settled.current = null;
        setSteps({ back: 0, forward: 0 });
        setName(graph.name);
        setStatus(graph.status);
        setEnabled(graph.enabled);
        setNodes(
          graph.nodes.map((node) => ({
            id: node.key,
            type: 'graphNode',
            position: { x: node.x, y: node.y },
            data: {
              kind: node.kind,
              name: node.name,
              description: node.description,
              yesLabel: node.yesLabel ?? null,
              noLabel: node.noLabel ?? null,
              agentId: node.agentId,
              triggerId: node.triggerId,
              actionId: node.actionId,
              conditionId: node.conditionId,
              objectId: node.objectId ?? null,
              outputName: node.outputName ?? null,
              icon: node.icon ?? null,
              orientation: node.orientation ?? null,
              mappings: node.mappings ?? [],
            },
          })),
        );
        setProblems(graph.problems);
        setPorts(Object.fromEntries(graph.nodes.map((node) => [node.key, { inputs: node.inputs, outputs: node.outputs }])));
        setEdges(
          graph.edges.map((edge) => {
            const sourceHandle = edge.branch === 'YES' ? 'yes' : edge.branch === 'NO' ? 'no' : null;
            return {
              /*
               * Named from the handle, not from the branch as it is stored. The
               * two differ only in case, but a loaded `-YES->` and a drawn
               * `-yes->` are two ids for one line, and the editor would let the
               * same wiring be drawn twice without noticing.
               */
              id: edgeName({ source: edge.source, sourceHandle, target: edge.target }),
              source: edge.source,
              target: edge.target,
              sourceHandle,
            };
          }),
        );
        // Freshly loaded is in step with the server, which is what `saved`
        // means to the buttons. Leaving it false lights Publish on a graph
        // nobody has touched.
        setSaved(true);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the workflow.');
      })
      // Either way there is nothing more to wait for: the graph is on the
      // canvas, or the message above says why it is not.
      .finally(() => setGraphArrived(true));
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
    /*
     * Copied without the ports. They are the server's answer about the node,
     * not part of what the panel edits - and a draft that carried them carried
     * them as they were at selection. Every edit then wrote that snapshot back
     * over the node, and until the next preview corrected it, a renamed field
     * flashed its old name: the ports from the moment the node was clicked.
     */
    if (node === undefined) {
      setDraft(null);
    } else {
      const { inputs: _inputs, outputs: _outputs, ...its } = node.data as NodeData;
      setDraft(its as NodeData);
    }
    // Only re-seed the form when the selection changes, not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => addEdge({ ...connection, id: edgeName(connection) }, current));
      setSaved(false);
    },
    [setEdges],
  );

  /**
   * A line picked up by one of its ends and dropped on a different handle.
   *
   * This is React Flow's own reconnection rather than a delete and a redraw:
   * the edge is the same edge afterwards, which is what keeps the label sitting
   * on it and keeps the history reading as one step. Redrawing it would be two
   * changes to undo, and would lose whatever was hanging off the line.
   *
   * Rewiring is a change to the graph like any other, so it marks the workflow
   * unsaved, and the undo stack picks it up on its own - a step is a copy of
   * the graph, and the graph now says something different.
   */
  const onReconnect = useCallback(
    (edge: Edge, connection: Connection) => {
      /*
       * Put back where it came from. React Flow reports the drop either way,
       * and taking it would move the edge to the end of the list - which is a
       * different graph as far as the history is concerned, and would leave an
       * undo step for a drag that changed nothing.
       */
      const same =
        edge.source === connection.source &&
        edge.target === connection.target &&
        (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null);
      if (same) return;

      const name = edgeName(connection);
      /*
       * Dropped onto a wiring the graph already has. Two edges would then share
       * an id, so the line goes back where it was - the same silence as drawing
       * a duplicate by hand, which `addEdge` refuses just as quietly.
       */
      if (edges.some((one) => one.id !== edge.id && one.id === name)) return;

      /*
       * Renamed as well as rewired. An edge is called after the two ends it
       * joins, and one left under its old name would be a line called
       * `a->b` running from a to c - which the next line drawn from a to b
       * would then collide with.
       */
      setEdges((current) =>
        reconnectEdge(edge, connection, current, { shouldReplaceId: true, getEdgeId: () => name }),
      );
      /*
       * The label goes with the line. Where it has been dragged to is kept
       * against the edge's id, and rewiring gives the edge a new one - so
       * without this a label somebody had placed would jump back onto a line
       * that had merely moved, which is the one thing dragging it was for.
       */
      carryLabel(edge.id, name);
      setSaved(false);
    },
    [carryLabel, edges, setEdges],
  );

  /**
   * A key for a new node that nothing in the graph is already using.
   *
   * The clock is nearly enough on its own and not quite: two nodes made inside
   * the same millisecond would share an id, and a graph with two nodes under
   * one key saves as one node. A person cannot press a key twice that fast; a
   * script driving the editor can, and so could a copy made from a menu that
   * did not wait for a keystroke.
   */
  function freshKey(kind: NodeKind): string {
    const stem = `${kind.toLowerCase()}-${Date.now().toString(36)}`;
    return untaken(stem, (at) => `${stem}-${at}`, new Set(nodes.map((node) => node.id)));
  }

  function addNode(kind: NodeKind) {
    const key = freshKey(kind);
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
          /*
           * An agent starts with its answer named.
           *
           * Everything else means something useful unnamed - an action's own
           * outputs stand, an object's fields go on - but an agent answers in
           * prose, and unnamed prose is a thing no later node can point at. The
           * box used to show `reply` as a placeholder, which reads as a value
           * that is already there: the node declared nothing, showed nothing on
           * the canvas, and only started working once somebody typed a
           * different name. Now the default is real.
           */
          outputName: kind === 'AGENT' ? 'reply' : null,
          orientation: null,
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
   * The selected node again, beside itself.
   *
   * What is copied is what the node is: its kind, its description, its icon,
   * which way it faces, what its branches are called, and - the point of the
   * whole thing - the definition it points at. Two nodes running the same
   * action is the ordinary case, so the pointer is copied rather than the
   * definition duplicated behind it; editing that action still edits it once.
   * The mappings come too, as the node's own copy, so changing what one node
   * passes does not change what the other does.
   *
   * What is not copied is the wiring. A node arriving already joined to
   * everything its original was joined to is rarely the graph anybody wanted,
   * and for a condition it is not even well defined - which of the two answers
   * should the copy's edges leave by? So the copy lands loose, and drawing the
   * one or two lines it actually needs is a shorter job than deleting five.
   *
   * The name is not copied verbatim either. Two nodes reading identically on
   * the canvas is exactly the confusion a copy invites, and a node's name is
   * what the field picker calls the group it produces - so `Fetch the order`
   * gets `Fetch the order copy`, and a copy of that gets `copy 2`. The output
   * name is stepped the same way for the same reason, and a sharper one: a
   * reference is resolved by the field's name, so two nodes both giving `reply`
   * means somebody's `reply` silently reads from whichever of them the graph
   * happens to list first.
   *
   * Nothing else is needed to make this undoable or to mark the graph unsaved
   * beyond saying so: a step is a copy of the whole graph, and the graph now
   * has a node in it that it did not.
   */
  function duplicate() {
    if (selectedKey === null) return;
    const original = nodes.find((node) => node.id === selectedKey);
    if (original === undefined) return;

    /*
     * Read from the panel, not from the canvas - which is a picture of the
     * panel a quarter of a second behind, on purpose. Copying the picture
     * would copy the name as it stood before the last word was typed. The same
     * merge is written onto the original here, so the edit is not lost when the
     * selection moves to the copy and cancels the write that was pending.
     */
    const from: NodeData =
      draft === null
        ? (original.data as NodeData)
        : { ...(original.data as NodeData), ...named(withHeldName(draft, fieldEdit)) };

    const key = freshKey(from.kind);
    const name = copyName(from.name, new Set(nodes.map((node) => (node.data as NodeData).name)));
    const given = from.outputName;
    const outputName =
      given === null || given === ''
        ? given
        : copyOutputName(
            given,
            new Set(
              nodes
                .map((node) => (node.data as NodeData).outputName)
                .filter((one): one is string => one !== null && one !== ''),
            ),
          );

    /*
     * Without the ports. They are the server's answer about the node it was
     * asked about, and carrying them onto a node the server has never seen
     * would draw chips on the copy that describe the original.
     */
    const { inputs: _inputs, outputs: _outputs, ...its } = from;

    setNodes((current) => [
      ...current.map((node) =>
        node.id === selectedKey
          ? { ...node, data: { ...(node.data as NodeData), ...from }, selected: false }
          : { ...node, selected: false },
      ),
      {
        id: key,
        type: original.type,
        // A node somebody widened by hand is a node they want two of that size.
        width: original.width,
        height: original.height,
        style: original.style,
        position: { x: original.position.x + COPY_OFFSET, y: original.position.y + COPY_OFFSET },
        data: {
          ...its,
          name,
          outputName,
          // Its own, so editing what one node passes leaves the other alone.
          mappings: its.mappings.map((mapping) => ({ ...mapping })),
        },
      },
    ]);
    // The held name belongs to a field of the node the panel is about to leave.
    setFieldEdit(null);
    setSelectedKey(key);
    // The store only learns about the node on the next tick, so select it then.
    requestAnimationFrame(() => updateNode(key, { selected: true }));
    setSaved(false);
  }

  /**
   * The panel edits the node as it is typed in, so the canvas keeps up: the
   * name changes as you type it, and picking a trigger or an action takes
   * effect where it can be seen. There is no button to press afterwards: what
   * the panel says is what the node is, and a graph is a draft until Publish
   * makes it live - so a second confirmation between typing and saving was one
   * step that never decided anything.
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
          data.orientation === draft.orientation &&
          data.yesLabel === draft.yesLabel &&
          data.noLabel === draft.noLabel &&
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

  /*
   * A node whose handles have moved has to be measured again.
   *
   * React Flow finds a node's handles once and remembers where they are, so
   * moving them in the markup moved the dots and nothing else: every line went
   * on leaving and arriving where the handles had been, and a node that looked
   * turned could not be wired as one. Telling it to look again is the only cure,
   * and the whole question is when.
   *
   * Watching the panel's draft was the wrong when. The draft turns the moment
   * the button is pressed and the canvas follows a quarter of a second later, so
   * the measurement was taken of the node as it still stood - and once the node
   * did turn, nothing asked again. A node came out measured one turn behind
   * itself, which is why pressing Turn four times, all the way round to where it
   * started, left a node with its dots on the left and right and its lines
   * leaving from the bottom.
   *
   * So what is watched here is the canvas, not the panel: the nodes as they are
   * actually drawn, and of each one only what decides where its handles are -
   * which way it faces, and its kind, since a trigger has no input at all and a
   * condition leaves by two doors rather than one. Anything else a node changes
   * is left alone, including its size, which React Flow already watches for
   * itself and measures the handles again when it changes.
   */
  const shapes = useRef(new Map<string, string>());
  useEffect(() => {
    const now = new Map<string, string>();
    const moved: string[] = [];
    for (const node of nodes) {
      const data = node.data as NodeData;
      const shape = `${data.kind}:${data.orientation ?? 'LEFT_TO_RIGHT'}`;
      now.set(node.id, shape);
      if (shapes.current.get(node.id) !== shape) moved.push(node.id);
    }
    shapes.current = now;
    if (moved.length > 0) remeasure(moved);
  }, [nodes, remeasure]);

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
   * A node takes the name of whatever it points at, until it is given one.
   *
   * A graph of nodes called Action and LLM Agent says only what kind each one
   * is, which the accent bar and the label above the name say already - so the
   * one line with room to say what the node does says nothing. The definition
   * has a name somebody has already written and chosen to reuse, and that is
   * the name worth reading on the canvas.
   *
   * The same rule the icon follows, and the same limit: only a node still
   * carrying the name it was made with takes one. A name that has been typed
   * here is the node's, and picking a different definition afterwards leaves it
   * exactly as it is.
   */
  useEffect(() => {
    if (draft === null || draft.name !== NODE_KIND_LABEL[draft.kind]) return;

    const chosen =
      draft.kind === 'ACTION'
        ? (actions.find((one) => one.id === draft.actionId)?.name ?? null)
        : draft.kind === 'TRIGGER'
          ? (triggers.find((one) => one.id === draft.triggerId)?.name ?? null)
          : draft.kind === 'CONDITION'
            ? (conditions.find((one) => one.id === draft.conditionId)?.name ?? null)
            : draft.kind === 'OBJECT'
              ? (objects.find((one) => one.id === draft.objectId)?.name ?? null)
              : (agents.find((one) => one.id === draft.agentId)?.name ?? null);
    // A definition named after the kind it is - an action called Action - would
    // otherwise be written back over an identical name for ever.
    if (chosen === null || chosen.trim() === '' || chosen === draft.name) return;

    setDraft((held) =>
      held === null || held.name !== NODE_KIND_LABEL[held.kind] ? held : { ...held, name: chosen },
    );
  }, [draft, actions, triggers, conditions, agents, objects]);

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
   * There is something on screen the server has not been told about. A node's
   * fields already apply as they are typed — the effect above puts them
   * straight into the graph — so what is unsaved is never the panel, it is the
   * graph.
   */
  const unsaved = !saved;

  /*
   * Whether pressing Publish would do anything: either there are edits the
   * server has not seen, or it has seen them and they are still a draft.
   *
   * These were one flag, and saving turned it off — so the button that makes a
   * change live went quiet the moment the change was stored, which reads as
   * "nothing left to do" at exactly the point where the one thing left to do is
   * publish it.
   */
  const unpublished = unsaved || status !== 'PUBLISHED';

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
          orientation: data.orientation ?? null,
          yesLabel: data.yesLabel ?? null,
          noLabel: data.noLabel ?? null,
          mappings: data.mappings,
          x: node.position.x,
          y: node.position.y,
        };
      }),
      edges: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        // The handle it leaves from is the answer it carries.
        branch: edge.sourceHandle === 'yes' ? 'YES' : edge.sourceHandle === 'no' ? 'NO' : null,
      })),
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
        edges: edges.map((edge) => [edge.source, edge.target, edge.sourceHandle]),
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

  /**
   * The keystroke that saves, as somebody has it set.
   *
   * The same setting every other editor obeys rather than one of the editor's
   * own: a graph and a function are both work in progress, and a save that
   * needed different fingers depending on which one is open is a shortcut
   * nobody would trust.
   */
  const save = useSaveShortcut();
  const turnKey = useTurnShortcut();
  const undoKey = useUndoShortcut();
  const redoKey = useRedoShortcut();
  const copyKey = useDuplicateShortcut();

  /** Read by the keyboard handler, which must not start a second save. */
  const busyRef = useRef(busy);
  busyRef.current = busy;

  /** @returns whether the graph is now on the server. */
  async function handleSave(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const graph = await saveWorkflowGraph(workspaceId, workflowId, toGraph());
      setStatus(graph.status);
      setEnabled(graph.enabled);
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

  /*
   * Saving from the keyboard.
   *
   * Bound on the window in the capture phase, so it works wherever the caret is:
   * the panel is full of inputs, and a graph edited through them is exactly the
   * graph somebody wants stored without reaching for the mouse. `preventDefault`
   * is most of the reason it is worth binding at all - the default for the usual
   * choice is the browser offering to save the page as a file.
   *
   * `busy` is read from a ref rather than closed over, so holding the key down
   * cannot start a second save on top of the one in flight.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!matches(event, save)) return;
      event.preventDefault();
      if (!busyRef.current) void handleSave();
    }

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // handleSave reads the graph as it stands now, so the listener is rebound
    // every render rather than left holding an older canvas.
  });

  /*
   * Going back and forward from the keyboard.
   *
   * Bound the way saving is - on the window, in the capture phase, rebound every
   * render so it reads the graph as it stands - but not from the same setting.
   * Ctrl+Z is not a preference anywhere: it is the keystroke every application
   * on the machine already answers to, and offering to change it would invite
   * somebody to make undo something other than undo. Both spellings of forward
   * are taken because both are somebody's habit.
   *
   * A caret in a text box is handed to the browser instead, for the reason
   * `typingText` gives.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      /*
       * Ctrl+Y is honoured for redo whatever has been chosen, and is not
       * offered as a setting: it is the other habit somebody may arrive with,
       * and taking it away would be a change nobody asked for.
       */
      const habit = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'y';
      const asked = matches(event, undoKey) ? 'back' : matches(event, redoKey) || habit ? 'forward' : null;
      if (asked === null || typingText(event.target)) return;
      event.preventDefault();
      if (asked === 'back') undo();
      else redo();
    }

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  /*
   * Escape closes the builder panel.
   *
   * A modal dialog gets that from the browser; one shown beside the page does
   * not, and losing it would be a form somebody can only leave by finding the
   * right button - which is worse than the modal it replaced.
   */
  useEffect(() => {
    if (building === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setBuilding(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [building]);

  /**
   * The turn keystroke, R until somebody changes it in Preferences.
   *
   * Turning is something somebody does four times in a row, and reaching for
   * the panel each time is three reaches too many. A caret in a text box is
   * somebody typing the letter, so this is only heard on the canvas - which is
   * also what lets the default be a bare letter where nothing else can be.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!matches(event, turnKey)) return;
      if (typingText(event.target)) return;
      if (draft === null) return;
      event.preventDefault();
      setDraft({ ...draft, orientation: turned(draft.orientation ?? null) });
    }

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  /**
   * Copying the selected node from the keyboard, Ctrl+D until somebody changes
   * it in Preferences.
   *
   * Heard wherever the caret is, unlike turning and unlike undo. Both of those
   * are handed back inside a text box because something else there means more -
   * a letter is somebody typing it, and the browser's undo is the better undo
   * for the box in front of them. Nothing in a text box means Ctrl+D, and the
   * panel's name field is exactly where somebody finishes naming the node they
   * want a second of.
   *
   * Prevented whether or not there is a node to copy, and whatever has been
   * chosen: the default's own meaning in a browser is a bookmark, and
   * "sometimes it bookmarks the page" is not a rule anybody can hold.
   * Rebound every render, so it copies the graph as it stands rather than an
   * older one.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!matches(event, copyKey)) return;
      event.preventDefault();
      duplicate();
    }

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  /**
   * Following a link to a definition saves the graph first. The link is one
   * click away from work that only exists on screen, and coming back to find a
   * node reverted is the kind of loss nobody thinks to expect. A save the
   * server refuses keeps the editor where it is, with the reason showing —
   * leaving anyway would discard exactly what could not be stored.
   */
  async function leaveFor(destination: string) {
    if (unsaved && !(await handleSave())) return;
    navigate(destination);
  }

  /**
   * What a link out of the editor does when it is clicked.
   *
   * Every one of these is a real anchor, so it can be middle-clicked,
   * ctrl-clicked or copied like any other link - a definition somebody wants to
   * read beside the graph should not have to be reached by leaving the graph.
   * A modified click is handed straight back to the browser: react-router leaves
   * those alone too, and the new tab it opens has taken nothing off this screen.
   *
   * A plain click is the one that has to be intercepted. Preventing the default
   * stops react-router following the link at once, so the graph is stored, and
   * accepted, before the editor goes anywhere.
   */
  function leavingFor(destination: string) {
    return (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (opensAway(event)) return;
      event.preventDefault();
      void leaveFor(destination);
    };
  }

  /**
   * What Open definition does where the panel can hold the definition itself.
   *
   * New opens the builder down the left and keeps the graph on the screen;
   * reading what a node already points at wanted the same thing and got a
   * page instead, which took the graph away to answer a question about it.
   * The form is the same one either way - a trigger, an action and a condition
   * are edited by exactly the form that makes them - so this opens it on the
   * one that exists.
   *
   * Still an anchor, and still handed back to the browser when the click asks
   * for a tab of its own: the definition has a page, and somebody who wants it
   * beside the graph rather than over it should keep having that.
   */
  function openingIn(kind: NodeKind, id: string, destination: string) {
    return (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (opensAway(event)) return;
      event.preventDefault();
      /*
       * A definition the picker was not handed - a workspace with more of them
       * than a page holds - is still readable where it always was. Opening the
       * panel on nothing would offer to make one instead, under a link that
       * promised to show this one.
       */
      if (!catalogue(kind).some((held) => held.id === id)) {
        void leaveFor(destination);
        return;
      }
      setBuilding({ kind, id });
    };
  }

  /** The catalogue behind a picker, for the kinds the panel can hold. */
  function catalogue(kind: NodeKind): { id: string }[] {
    if (kind === 'TRIGGER') return triggers;
    if (kind === 'ACTION') return actions;
    if (kind === 'CONDITION') return conditions;
    return [];
  }

  /**
   * The definition the panel was opened on, or null while it is making one.
   *
   * Read out of the catalogue the picker is already offering rather than asked
   * for again: these lists arrive with every field the form needs, so a second
   * request would fetch what is on the screen.
   */
  function beingBuilt<T extends { id: string }>(kind: NodeKind, all: T[]): T | null {
    if (building === null || building.kind !== kind || building.id === null) return null;
    const id = building.id;
    return all.find((held) => held.id === id) ?? null;
  }

  /*
   * Closing the tab with edits on the canvas asks first.
   *
   * Every way out of the editor inside the app stores the draft on the way -
   * the only copy of a graph should not be a picture on a screen somebody is
   * about to walk away from. The browser will not let a page save on its way
   * out, so this is the one exit that has to ask instead, in the one way a
   * page is allowed to: the browser's own question, with its own words.
   */
  useEffect(() => {
    if (!unsaved) return;
    function onLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', onLeaving);
    return () => window.removeEventListener('beforeunload', onLeaving);
  }, [unsaved]);

  /**
   * Starts a run and follows it to the page that shows what it did.
   *
   * The graph is stored first, for the reason `leaveFor` stores it: a run
   * started by hand is the graph the server last heard about, so running
   * without saving would run whatever was there before the edits on screen.
   * A save the server refuses stops here with the reason showing, because a
   * run of the older graph is not what the button was pressed for.
   *
   * A refused start leaves the editor where it is. There is no run at the other
   * end to look at, and going there anyway would carry the reader away from the
   * one sentence explaining why - so the refusal goes where every other one in
   * this toolbar goes, beside the workflow's name.
   */
  async function handleRun() {
    if (busy || running) return;
    setRunning(true);
    setError(null);
    try {
      if (unsaved && !(await handleSave())) return;
      const started = await startExecution(workspaceId, workflowId);
      navigate(`/workspace/${workspaceId}/executions/${started.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the run.');
    } finally {
      setRunning(false);
    }
  }

  async function handlePublish() {
    setBusy(true);
    setError(null);
    try {
      await saveWorkflowGraph(workspaceId, workflowId, toGraph());
      const graph = await publishWorkflow(workspaceId, workflowId);
      setStatus(graph.status);
      setEnabled(graph.enabled);
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
      title={name === '' ? undefined : name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={null}
      hideSidebar
    >
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <Link
            to={`/workspace/${workspaceId}`}
            className={styles.backButton}
            onClick={leavingFor(`/workspace/${workspaceId}`)}
            aria-label="Back to workflows"
          >
            <img src={arrowLeftIcon} alt="" width={14} height={14} />
          </Link>
          <Link
            to={`/workspace/${workspaceId}`}
            className={styles.crumbLink}
            onClick={leavingFor(`/workspace/${workspaceId}`)}
          >
            Workflows
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.workflowName}>{name}</span>
          <Link
            to={`/workspace/${workspaceId}/workflows/${workflowId}/settings`}
            className={styles.renameButton}
            onClick={leavingFor(`/workspace/${workspaceId}/workflows/${workflowId}/settings`)}
            aria-label="Rename workflow"
            title="Rename workflow"
          >
            <img src={pencilIcon} alt="" width={14} height={14} />
          </Link>
          <span className={status === 'PUBLISHED' ? `${styles.badge} ${styles.badgeLive}` : styles.badge}>
            {status === 'PUBLISHED' ? 'Published' : 'Draft'}
          </span>
          {!enabled && (
            <span
              className={`${styles.badge} ${styles.badgeOff}`}
              title="No trigger, schedule or tool call will start this workflow while it is switched off. Run still will."
            >
              Switched off
            </span>
          )}
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
          {/*
            Beside Add, because it is the other way a node gets onto the canvas.
            Grey while nothing is selected, which is also how somebody learns
            that it is the selected node this copies. The keystroke is on the
            button for the reason Save's is: nobody finds out a shortcut exists
            without being told, and it is read from the setting the handler
            obeys so a rebinding shows here too.
          */}
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => duplicate()}
            disabled={selectedKey === null}
            title={
              selectedKey === null
                ? 'Select a node to copy it'
                : `Copy the selected node (${copyKey}). Change the keystroke in Preferences.`
            }
          >
            Duplicate <kbd className={styles.shortcutKey}>{copyKey}</kbd>
          </button>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => setRemoving(true)}
            aria-label="Remove workflow from workspace"
            title="Remove workflow from workspace"
          >
            <TrashIcon />
          </button>
          {/*
            The keystrokes are written on the buttons for the reason the save
            one is: nobody finds out a shortcut exists without being told. Grey
            while there is nowhere to go, which is also how somebody learns the
            editor has been remembering at all.
          */}
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => undo()}
            disabled={steps.back === 0}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => redo()}
            disabled={steps.forward === 0}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setDiscarding(true)}
            disabled={busy}
          >
            Discard
          </button>
          {/*
            The keystroke is written on the button that does the same thing,
            because that is the only way anybody finds out it exists without
            being told. Read from the setting the handler obeys, so somebody who
            changed it in Preferences is shown what they chose.
          */}
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => void handleSave()}
            disabled={busy}
            title={`Save the workflow (${save}). Change the keystroke in Preferences.`}
          >
            {busy ? (
              'Working…'
            ) : (
              <>
                Save <kbd className={styles.shortcutKey}>{save}</kbd>
              </>
            )}
          </button>
          {/*
            Running from the editor, and then watching it: the run's own page is
            where every step, its input and its log are, and reaching it by going
            back to the list and hunting for the newest row is a detour past the
            thing somebody pressed Run to see.
          */}
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => void handleRun()}
            disabled={busy || running}
            title="Run the workflow as it is on screen and open the run"
          >
            {running ? 'Starting…' : 'Run'}
          </button>
          {/*
            Violet while there is something to publish, quiet once there is not:
            a call to action that is always lit says nothing about whether it
            needs pressing.
          */}
          <button
            type="button"
            className={unpublished ? styles.publishButton : styles.publishButtonQuiet}
            onClick={() => void handlePublish()}
            disabled={busy}
          >
            Publish
          </button>
        </div>
      </div>

      <div className={styles.editor}>
        <div className={styles.canvas}>
          {!graphArrived && loadError === null && (
            <div className={styles.canvasWaiting}>
              <Loader />
            </div>
          )}
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
              onReconnect={onReconnect}
              /*
               * Room to take hold of a line's end. The grab circle sits just
               * beyond the handle, so a wider one is easier to aim at without
               * covering the handle itself - which is where a new line is
               * drawn from, and has to stay reachable.
               */
              reconnectRadius={14}
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
                          onClick={() => setBuilding({ kind: 'AGENT', id: null })}
                        >
                          New
                        </button>
                        {draft.agentId !== null && (
                          <Link
                            to={`/workspace/${workspaceId}/agents/${draft.agentId}/settings`}
                            className={styles.definitionLink}
                            onClick={leavingFor(`/workspace/${workspaceId}/agents/${draft.agentId}/settings`)}
                          >
                            Open definition
                          </Link>
                        )}
                      </span>
                    </span>
                    <DefinitionPicker
                      id="node-agent"
                      value={draft.agentId ?? ''}
                      options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
                      onChoose={(chosen) => setDraft({ ...draft, agentId: chosen || null })}
                      placeholder="Choose an agent…"
                      searchPlaceholder="Search agents…"
                    />
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
                          onClick={() => setBuilding({ kind: 'TRIGGER', id: null })}
                        >
                          New
                        </button>
                        {/* Where the node points, so the definition is one click away. */}
                        {draft.triggerId !== null && (
                          <Link
                            to={`/workspace/${workspaceId}/triggers/${draft.triggerId}`}
                            className={styles.definitionLink}
                            onClick={openingIn(
                              'TRIGGER',
                              draft.triggerId,
                              `/workspace/${workspaceId}/triggers/${draft.triggerId}`,
                            )}
                          >
                            Open definition
                          </Link>
                        )}
                      </span>
                    </span>
                    <DefinitionPicker
                      id="node-trigger"
                      value={draft.triggerId ?? ''}
                      options={triggers.map((trigger) => ({ value: trigger.id, label: trigger.name }))}
                      onChoose={(chosen) => setDraft({ ...draft, triggerId: chosen || null })}
                      placeholder="Choose a trigger…"
                      searchPlaceholder="Search triggers…"
                    />
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
                          onClick={() => setBuilding({ kind: 'ACTION', id: null })}
                        >
                          New
                        </button>
                        {draft.actionId !== null && (
                          <Link
                            to={`/workspace/${workspaceId}/actions/${draft.actionId}`}
                            className={styles.definitionLink}
                            onClick={openingIn(
                              'ACTION',
                              draft.actionId,
                              `/workspace/${workspaceId}/actions/${draft.actionId}`,
                            )}
                          >
                            Open definition
                          </Link>
                        )}
                      </span>
                    </span>
                    <DefinitionPicker
                      id="node-action"
                      value={draft.actionId ?? ''}
                      options={actions.map((action) => ({ value: action.id, label: action.name }))}
                      onChoose={(chosen) => setDraft({ ...draft, actionId: chosen || null })}
                      placeholder="Choose an action…"
                      searchPlaceholder="Search actions…"
                    />
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
                          onClick={() => setBuilding({ kind: 'OBJECT', id: null })}
                        >
                          New
                        </button>
                        {draft.objectId !== null && (
                          <Link
                            to={`/workspace/${workspaceId}/objects/${draft.objectId}`}
                            className={styles.definitionLink}
                            onClick={leavingFor(`/workspace/${workspaceId}/objects/${draft.objectId}`)}
                          >
                            Open definition
                          </Link>
                        )}
                      </span>
                    </span>
                    <DefinitionPicker
                      id="node-object"
                      value={draft.objectId ?? ''}
                      options={objects.map((shape) => ({ value: shape.id, label: shape.name }))}
                      onChoose={(chosen) => setDraft({ ...draft, objectId: chosen || null })}
                      placeholder="Choose a shape…"
                      searchPlaceholder="Search objects…"
                    />
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
                                  label={`${mapping.name} reference`}
                                  onChange={(option) =>
                                    setDraft({
                                      ...draft,
                                      mappings: draft.mappings.map((held, at) =>
                                        at === index
                                          ? {
                                              ...held,
                                              expression: option.expression,
                                              sourceNodeKey: option.groupKey,
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
                              the agent already does. <strong>sessionKey</strong> keeps this turn in a
                              conversation that outlives the run — every node arriving at the same key writes
                              into the same one — and <strong>sessionKeyPrefix</strong> is what that key is
                              filed under. Leave the key empty and nothing is recorded.
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
                    <span className={styles.label}>Ways out</span>
                    {/*
                      What the two branches are called on this node. "Is it
                      urgent" reads better as Escalate and File it, and those
                      words are most of what makes a graph legible - so they
                      belong to the node rather than to the edges leaving it.
                    */}
                    <div className={styles.branchNames}>
                      <input
                        className={`${styles.input} ${styles.branchInput}`}
                        value={draft.yesLabel ?? ''}
                        placeholder="Yes"
                        aria-label="What the yes branch is called"
                        onChange={(event) => setDraft({ ...draft, yesLabel: event.target.value || null })}
                      />
                      <input
                        className={`${styles.input} ${styles.branchInput}`}
                        value={draft.noLabel ?? ''}
                        placeholder="No"
                        aria-label="What the no branch is called"
                        onChange={(event) => setDraft({ ...draft, noLabel: event.target.value || null })}
                      />
                    </div>
                    <p className={styles.parameterHint}>
                      Two lines leave a condition: the upper handle for the answer that holds, the lower
                      for the one that does not. Either may be left unconnected.
                    </p>
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
                          onClick={() => setBuilding({ kind: 'CONDITION', id: null })}
                        >
                          New
                        </button>
                        {draft.conditionId !== null && (
                          <Link
                            to={`/workspace/${workspaceId}/conditions/${draft.conditionId}`}
                            className={styles.definitionLink}
                            onClick={openingIn(
                              'CONDITION',
                              draft.conditionId,
                              `/workspace/${workspaceId}/conditions/${draft.conditionId}`,
                            )}
                          >
                            Open definition
                          </Link>
                        )}
                      </span>
                    </span>
                    <DefinitionPicker
                      id="node-condition"
                      value={draft.conditionId ?? ''}
                      options={conditions.map((condition) => ({ value: condition.id, label: condition.name }))}
                      onChoose={(chosen) => setDraft({ ...draft, conditionId: chosen || null })}
                      placeholder="Choose a condition…"
                      searchPlaceholder="Search conditions…"
                    />
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

                <div className={styles.field}>
                  <span className={styles.label}>Facing</span>
                  {/*
                    One button that walks round rather than four options: a
                    node has four ways to face and pressing until it looks
                    right is how somebody actually uses this, while four radio
                    buttons would take four times the room in a panel that is
                    already the narrow half of the screen.
                  */}
                  <div className={styles.inputWrapper}>
                    <span className={styles.iconName}>{FACING_LABEL[draft.orientation ?? 'LEFT_TO_RIGHT']}</span>
                    <button
                      type="button"
                      className={styles.parameterSync}
                      onClick={() => setDraft({ ...draft, orientation: turned(draft.orientation ?? null) })}
                      title="Turn the node (R)"
                    >
                      Turn
                    </button>
                  </div>
                  <p className={styles.parameterHint}>
                    Where the lines join it. Nothing about what runs; a long chain reads better down a screen than
                    off the side of one.
                  </p>
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
                        // Not a name it already has: for an agent an empty box
                        // means the answer goes nowhere addressable, and a
                        // placeholder spelling a plausible name said otherwise.
                        placeholder={draft.kind === 'AGENT' ? 'not named' : 'result'}
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
        Making a definition, and changing one, without leaving the graph.

        Each of these is the builder its own page uses, so a trigger made here is
        made exactly as it would be there - and a trigger opened here is the same
        form its settings page shows. What is added is picked straight away:
        somebody who reached for New wanted this node to use it.

        Shown as a panel down the left rather than as a modal over the middle.
        The graph is the reason somebody is making the thing, and covering it to
        ask about it means answering from memory - so the canvas stays visible
        and about two thirds of the width stays usable while the form is open.

        What is saved here is the definition itself, not the node: it lands in
        the workspace at once, and every other workflow pointing at it gets the
        new version. The graph's own Save and Publish are unaffected either way.
      */}
      <CreateTriggerDialog
        placement="panel"
        open={building?.kind === 'TRIGGER'}
        workspaceId={workspaceId}
        trigger={beingBuilt('TRIGGER', triggers)}
        onClose={() => setBuilding(null)}
        onCreated={(trigger) => {
          setTriggers((all) => withDefinition(all, trigger));
          setDraft((current) => (current === null ? current : { ...current, triggerId: trigger.id }));
          setBuilding(null);
        }}
      />

      <ActionDialog
        placement="panel"
        open={building?.kind === 'ACTION'}
        workspaceId={workspaceId}
        action={beingBuilt('ACTION', actions)}
        onClose={() => setBuilding(null)}
        onSaved={(action) => {
          setActions((all) => withDefinition(all, action));
          setDraft((current) => (current === null ? current : { ...current, actionId: action.id }));
          setBuilding(null);
        }}
        /*
         * Deleted from the panel, the node is left pointing at nothing rather
         * than at an action the workspace no longer has - which the validator
         * can say something useful about, where a dead id reads as a node that
         * works.
         */
        onDeleted={() => {
          const gone = building?.id ?? null;
          setActions((all) => all.filter((held) => held.id !== gone));
          setDraft((current) =>
            current === null || current.actionId !== gone ? current : { ...current, actionId: null },
          );
          setBuilding(null);
        }}
      />

      <ConditionDialog
        placement="panel"
        open={building?.kind === 'CONDITION'}
        workspaceId={workspaceId}
        condition={beingBuilt('CONDITION', conditions)}
        onClose={() => setBuilding(null)}
        onSaved={(condition) => {
          setConditions((all) => withDefinition(all, condition));
          setDraft((current) => (current === null ? current : { ...current, conditionId: condition.id }));
          setBuilding(null);
        }}
        onDeleted={() => {
          const gone = building?.id ?? null;
          setConditions((all) => all.filter((held) => held.id !== gone));
          setDraft((current) =>
            current === null || current.conditionId !== gone ? current : { ...current, conditionId: null },
          );
          setBuilding(null);
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
        placement="panel"
        open={building?.kind === 'OBJECT'}
        title="Create Object"
        message="An object names a shape, so a mapping can be offered rather than typed blind."
        nameLabel="Name"
        namePlaceholder="SlackMessage"
        descriptionPlaceholder="Represents an incoming Slack message with metadata"
        submitLabel="Create Object"
        onClose={() => setBuilding(null)}
        onSubmit={async (name, description) => {
          const made = await createObject(workspaceId, { name, description: description || undefined });
          setObjects((all) => withDefinition(all, made));
          setDraft((current) => (current === null ? current : { ...current, objectId: made.id }));
          setBuilding(null);
        }}
      />

      <CreateAgentDialog
        placement="panel"
        open={building?.kind === 'AGENT'}
        workspaceId={workspaceId}
        onClose={() => setBuilding(null)}
        onCreated={(agent) => {
          setAgents((all) => withDefinition(all, agent));
          setDraft((current) => (current === null ? current : { ...current, agentId: agent.id }));
          setBuilding(null);
        }}
      />
    </AppShell>
  );
}
