/**
 * Duplicating a workflow, and what the copy is.
 *
 * Issue #310. A workflow is the one thing here somebody edits while it is in
 * use, so trying a change meant either redrawing it node by node or editing the
 * one that works.
 *
 * Five things this is here to catch:
 *
 *   the button   the row offers Duplicate at all
 *   the landing  it opens the copy's canvas rather than leaving you on a list
 *                with a second similar name and the change still to start
 *   the graph    the copy holds the same nodes. A duplicate that made an empty
 *                workflow with the right name would satisfy everything else
 *   the naming   the copy is *(copy)*, and pressing twice gives *(copy 2)*
 *                rather than refusing - workflow names are unique across the
 *                installation, so the second press is where a naive fix breaks
 *   the original the workflow it was made from is untouched and still there
 *
 * Nothing is stubbed. Every one of these is the server's answer or the page's
 * use of it, and there is no timing in any of them worth faking a model for.
 *
 * Makes three workflows and removes them.
 */
import { BASE, WORKSPACE, open, drawn, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const MARK = 'zzWorkflowDuplicate';

/*
 * A name of this run's own, on top of the prefix.
 *
 * `removeWorkflow` unassigns the workflow from the workspace and keeps the
 * definition - that is what it is for, since a definition is shared between
 * workspaces - and workflow names are unique across the installation. So a
 * fixed name works once and refuses on every run after it. The sweep still goes
 * by the prefix, which is what keeps this workspace's list clean.
 */
const RUN = `${MARK} ${Date.now()}`;

const sweep = async () => {
  const { workspaceWorkflows } = await graphql(
    `query($w: ID!) { workspaceWorkflows(workspaceId: $w, size: 200) { content { id name } } }`,
    { w: WORKSPACE },
  );
  for (const old of workspaceWorkflows.content.filter((one) => one.name.startsWith(MARK))) {
    await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept ${old.name} (#${old.id})`);
  }
};

await sweep();

const made = await graphql(
  `mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id workflowId name } }`,
  { input: { workspaceId: WORKSPACE, name: `${RUN} Triage`, description: 'Made by workflow-duplicate-check.' } },
);
const ORIGINAL = made.createWorkflow;
console.log(`made ${ORIGINAL.name} (#${ORIGINAL.workflowId})`);

/*
 * Two nodes and the edge between them, so "the copy holds the same graph" is a
 * claim about something. A workflow with one node would be copied correctly by
 * a duplicate that dropped every edge.
 */
await graphql(
  `mutation($w: ID!, $f: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $w, workflowId: $f, input: $input) { nodes { key } }
   }`,
  {
    w: WORKSPACE,
    f: ORIGINAL.workflowId,
    input: {
      nodes: [
        { key: 'first', kind: 'OBJECT', name: 'Where it starts', x: 0, y: 0 },
        { key: 'second', kind: 'OBJECT', name: 'Where it goes', x: 260, y: 0 },
      ],
      edges: [{ source: 'first', target: 'second' }],
    },
  },
);

/** What the server says one workflow's graph is, which is the thing copied. */
const graphOf = async (workflowId) => {
  const { workflowGraph } = await graphql(
    `query($w: ID!, $f: ID!) {
       workflowGraph(workspaceId: $w, workflowId: $f) {
         name status nodes { key name x y } edges { source target }
       }
     }`,
    { w: WORKSPACE, f: workflowId },
  );
  return workflowGraph;
};

const theirs = await graphOf(ORIGINAL.workflowId);

const clean = async () => {
  await sweep();
  await finish(browser);
};

/* -------------------------------------------------------------------- drive */

/*
 * Sorted by name, backwards, so the fixture is on the first page.
 *
 * The list is paginated and an installation has however many workflows it has;
 * `zz` at the front of the name and `dir=desc` is what puts this one at the top
 * of it without this check having to page through somebody else's.
 */
const LIST = `${BASE}/workspace/${WORKSPACE}?order=NAME&dir=desc`;

await page.goto(LIST, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the workflow list'))) await clean();

const offered = await page
  .waitForSelector(`button[aria-label="Duplicate ${ORIGINAL.name}"]`, { timeout: 25_000 })
  .then(() => true)
  .catch(() => false);
record(offered, 'the row offers a way to duplicate the workflow');

if (!offered) await clean();

await page.click(`button[aria-label="Duplicate ${ORIGINAL.name}"]`);

const landed = await page
  .waitForURL('**/workflows/*/editor', { timeout: 25_000 })
  .then(() => true)
  .catch(() => false);
record(landed, `pressing it opens a canvas rather than staying on the list (${page.url().replace(BASE, '')})`);

const copyId = landed ? (page.url().match(/workflows\/(\d+)\/editor/) ?? [])[1] : null;
record(
  copyId !== null && copyId !== ORIGINAL.workflowId,
  `and the canvas is the copy's rather than the original's (#${copyId} against #${ORIGINAL.workflowId})`,
);

if (copyId === null) await clean();

const ours = await graphOf(copyId);

record(ours.name === `${ORIGINAL.name} (copy)`, `the copy is named for what it came from (${ours.name})`);
record(ours.status === 'DRAFT', `and it is a draft, so nothing starts it until somebody says so (${ours.status})`);
record(
  JSON.stringify(ours.nodes) === JSON.stringify(theirs.nodes),
  `the copy holds the same nodes, in the same places (${JSON.stringify(ours.nodes.map((one) => one.key))})`,
);
record(
  JSON.stringify(ours.edges) === JSON.stringify(theirs.edges),
  `and the same edges between them (${JSON.stringify(ours.edges)})`,
);

/* ---- pressed twice, which is where a naive fix breaks ---- */

await page.goto(LIST, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(`button[aria-label="Duplicate ${ORIGINAL.name}"]`, { timeout: 25_000 });
await page.click(`button[aria-label="Duplicate ${ORIGINAL.name}"]`);
await page.waitForURL('**/workflows/*/editor', { timeout: 25_000 }).catch(() => undefined);

const secondId = (page.url().match(/workflows\/(\d+)\/editor/) ?? [])[1] ?? null;
const second = secondId === null ? null : await graphOf(secondId);
record(
  second?.name === `${ORIGINAL.name} (copy 2)`,
  `a second duplicate is numbered rather than refused (${second?.name ?? null})`,
);

/* ---- and the one it was made from ---- */

const after = await graphOf(ORIGINAL.workflowId);
record(
  after.name === theirs.name && JSON.stringify(after.nodes) === JSON.stringify(theirs.nodes),
  'the workflow it was copied from is untouched',
);

await clean();
