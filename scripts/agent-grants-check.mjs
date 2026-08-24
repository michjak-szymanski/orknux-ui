/**
 * An agent's grants: bounded, searchable, and explained behind a (?).
 *
 * Two issues over the same twenty rows of markup, measured in one run.
 *
 * **#172** - the grant lists drew every row at full height with no bound, so a
 * workspace with a few dozen tools was a wall of checkboxes that pushed the
 * switches under it, the MCP servers and Save off the screen, and the only way
 * to find a tool was to scroll and read it. Each group has a scroll box now, a
 * search that narrows as you type, and a count. The rule that needed deciding
 * is what a search does to a row that is already granted, and the answer is
 * nothing: a ticked row is drawn whatever is typed, in the place it already
 * occupied, and marked so it is clear it is not a match. A search that can hide
 * a grant is how the same tool gets granted twice and how one fails to be
 * revoked.
 *
 * **#173** - Orknux and Shells printed their explanation as a paragraph while
 * MCP Servers had a (?), which is the one arrangement UI-DESIGN-RULES.md calls
 * worse than either convention applied whole. Both moved behind a (?), and the
 * (?) is beside the row being granted rather than the heading above it.
 *
 * Both halves are measured **in both frames**, which is the part that could not
 * be taken on trust: since #149 the agent's settings page and the workflow
 * editor's left panel render one `AgentForm`, and the panel is the narrower of
 * the two - a cap that leaves the page readable can still leave the panel a
 * wall of its own.
 *
 * It writes nothing it does not remove. Where the workspace has too few tools
 * to prove a bound with, it makes its own under a name nobody would mistake for
 * real, deletes them at the end, and sweeps any an earlier killed run left
 * behind. The agent it drives is never saved: what it ticks lives in the form
 * until the page is left, and it leaves without pressing Save.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, shot, finish } from './suite/harness.mjs';

/** Enough rows that a bound is a bound, rather than a list that happened to fit. */
const WANT_ROWS = 24;

/** The form draws a search box from here up; `AgentForm` says the same number. */
const SEARCH_FROM = 8;

/** What the stylesheet caps a scroll box at, plus the 1px of padding around it. */
const CAP = 240 + 2;

/** Nobody's tool is called this. The sweep is by prefix. */
const SCRATCH = 'grantCheckScratch_';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

// ---------------------------------------------------------------- the fixture

const listTools = async () =>
  (
    await graphql(
      `query ($workspaceId: ID!) {
         workspaceTools(workspaceId: $workspaceId, page: 0, size: 100) { content { id name } }
       }`,
      { workspaceId: WORKSPACE },
    )
  ).workspaceTools.content;

const createTool = async (name) =>
  (
    await graphql(`mutation ($input: CreateToolInput!) { createTool(input: $input) { id name } }`, {
      input: { workspaceId: WORKSPACE, name, description: 'Scratch row for agent-grants-check.' },
    })
  ).createTool;

const deleteTool = (id) => graphql(`mutation ($id: ID!) { deleteTool(id: $id) }`, { id });

/** Everything this check made - here, or on a run that was killed before the sweep. */
let mine = [];

async function sweep() {
  for (const tool of mine) await deleteTool(tool.id).catch(() => {});
  mine = [];
}

const stale = (await listTools()).filter((tool) => tool.name.startsWith(SCRATCH));
for (const tool of stale) await deleteTool(tool.id).catch(() => {});
if (stale.length > 0) console.log(`NOTE: swept ${stale.length} scratch tool(s) from an earlier run`);

for (let held = (await listTools()).length; held < WANT_ROWS; held += 1) {
  mine.push(await createTool(`${SCRATCH}${String(held).padStart(2, '0')}`));
}
if (mine.length > 0) console.log(`NOTE: made ${mine.length} scratch tool(s) to reach ${WANT_ROWS} rows`);

/** The agent the editor's panel opens, so both frames are asked about one agent. */
const { workflowGraph: graph } = await graphql(
  `query ($workspaceId: ID!, $workflowId: ID!) {
     workflowGraph(workspaceId: $workspaceId, workflowId: $workflowId) { nodes { kind name agentId } }
   }`,
  { workspaceId: WORKSPACE, workflowId: WORKFLOW },
);
const agentNode = graph.nodes.find((node) => node.kind === 'AGENT' && node.agentId !== null) ?? null;

if (agentNode === null) {
  record(false, 'this workflow has no agent node pointing at an agent, so the panel cannot be opened');
  await sweep();
  await finish(browser);
}

// -------------------------------------------------------------- the questions

/**
 * What one grant group is drawing, read off the page rather than inferred.
 *
 * `root` is whatever frame the form is in - the page itself, or the panel's
 * `<dialog>` - so both are asked the same questions in the same words. The row
 * names come off `data-grant-name` rather than out of the text, because the
 * text of a row is the name plus whatever muted word follows it, and because
 * the attribute holds what is actually stored in the grant.
 */
async function readGroup(root, what) {
  const group = root.locator(`[data-grants="${what}"]`);
  if ((await group.count()) === 0) return null;
  return group.evaluate((node) => {
    const box = node.querySelector('[data-grant-rows]');
    /*
     * By the attribute rather than by `> label`. A row carries a way out to
     * what it names now - issue #251 - so the <label> is the part that toggles
     * and the row around it is what holds the grant's name.
     */
    const rows = box === null ? [] : Array.from(box.querySelectorAll(':scope > [data-grant-name]'));
    return {
      groupHeight: Math.round(node.getBoundingClientRect().height),
      boxHeight: box === null ? 0 : Math.round(box.getBoundingClientRect().height),
      /* The height the rows want, which is what the old form drew. */
      wanted: box === null ? 0 : box.scrollHeight,
      searchable: node.querySelector('input[type="search"]') !== null,
      count: node.querySelector('[data-grant-count]')?.textContent?.trim() ?? '',
      names: rows.map((row) => row.getAttribute('data-grant-name')),
      kept: rows
        .filter((row) => row.hasAttribute('data-kept'))
        .map((row) => row.getAttribute('data-grant-name')),
      ticked: rows
        .filter((row) => row.querySelector('input[type="checkbox"]')?.checked === true)
        .map((row) => row.getAttribute('data-grant-name')),
      marks: node.querySelectorAll('mark').length,
    };
  });
}

/**
 * The MCP servers, which are chips rather than rows and so are read apart: a
 * chip carries no grant name, because every one of them is granted.
 */
async function readServers(root) {
  return root.locator('[data-grants="mcp servers"]').evaluate((node) => {
    const box = node.querySelector('[data-grant-rows]');
    const after = box?.nextElementSibling ?? null;
    return {
      chips: box === null ? 0 : box.children.length,
      boxHeight: box === null ? 0 : Math.round(box.getBoundingClientRect().height),
      wanted: box === null ? 0 : box.scrollHeight,
      /* The "+ Add Server" control, which must not be inside what scrolls. */
      addBelow: after !== null && (after.textContent ?? '').includes('Add Server'),
    };
  });
}

/**
 * One frame, from the wall it used to draw to the search that narrows it and
 * back again. `where` is only what the failures are called.
 */
async function measure(root, where) {
  const form = root.locator('form:has([data-grants="tools"])').first();
  const search = root.locator('[data-grants="tools"] input[type="search"]');

  const before = await readGroup(root, 'tools');
  if (before === null) {
    record(false, `${where}: there is no Tools group on this form at all`);
    return;
  }

  // ---- #172: the bound -----------------------------------------------------

  record(
    before.names.length >= SEARCH_FROM,
    `${where}: the Tools group holds ${before.names.length} rows, enough to be worth bounding`,
  );
  record(before.boxHeight <= CAP, `${where}: the rows are drawn ${before.boxHeight}px tall, within the ${CAP}px cap`);
  record(
    before.wanted > before.boxHeight + 1,
    `${where}: and are really clipped - ${before.wanted}px of rows inside a ${before.boxHeight}px box, ` +
      `where the old form drew all ${before.wanted}px of it`,
  );
  record(
    before.groupHeight <= CAP + 120,
    `${where}: heading, search and rows together come to ${before.groupHeight}px`,
  );

  // Every group on the form, not only the one the litter is in.
  for (const what of ['memory catalogs', 'skill catalogs', 'tools']) {
    const group = await readGroup(root, what);
    if (group === null) {
      record(false, `${where}: no group called ${what}`);
      continue;
    }
    record(group.boxHeight <= CAP, `${where}: ${what} is ${group.boxHeight}px for ${group.names.length} rows`);
    /*
     * The rule rather than one workspace's answer to it: a group grows a search
     * box exactly when it has enough rows to need one. Put this way it is true
     * of a workspace with four tools and of one with four hundred, which is the
     * half of #172 that asked whether a short list should grow a control.
     */
    record(
      group.searchable === group.names.length >= SEARCH_FROM,
      `${where}: ${what} has ${group.names.length} rows and ${group.searchable ? 'a' : 'no'} search box`,
    );
    /*
     * A group the workspace has none of says nothing rather than "0 of 0
     * granted": the line under it already says there are none, and a count of
     * nothing beside it is a second way of saying so.
     */
    record(
      group.names.length === 0 ? group.count === '' : /^\d+ of \d+ granted/.test(group.count),
      group.names.length === 0
        ? `${where}: ${what} is empty and says no count`
        : `${where}: ${what} says "${group.count}"`,
    );
  }

  /*
   * The fourth group #172 names, and the one that had to be measured against
   * something rather than against an empty box: an agent with no MCP servers
   * satisfies any cap at all. So where there are none, twenty-six are typed in -
   * into the form, never saved - and taken out again afterwards.
   */
  let servers = await readServers(root);
  const scratchChips = servers.chips === 0 ? 26 : 0;
  for (let n = 0; n < scratchChips; n += 1) {
    await root.getByRole('button', { name: '+ Add Server' }).click();
    await root.getByLabel('New MCP server').fill(`${SCRATCH}server${n}`);
    await root.getByLabel('New MCP server').press('Enter');
  }
  servers = await readServers(root);

  record(servers.chips >= 26, `${where}: the MCP group is holding ${servers.chips} servers to be measured with`);
  record(
    servers.boxHeight <= 100,
    `${where}: the chips are bounded at ${servers.boxHeight}px, wanting ${servers.wanted}px`,
  );
  record(servers.wanted > servers.boxHeight + 1, `${where}: and are really clipped rather than merely fitting`);
  record(
    servers.addBelow,
    `${where}: the way to add one is outside the box, where scrolling the chips cannot take it away`,
  );

  for (let n = 0; n < scratchChips; n += 1) {
    await root.locator('[data-grants="mcp servers"] [data-grant-rows] button').first().click();
  }

  // ---- #172: a granted row survives the search -----------------------------

  /*
   * A row to grant, and a word that does not find it. Both taken off the page
   * rather than written in, so this says the same thing on any workspace: `hit`
   * is a whole row's name, `keep` is a different name that does not contain it
   * and is not granted already.
   */
  const hit = before.names.find((name) => name !== null && name.length > 3) ?? '';
  const keep = before.names.find(
    (name) =>
      name !== null &&
      name !== hit &&
      !name.toLowerCase().includes(hit.toLowerCase()) &&
      !before.ticked.includes(name),
  );

  if (keep === undefined || hit === '') {
    record(false, `${where}: could not find two rows to tell apart among ${before.names.length}`);
    return;
  }

  /*
   * By the attribute on the row itself rather than by its text: a name is drawn
   * in pieces once a search has marked part of it, and `hasText` on a list where
   * one name is a prefix of another picks the wrong row.
   */
  const keepBox = root.locator(`[data-grants="tools"] [data-grant-rows] > [data-grant-name="${keep}"]`);
  await keepBox.locator('input[type="checkbox"]').check();

  const granted = await readGroup(root, 'tools');
  record(
    granted.count.startsWith(`${before.ticked.length + 1} of `),
    `${where}: ticking one row makes the count read "${granted.count}"`,
  );

  await search.fill(hit);
  await page.waitForTimeout(200);
  const filtered = await readGroup(root, 'tools');

  record(
    filtered.names.length < before.names.length,
    `${where}: typing "${hit}" narrows ${before.names.length} rows to ${filtered.names.length}`,
  );
  record(
    filtered.names.includes(keep),
    `${where}: the row granted a moment ago is still drawn, though "${hit}" does not match it`,
  );
  record(
    filtered.kept.includes(keep),
    `${where}: and is marked kept rather than matched, so a list of ${filtered.names.length} for one hit reads right`,
  );
  record(
    filtered.names.every((name) => name.toLowerCase().includes(hit.toLowerCase()) || granted.ticked.includes(name)),
    `${where}: everything else drawn is either a match or a grant`,
  );
  record(filtered.marks > 0, `${where}: the typed word is picked out inside the rows that matched`);
  record(
    /^\d+ of \d+ granted · \d+ matching$/.test(filtered.count),
    `${where}: the count says how much is granted and how much matched - "${filtered.count}"`,
  );
  record(filtered.boxHeight <= CAP, `${where}: the box is still bounded while filtered (${filtered.boxHeight}px)`);
  // The picture of the thing that was argued about: one match, and a grant kept
  // beside it in a dashed row.
  await page.screenshot({ path: shot(`agent-grants-${where.replace(' ', '-')}-filtered.png`) });

  await search.fill('zzz-nothing-is-called-this');
  await page.waitForTimeout(200);
  const none = await readGroup(root, 'tools');
  record(
    none.names.length === granted.ticked.length && none.names.includes(keep),
    `${where}: a word matching nothing leaves the ${granted.ticked.length} grant(s) on screen and nothing else`,
  );

  await search.fill('');
  await page.waitForTimeout(200);
  const cleared = await readGroup(root, 'tools');
  record(
    cleared.names.length === before.names.length,
    `${where}: clearing the search brings all ${before.names.length} rows back`,
  );
  record(cleared.kept.length === 0, `${where}: nothing is marked kept once nothing is searched for`);
  record(cleared.marks === 0, `${where}: and nothing is left marked`);

  // The form put back as it was found. Nothing here is ever saved, but a panel
  // closed and reopened should not look as though somebody had edited it.
  await keepBox.locator('input[type="checkbox"]').uncheck();

  // ---- #173: the two paragraphs, and where their (?) went ------------------

  const printed = await form.innerText();

  for (const [name, sentence, row] of [
    ['Orknux', 'loop nothing here breaks', 'Let this agent ask orknux'],
    ['Shells', 'can do whatever that account can', 'Let this agent open a shell'],
  ]) {
    const control = root.locator(`button[data-hint="${name}"]`);
    record((await control.count()) === 1, `${where}: ${name} has a (?)`);
    record(!printed.includes(sentence), `${where}: ${name}'s explanation is no longer printed under the box`);
    if ((await control.count()) !== 1) continue;

    /*
     * Beside the thing being granted, not the heading above it - asked the way
     * the rule is written. Walk up from the (?) to the first ancestor holding a
     * checkbox and see whether that is the grant's own row.
     */
    const beside = await control.evaluate((node) => {
      let held = node.parentElement;
      while (held !== null && held.querySelector('input[type="checkbox"]') === null) held = held.parentElement;
      return {
        row: held?.innerText?.trim().split('\n')[0] ?? '',
        insideLabel: node.closest('label') !== null,
      };
    });
    record(beside.row.startsWith(row), `${where}: ${name}'s (?) sits on the row granted - "${beside.row}"`);
    record(!beside.insideLabel, `${where}: ${name}'s (?) is not inside the label it stands beside`);

    /*
     * And what that placement is for, measured rather than reasoned about: a
     * button inside a <label> is a press the browser forwards to that label's
     * control, so a (?) put carelessly would grant the permission it was asked
     * to explain.
     */
    const box = root.locator('label').filter({ hasText: row }).first().locator('input[type="checkbox"]');
    const was = await box.isChecked();
    await control.click();
    await page.waitForTimeout(250);
    const note = page.locator('[role="note"]').first();
    record(
      (await note.count()) === 1 && (await note.innerText()).includes(sentence),
      `${where}: pressing ${name}'s (?) shows the sentence that used to be printed under it`,
    );
    record((await box.isChecked()) === was, `${where}: and does not tick ${name} on the way`);
    await control.click();
    await page.waitForTimeout(200);
  }

  /*
   * The sweep, kept rather than done once. An explanation is long and a status
   * is short, so a paragraph over eighty characters inside this form is the
   * convention coming undone again - which is exactly what happened between the
   * first sweep and #173.
   *
   * A catalogue that failed to load prints a long sentence here too, and that
   * would fail this. Correctly: a run whose catalogues did not load has already
   * failed everything above.
   */
  const paragraphs = await form.evaluate((node) =>
    Array.from(node.querySelectorAll('p'))
      .map((one) => one.innerText.trim())
      .filter((text) => text.length > 80),
  );
  record(
    paragraphs.length === 0,
    paragraphs.length === 0
      ? `${where}: no explanation is left printed in the form`
      : `${where}: still printing ${paragraphs.length} paragraph(s): ${JSON.stringify(paragraphs[0].slice(0, 90))}`,
  );
}

// ------------------------------------------------------------- the two frames

// ---- the agent's own settings page ----

await page.goto(`${BASE}/workspace/${WORKSPACE}/agents/${agentNode.agentId}/settings`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-grants="tools"] [data-grant-rows]', { timeout: 20_000 });
await page.waitForTimeout(500);
const column = await page
  .locator('[data-grants="tools"]')
  .evaluate((node) => Math.round(node.getBoundingClientRect().width));
console.log(`NOTE: the page gives a grant group ${column}px of width`);
await measure(page, 'settings page');
await page.screenshot({ path: shot('agent-grants-page.png') });

// ---- the workflow editor's left panel ----

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(800);
await page.locator('.react-flow__node').filter({ hasText: agentNode.name }).first().click();
await page.waitForTimeout(600);
await page.getByRole('link', { name: 'Open definition' }).click();
await page.waitForSelector('dialog[open] [data-grants="tools"] [data-grant-rows]', { timeout: 20_000 });
await page.waitForTimeout(500);

const panel = page.locator('dialog[open]').first();
const narrow = await panel
  .locator('[data-grants="tools"]')
  .evaluate((node) => Math.round(node.getBoundingClientRect().width));
console.log(`NOTE: the panel gives a grant group ${narrow}px of width`);
record(narrow < column, `the panel is the narrower frame (${narrow}px against the page's ${column}px)`);
record((await page.locator('.react-flow__node').count()) > 0, 'the panel opened beside the graph rather than instead of it');
await measure(panel, 'editor panel');
await page.screenshot({ path: shot('agent-grants-panel.png') });

await sweep();
await finish(browser);
