/**
 * Opening an agent node's definition without losing the graph.
 *
 * Issue #149: "agent definition in Workflow editor does not open in left menu -
 * instead it redirects to another page". A trigger node and an action node put
 * the definition they point at in the panel down the left and keep the canvas
 * on the screen; the agent node navigated to the agent's settings page, which
 * takes the graph away to answer a question about it.
 *
 * So this presses Open definition on both kinds, in the same editor, in the same
 * run: the trigger is the behaviour that was already right and is here as the
 * comparison, the agent is the one that was wrong. Both are measured the same
 * way - a panel that opens holding that definition, and an editor that is still
 * underneath it.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, shot, finish } from './suite/harness.mjs';

const EDITOR = `${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`;

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/** What the graph holds, so the check knows which node carries a definition. */
const { workflowGraph: graph } = await graphql(
  `query ($workspaceId: ID!, $workflowId: ID!) {
     workflowGraph(workspaceId: $workspaceId, workflowId: $workflowId) {
       nodes { key kind name agentId triggerId }
     }
   }`,
  { workspaceId: WORKSPACE, workflowId: WORKFLOW },
);

const agentNode = graph.nodes.find((node) => node.kind === 'AGENT' && node.agentId !== null) ?? null;
const triggerNode = graph.nodes.find((node) => node.kind === 'TRIGGER' && node.triggerId !== null) ?? null;

if (agentNode === null) {
  record(false, 'this workflow has no agent node pointing at an agent');
  await finish(browser);
}

/** The agent the node points at, by the name its own definition carries. */
const { agent } = await graphql(`query ($id: ID!) { agent(id: $id) { id name modelId } }`, {
  id: agentNode.agentId,
});

await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(600);

/** Selects the node with this name on the canvas and waits for its panel. */
async function select(name) {
  await page.locator('.react-flow__node').filter({ hasText: name }).first().click();
  await page.waitForTimeout(600);
}

/** The one link out of the node panel, and where it says it goes. */
const jump = page.getByRole('link', { name: 'Open definition' });

/**
 * Presses Open definition and reports what happened: which panel opened, and
 * whether the editor is still on the screen behind it.
 */
async function openDefinition() {
  await jump.click();
  await page.waitForTimeout(1200);
  const panel = page.locator('dialog[open]').first();
  const opened = (await panel.count()) === 1;
  return {
    opened,
    title: opened ? (await panel.locator('h2').first().innerText().catch(() => '')).trim() : '',
    text: opened ? await panel.innerText().catch(() => '') : '',
    url: new URL(page.url()).pathname,
    canvas: await page.locator('.react-flow__node').count(),
  };
}

// ---- the trigger node: what the agent node is being measured against ----

if (triggerNode === null) {
  record(false, 'no trigger node here to compare the agent with');
} else {
  await select(triggerNode.name);
  record((await jump.count()) === 1, `Open definition beside the trigger picker on "${triggerNode.name}"`);
  const shown = await openDefinition();
  record(shown.opened && shown.title === 'Trigger Settings', `the trigger opens in the panel (${shown.title})`);
  record(
    shown.url.endsWith(`/workflows/${WORKFLOW}/editor`) && shown.canvas > 0,
    `the editor is still underneath it (${shown.url}, ${shown.canvas} nodes)`,
  );
  // The editor again, with nothing open on it: the agent half of this check
  // should meet the screen the person filing #149 met, not one already holding
  // a panel somebody else's press put there.
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
  await page.waitForTimeout(600);
}

// ---- the agent node: issue #149 ----

await select(agentNode.name);
record((await jump.count()) === 1, `Open definition beside the agent picker on "${agentNode.name}"`);

/*
 * Still a real anchor. The panel is what a plain click gets; a ctrl-click or a
 * middle-click is handed back to the browser, and what it opens has to be the
 * agent's own page - so the href is checked before the click that intercepts it.
 */
const href = await jump.getAttribute('href');
record(
  href === `/workspace/${WORKSPACE}/agents/${agent.id}/settings`,
  `it is a link to the agent's own page too (${href})`,
);

const shown = await openDefinition();
record(shown.opened && shown.title === 'Agent Settings', `the agent opens in the panel (${shown.title || 'no panel'})`);
record(
  shown.url.endsWith(`/workflows/${WORKFLOW}/editor`),
  `the editor was not navigated away (${shown.url})`,
);
record(shown.canvas > 0, `the graph is still on the screen (${shown.canvas} nodes)`);

await page.screenshot({ path: shot('agent-definition-panel.png') });

// It is that agent's definition, not an empty form offering to make one.
if (!shown.opened) {
  record(false, 'nothing else can be asked of a panel that did not open');
  await finish(browser);
}

const nameField = page.locator('dialog[open] input#agent-name');
const nameHeld = (await nameField.count()) === 1 ? await nameField.inputValue() : '';
record(nameHeld === agent.name, `it holds the agent it was opened on ("${nameHeld}")`);

// And the whole definition, which is what the node's own fields cannot show:
// the model it answers on, its instructions, and the catalogs it was granted.
const model = page.locator('dialog[open] select#agent-model');
record((await model.count()) === 1, 'the model it answers on is in the panel');
record(
  (await page.locator('dialog[open] #agent-system-prompt').count()) === 1,
  'its system prompt is in the panel',
);
record(shown.text.includes('Tools'), 'its tool grants are in the panel');
record(
  (await model.count()) === 1 && (await model.inputValue()) === (agent.modelId ?? ''),
  'the model shown is the one the agent is saved with',
);

// An editor, not a reading of one: saving stores the definition and puts the
// panel away, leaving the editor where it was.
await page.locator('dialog[open] button[type="submit"]').first().click();
await page.waitForTimeout(1500);
record((await page.locator('dialog[open]').count()) === 0, 'saving closes the panel');
record(
  new URL(page.url()).pathname.endsWith(`/workflows/${WORKFLOW}/editor`) &&
    (await page.locator('.react-flow__node').count()) > 0,
  'and leaves the editor exactly where it was',
);
const { agent: after } = await graphql(`query ($id: ID!) { agent(id: $id) { name } }`, { id: agent.id });
record(after.name === agent.name, `the agent is as it was found ("${after.name}")`);

// ---- the agent's own page, which is the same form in a different frame ----

/*
 * The panel and the page show one form, so the page is worth a look here rather
 * than only in whatever check happens to open it: a field that moved into the
 * panel and out of the page would pass everything above and still be a loss.
 * The link is still the way to that page, and this is where it goes.
 */
await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#agent-name', { timeout: 20_000 });
await page.waitForTimeout(600);

record((await page.locator('input#agent-name').inputValue()) === agent.name, "the page holds the agent's name");
record((await page.locator('select#agent-model').count()) === 1, 'and the model it answers on');
record((await page.locator('#agent-system-prompt').count()) === 1, 'and its system prompt');
const pageText = await page.locator('main').innerText();
record(pageText.includes('Memory Catalogs') && pageText.includes('Skill Catalogs') && pageText.includes('Tools'), 'and every grant');
record(pageText.includes('MCP Servers'), 'and the servers it may reach');
// The one thing the panel does not carry, and the reason the page still exists.
record(pageText.includes('Danger Zone'), 'and the Danger Zone, which the panel has nowhere to put');

await page.screenshot({ path: shot('agent-definition-page.png'), fullPage: true });

await finish(browser);
