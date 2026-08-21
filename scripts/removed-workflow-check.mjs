/**
 * A run whose workflow the workspace no longer lists, and the two places that
 * used to treat it worse than they needed to.
 *
 * Issue 168. Removing a workflow deletes the workspace's assignment and leaves
 * the definition and every run of it alone, so such runs stay on the executions
 * list and still open. Two things followed from that and neither had to:
 *
 *   1. The Workflow filter was built from the *assigned* workflows, so those
 *      runs could be scrolled past and never singled out. The one control that
 *      would have isolated them did not know they existed.
 *   2. The workflow link on such a run went to `/workflows/{id}/editor`, which
 *      answers "No workflow assignment with id 373" - a sentence that reads
 *      like a broken page rather than like a workflow somebody removed.
 *
 * So this measures both, and it measures them against the same run: the filter
 * can isolate it, the rows say why it is marked, and its page names the
 * workflow without offering a way into nothing. A live workflow is checked
 * beside it every time, because "no link anywhere" would pass all of the above
 * and be a worse page than the one being fixed.
 *
 * ---------------------------------------------------------------------------
 * The fixture, and why it is reused rather than rebuilt
 *
 * Making one is three calls: create a workflow, give it a graph, run it, remove
 * it. Unmaking one is not possible. There is no mutation that deletes a run and
 * none that deletes a workflow definition, so a check that builds a fresh
 * removed-workflow run every time adds a definition and a run to the database
 * on every run of the suite, for ever - which is the very growth issue 168 was
 * found beside, and this check would be a contributor to it.
 *
 * So the fixture has a fixed name per workspace and is looked for first. The
 * first run of this check in a workspace makes one; every run after that finds
 * it and makes nothing. The residue is one definition and one run per
 * workspace, once, instead of one per suite run.
 *
 * A fixed name is safe here for the same reason it is usually unsafe: removing
 * a workflow leaves the definition, so the name stays taken - and a name that
 * stays taken is exactly what lets this find its own fixture again.
 * ---------------------------------------------------------------------------
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/**
 * One per workspace, found again on the next run rather than made again.
 *
 * The name deliberately does not carry the word this check looks for on the
 * row. "removed" appearing in the workflow's own name would make every
 * assertion below that the row says so pass without the row saying anything.
 */
const FIXTURE = `zz orphan run check ${WORKSPACE}`;

/* ------------------------------------------------------------------ asking */

const RAN = `query($w: ID!) { executionWorkflows(workspaceId: $w) { workflowId name assigned } }`;
const RUNS = `
  query($w: ID!, $id: ID) {
    workspaceExecutions(workspaceId: $w, page: 0, size: 50, workflowId: $id) {
      totalElements
      content { id workflowId workflowName workflowAssigned }
    }
  }
`;

/** Every workflow this workspace has runs of, removed ones included. */
const workflowsRun = async () => (await graphql(RAN, { w: WORKSPACE })).executionWorkflows;

/** Runs of one workflow, or of all of them when `id` is null. All time either way. */
const runsOf = async (id) => (await graphql(RUNS, { w: WORKSPACE, id })).workspaceExecutions;

/* ----------------------------------------------------------------- fixture */

/**
 * A run of a workflow this workspace no longer lists.
 *
 * The graph is one trigger node that names no trigger. It is the smallest thing
 * that runs: the validator says it will do nothing, the run completes at once,
 * and nothing outside this process is touched - no model, no connection, no
 * schedule. What is wanted here is a run that exists, not a run that did
 * anything.
 */
async function fixture() {
  const already = (await workflowsRun()).find((one) => !one.assigned && one.name === FIXTURE);
  if (already !== undefined) {
    const runs = await runsOf(already.workflowId);
    if (runs.totalElements > 0) {
      console.log(`reusing workflow ${already.workflowId} "${FIXTURE}" and its ${runs.totalElements} run(s)`);
      return { workflowId: already.workflowId, name: already.name, runId: runs.content[0].id, made: false };
    }
  }

  const made = await graphql(
    `mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id workflowId name } }`,
    {
      input: {
        workspaceId: WORKSPACE,
        name: FIXTURE,
        description: 'Made once by scripts/removed-workflow-check.mjs, then unassigned and left as its fixture.',
      },
    },
  );
  // The assignment and the definition are two different rows with two different
  // ids, and this check needs both: the graph and the runs are the definition's,
  // and removing is the assignment's. They happen to coincide on the database
  // this was written against, which is precisely how the bug survived.
  const { id: assignment, workflowId } = made.createWorkflow;

  await graphql(
    `mutation($w: ID!, $id: ID!, $input: WorkflowGraphInput!) {
       saveWorkflowGraph(workspaceId: $w, workflowId: $id, input: $input) { workflowId }
     }`,
    {
      w: WORKSPACE,
      id: workflowId,
      input: { nodes: [{ key: 'start', kind: 'TRIGGER', name: 'nothing in particular', x: 40, y: 40 }], edges: [] },
    },
  );

  const started = await graphql(
    `mutation($w: ID!, $id: ID!) { startExecution(workspaceId: $w, workflowId: $id) { id status } }`,
    { w: WORKSPACE, id: workflowId },
  );

  await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: assignment });
  console.log(
    `made workflow ${workflowId} "${FIXTURE}" (assignment ${assignment}), ran it as #${started.startExecution.id}, ` +
      `and removed it from the workspace`,
  );
  return { workflowId, name: FIXTURE, runId: started.startExecution.id, made: true };
}

/* -------------------------------------------------------------- the screen */

/** What the executions list has actually drawn: one entry per row, in order. */
const asDrawn = () =>
  page.evaluate(() => {
    const isRun = (link) => /\/executions\/\d+$/.test(link.getAttribute('href') ?? '');
    return [...document.querySelectorAll('a[href*="/executions/"]')].filter(isRun).map((link) => {
      const row = link.parentElement;
      const editor = row?.querySelector('a[href$="/editor"]') ?? null;
      const cell = editor ?? row?.children[1] ?? null;
      return {
        id: link.textContent.trim(),
        // Null is the whole point on a removed workflow's row: the name is
        // still printed, and there is nowhere for it to go.
        link: editor?.getAttribute('href') ?? null,
        text: (cell?.textContent ?? '').trim(),
      };
    });
  });

/** Every option the Workflow filter offers, as drawn. */
const filterOptions = () =>
  page.$$eval('select[aria-label="Workflow:"] option', (options) =>
    options.map((option) => ({ value: option.value, label: option.textContent.trim() })),
  );

/** Waits for the rows to settle after a control was used. */
async function settle() {
  await page.waitForSelector('text=Showing', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function openList() {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/executions`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the executions list'))) return false;
  // The list opens on the last 24 hours, and the fixture is made once and then
  // reused, so it is older than that on every run but the first.
  await page.selectOption('select[aria-label="Date range"]', '');
  await settle();
  return true;
}

/* ------------------------------------------------------------------- doing */

let failed = false;
try {
  const gone = await fixture();

  // ---------------------------------------------------- what the server says

  const listed = await workflowsRun();
  const mine = listed.find((one) => one.workflowId === gone.workflowId);
  record(mine !== undefined, `the workflow the run names is offered as a filter (#${gone.workflowId})`);
  record(mine?.assigned === false, 'and is marked as one this workspace no longer lists');
  record(
    listed.some((one) => one.assigned),
    `alongside the ones it does list, so this is not simply every workflow marked gone ` +
      `(${listed.filter((one) => one.assigned).length} of ${listed.length} still assigned)`,
  );

  const held = await runsOf(gone.workflowId);
  record(held.totalElements > 0, `the removed workflow still has runs to find (${held.totalElements})`);
  record(
    held.content.every((run) => run.workflowAssigned === false),
    'and every one of them says its workflow is not assigned',
  );

  // -------------------------------------------------- the filter reaches it

  if (!(await openList())) throw new Error('the executions list drew nothing');

  const wholeList = await runsOf(null);
  const options = await filterOptions();
  const option = options.find((one) => one.value === String(gone.workflowId));
  record(option !== undefined, `the Workflow filter offers the removed workflow (${options.length} options)`);
  record(
    option !== undefined && /removed/i.test(option.label),
    `and says what it is rather than passing it off as a live one: "${option?.label ?? '—'}"`,
  );
  const live = options.find((one) => one.value !== '' && one.value !== String(gone.workflowId) && !/removed/i.test(one.label));
  record(live !== undefined, `while an assigned workflow is offered unmarked: "${live?.label ?? '—'}"`);

  await page.selectOption('select[aria-label="Workflow:"]', String(gone.workflowId));
  await settle();
  const isolated = await asDrawn();

  record(isolated.length > 0, `choosing it isolates its runs (${isolated.length} rows drawn)`);
  record(
    held.totalElements < wholeList.totalElements,
    `which is a part of the list rather than all of it ` +
      `(${held.totalElements} of the workspace's ${wholeList.totalElements} runs)`,
  );
  record(
    isolated.every((row) => row.text.startsWith(gone.name)),
    `and every row drawn is that workflow's ("${isolated[0]?.text ?? '—'}")`,
  );
  const ids = isolated.map((row) => row.id.replace(/^#/, ''));
  record(
    ids.includes(String(gone.runId)),
    `the run this check knows about is among them (#${gone.runId} in ${ids.join(', ') || 'nothing'})`,
  );

  // ------------------------------------------------- and the rows say so

  record(
    isolated.every((row) => row.link === null),
    'no row of a removed workflow offers a link into an editor that would refuse it',
  );
  record(
    isolated.every((row) => /removed/i.test(row.text)),
    `each says so on the row instead ("${isolated[0]?.text ?? '—'}")`,
  );
  record(
    isolated.every((row) => row.text.replace(/removed/i, '').trim() === gone.name),
    `while the name beside the mark is the workflow's own, which is the only record of what ran`,
  );

  await page.screenshot({ path: shot('removed-workflow-list.png'), fullPage: false });

  // ------------------------------------- a live workflow is still a link

  const stillHere = (await workflowsRun()).find((one) => one.assigned);
  if (stillHere === undefined) {
    record(false, 'this workspace has no run of an assigned workflow to compare against');
  } else {
    await page.selectOption('select[aria-label="Workflow:"]', String(stillHere.workflowId));
    await settle();
    const alive = await asDrawn();
    record(alive.length > 0, `a workflow the workspace does list still draws its runs (${alive.length})`);
    record(
      alive.every((row) => row.link !== null && row.link.endsWith(`/workflows/${stillHere.workflowId}/editor`)),
      `and every one of those rows still links to its editor (${alive[0]?.link ?? '—'})`,
    );
    record(
      alive.every((row) => !/removed/i.test(row.text)),
      'without any of them being marked removed',
    );
  }

  // ----------------------------------------------- where the run's page goes

  await page.goto(`${BASE}/workspace/${WORKSPACE}/executions/${gone.runId}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, `run #${gone.runId}`, { within: 30_000 }))) throw new Error('the run page drew nothing');

  const body = await page.evaluate(() => document.body.innerText);
  const editorLinks = await page.$$eval('a[href$="/editor"]', (links) => links.map((link) => link.getAttribute('href')));

  record(body.includes(gone.name), `the run's page still names the workflow it ran ("${gone.name}")`);
  record(
    editorLinks.length === 0,
    `and offers no way into the editor that would answer "No workflow assignment with id ${gone.workflowId}" ` +
      `(found ${editorLinks.join(', ') || 'none'})`,
  );
  record(/removed from the workspace/i.test(body), 'saying instead that the workflow has been removed from the workspace');
  record(!/No workflow assignment with id/i.test(body), 'and the page itself is not the error it used to lead to');

  await page.screenshot({ path: shot('removed-workflow-run.png'), fullPage: false });

  // ---------------------------------------- the same page for a live run

  if (stillHere !== undefined) {
    const alive = await runsOf(stillHere.workflowId);
    if (alive.totalElements === 0) {
      record(false, `${stillHere.name} is assigned but has no run to open`);
    } else {
      const liveRun = alive.content[0].id;
      await page.goto(`${BASE}/workspace/${WORKSPACE}/executions/${liveRun}`, { waitUntil: 'domcontentloaded' });
      if (await drawn(page, `run #${liveRun}`, { within: 30_000 })) {
        const toEditor = await page.$$eval('a[href$="/editor"]', (links) => links.map((l) => l.getAttribute('href')));
        record(
          toEditor.length > 0,
          `a run of an assigned workflow still offers its workflow (${toEditor[0] ?? 'none'})`,
        );

        // Following it is the difference this whole check is about, so it is
        // followed rather than assumed: the same control on the other run led
        // to a sentence with an id in it.
        await page.locator('a[href$="/editor"]').first().click();
        await page.waitForTimeout(2500);
        const editor = await page.evaluate(() => document.body.innerText);
        record(
          !/No workflow assignment with id/i.test(editor),
          'and following it lands somewhere that is not that error',
        );
      }
    }
  }
} catch (cause) {
  failed = true;
  console.error(`FAIL: the check threw: ${cause instanceof Error ? cause.stack : String(cause)}`);
}

/*
 * Nothing is swept. The fixture *is* the leftovers - a workflow removed from
 * the workspace, and one run of it - and there is no mutation that deletes
 * either. Making it once and finding it again is the sweeping: see the note at
 * the top for why that is the best this can do.
 */

await finish(browser, !failed);
