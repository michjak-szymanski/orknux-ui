import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import { startExecution } from '../../api/executions';
import { timeAgo } from '../../api/functions';
import { fetchWorkspaces } from '../../api/workspaces';
import type { Workspace } from '../../api/workspaces';
import { fetchWorkspaceWorkflows, setWorkflowEnabled } from '../../api/workflows';
import type { WorkflowOrder, WorkspaceWorkflow } from '../../api/workflows';
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
import { SortControl } from '../../components/SortControl';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
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

/**
 * How many rows a page holds, and what else it may be set to.
 *
 * The same four the issue list offers, for the same reason: it says how much of
 * a screen somebody has, not what they are looking at. Remembered per person
 * rather than per workspace, and under a key of this list's own - somebody who
 * reads workflows four at a time and issues fifty at a time is not being
 * inconsistent.
 *
 * Ten rather than the four this used to hold. Four was not a choice anybody had
 * made, and it is not one of the sizes on offer - a control that opens showing a
 * number it cannot be set back to is a control that looks broken.
 */
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_KEY = 'orknux.workflows.page-size';

/**
 * What the list can be ordered by, in the words this page already uses.
 *
 * Three, and they are the three questions asked of this screen: what is it
 * called, when did it last do anything, and is it switched on. Next Run is a
 * column here and is deliberately not on this list - it is not stored anywhere,
 * it is the soonest of however many cron expressions the workflow's triggers
 * carry, worked out one workflow at a time, and a database cannot order by
 * something it has never seen.
 *
 * Asked of the server, like the issue list's, because the page holds ten rows
 * of however many the workspace has: sorting ten of them orders the page rather
 * than the list, which looks like it worked until the row somebody wanted turns
 * out to be on page two.
 */
const ORDERS: { label: string; order: WorkflowOrder }[] = [
  { label: 'Name', order: 'NAME' },
  { label: 'Last run', order: 'LAST_RUN' },
  { label: 'Switched on', order: 'ENABLED' },
];

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
   * The order lives in the address, like the issue list's.
   *
   * "the ones nobody has run" is a link if it is in the URL and a sentence of
   * instructions if it is not, and a refresh or a restored tab comes back to
   * the list somebody was reading rather than to the top of the alphabet.
   *
   * Ascending unless the address says otherwise, which is the opposite of the
   * issue list's default and right for the same reason: a column of names is
   * read A to Z, and a column of issue numbers is read newest first. The arrow
   * says which it is, so neither needs explaining.
   */
  const [params, setParams] = useSearchParams();
  const order = (params.get('order') as WorkflowOrder | null) ?? 'NAME';
  const ascending = params.get('dir') !== 'desc';

  /** Writes the order back into the address, replacing rather than pushing. */
  function sortBy(changes: Record<string, string | null>) {
    setParams(
      (held) => {
        const next = new URLSearchParams(held);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }

  /**
   * How many rows at a time, remembered for whoever is reading.
   *
   * Not in the address: it is a fact about the screen somebody is at, so a link
   * they send should not force their choice on the person who opens it.
   */
  const [pageSize, setPageSize] = useState(() => {
    const held = Number(window.localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(held) ? held : DEFAULT_PAGE_SIZE;
  });

  /*
   * Which list the page number belongs to.
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
   *
   * The order and the size are in here for the same reason rather than a
   * different one. Page two of a list means a different ten rows once the order
   * changes and may not exist at all once the size grows, so both have to put
   * the reader back at the start - and both have to do it before the fetch, or
   * the screen asks twice and shows the wrong answer in between.
   */
  const listShape = `${workspaceId}|${order}|${ascending}|${pageSize}`;
  const [pagedFor, setPagedFor] = useState(listShape);
  if (pagedFor !== listShape) {
    setPagedFor(listShape);
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
    fetchWorkspaceWorkflows(workspaceId, page - 1, pageSize, order, ascending)
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
  }, [workspaceId, page, pageSize, order, ascending]);

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
          {/*
            The order, on the header row with everything else that acts on this
            list.

            It had a row of its own between the heading and the table, which is
            where the issue list keeps it - but the issue list's row also holds
            status tabs and a search box, and this one held nothing else. A
            control alone on a line reads as belonging to the table under it
            rather than to the page, and costs a row of vertical space to say
            so; the owner's report of "two controls floating under the title"
            is that row, seen without noticing its own small grey label.

            First of the controls rather than last, so that + Create Workflow
            stays at the end of the row where the primary action is on every
            other list. The other half of what #145 asked for - how many rows
            at a time - is still in the footer, on the line that says
            "showing 1-10 of 11", because that is the sentence it changes.

            Ascending unless the address says otherwise - read above, not here,
            because the issue list's default is the other way round and the
            control is the same control.
          */}
          <SortControl
            id="workflow-order"
            options={ORDERS}
            order={order}
            onOrderChange={(wanted) => sortBy({ order: wanted })}
            ascending={ascending}
            onDirectionChange={(wanted) => sortBy({ dir: wanted ? 'asc' : 'desc' })}
          />
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
            {/*
              "Workflow", because that is what the rows are.

              It said "Template name" on a list of workflows - the same wrong
              noun the footer under it carried until 788b694, and wrong for the
              same reason: a template is a published copy of a component, kept
              on the Templates page under Admin and reached from this page's
              own Use template button. The column headed with another screen's
              noun, above rows linking into the workflow editor.
            */}
            <span className={styles.colGrow}>Workflow</span>
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
            pageSize={pageSize}
            totalItems={workflows?.totalElements ?? 0}
            /*
             * "workflows", because that is what the rows are.
             *
             * This said "templates", which is not a synonym here - a template is
             * a published copy of a component, kept on the Templates page under
             * Admin and reached from this page's own Use Template button. So the
             * footer under a list of workflows named a different thing in the
             * product, and the size control beside it asked "How many templates
             * to show at once" about rows that are not templates.
             */
            unit="workflows"
            onPageChange={setPage}
            pageSizes={PAGE_SIZES}
            onPageSizeChange={(chosen) => {
              setPageSize(chosen);
              window.localStorage.setItem(PAGE_SIZE_KEY, String(chosen));
              // Which page somebody is on means something else at another size;
              // the guard above the fetch puts them back on the first.
            }}
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

      <ConfirmDialog
        subject={disabling?.name ?? null}
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
