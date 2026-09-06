/**
 * The Object node's Custom shape, which used to be reachable only by accident.
 *
 * Issue #309. A node with no saved shape holds fields of its own - a real mode,
 * with a fields editor of its own that has been there all along. But the Shape
 * picker held one row per saved object and nothing else, so that mode had no
 * name on screen: an untouched node read *Choose a shape…*, which is what a
 * control somebody forgot to fill in looks like, and choosing a shape was
 * one-way because there was no row to go back to.
 *
 * Four things this is here to catch:
 *
 *   the naming   a node with no saved shape says **Custom**, not a placeholder
 *   the row      Custom is in the list, and is marked as not being one of the
 *                objects - a row that read like one more saved shape would be
 *                the same complaint in a different place
 *   the fields   choosing a saved shape takes the fields editor away, because
 *                the shape then fixes the field names
 *   the way back and choosing Custom again brings it back. This is the one that
 *                could not be done at all before, and it is the whole issue
 *
 * Makes a workflow with one Object node in it and removes it again.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const PREFIX = 'zzObjectCustomShape';
const STAMP = Date.now();
const WORKFLOW_NAME = `${PREFIX} ${STAMP}`;
const SHAPE_NAME = `${PREFIX}Shape${STAMP}`;

const sweep = async () => {
  const { workspaceWorkflows } = await graphql(
    `query($w: ID!) { workspaceWorkflows(workspaceId: $w, size: 200) { content { id name } } }`,
    { w: WORKSPACE },
  );
  for (const old of workspaceWorkflows.content.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept workflow ${old.name} (#${old.id})`);
  }

  const { workspaceObjects } = await graphql(
    `query($w: ID!) { workspaceObjects(workspaceId: $w, size: 200) { content { id name } } }`,
    { w: WORKSPACE },
  );
  for (const old of workspaceObjects.content.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { deleteObject(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept object ${old.name} (#${old.id})`);
  }
};

await sweep();

/** A saved shape to switch to, so "the way back" has somewhere to come back from. */
const shape = await graphql(
  `mutation($input: CreateObjectInput!) { createObject(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: SHAPE_NAME,
      properties: [{ name: 'id', kind: 'STRING' }],
    },
  },
);
console.log(`made object ${shape.createObject.name} (#${shape.createObject.id})`);

const made = await graphql(`mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { workflowId } }`, {
  input: {
    workspaceId: WORKSPACE,
    name: WORKFLOW_NAME,
    description: 'Made by object-custom-shape-check, and removed again.',
  },
});
const WORKFLOW = made.createWorkflow.workflowId;
console.log(`made workflow ${WORKFLOW_NAME} (#${WORKFLOW})`);

/*
 * One Object node with no shape, which is the state the whole issue is about:
 * an ad-hoc object, holding a field of its own, that the control had no word for.
 */
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
          key: 'held',
          kind: 'OBJECT',
          name: `${PREFIX} holds`,
          x: 120,
          y: 120,
          mappings: [{ name: 'field1', expression: 'something', mode: 'VALUE' }],
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

/* ------------------------------------------------------------------ reading */

/** What the closed Shape control says. */
const says = () => page.$eval('#node-object', (one) => one.textContent?.trim() ?? '');

/** Whether the fields editor is offered, which only a custom shape gets. */
const addsFields = () => page.locator('button', { hasText: '+ Add field' }).count().then((n) => n > 0);

/**
 * The field names the panel is showing, in order.
 *
 * A custom shape's fields are the node's own and a saved shape's are the
 * shape's, so this is what says which set the panel is holding.
 */
const fieldNames = () =>
  page.$$eval('input[aria-label^="Name of field"]', (found) => found.map((one) => one.value));

/** The rows in the open list, and whether each is marked as not being an object. */
const rows = () =>
  page.$$eval('#node-object ~ * [role="option"], [role="option"]', (found) =>
    found.map((one) => ({
      label: one.querySelector('span')?.textContent?.trim() ?? '',
      // The pinned row carries a bottom rule and a colour of its own; what is
      // asserted is that it is drawn differently, not which colour was chosen.
      marked: [...one.classList].some((name) => name.includes('optionPinned')),
    })),
  );

/** Opens the list and takes the row named, by clicking it. */
async function choose(label) {
  await page.click('#node-object');
  await page.waitForSelector('[role="option"]', { timeout: 10_000 });
  await page.locator('[role="option"]', { hasText: label }).first().click();
  await page.waitForTimeout(400);
}

/* -------------------------------------------------------------------- drive */

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });

const drew = await page
  .waitForSelector('.react-flow__node', { timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
record(drew, 'the editor drew the node');
if (!drew) await clean();

await page.waitForTimeout(1000);
await page.click('.react-flow__node');

const inspected = await page
  .waitForSelector('#node-object', { timeout: 15_000 })
  .then(() => true)
  .catch(() => false);
record(inspected, 'clicking the node opens its properties, Shape among them');
if (!inspected) await clean();

/* ---- the naming ---- */

record(
  (await says()) === 'Custom',
  `a node with no saved shape says what it is rather than reading as unfilled (${JSON.stringify(await says())})`,
);
record(await addsFields(), 'and it offers the fields editor, which is what that shape means');

/* ---- the row, and that it is marked ---- */

await page.click('#node-object');
await page.waitForSelector('[role="option"]', { timeout: 10_000 });
const listed = await rows();
const custom = listed.find((one) => one.label === 'Custom');

record(custom !== undefined, `Custom is a row in the list (${JSON.stringify(listed.map((one) => one.label))})`);
record(
  custom?.marked === true,
  'and it is marked as not being one of the saved shapes, rather than reading as one more of them',
);
record(
  listed.some((one) => one.label === SHAPE_NAME),
  'the saved shapes are still listed beside it',
);
await page.keyboard.press('Escape');

/* ---- away to a saved shape ---- */

await choose(SHAPE_NAME);
record((await says()) === SHAPE_NAME, `choosing a saved shape takes it (${JSON.stringify(await says())})`);
record(
  !(await addsFields()),
  'and the fields editor goes, because the shape now fixes what the field names are',
);

/* ---- and back again, which could not be done at all ---- */

await choose('Custom');
record((await says()) === 'Custom', `Custom can be chosen again (${JSON.stringify(await says())})`);
record(await addsFields(), 'and the fields editor comes back with it, so the choice is not one-way');

/* ---- and the fields that were the node's own are the node's own again ---- */

/*
 * The round trip used to come back holding the *shape's* fields. Choosing a
 * shape seeds the fields it has and drops the rest, which is what a saved shape
 * is for - but nothing put the node's own fields back, so a look at a saved
 * shape silently threw away whatever had been named before it. Reported against
 * #309 on 2026-09-06: "select custom, add field a, b, select defined shape,
 * go back to custom - custom has fields from defined shape".
 */
const back = await fieldNames();
record(
  back.includes('field1'),
  `the fields the node held of its own are back (${JSON.stringify(back)})`,
);
record(
  !back.includes('id'),
  "and the saved shape's fields did not stay behind in place of them",
);
const kept = await page
  .locator('#node-mapping-field1')
  .inputValue()
  .catch(() => null);
record(
  kept === 'something',
  `and what was in the field came back with its name (${JSON.stringify(kept)})`,
);

await clean();
