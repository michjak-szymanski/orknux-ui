import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import { startExecution } from '../../api/executions';
import { timeAgo } from '../../api/functions';
import { fetchWorkspaces } from '../../api/workspaces';
import type { Workspace } from '../../api/workspaces';
import { fetchWorkspaceWorkflows, setWorkflowEnabled } from '../../api/workflows';
import type { WorkspaceWorkflow } from '../../api/workflows';
import settingsIcon from '../../assets/settings-14.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AppShell } from '../../components/AppShell';
import { AutoRefresh } from '../../components/AutoRefresh';
import { CompactPagination } from '../../components/CompactPagination';
import {
  ExportComponentButton,
  ImportComponentsButton,
  SaveAsTemplateButton,
  UseTemplateButton,
} from '../../components/ComponentTransfer';
import { CreateWorkflowDialog } from '../../components/CreateWorkflowDialog';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { WorkflowConfirmDialog } from '../../components/WorkflowConfirmDialog';
import { shellUser } from '../../session/user';
import styles from './WorkspaceWorkflowsPage.module.css';

/** "in 42 seconds", for a run the clock has not started yet. */
function inWords(iso: string): string {
  const seconds = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}

/** Green when the last run finished, red when it did not, amber while it runs. */
function runStatusClass(status: 'RUNNING' | 'COMPLETED' | 'FAILED'): string {
  switch (status) {
    case 'COMPLETED':
      return `${styles.runDot} ${styles.runCompleted}`;
    case 'FAILED':
      return `${styles.runDot} ${styles.runFailed}`;
    default:
      return `${styles.runDot} ${styles.runRunning}`;
  }
}

export interface WorkspaceWorkflowsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 4;
const WORKSPACE_LIST_SIZE = 100;

export function WorkspaceWorkflowsPage({ session, onSignOut }: WorkspaceWorkflowsPageProps) {
  const { workspaceId = '' } = useParams();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workflows, setWorkflows] = useState<PageOf<WorkspaceWorkflow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [disabling, setDisabling] = useState<WorkspaceWorkflow | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  /*
   * Which workspace the page number belongs to.
   *
   * The switcher in the corner changes the workspace without leaving this
   * screen: the route is the same one, so this component is never built again
   * and everything it remembers survives the move - including which page
   * somebody was on. Page two of a workspace with six workflows is past the end
   * of one with three, and a page past the end comes back with no rows at all
   * and the real total beside them. That is the screen that contradicted
   * itself: an empty table under a footer counting three, and nothing put it
   * right, because every auto-refresh asked for the same page that is not
   * there. Reset while rendering rather than in an effect, so the fetch below is
   * made with the page it is going to end up on instead of asking twice.
   */
  const [pagedFor, setPagedFor] = useState(workspaceId);
  if (pagedFor !== workspaceId) {
    setPagedFor(workspaceId);
    setPage(1);
  }

  /*
   * Which fetch is the newest, so an older answer cannot land on top of it.
   *
   * Two are often in the air at once here: auto-refresh ticks every few seconds
   * whatever else is happening, and an import asks for the list again the
   * moment it lands. Whichever the network returns first, the list has to end
   * up showing the newest answer - otherwise a slow reply from before the
   * import wins and puts the imported workflow back out of sight. A ref rather
   * than state because nothing draws it.
   */
  const newest = useRef(0);

  useEffect(() => {
    fetchWorkspaces(0, WORKSPACE_LIST_SIZE)
      .then((result) => setWorkspaces(result.content))
      .catch(() => setWorkspaces([]));
  }, []);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    const mine = ++newest.current;
    setLoading(true);
    setError(null);
    fetchWorkspaceWorkflows(workspaceId, page - 1, PAGE_SIZE)
      .then((result) => {
        if (mine !== newest.current) return;
        /*
         * The page asked for is past the end - somebody else removed enough
         * rows, or this workspace simply has fewer. Answered with no rows and a
         * total that says otherwise, which is a table and a footer disagreeing
         * if it is drawn. Ask again for the last page there is instead; loading
         * stays on until that answer arrives, so nothing empty is ever shown.
         */
        if (result.content.length === 0 && result.totalPages > 0 && page > result.totalPages) {
          setPage(result.totalPages);
          return;
        }
        setWorkflows(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (mine !== newest.current) return;
        setWorkflows(null);
        setError(cause instanceof Error ? cause.message : 'Could not load workflows.');
        setLoading(false);
      });
  }, [workspaceId, page]);

  useEffect(load, [load]);

  /** Runs it now. Nothing else in the UI starts a run; a trigger does the rest. */
  async function run(workflow: WorkspaceWorkflow) {
    setRunning(workflow.workflowId);
    setError(null);
    try {
      await startExecution(workspaceId, workflow.workflowId);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the run.');
    } finally {
      setRunning(null);
    }
  }

  async function toggle(workflow: WorkspaceWorkflow) {
    // Turning one off is confirmed; turning it back on is not destructive.
    if (workflow.enabled) {
      setDisabling(workflow);
      return;
    }
    await setWorkflowEnabled(workflow.id, true);
    load();
  }

  const workspaceName = workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? '';

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>Workflows</h1>
          <span className={styles.headerSpacer} />
          {/* A workflow's status changes as runs finish, without this page asking. */}
          <AutoRefresh onRefresh={load} />
          <ImportComponentsButton workspaceId={workspaceId} onImported={load} />
          <UseTemplateButton workspaceId={workspaceId} kind="WORKFLOW" onImported={load} />
          <button type="button" className={styles.createWorkflow} onClick={() => setCreating(true)}>
            <span aria-hidden="true">+</span>
            Create Workflow
          </button>
        </header>

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colGrow}>Template name</span>
            <span className={styles.colGrow}>Description</span>
            <span className={styles.colLastRun}>Last Run</span>
            <span className={styles.colLastRun}>Next Run</span>
            <span className={styles.colActions}>Actions</span>
          </div>

          {loading && <p className={styles.notice}><Loader /></p>}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {!loading && error === null && workflows?.content.length === 0 && (
            <p className={styles.notice}>
              No workflows for {workspaceName === '' ? 'this workspace' : workspaceName} yet.
            </p>
          )}

          {workflows?.content.map((workflow) => (
            <div key={workflow.id} className={styles.row}>
              <Link
                className={`${styles.colGrow} ${styles.name}`}
                to={`/workspace/${workspaceId}/workflows/${workflow.workflowId}/editor`}
              >
                {workflow.name}
              </Link>
              <span className={`${styles.colGrow} ${styles.description}`}>{workflow.description ?? '—'}</span>
              <span className={styles.colLastRun}>
                {workflow.lastRun === null ? (
                  <span className={styles.neverRun}>Never run</span>
                ) : (
                  <Link
                    className={styles.lastRun}
                    to={`/workspace/${workspaceId}/executions/${workflow.lastRun.executionId}`}
                  >
                    <span className={runStatusClass(workflow.lastRun.status)} aria-hidden="true" />
                    {timeAgo(workflow.lastRun.startedAt)}
                  </Link>
                )}
              </span>
              <span className={styles.colLastRun}>
                {/*
                  A workflow that is switched off has no next run, whatever its
                  triggers say, so the column says which of the two silences
                  this is rather than calling both of them "not scheduled".
                */}
                {!workflow.enabled ? (
                  <span className={styles.neverRun}>Switched off</span>
                ) : workflow.nextRun === null ? (
                  <span className={styles.neverRun}>Not scheduled</span>
                ) : (
                  <span className={styles.nextRun} title={workflow.nextRun}>
                    {inWords(workflow.nextRun)}
                  </span>
                )}
              </span>
              <span className={styles.colActions}>
                <button
                  type="button"
                  className={styles.runButton}
                  onClick={() => void run(workflow)}
                  disabled={running === workflow.workflowId}
                  aria-label={`Run ${workflow.name}`}
                  title={`Run ${workflow.name}`}
                >
                  {running === workflow.workflowId ? '…' : 'Run'}
                </button>
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={() => void toggle(workflow)}
                  role="switch"
                  aria-checked={workflow.enabled}
                  aria-label={`${workflow.enabled ? 'Disable' : 'Enable'} ${workflow.name}`}
                  title={workflow.enabled ? 'Disable' : 'Enable'}
                >
                  <img src={workflow.enabled ? toggleOnIcon : toggleOffIcon} alt="" width={36} height={20} data-keeps-colour />
                </button>
                {/*
                  The definition's id rather than the assignment's: what travels
                  is the workflow itself, and the row this workspace holds it by
                  means nothing anywhere else.
                */}
                <ExportComponentButton
                  workspaceId={workspaceId}
                  kind="WORKFLOW"
                  id={workflow.workflowId}
                  name={workflow.name}
                  className={styles.settings}
                />
                <SaveAsTemplateButton
                  workspaceId={workspaceId}
                  kind="WORKFLOW"
                  id={workflow.workflowId}
                  name={workflow.name}
                  className={styles.settings}
                  canPublish={session.admin}
                />
                <Link
                  className={styles.settings}
                  to={`/workspace/${workspaceId}/workflows/${workflow.id}/settings`}
                  aria-label={`Settings for ${workflow.name}`}
                  title={`Settings for ${workflow.name}`}
                >
                  <img src={settingsIcon} alt="" width={14} height={14} />
                </Link>
              </span>
            </div>
          ))}

          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={workflows?.totalElements ?? 0}
            unit="templates"
            onPageChange={setPage}
          />
        </div>
      </section>

      <CreateWorkflowDialog
        open={creating}
        workspaceId={workspaceId}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setPage(1);
          load();
        }}
      />

      <WorkflowConfirmDialog
        workflowName={disabling?.name ?? null}
        kind="disable"
        onClose={() => setDisabling(null)}
        onConfirm={async () => {
          if (disabling === null) return;
          await setWorkflowEnabled(disabling.id, false);
          setDisabling(null);
          load();
        }}
      />

    </AppShell>
  );
}
