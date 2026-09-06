/**
 * A condition node fills in the parameters of the function it asks.
 *
 * The rows were on the condition's own settings page - issue #316 - and could
 * not do the job there: that form has no graph behind it, so a reference had to
 * be typed from memory into a plain text box beside a bare select, with nothing
 * on screen saying what there was to reference. And arguments kept on the
 * definition were one shared list, so two nodes asking "is this the first
 * reply" about different threads had to be two conditions.
 *
 * They are the node's now, drawn with the ordinary controls the editor already
 * uses for a parameter. Four things this is here to keep:
 *
 *   the rows      a condition node whose condition asks a function draws one
 *                 row per declared parameter, named for it
 *   the controls  each row is the ordinary Value/Reference switch, not a
 *                 select and a text box
 *   the order     the condition comes before the parameters it decides, the
 *                 same way a shape comes before its fields
 *   it sticks     what is filled in is saved on the node and is there again
 *                 when the graph is reopened
 *
 * Makes a function, a condition and a workflow, and removes all three.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const PREFIX = 'zzConditionArgs';
const STAMP = Date.now();

const { browser, page, graphql } = await open({ viewport: { width: 1500, height: 1100 } });

/* ----------------------------------------------------------------- fixture */

const sweep = async () => {
  for (const [query, remove, field] of [
    ['workspaceWorkflows(workspaceId: $w, page: 0, size: 200)', 'removeWorkflow', 'workspaceWorkflows'],
    ['workspaceConditions(workspaceId: $w, page: 0, size: 200)', 'deleteCondition', 'workspaceConditions'],
    ['workspaceFunctions(workspaceId: $w, page: 0, size: 200)', 'deleteFunction', 'workspaceFunctions'],
  ]) {
    const held = await graphql(`query($w: ID!) { ${query} { content { id name } } }`, { w: WORKSPACE });
    for (const old of held[field].content.filter((one) => one.name.startsWith(PREFIX))) {
      await graphql(`mutation($id: ID!) { ${remove}(id: $id) }`, { id: old.id }).catch(() => undefined);
      console.log(`swept ${field} ${old.name}`);
    }
  }
};

await sweep();

const fn = await graphql(
  `mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: `${PREFIX}Over${STAMP}`,
      description: 'Made by condition-arguments-check.',
      returnType: 'BOOLEAN',
      params: [
        { name: 'count', type: 'NUMBER' },
        { name: 'limit', type: 'NUMBER' },
      ],
      /*
       * Both, because the server keeps them together: what runs is the
       * JavaScript and the TypeScript is what it was compiled from, so a
       * function saved with only one of them is refused.
       */
      source: 'export default async function over(count, limit) {\n  return count > limit;\n}',
      typescript:
        'export default async function over(count: number, limit: number) {\\n  return count > limit;\\n}',
    },
  },
);

const cond = await graphql(
  `mutation($input: CreateConditionInput!) { createCondition(input: $input) { id } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: `${PREFIX} is over ${STAMP}`,
      type: 'FUNCTION',
      functionId: fn.createFunction.id,
    },
  },
);

const made = await graphql(`mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { workflowId } }`, {
  input: { workspaceId: WORKSPACE, name: `${PREFIX} ${STAMP}`, description: 'Made by condition-arguments-check.' },
});
const WORKFLOW = made.createWorkflow.workflowId;

await graphql(
  `mutation($w: ID!, $f: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $w, workflowId: $f, input: $input) { nodes { key } }
   }`,
  {
    w: WORKSPACE,
    f: WORKFLOW,
    input: {
      nodes: [
        {
          key: 'asks',
          kind: 'CONDITION',
          name: `${PREFIX} asks`,
          x: 140,
          y: 140,
          conditionId: cond.createCondition.id,
          mappings: [],
        },
      ],
      edges: [],
    },
  },
);

const clean = async () => {
  await sweep();
  await finish(browser);
};

/* -------------------------------------------------------------------- drive */

const openNode = async () => {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.locator('.react-flow__node').first().click();
  await page.waitForSelector('#node-condition', { timeout: 15_000 });
  await page.waitForTimeout(600);
};

await openNode();
if (!(await drawn(page, 'the editor', { within: 30_000, still: 0 }))) await clean();

/* ---- the rows, named for the function's parameters ---- */

const rowsOf = () =>
  page.locator('[role="group"][aria-label$=" source"]').evaluateAll((groups) =>
    groups.map((one) => one.getAttribute('aria-label').replace(/ source$/, '')),
  );

const rows = await rowsOf();
record(
  JSON.stringify(rows) === JSON.stringify(['count', 'limit']),
  `the node draws a row per declared parameter, in order (${JSON.stringify(rows)})`,
);

/* ---- the ordinary controls, not a select and a box ---- */

const first = page.locator('[role="group"][aria-label="count source"]');
const modes = await first.locator('button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()));
record(
  JSON.stringify(modes) === JSON.stringify(['Value', 'Reference']),
  `each row offers the ordinary Value/Reference switch (${JSON.stringify(modes)})`,
);
record(
  (await first.locator('select').count()) === 0,
  'and not the select the condition settings page used to draw',
);

/* ---- the condition comes before the parameters it decides ---- */

const picker = await page.locator('#node-condition').boundingBox();
const parameter = await first.boundingBox();
record(
  (picker?.y ?? 0) < (parameter?.y ?? 0),
  `the condition is asked before its parameters are filled in (${Math.round(picker?.y ?? 0)} then ${Math.round(parameter?.y ?? 0)})`,
);

/* ---- what is filled in is the node's, and it stays ---- */

await page.locator('#node-mapping-count').fill('7');
await page.waitForTimeout(300);
await page.keyboard.press('Control+s');
await page.waitForTimeout(2000);

await openNode();
const kept = await page.locator('#node-mapping-count').inputValue().catch(() => null);
record(kept === '7', `what the node passes is saved on the node and comes back (${JSON.stringify(kept)})`);

const stored = await graphql(
  `query($w: ID!, $f: ID!) { workflowGraph(workspaceId: $w, workflowId: $f) { nodes { kind mappings { name expression mode } } } }`,
  { w: WORKSPACE, f: WORKFLOW },
);
const held = stored.workflowGraph.nodes.find((one) => one.kind === 'CONDITION')?.mappings ?? [];
record(
  held.some((one) => one.name === 'count' && one.expression === '7'),
  `and the graph holds it against the node rather than the condition (${JSON.stringify(held)})`,
);

await clean();
