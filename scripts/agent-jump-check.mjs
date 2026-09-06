/**
 * The ways out of an agent's settings to the things it names.
 *
 * Issue #251, and "yet another" is the whole of it: the same report had already
 * been made about a function's object parameter, a trigger's three pickers, an
 * action's four and a condition's one, and each time one form was fixed. This
 * form names five kinds of thing - a model, memory catalogs, skill catalogs,
 * tools and MCP servers - and pointed at none of them, so all five are driven
 * here rather than the one somebody happened to photograph.
 *
 * What is asserted is the same shape the other jump checks assert: the mark
 * appears only where there is something real to open, it points where the route
 * says it should, it opens a tab of its own, and the form it was pressed from
 * is left exactly as it was. With one addition this form needs and the others
 * do not - **pressing it must not grant anything.** Every grant row is a
 * checkbox in a label, and a press inside a label is a press the browser can
 * forward to that label's control, so a mark put carelessly would grant the
 * thing it was asked to explain.
 *
 * Both frames, for the reason `agent-grants-check` gives: the settings page and
 * the workflow editor's left panel are one `AgentForm` painted with class names
 * the frame hands in, and the two marks that sit beside a label are drawn with
 * exactly those. A frame that forgot one is a form with no way out in half the
 * places it is shown.
 *
 * It writes two things: an MCP server to name, so the row naming something
 * registered can be told from the row naming nothing, and - since the list
 * draws the workspace rather than a box to type into - that second grant on the
 * agent itself. Both are put back at the end, and any server left behind by a
 * killed run is swept at the start.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, shot, finish } from './suite/harness.mjs';

/** Nobody's MCP server is called this. The sweep is by prefix. */
const SCRATCH = 'jumpCheckServer_';

/** A grant naming nothing this workspace has, which must be drawn and must get no mark. */
const UNKNOWN = 'jumpCheckServer_notRegistered';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

// ---------------------------------------------------------------- the fixture

const listServers = async () =>
  (await graphql(`query ($w: ID!) { mcpServers(workspaceId: $w) { id name } }`, { w: WORKSPACE })).mcpServers;

const removeServer = (id) => graphql(`mutation ($id: ID!) { removeMcpServer(id: $id) }`, { id });

for (const stale of (await listServers()).filter((server) => server.name.startsWith(SCRATCH))) {
  await removeServer(stale.id).catch(() => {});
}

const { createMcpServer: registered } = await graphql(
  `mutation ($input: CreateMcpServerInput!) { createMcpServer(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: `${SCRATCH}registered`,
      address: 'https://mcp.invalid/sse',
    },
  },
);

/** The agent both frames show, so the two are asked about one agent. */
const { workflowGraph: graph } = await graphql(
  `query ($workspaceId: ID!, $workflowId: ID!) {
     workflowGraph(workspaceId: $workspaceId, workflowId: $workflowId) { nodes { kind name agentId } }
   }`,
  { workspaceId: WORKSPACE, workflowId: WORKFLOW },
);
const agentNode = graph.nodes.find((node) => node.kind === 'AGENT' && node.agentId !== null) ?? null;

/*
 * The grant that names nothing.
 *
 * It used to be typed into the form and never saved, because the control was a
 * box to type a name into. The list draws the workspace's servers now, so the
 * only way to have a grant the workspace has no row for is to hold one: it goes
 * on the agent here and comes off in `done`, and it is the one thing this check
 * saves. `held` is what the agent granted before, restored exactly.
 */
let held = null;

async function grantUnknown() {
  const { agent } = await graphql(`query ($id: ID!) { agent(id: $id) { id name type mcpServers } }`, {
    id: agentNode.agentId,
  });
  held = agent;
  await graphql(`mutation ($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }`, {
    id: agent.id,
    input: { name: agent.name, type: agent.type, mcpServers: [...agent.mcpServers, UNKNOWN] },
  });
}

async function done(...extras) {
  if (held !== null) {
    await graphql(`mutation ($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }`, {
      id: held.id,
      input: { name: held.name, type: held.type, mcpServers: held.mcpServers },
    }).catch(() => {});
  }
  await removeServer(registered.id).catch(() => {});
  await finish(browser, ...extras);
}

if (agentNode === null) {
  record(false, 'this workflow has no agent node pointing at an agent, so neither frame can be opened');
  await done();
}

// -------------------------------------------------------------- the questions

/** Every row of one grant group, with whatever way out it carries. */
async function rowsOf(root, what) {
  const group = root.locator(`[data-grants="${what}"]`);
  if ((await group.count()) === 0) return null;
  return group.evaluate((node) =>
    Array.from(node.querySelectorAll('[data-grant-rows] > [data-grant-name]')).map((row) => {
      const jump = row.querySelector('a');
      return {
        name: row.getAttribute('data-grant-name'),
        href: jump === null ? null : jump.getAttribute('href'),
        words: jump === null ? null : jump.innerText.trim(),
        label: jump === null ? null : jump.getAttribute('aria-label'),
        newTab: jump === null ? null : jump.getAttribute('target'),
      };
    }),
  );
}

/** The mark beside the Model picker, or null when there is none. */
function modelJump(root) {
  return root.locator('a[aria-label="Open the model\'s settings"]');
}

/**
 * One frame's five ways out. `where` is only what the failures are called.
 *
 * The routes are written here rather than read off the page, which is the point
 * of the check: a mark that points at a page that does not exist is worse than
 * no mark, and `routes.tsx` is what says where each of these lives.
 */
async function measure(root, where) {
  const select = root.locator('#agent-model');

  // ---- the model --------------------------------------------------------

  await select.selectOption('');
  await page.waitForTimeout(200);
  record(
    (await modelJump(root).count()) === 0,
    `${where}: nothing to open while the model reads "None - this agent cannot run"`,
  );

  /*
   * Waited for. The picker is drawn with its "None" row before the workspace's
   * models have arrived, so reading it straight away finds one option and
   * concludes the workspace has no model in it - which is a fetch in flight
   * reported as an empty workspace.
   */
  await page
    .waitForFunction(
      (id) => (document.getElementById(id)?.options.length ?? 0) > 1,
      await select.getAttribute('id'),
      { timeout: 15_000 },
    )
    .catch(() => {});
  const options = await select.locator('option').evaluateAll((all) =>
    all.map((one) => ({ value: one.value, label: one.textContent.trim() })).filter((one) => one.value !== ''),
  );
  if (options.length === 0) {
    record(false, `${where}: this workspace has no model to point the picker at`);
  } else {
    await select.selectOption(options[0].value);
    await page.waitForTimeout(200);
    record((await modelJump(root).count()) === 1, `${where}: a way out beside Model, on "${options[0].label}"`);
    const href = await modelJump(root).getAttribute('href');
    record(
      href === `/workspace/${WORKSPACE}/models/${options[0].value}`,
      `${where}: it points at the model that is chosen (${href})`,
    );
    record((await modelJump(root).innerText()).trim() === '', `${where}: drawn as the mark, with no words beside it`);
    record(
      (await modelJump(root).getAttribute('target')) === '_blank',
      `${where}: and opens a tab of its own, so a half-edited form is not thrown away`,
    );
  }

  // ---- the three grant lists --------------------------------------------

  const groups = [
    ['memory catalogs', `/workspace/${WORKSPACE}/memory?catalog=`],
    ['skill catalogs', `/workspace/${WORKSPACE}/skills?catalog=`],
    ['tools', `/workspace/${WORKSPACE}/tools/`],
  ];

  for (const [what, route] of groups) {
    const rows = await rowsOf(root, what);
    if (rows === null || rows.length === 0) {
      record(false, `${where}: the fixture has no ${what} for this form to point at`);
      continue;
    }
    const marked = rows.filter((row) => row.href !== null);
    record(
      marked.length === rows.length,
      `${where}: all ${rows.length} ${what} carry a way out (${marked.length} do)`,
    );
    record(
      marked.every((row) => row.href.startsWith(route)),
      `${where}: every one of them points under ${route} (e.g. ${marked[0]?.href})`,
    );
    record(
      marked.every((row) => row.newTab === '_blank' && row.words === '' && row.label === `Open ${row.name}`),
      `${where}: each is the mark alone, named for its row, in a tab of its own`,
    );
  }

  // ---- the MCP servers ---------------------------------------------------

  /*
   * Two rows, and what tells them apart is the mark. One names a server this
   * workspace has and opens it; the other names nothing this workspace has - a
   * grant left behind by a rename or a deletion - and carries no way out,
   * because a way out to a page that would answer "no such server" is worse
   * than none at all.
   *
   * The unknown one is drawn at all, which is the half worth stating: the list
   * draws the workspace, and a grant with no row in it would otherwise be
   * invisible while still being granted and still being sent to the agent.
   */
  const servers = await rowsOf(root, 'mcp servers');
  if (servers === null) {
    record(false, `${where}: there is no MCP Servers group on this form`);
  } else {
    const known = servers.find((row) => row.name === registered.name);
    const unknown = servers.find((row) => row.name === UNKNOWN);
    record(
      known?.href === `/workspace/${WORKSPACE}/integrations/servers/${registered.id}`,
      `${where}: the row naming a registered server opens it (${known?.href})`,
    );
    record(
      unknown !== undefined,
      `${where}: a grant the workspace has no server for is still drawn, rather than silently dropped`,
    );
    record(
      unknown !== undefined && unknown.href === null,
      `${where}: and it carries no way out, because there is nothing to open`,
    );
  }
}

// ------------------------------------------------------------- the two frames

// Before either frame is opened, so both are asked about the same agent.
await grantUnknown();

const settings = `/workspace/${WORKSPACE}/agents/${agentNode.agentId}/settings`;
await page.goto(`${BASE}${settings}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-grants="tools"] [data-grant-rows]', { timeout: 20_000 });
await page.waitForTimeout(500);
await measure(page, 'settings page');
await page.screenshot({ path: shot('agent-jump-page.png') });

// ---- pressed, not merely present ------------------------------------------

/*
 * The half a screenshot cannot show. A row's mark is inside the row, and the
 * row's tick is a checkbox in a label: if the press reaches the label, going to
 * read what a tool does grants it. And the form has to be where it was left
 * afterwards, which is the whole reason these open in a tab of their own.
 */
const firstTool = page.locator('[data-grants="tools"] [data-grant-rows] > [data-grant-name]').first();
const toolName = await firstTool.getAttribute('data-grant-name');
const tick = firstTool.locator('input[type="checkbox"]');
const wasTicked = await tick.isChecked();

const typed = 'Jump check was here';
await page.fill('#agent-description', typed);

const openedTool = page.context().waitForEvent('page');
await firstTool.locator('a').click();
const toolTab = await openedTool;
await toolTab.waitForLoadState('domcontentloaded');
await toolTab.waitForTimeout(1500);
record(
  new URL(toolTab.url()).pathname.startsWith(`/workspace/${WORKSPACE}/tools/`),
  `pressing a tool's mark lands on its editor (${new URL(toolTab.url()).pathname})`,
);
record((await tick.isChecked()) === wasTicked, `and does not grant ${JSON.stringify(toolName)} on the way`);
record(new URL(page.url()).pathname === settings, 'the form is still on screen behind it');
record(
  (await page.locator('#agent-description').inputValue()) === typed,
  'with what was being typed into it untouched',
);
await toolTab.close();

/*
 * And the catalog links, which are the ones that had to be given somewhere to
 * land: a catalog is not a page of its own, so the memory screen now opens on
 * the one it is pointed at rather than on whichever happens to be first.
 */
const firstCatalog = page.locator('[data-grants="memory catalogs"] [data-grant-rows] > [data-grant-name]').first();
const catalogName = await firstCatalog.getAttribute('data-grant-name');
const openedCatalog = page.context().waitForEvent('page');
await firstCatalog.locator('a').click();
const catalogTab = await openedCatalog;
await catalogTab.waitForLoadState('domcontentloaded');
await catalogTab.waitForTimeout(2000);
const heading = (await catalogTab.locator('h1').first().innerText().catch(() => '')).trim();
record(
  heading === catalogName,
  `a memory catalog's mark opens that catalog rather than the first one - asked for ` +
    `${JSON.stringify(catalogName)}, landed on ${JSON.stringify(heading)}`,
);
await catalogTab.close();

// ---- the workflow editor's left panel -------------------------------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(800);
await page.locator('.react-flow__node').filter({ hasText: agentNode.name }).first().click();
await page.waitForTimeout(600);
await page.getByRole('link', { name: /^Open the .+'s definition$/ }).click();
await page.waitForSelector('dialog[open] [data-grants="tools"] [data-grant-rows]', { timeout: 20_000 });
await page.waitForTimeout(500);

const panel = page.locator('dialog[open]').first();
await measure(panel, 'editor panel');
record(
  (await page.locator('.react-flow__node').count()) > 0,
  'the panel was measured beside the graph rather than instead of it',
);
await page.screenshot({ path: shot('agent-jump-panel.png') });

await done();
