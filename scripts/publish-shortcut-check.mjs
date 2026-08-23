/**
 * Publishing a workflow from the keyboard.
 *
 * Issue #233. The editor could be saved, stepped back through, copied from and
 * added to without the mouse, and then the one press that makes any of it live
 * had to be aimed at a square in the corner. It has a keystroke now, and this
 * measures the four things that make a keystroke worth having rather than one
 * that merely exists:
 *
 *   it works        Ctrl+Enter publishes the graph on screen - the badge turns
 *                   and the server says so, which are two different claims
 *   it is only it   a combination nothing is bound to publishes nothing
 *   it is a setting rebinding it in Preferences moves the behaviour AND the
 *                   tooltip, which is what tells a lone key listener from one
 *                   that went through the shortcut registry
 *   it is findable  the Publish control names the keystroke on hover, read from
 *                   the setting rather than written out beside it
 *
 * Publishes are counted off the wire rather than off the screen. A badge reading
 * Published cannot tell one publish from two, and the second press of a key
 * held down is exactly the case the button's own disabled condition exists to
 * refuse.
 *
 * A workflow of this check's own, made and removed over GraphQL, so nothing
 * anybody else's check reads is published by running this - and its name
 * carries a timestamp, because removing a workflow keeps its definition and the
 * name with it.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';
import { anyOf } from './suite/named.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const PREFIX = 'zzPublishKey233';
const NAME = `${PREFIX} ${Date.now()}`;

async function sweep() {
  const { workspaceWorkflows } = await graphql(
    `query($id: ID!) { workspaceWorkflows(workspaceId: $id, page: 0, size: 200) { content { id name } } }`,
    { id: WORKSPACE },
  );
  for (const old of workspaceWorkflows.content.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept workflow ${old.name} (#${old.id})`);
  }
}

await sweep();

const AGENT = await anyOf(graphql, 'agent', WORKSPACE, null);
if (AGENT === null) {
  record(false, 'this workspace has no agent, so there is no graph to publish');
  await finish(browser);
}

const made = await graphql(`mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id } }`, {
  input: {
    workspaceId: WORKSPACE,
    name: NAME,
    description: 'Made by scripts/publish-shortcut-check.mjs to publish from the keyboard, and removed after.',
  },
});
const WORKFLOW = made.createWorkflow.id;
console.log(`made workflow ${NAME} (#${WORKFLOW}) around agent #${AGENT}`);

/*
 * One node, because what is being measured is a keystroke and an agent node is
 * the shortest thing there is that a workflow can be published with.
 */
const says = (name) => ({
  key: 'says',
  kind: 'AGENT',
  name,
  agentId: AGENT,
  outputName: 'said',
  x: 80,
  y: 80,
  mappings: [{ name: 'prompt', expression: 'Say something.', mode: 'VALUE' }],
});

await graphql(
  `mutation($ws: ID!, $id: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $ws, workflowId: $id, input: $input) { workflowId problems { message } }
   }`,
  { ws: WORKSPACE, id: WORKFLOW, input: { nodes: [says(`${PREFIX} says`)], edges: [] } },
);

/**
 * Saves the graph again under a new node name, which puts the workflow back to
 * a draft - so the next assertion has something left to publish.
 */
const draft = async (name) =>
  graphql(
    `mutation($ws: ID!, $id: ID!, $input: WorkflowGraphInput!) {
       saveWorkflowGraph(workspaceId: $ws, workflowId: $id, input: $input) { workflowId }
     }`,
    { ws: WORKSPACE, id: WORKFLOW, input: { nodes: [says(name)], edges: [] } },
  );

/** What the server holds, which is the only witness that a publish landed. */
const stored = async () => {
  const read = await graphql(`query($ws: ID!, $id: ID!) { workflowGraph(workspaceId: $ws, workflowId: $id) { status } }`, {
    ws: WORKSPACE,
    id: WORKFLOW,
  });
  return read.workflowGraph.status;
};

/* -------------------------------------------------------------- the rulers */

/*
 * Publishes, counted off the wire. `publishWorkflow` is its own mutation, so a
 * request carrying that name is a publish and nothing else is.
 */
let publishes = 0;
page.on('request', (request) => {
  if (request.method() !== 'POST') return;
  if ((request.postData() ?? '').includes('publishWorkflow')) publishes += 1;
});

const publish = page.locator('button[aria-label^="Publish"]');
const badge = page.locator('[class*="_badge_"]').first();

async function openEditor() {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
  } catch {
    const held = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
    record(false, `the editor drew no node in thirty seconds. The page holds: ${JSON.stringify(held)}`);
    await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: WORKFLOW }).catch(() => undefined);
    await finish(browser);
  }
  await page.waitForTimeout(1500);
}

/** One keystroke, aimed at the canvas rather than at whatever had focus. */
async function press(shortcut) {
  await page.locator('.react-flow__pane').click({ position: { x: 500, y: 400 } });
  await page.keyboard.press(shortcut);
  await page.waitForTimeout(2500);
}

/* --------------------------------------------------- findable, before anything */

await openEditor();

record((await badge.innerText()).trim() === 'Draft', `a workflow nobody has published reads Draft (${await badge.innerText()})`);
const tip = (await publish.getAttribute('data-tip')) ?? '';
record(tip.startsWith('Publish (Ctrl+Enter)'), `the Publish control names its keystroke on hover (${JSON.stringify(tip)})`);
record(
  ((await publish.getAttribute('aria-label')) ?? '').includes('Ctrl+Enter'),
  'and says it to a screen reader as well as to a pointer',
);

/* ------------------------------------------------- a key nothing is bound to */

/*
 * Before the one that should work, so that "it published" cannot be an accident
 * of the page having been about to publish anyway.
 */
await press('Control+Alt+P');
record(publishes === 0, `a combination nothing is bound to publishes nothing (${publishes} sent)`);
record((await badge.innerText()).trim() === 'Draft', 'and the graph is still a draft');

/* ---------------------------------------------------------------- it works */

await press('Control+Enter');
record(publishes === 1, `the chosen keystroke publishes, once for one press (${publishes} sent)`);
record((await badge.innerText()).trim() === 'Published', `and the badge says so (${await badge.innerText()})`);
record((await stored()) === 'PUBLISHED', 'and so does the server, which is the claim that matters');

/* ------------------------------------------- and refuses what the button refuses */

/*
 * The button is disabled while a publish is in flight, and the keystroke reads
 * that same condition rather than a copy of it - so a key held down must not
 * start a second publish on top of the first.
 *
 * The publish is held back on the wire to measure it. Pressing twice a moment
 * apart against a real server proves nothing either way: locally the whole round
 * trip finishes inside a hundred milliseconds, so two presses two hundred apart
 * are two honest publishes and the assertion would be about the network rather
 * than about the guard. Three seconds of delay makes the second press land
 * squarely inside the first, which is the case the condition exists for.
 */
await draft(`${PREFIX} says once more`);
await openEditor();

let holding = true;
await page.route('**/graphql', async (route) => {
  if (holding && (route.request().postData() ?? '').includes('publishWorkflow')) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  await route.continue();
});

const one = publishes;
await page.locator('.react-flow__pane').click({ position: { x: 500, y: 400 } });
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(500);
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(6000);
record(
  publishes === one + 1,
  `held down while one publish is in flight, it starts no second one (${publishes - one} sent)`,
);
holding = false;
await page.unroute('**/graphql');

/* ------------------------------------------------- it is a setting, not a key */

/*
 * Rebound through the real Preferences control - clicking the button and
 * pressing the keys, the way the other seven are chosen. A page with its own
 * `keydown` listener would go on answering Ctrl+Enter and go on printing
 * Ctrl+Enter on its tooltip; both move only if the editor is reading the
 * registry.
 */
await page.goto(`${BASE}/preferences`, { waitUntil: 'domcontentloaded' });

/*
 * Asked for rather than waited on, so a Preferences page with no such row says
 * that and lets the rest of the file report. A bare `waitForSelector` throws
 * after twenty seconds and takes the six assertions below it with it, which is
 * how a check comes to hide most of what it knows on the day it is most needed.
 */
const listed = await page
  .locator('#publish-shortcut')
  .waitFor({ timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
record(listed, 'Preferences lists a Publish Shortcut of its own');

if (listed) {
  record(
    (await page.locator('[data-hint="Publish Shortcut"]').count()) === 1,
    'with a (?) beside it like every other setting on the page',
  );

  /* The row's own controls, not the (?) beside its label: both are buttons. */
  const row = page.locator('#publish-shortcut').locator('xpath=../..').locator('[class*="_options_"]');
  await row.locator('button', { hasText: 'Ctrl+Enter' }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Alt+P');
  await page.waitForTimeout(600);
  const chosen = (await row.locator('button').first().innerText()).trim();
  record(chosen === 'Ctrl+Alt+P', `Preferences took the new keystroke (${chosen})`);

  /* Back to a draft, so there is something for the new key to do. */
  await draft(`${PREFIX} says again`);
  await openEditor();
  const rebound = (await publish.getAttribute('data-tip')) ?? '';
  record(
    rebound.startsWith('Publish (Ctrl+Alt+P)'),
    `the tooltip follows the setting rather than repeating a default (${JSON.stringify(rebound)})`,
  );

  const before = publishes;
  await press('Control+Enter');
  record(publishes === before, `the old keystroke does nothing once it has been given up (${publishes - before} sent)`);

  await press('Control+Alt+P');
  record(publishes === before + 1, `and the new one publishes (${publishes - before} sent)`);
  record((await stored()) === 'PUBLISHED', 'and the server has the new graph as the one that runs');

  /* The setting lives in this browser and the browser goes, but Reset is the
     other half of the row and is worth driving once. */
  await page.goto(`${BASE}/preferences`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#publish-shortcut', { timeout: 20_000 });
  const back = page.locator('#publish-shortcut').locator('xpath=../..').locator('[class*="_options_"]');
  await back.locator('button', { hasText: /^Reset$/ }).click();
  await page.waitForTimeout(400);
  record(
    (await back.locator('button').first().innerText()).trim() === 'Ctrl+Enter',
    'Reset puts the default back, like the seven rows above it',
  );
}

/* ------------------------------------------------------------------- tidy up */

await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: WORKFLOW }).catch((cause) => {
  console.log(`could not remove workflow #${WORKFLOW}: ${cause.message}`);
});

await finish(browser);
