import { useCallback, useEffect, useState } from 'react';
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

  useEffect(() => {
    fetchWorkspaces(0, WORKSPACE_LIST_SIZE)
      .then((result) => setWorkspaces(result.content))
      .catch(() => setWorkspaces([]));
  }, []);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspaceWorkflows(workspaceId, page - 1, PAGE_SIZE)
      .then((result) => {
        setWorkflows(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
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
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="workflows" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>Workflows</h1>
          <span className={styles.headerSpacer} />
          {/* A workflow's status changes as runs finish, without this page asking. */}
          <AutoRefresh onRefresh={load} />
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
