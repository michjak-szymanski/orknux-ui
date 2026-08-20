import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import { STATUS_LABEL, TRIGGER_LABEL, fetchWorkspaceExecutions, formatDuration, formatRelative } from '../../api/executions';
import type { Execution, ExecutionStatus } from '../../api/executions';
import type { SessionUser } from '../../api/session';
import { fetchWorkspaceWorkflows } from '../../api/workflows';
import type { WorkspaceWorkflow } from '../../api/workflows';
import clockIcon from '../../assets/clock.svg';
import refreshIcon from '../../assets/refresh-cw.svg';
import searchIcon from '../../assets/search.svg';
import terminalIcon from '../../assets/terminal.svg';
import userIcon from '../../assets/user.svg';
import { AppShell } from '../../components/AppShell';
import { AutoRefresh } from '../../components/AutoRefresh';
import { Loader } from '../../components/Loader';
import { SelectField } from '../../components/SelectField';
import { CompactPagination } from '../../components/CompactPagination';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './ExecutionsPage.module.css';

export interface ExecutionsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 6;
const WORKFLOW_LIST_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;

const TRIGGER_ICON: Record<string, string> = {
  WEBHOOK: terminalIcon,
  API: terminalIcon,
  MANUAL: userIcon,
  SCHEDULE: clockIcon,
};

export function ExecutionsPage({ session, onSignOut }: ExecutionsPageProps) {
  const { workspaceId = '' } = useParams();

  const [runs, setRuns] = useState<PageOf<Execution> | null>(null);
  const [workflows, setWorkflows] = useState<WorkspaceWorkflow[]>([]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ExecutionStatus | ''>('');
  const [workflowId, setWorkflowId] = useState('');
  const [days, setDays] = useState<number | ''>(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceWorkflows(workspaceId, 0, WORKFLOW_LIST_SIZE)
      .then((result) => setWorkflows(result.content))
      .catch(() => setWorkflows([]));
  }, [workspaceId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [status, workflowId, days, debouncedSearch]);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspaceExecutions(workspaceId, page - 1, PAGE_SIZE, {
      status: status || undefined,
      workflowId: workflowId || undefined,
      days: days === '' ? undefined : days,
      search: debouncedSearch || undefined,
    })
      .then((result) => {
        setRuns(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setRuns(null);
        setError(cause instanceof Error ? cause.message : 'Could not load executions.');
        setLoading(false);
      });
  }, [workspaceId, page, status, workflowId, days, debouncedSearch]);

  useEffect(load, [load]);

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.contentHeader}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Executions</h1>
          <p className={styles.subtitle}>View and monitor workflow execution runs</p>
        </div>
        {/* Runs arrive while the page is open — a trigger fires, a step finishes —
            and nothing here polls, so this is how the list catches up. */}
        <div className={styles.headerActions}>
          <AutoRefresh onRefresh={load} busy={loading} />
          {/* The label does not change: a word that flips every few seconds
              under auto-refresh is movement, not information. */}
          <button type="button" className={styles.refresh} onClick={load} disabled={loading}>
            <img src={refreshIcon} alt="" width={14} height={14} />
            Refresh
          </button>
        </div>
      </header>

      <div className={styles.filtersBar}>
        <div className={styles.filtersLeft}>
          <SelectField
            label="Status:"
            value={status}
            onChange={(value) => setStatus(value as ExecutionStatus | '')}
            options={[
              { value: '', label: 'All Statuses' },
              { value: 'RUNNING', label: 'Running' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'FAILED', label: 'Failed' },
            ]}
          />

          <SelectField
            label="Workflow:"
            value={workflowId}
            onChange={setWorkflowId}
            options={[
              { value: '', label: 'All Workflows' },
              ...workflows.map((workflow) => ({ value: workflow.workflowId, label: workflow.name })),
            ]}
          />

          <SelectField
            value={days === '' ? '' : String(days)}
            onChange={(value) => setDays(value === '' ? '' : Number(value))}
            ariaLabel="Date range"
            options={[
              { value: '1', label: 'Last 24 Hours' },
              { value: '7', label: 'Last 7 Days' },
              { value: '30', label: 'Last 30 Days' },
              { value: '', label: 'All Time' },
            ]}
          />
        </div>

        <div className={styles.searchBox}>
          <img src={searchIcon} alt="" width={14} height={14} />
          <input
            className={styles.searchField}
            type="search"
            placeholder="Search executions..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search executions"
          />
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colRun}>Run</span>
          <span className={styles.colWorkflow}>Workflow</span>
          <span className={styles.colStatus}>Status</span>
          <span className={styles.colStarted}>Started</span>
          <span className={styles.colDuration}>Duration</span>
          <span className={styles.colTrigger}>Triggered by</span>
        </div>

        {/*
          Only while there is nothing to show. A background refresh that inserts
          a line above the rows moves the whole table on every tick, which is
          the last thing a list being watched should do.
        */}
        {loading && runs === null && <p className={styles.notice}><Loader /></p>}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {!loading && error === null && runs?.content.length === 0 && (
          <p className={styles.notice}>No runs match those filters.</p>
        )}

        {runs?.content.map((run) => (
          <div key={run.id} className={styles.row}>
            {/*
              Two different places, so two different links: the run number opens
              what this run did, and the name opens the workflow it ran.
            */}
            <Link
              className={`${styles.colRun} ${styles.runId}`}
              to={`/workspace/${workspaceId}/executions/${run.id}`}
            >
              {run.id}
            </Link>
            <Link
              className={`${styles.colWorkflow} ${styles.workflowName}`}
              to={`/workspace/${workspaceId}/workflows/${run.workflowId}/editor`}
            >
              {run.workflowName}
            </Link>
            <span className={styles.colStatus}>
              <span className={`${styles.statusBadge} ${styles[run.status.toLowerCase()]}`}>
                <span className={styles.statusDot} aria-hidden="true" />
                {STATUS_LABEL[run.status]}
              </span>
            </span>
            <span className={`${styles.colStarted} ${styles.muted}`}>{formatRelative(run.startedAt)}</span>
            <span className={`${styles.colDuration} ${styles.muted}`}>{formatDuration(run.durationSeconds)}</span>
            <span className={`${styles.colTrigger} ${styles.muted}`}>
              <img src={TRIGGER_ICON[run.trigger]} alt="" width={14} height={14} />
              {TRIGGER_LABEL[run.trigger]}
            </span>
          </div>
        ))}

        <CompactPagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={runs?.totalElements ?? 0}
          unit="runs"
          onPageChange={setPage}
        />
      </section>
    </AppShell>
  );
}
