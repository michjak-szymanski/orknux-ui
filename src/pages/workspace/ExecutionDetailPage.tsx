import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import type { ReactFlowInstance } from '@xyflow/react';
import type { Edge, Node, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  STATUS_LABEL,
  TRIGGER_LABEL,
  fetchExecution,
  formatDuration,
  rerunExecution,
  rerunExecutionStep,
} from '../../api/executions';
import type { ExecutionDetail, ExecutionStep, StepStatus } from '../../api/executions';
import { NODE_KIND_LABEL } from '../../api/graph';
import type { NodeKind } from '../../api/graph';
import type { SessionUser } from '../../api/session';
import clockIcon from '../../assets/clock.svg';
import downloadIcon from '../../assets/download.svg';
import refreshIcon from '../../assets/refresh-cw.svg';
import searchIcon from '../../assets/search.svg';
import terminalIcon from '../../assets/terminal.svg';
import { AppShell } from '../../components/AppShell';
import { AutoRefresh } from '../../components/AutoRefresh';
import { BackLink } from '../../components/BackLink';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './ExecutionDetailPage.module.css';

export interface ExecutionDetailPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const KIND_CLASS: Record<NodeKind, string> = {
  TRIGGER: 'trigger',
  AGENT: 'agent',
  ACTION: 'action',
  CONDITION: 'condition',
  OBJECT: 'objectNode',
  // Listed for completeness rather than because it happens: a session node is
  // a declaration the agent reads, so no run ever records a step of this kind.
  SESSION: 'session',
};

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  WAITING: 'Waiting',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};

/** What each canvas node carries; React Flow keeps it under `data`. */
interface StepNodeData extends Record<string, unknown> {
  kind: NodeKind;
  name: string;
  description: string | null;
  status: StepStatus;
  duration: string;
  /** What actually happened to this step, once the run has ended. */
  outcome: StepOutcome;
}

/**
 * What a step's box says, which is not quite its status.
 *
 * A step still `PENDING` in a run that has ended was never reached, and the node
 * that ended the run is not merely "completed" — it is the answer that stopped
 * everything after it. Neither is a status the server keeps, because both are
 * about the run as a whole.
 */
type StepOutcome =
  | 'done'
  | 'failed'
  | 'running'
  | 'waiting'
  | 'not-met'
  | 'skipped'
  | 'start'
  | 'pending'
  | 'carried';

function outcomeOf(
  step: ExecutionStep,
  runEnded: boolean,
  stoppedAtNodeKey: string | null,
): StepOutcome {
  /*
   * Carried over answers the question this graph asks - what did this run do
   * with this node - and the answer is nothing. The status and the times beside
   * it were copied from the run this one was started from, so reading them as
   * work done here would be reading them wrong. The status behind the copy is
   * still in the panel, for anyone who wants it.
   */
  if (step.carriedOver) return 'carried';
  if (step.key === stoppedAtNodeKey) return 'not-met';
  if (step.kind === 'TRIGGER') return 'start';
  if (step.status === 'PENDING') return runEnded ? 'skipped' : 'pending';
  if (step.status === 'SKIPPED') return 'skipped';
  if (step.status === 'FAILED') return 'failed';
  if (step.status === 'RUNNING') return 'running';
  if (step.status === 'WAITING') return 'waiting';
  return 'done';
}

const OUTCOME_LABEL: Record<StepOutcome, string> = {
  done: 'Ran',
  failed: 'Failed',
  running: 'Running',
  waiting: 'Waiting',
  'not-met': 'Condition not met',
  skipped: 'Skipped',
  start: 'Started here',
  pending: 'Pending',
  carried: 'Carried over',
};

/** The mark in the corner: what happened, at a glance. */
const OUTCOME_MARK: Record<StepOutcome, string> = {
  done: '✓',
  failed: '✕',
  running: '',
  waiting: '',
  'not-met': '✕',
  skipped: '–',
  start: '▶',
  pending: '',
  carried: '↻',
};

/** A node as it ran: the editor's card plus the outcome badge and its duration. */
function StepNodeView({ data, selected }: NodeProps) {
  const step = data as StepNodeData;
  const classes = [styles.node, styles[`outcome-${step.outcome}` as keyof typeof styles] as string];
  if (selected) classes.push(styles.nodeSelected);

  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <span className={`${styles.accentBar} ${styles[KIND_CLASS[step.kind]]}`} aria-hidden="true" />
      {step.kind !== 'TRIGGER' && <Handle className={styles.handle} type="target" position={Position.Left} />}
      <Handle className={styles.handle} type="source" position={Position.Right} />

      <div className={styles.nodeContent}>
        <div className={styles.metaRow}>
          <span className={styles.kindLabel}>{NODE_KIND_LABEL[step.kind]}</span>
          <OutcomeMark outcome={step.outcome} />
        </div>
        <span className={styles.nodeName}>{step.name}</span>
        <span className={styles.outcomeLabel}>{OUTCOME_LABEL[step.outcome]}</span>
        <span className={styles.nodeDuration}>{step.duration}</span>
      </div>
    </div>
  );
}

/** The mark a node carries in its corner: what happened to it. */
function OutcomeMark({ outcome }: { outcome: StepOutcome }) {
  return (
    <span
      className={`${styles.stepBadge} ${styles[`mark-${outcome}` as keyof typeof styles] as string}`}
      title={OUTCOME_LABEL[outcome]}
      aria-label={OUTCOME_LABEL[outcome]}
    >
      {OUTCOME_MARK[outcome]}
    </span>
  );
}

const nodeTypes = { stepNode: StepNodeView };

/**
 * Frames the graph on what is actually drawn.
 *
 * React Flow's own `fitView` does nothing in this canvas. It fits to the sizes it
 * has measured, and it never measures these nodes: `useNodesInitialized` reports
 * false forever, with the nodes rendered, absolutely positioned at their
 * coordinates, 200x92 each, and their handles in place. Every route into the fit
 * therefore did nothing — the `fitView` prop, which fits on initialisation, and the
 * two effects that called `fitView` themselves. The viewport kept its identity
 * transform, and a run wider than the card showed two of its four steps with
 * nothing to say the others were off to the right.
 *
 * So the viewport is computed here instead, from the one source that is definitely
 * right: the elements on the page. Each node carries its own `translate(x, y)` in
 * flow coordinates, and `offsetWidth`/`offsetHeight` are layout sizes, unaffected
 * by the scale on the ancestor — so the extent of the graph can be read off the DOM
 * whatever React Flow believes. `setViewport` only sets a transform and needs no
 * measurement of its own, which is why it works where `fitView` does not.
 */
function frameGraph(flow: ReactFlowInstance, canvas: HTMLElement): void {
  const drawn = [...canvas.querySelectorAll<HTMLElement>('.react-flow__node')];
  if (drawn.length === 0) return;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const node of drawn) {
    const at = /translate\(\s*([-\d.]+)px,\s*([-\d.]+)px\s*\)/.exec(node.style.transform);
    if (at === null) continue;
    const x = Number(at[1]);
    const y = Number(at[2]);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + node.offsetWidth);
    bottom = Math.max(bottom, y + node.offsetHeight);
  }

  const width = right - left;
  const height = bottom - top;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

  const room = { width: canvas.clientWidth, height: canvas.clientHeight };
  if (room.width === 0 || room.height === 0) return;

  /*
   * Never magnified. A run of two steps blown up to fill the card looks like a
   * different application than the same run with eight, and the nodes are drawn at
   * the size somebody chose.
   */
  const zoom = Math.min(room.width / (width * PADDING), room.height / (height * PADDING), 1);

  flow.setViewport({
    x: room.width / 2 - (left + width / 2) * zoom,
    y: room.height / 2 - (top + height / 2) * zoom,
    zoom,
  });
}

/** How much bigger than the graph the view is, so nothing sits against an edge. */
const PADDING = 1.2;

/**
 * Frames the graph when the run's steps change.
 *
 * Two frames — one for React to commit the nodes, one for the browser to lay them
 * out — and once more shortly after, for a layout that lands later still. Framing
 * twice is cheap and lands in the same place; not framing at all was the bug.
 *
 * Keyed on which steps there are rather than how many, so selecting one (which
 * rebuilds the node objects) does not yank the viewport back mid-inspection.
 */
function FitWhenReady({ signature }: { signature: string }) {
  const flow = useReactFlow();

  useEffect(() => {
    if (signature === '') return;

    let cancelled = false;
    const frame = () => {
      const canvas = document.querySelector<HTMLElement>('.react-flow');
      if (!cancelled && canvas !== null) frameGraph(flow, canvas);
    };

    const first = requestAnimationFrame(() => requestAnimationFrame(frame));
    const again = window.setTimeout(frame, LATE_FIT_MS);

    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
      window.clearTimeout(again);
    };
  }, [signature, flow]);

  return null;
}

/** Long enough for a slow layout, short enough not to be seen as a jump. */
const LATE_FIT_MS = 250;

export function ExecutionDetailPage({ session, onSignOut }: ExecutionDetailPageProps) {
  const { workspaceId = '', executionId = '' } = useParams();

  const [run, setRun] = useState<ExecutionDetail | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    if (executionId === '') return;
    setRefreshing(true);
    fetchExecution(executionId)
      .then((found) => {
        if (found === null) {
          setLoadError('That run does not exist, or you do not have access to it.');
          return;
        }
        setRun(found);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the run.');
      })
      .finally(() => setRefreshing(false));
  }, [executionId]);

  useEffect(load, [load]);

  const runEnded = run !== null && run.status !== 'RUNNING';
  /**
   * React Flow fits the view when it mounts, which is before the card has been
   * laid out — so it fitted an empty box and the graph landed off-screen. It is
   * fitted again once there is something to fit and somewhere to fit it into.
   */
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);

  const nodes: Node[] = useMemo(
    () =>
      (run?.steps ?? []).map((step) => ({
        id: step.key,
        type: 'stepNode',
        position: { x: step.x, y: step.y },
        selected: step.key === selectedKey,
        data: {
          kind: step.kind,
          name: step.name,
          description: step.description,
          status: step.status,
          duration: formatDuration(step.durationSeconds),
          outcome: outcomeOf(step, runEnded, run?.stoppedAtNodeKey ?? null),
        } satisfies StepNodeData,
      })),
    [run, selectedKey, runEnded],
  );

  /** Which steps the graph is showing, so a refit follows the run and not the cursor. */
  const signature = useMemo(() => nodes.map((node) => node.id).join('|'), [nodes]);

  const edges: Edge[] = useMemo(() => {
    const outcomes = new Map(
      (run?.steps ?? []).map((step) => [
        step.key,
        outcomeOf(step, runEnded, run?.stoppedAtNodeKey ?? null),
      ]),
    );
    return (run?.edges ?? []).map((edge) => {
      // A path the run never took is drawn as one it never took.
      const notTaken = outcomes.get(edge.target) === 'skipped';
      return {
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        animated: outcomes.get(edge.target) === 'running',
        className: notTaken ? styles.edgeSkipped : undefined,
      };
    });
  }, [run, runEnded]);

  useEffect(() => {
    if (flow === null || nodes.length === 0) return;
    const fit = () => {
      const element = document.querySelector<HTMLElement>('.react-flow');
      if (element !== null) frameGraph(flow, element);
    };
    const frame = requestAnimationFrame(fit);

    // The card is laid out after the graph mounts, and the panel opening
    // changes its width; both are a reason to fit again.
    const canvas = document.querySelector(`.${styles.canvas}`);
    const observer = canvas === null ? null : new ResizeObserver(fit);
    if (canvas !== null) observer?.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [flow, nodes]);

  const selected = run?.steps.find((step) => step.key === selectedKey) ?? null;

  // With a node selected the log narrows to that node, as the design shows it.
  const visibleLogs = (run?.logs ?? []).filter((line) => {
    if (selected !== null && line.nodeKey !== selected.key) return false;
    if (logFilter.trim() === '') return true;
    return line.message.toLowerCase().includes(logFilter.trim().toLowerCase());
  });

  async function handleRerun() {
    if (rerunning) return;
    setRerunning(true);
    try {
      const queued = await rerunExecution(executionId);
      // The queued run is a new one; follow it rather than staying on the old.
      window.location.assign(`/workspace/${workspaceId}/executions/${queued.id}`);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not re-run.');
      setRerunning(false);
    }
  }

  /*
   * The panel calls this and shows what comes back out of it. It deliberately
   * does not catch: which steps can be started from is the server's judgement,
   * and the panel puts the server's own sentence beside the button it refused.
   */
  async function rerunFromStep(nodeKey: string) {
    const queued = await rerunExecutionStep(executionId, nodeKey);
    // A run started from a step is still a new run; follow it, as Re-run does.
    window.location.assign(`/workspace/${workspaceId}/executions/${queued.id}`);
  }

  function downloadLogs() {
    const text = (run?.logs ?? [])
      .map((line) => `[${timeOf(line.at)}] ${line.message}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `run-${executionId}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell
      title={run?.workflowName}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
      /*
       * A run is a long page - a summary, a graph, and a step for every node -
       * so it scrolls inside the frame rather than growing it. Growing pushed
       * everything below the fold, the attribution bar included, which is the
       * one thing on the page that has to stay where it is.
       */
      scrollContent
    >
      {/* Outside the columns: the header belongs to the page, so the cards and
          the node panel both start under it rather than the panel starting level
          with the breadcrumb. */}
      <div className={styles.headerRow}>
        <header className={styles.contentHeader}>
            <p className={styles.breadcrumb}>
              <BackLink to={`/workspace/${workspaceId}/executions`} label="Executions" />
              <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/executions`}>
                Executions
              </Link>
              <span className={styles.crumbSeparator}>/</span>
              <span className={styles.crumbCurrent}>Run #{executionId}</span>
            </p>

            <div className={styles.statusHeader}>
              <div className={styles.headerLeft}>
                {run !== null && (
                  <span className={`${styles.statusBadge} ${styles[run.status.toLowerCase()]}`}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    {STATUS_LABEL[run.status]}
                  </span>
                )}
                <h1 className={styles.title}>{run?.workflowName ?? '…'}</h1>
                {run !== null && (
                  <Link className={styles.viewWorkflow} to={`/workspace/${workspaceId}/workflows/${run.workflowId}/editor`}>
                    View Workflow
                  </Link>
                )}
                <span className={styles.duration}>
                  <img src={clockIcon} alt="" width={14} height={14} />
                  {formatDuration(run?.durationSeconds ?? null)}
                </span>
              </div>
              {/* A run in flight changes on its own; this is how the page keeps up. */}
              {/* Reloading is skipped while a load is in flight, so the timer
                  cannot stack ticks behind a slow one. */}
              <button
                type="button"
                className={styles.refresh}
                onClick={load}
                disabled={refreshing}
                title="Reload this run"
              >
                <img src={refreshIcon} alt="" width={14} height={14} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <AutoRefresh onRefresh={load} busy={refreshing} />
              <button type="button" className={styles.rerun} onClick={handleRerun} disabled={run === null || rerunning}>
                <img src={refreshIcon} alt="" width={14} height={14} />
                {rerunning ? 'Queueing…' : 'Re-run'}
              </button>
              {/*
                What this page shows is what each node did. Every attempt behind
                that is Temporal's history — a screen that already exists, so it
                is offered rather than rebuilt. Absent where nothing is exposed.
              */}
              {run?.temporalUrl != null && run.temporalUrl !== '' && (
                <a
                  className={styles.refresh}
                  href={run.temporalUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="This run in Temporal, attempt by attempt"
                >
                  Open in Temporal
                </a>
              )}
            </div>
        </header>
      </div>

      <div className={selected === null ? styles.layout : `${styles.layout} ${styles.layoutWithPanel}`}>
        <div className={styles.main}>
          {loadError !== null ? (
            <section className={styles.card}>
              <p className={styles.loadError} role="alert">
                {loadError}
              </p>
            </section>
          ) : run === null ? (
            <section className={styles.card}>
              <Loader />
            </section>
          ) : (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Summary</h2>
                <dl className={styles.summary}>
                  <SummaryRow label="Run ID">#{executionId}</SummaryRow>
                  {/* Where this run came from, for a run that came of re-running
                      another. Only the id is kept, and only the id is needed:
                      the workflow is the same one named two rows below. */}
                  {run?.startedFrom != null && (
                    <SummaryRow label="Started from">
                      <Link
                        className={styles.summaryLink}
                        to={`/workspace/${workspaceId}/executions/${run.startedFrom}`}
                      >
                        Run #{run.startedFrom}
                      </Link>
                    </SummaryRow>
                  )}
                  <SummaryRow label="Status">
                    {run !== null && (
                      <span className={`${styles.statusBadge} ${styles[run.status.toLowerCase()]}`}>
                        <span className={styles.statusDot} aria-hidden="true" />
                        {STATUS_LABEL[run.status]}
                      </span>
                    )}
                  </SummaryRow>
                  <SummaryRow label="Workflow">{run?.workflowName ?? '—'}</SummaryRow>
                  <SummaryRow label="Triggered by">
                    {run === null ? '—' : TRIGGER_LABEL[run.trigger]}
                  </SummaryRow>
                  <SummaryRow label="Started" mono>
                    {formatStamp(run?.startedAt)}
                  </SummaryRow>
                  <SummaryRow label="Finished" mono>
                    {formatStamp(run?.finishedAt ?? null)}
                  </SummaryRow>
                  <SummaryRow label="Duration">{formatDuration(run?.durationSeconds ?? null)}</SummaryRow>
                  {run?.error != null && (
                    <SummaryRow label="Error">
                      <span className={styles.summaryError}>{run.error}</span>
                    </SummaryRow>
                  )}
                  {run?.stoppedAtNodeKey != null &&
                    (() => {
                      const stopped = run.steps.find((step) => step.key === run.stoppedAtNodeKey);
                      const name = stopped?.name ?? run.stoppedAtNodeKey;
                      return (
                        <SummaryRow label="Condition not met">
                          {/* The question that was asked is a click away, in the catalogue. */}
                          {stopped?.conditionId != null ? (
                            <Link
                              className={styles.summaryStopped}
                              to={`/workspace/${workspaceId}/conditions/${stopped.conditionId}`}
                            >
                              {name}
                            </Link>
                          ) : (
                            <span className={styles.summaryStopped}>{name}</span>
                          )}
                        </SummaryRow>
                      );
                    })()}
                </dl>
              </section>

              <section className={styles.card}>
                <div className={styles.graphHeader}>
                  <h2 className={styles.cardTitle}>Workflow Graph</h2>
                  {run !== null && (
                    <span className={`${styles.graphStatus} ${styles[run.status.toLowerCase()]}`}>
                      <span className={styles.statusDot} aria-hidden="true" />
                      {STATUS_LABEL[run.status]}
                    </span>
                  )}
                </div>

                {run !== null && run.steps.length === 0 ? (
                  <p className={styles.notice}>No step detail was recorded for this run.</p>
                ) : (
                  <div className={styles.canvas}>
                    <ReactFlow
                      onInit={(instance) => setFlow(instance)}
                      nodes={nodes}
                      edges={edges}
                      nodeTypes={nodeTypes}
                      onNodeClick={(_, node) => setSelectedKey(node.id)}
                      onPaneClick={() => setSelectedKey(null)}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      edgesFocusable={false}
                      fitView
                      proOptions={{ hideAttribution: true }}
                    >
                      <FitWhenReady signature={signature} />
                      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#27272a" />
                    </ReactFlow>
                  </div>
                )}
              </section>

              <section className={styles.card}>
                <div className={styles.logsHeader}>
                  <h2 className={styles.logsTitle}>
                    <img src={terminalIcon} alt="" width={16} height={16} />
                    Logs{selected === null ? '' : ` — ${selected.name}`}
                  </h2>
                  <div className={styles.logControls}>
                    <span className={styles.logSearch}>
                      <img src={searchIcon} alt="" width={12} height={12} />
                      <input
                        className={styles.logSearchField}
                        type="search"
                        placeholder="Filter logs..."
                        value={logFilter}
                        onChange={(event) => setLogFilter(event.target.value)}
                        aria-label="Filter logs"
                      />
                    </span>
                    <button
                      type="button"
                      className={styles.download}
                      onClick={downloadLogs}
                      aria-label="Download logs"
                      title="Download logs"
                    >
                      <img src={downloadIcon} alt="" width={14} height={14} />
                    </button>
                  </div>
                </div>

                <div className={styles.terminal}>
                  {visibleLogs.length === 0 ? (
                    <p className={styles.terminalEmpty}>
                      {run?.logs.length === 0 ? 'This run produced no log.' : 'Nothing matches that filter.'}
                    </p>
                  ) : (
                    visibleLogs.map((line) => (
                      <p key={line.id} className={styles.terminalLine}>
                        <span className={styles.terminalTime}>[{timeOf(line.at)}]</span>
                        <span className={styles[`level${line.level}`]}>{line.message}</span>
                      </p>
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        {selected !== null && (
          <NodeDetailsPanel
            /* Keyed on the step so that moving to another node starts the panel
               again, rather than carrying one node's refusal over to the next. */
            key={selected.key}
            step={selected}
            workspaceId={workspaceId}
            runEnded={run !== null && run.status !== 'RUNNING'}
            onRerunFromHere={rerunFromStep}
            onClose={() => setSelectedKey(null)}
          />
        )}
      </div>
    </AppShell>
  );
}

function SummaryRow({ label, mono = false, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className={styles.summaryRow}>
      <dt className={styles.summaryLabel}>{label}</dt>
      <dd className={mono ? `${styles.summaryValue} ${styles.mono}` : styles.summaryValue}>{children}</dd>
    </div>
  );
}

/** What the selected node was handed and what it produced. */
function NodeDetailsPanel({
  step,
  workspaceId,
  runEnded,
  onRerunFromHere,
  onClose,
}: {
  step: ExecutionStep;
  workspaceId: string;
  /** True once the run has finished, so a pending step was never reached. */
  runEnded: boolean;
  /** Starts the workflow again from this step; rejects with the server's words. */
  onRerunFromHere: (nodeKey: string) => Promise<void>;
  onClose: () => void;
}) {
  const [rerunning, setRerunning] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function handleRerunFromHere() {
    if (rerunning) return;
    setRerunning(true);
    setRefusal(null);
    try {
      await onRerunFromHere(step.key);
    } catch (cause) {
      /*
       * Shown as the server wrote it. It knows why a step cannot be started
       * from - the branch the earlier run took, a node the graph has since
       * lost, a field that was never produced - and guessing at those rules
       * here would mean a second, worse copy of them going stale on its own.
       */
      setRefusal(cause instanceof Error ? cause.message : 'Could not re-run from this step.');
      setRerunning(false);
    }
  }

  /** Where the step's catalogue entry lives, when it came from one. */
  const definition =
    step.conditionId != null
      ? { label: 'Condition', to: `/workspace/${workspaceId}/conditions/${step.conditionId}` }
      : step.actionId != null
        ? { label: 'Action', to: `/workspace/${workspaceId}/actions/${step.actionId}` }
        : null;

  return (
    <aside className={styles.panel} aria-label="Node details">
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Node Details</h2>
        <button type="button" className={styles.panelClose} onClick={onClose} aria-label="Close node details">
          ✕
        </button>
      </div>
      <p className={styles.panelSubtitle}>Execution info for selected node</p>

      <PanelField label="Node name">{step.name}</PanelField>
      <PanelField label="Node type">{NODE_KIND_LABEL[step.kind]}</PanelField>
      {definition !== null && (
        <PanelField label="Defined by">
          <Link className={styles.panelLink} to={definition.to}>
            {`Open ${definition.label.toLowerCase()}`}
          </Link>
        </PanelField>
      )}
      <PanelField label="Status">
        <span className={`${styles.statusBadge} ${styles[stepStatusClass(step.status)]}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          {/* A step still pending in a run that has ended was never reached. */}
          {step.status === 'PENDING' && runEnded ? 'Not reached' : STEP_STATUS_LABEL[step.status]}
        </span>
        {/* The status here, and the duration and times under it, belong to the
            run this one was started from rather than to this one. Unsaid, they
            read as work that happened here, which is the misleading part. */}
        {step.carriedOver && (
          <span className={styles.carriedNote}>Carried over from the earlier run</span>
        )}
      </PanelField>
      {/*
        Which way the run left this step by. A condition answers Yes or No; an
        action that handles its own failure answers Failure, which is the one
        worth a sentence - a step that failed and a run that carried on look
        like a contradiction until the page says the failure was the answer.
      */}
      {step.branch !== null && (
        <PanelField label="Branch">
          {step.branch === 'FAILURE' ? (
            <>
              Failure
              <span className={styles.carriedNote}>
                The run carried on down this node&apos;s failure line rather than stopping here.
              </span>
            </>
          ) : step.branch === 'YES' ? (
            'Yes'
          ) : (
            'No'
          )}
        </PanelField>
      )}
      {/*
        Said only where it says something. Every step has attempts, and one is
        what every step without a retry policy spends - a field reading 1 on
        every node in every run is a row nobody reads twice.
      */}
      {step.attempts > 1 && <PanelField label="Attempts">{step.attempts}</PanelField>}
      <PanelField label="Duration">{formatDuration(step.durationSeconds)}</PanelField>
      <PanelField label="Started">{timeOf(step.startedAt)}</PanelField>
      <PanelField label="Finished">{timeOf(step.finishedAt)}</PanelField>

      {/* The button the issue asked for. Never disabled on a rule worked out in
          the browser - only while the request it started is still out. */}
      <div className={styles.panelAction}>
        <button
          type="button"
          className={styles.rerunStep}
          onClick={handleRerunFromHere}
          disabled={rerunning}
        >
          <img src={refreshIcon} alt="" width={14} height={14} />
          {rerunning ? 'Queueing…' : 'Re-run from here'}
        </button>
        {refusal !== null && (
          <p className={styles.rerunRefusal} role="alert">
            {refusal}
          </p>
        )}
      </div>

      {step.error !== null && (
        <>
          <h3 className={styles.panelHeading}>Error</h3>
          <pre className={`${styles.payload} ${styles.payloadError}`}>{step.error}</pre>
        </>
      )}

      <h3 className={styles.panelHeading}>Input</h3>
      <pre className={styles.payload}>{prettyJson(step.input)}</pre>

      <h3 className={styles.panelHeading}>Output</h3>
      <pre className={styles.payload}>{prettyJson(step.output)}</pre>
    </aside>
  );
}

function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.panelField}>
      <span className={styles.panelLabel}>{label}</span>
      <span className={styles.panelValue}>{children}</span>
    </div>
  );
}

/** A running step reads like a running run, a failed one like a failed run. */
function stepStatusClass(status: StepStatus): string {
  switch (status) {
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    // A waiting step has not finished, so it reads like one still going.
    case 'RUNNING':
    case 'WAITING':
      return 'running';
    default:
      return 'pending';
  }
}

/** "Jan 26, 2024 14:32:05", as the summary shows it. */
function formatStamp(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  return `${day} ${timeOf(iso)}`;
}

/** "14:32:05" — the log and the panel show the time alone. */
function timeOf(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** Payloads are stored as the engine wrote them; indent them when they are JSON. */
function prettyJson(raw: string | null): string {
  if (raw === null || raw.trim() === '') return '—';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
