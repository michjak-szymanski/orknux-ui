/**
 * Where a component is used, and following one of those rows to the end.
 *
 * Issues #258 and #268. The list is only worth having if a row opens the thing
 * it names, and the failure worth catching is the one the agent-jump work
 * found: a link naming one thing and landing on another. Being told a tool is
 * called `makeSlug` and being taken to whatever tool happens to have that id is
 * worse than being told nothing, because it looks like it worked.
 *
 * So it does not stop at the href. It presses the row, waits for the editor to
 * arrive, and reads the name off the page it landed on - the same shape
 * `agent-jump-check` uses for a memory catalog, and for the same reason: an
 * href that is merely well-formed proves nothing about what answers it.
 *
 * It builds its own fixture, which is the only way to know both answers. A
 * function nothing imports says so in words, and the same function with a tool
 * importing it names that tool - two states of one component, so the empty line
 * is a real empty line and not a panel that failed to load. Both are removed at
 * the end, and anything left by a killed run is swept at the start.
 */
import { BASE, WORKSPACE, open, record, drawn, shot, finish } from './suite/harness.mjs';

/** Nobody's function or tool is called this. The sweep is by prefix. */
const SCRATCH = 'usedByCheck_';

const { browser, context, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

// ---------------------------------------------------------------- the fixture

const listTools = async () =>
  (await graphql(`query ($w: ID!) { workspaceTools(workspaceId: $w, size: 200) { content { id name } } }`, {
    w: WORKSPACE,
  })).workspaceTools.content;

const listFunctions = async () =>
  (await graphql(
    `query ($w: ID!) { workspaceFunctions(workspaceId: $w, size: 200) { content { id name } } }`,
    { w: WORKSPACE },
  )).workspaceFunctions.content;

const dropTool = (id) => graphql(`mutation ($id: ID!) { deleteTool(id: $id) }`, { id }).catch(() => {});
const dropFunction = (id) => graphql(`mutation ($id: ID!) { deleteFunction(id: $id) }`, { id }).catch(() => {});

/** The library this check loads, by the key it loads it under. */
const dropLibraries = async () => {
  const { scriptLibraries } = await graphql(`query { scriptLibraries { id key } }`).catch(() => ({
    scriptLibraries: [],
  }));
  for (const one of scriptLibraries.filter((held) => held.key === 'usedbycheck')) {
    await graphql(`mutation ($id: ID!) { deleteScriptLibrary(id: $id) }`, { id: one.id }).catch(() => {});
  }
};

// Tools first: one of them may be what holds a stale function in place, and a
// stale function may be what holds the library.
for (const stale of (await listTools()).filter((one) => one.name.startsWith(SCRATCH))) await dropTool(stale.id);
for (const stale of (await listFunctions()).filter((one) => one.name.startsWith(SCRATCH))) {
  await dropFunction(stale.id);
}
await dropLibraries();

const SOURCE = 'export default function f(word) { return word; }';
const { createFunction: shared } = await graphql(
  `mutation ($input: CreateFunctionInput!) { createFunction(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: `${SCRATCH}shared`,
      source: SOURCE,
      typescript: SOURCE,
      params: [{ name: 'word', type: 'STRING' }],
    },
  },
);

async function done() {
  // In the order the guards allow, which is the rule this check is about: the
  // tool holds the function it imports, and the function holds the library.
  for (const mine of (await listTools()).filter((one) => one.name.startsWith(SCRATCH))) await dropTool(mine.id);
  for (const mine of (await listFunctions()).filter((one) => one.name.startsWith(SCRATCH))) {
    await dropFunction(mine.id);
  }
  await dropLibraries();
  await finish(browser);
}

/**
 * Wait until the panel has an answer, rather than until it is on the page.
 *
 * It fetches its own rows, so it draws a loading mark for a moment after the
 * editor around it has arrived - and a check that reads it then reads neither
 * state. This is the same trap `drawn` was written for, one component down.
 */
async function settled() {
  await page.waitForSelector('[aria-label="Used by"]', { timeout: 20_000 });
  await page
    .locator('[aria-label="Used by"] [role="status"]')
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(300);
}

// ------------------------------------------------- nothing uses it, said aloud

const editor = `${BASE}/workspace/${WORKSPACE}/functions/${shared.id}`;
await page.goto(editor, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, "the new function's editor"))) await done();
await settled();

const panel = page.locator('[aria-label="Used by"]');
const said = (await panel.innerText()).replace(/\s+/g, ' ').trim();
record(
  said.includes('Nothing uses this yet'),
  `a function nothing points at says so in words rather than drawing an empty box (${JSON.stringify(said)})`,
);
record((await panel.locator('[data-dependants] a').count()) === 0, 'and offers nothing to follow');

// ------------------------------------------------------ and then something does

const TOOL_SOURCE = 'export default function makeSlug(t) { return imports.slug(t); }';
const { createTool: tool } = await graphql(
  `mutation ($input: CreateToolInput!) { createTool(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: `${SCRATCH}makeSlug`,
      source: TOOL_SOURCE,
      typescript: TOOL_SOURCE,
      params: [{ name: 't', type: 'STRING' }],
      imports: [{ functionId: shared.id, name: 'slug' }],
    },
  },
);

await page.goto(editor, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, "the function's editor, with an importer"))) await done();
await page.waitForSelector('[aria-label="Used by"] [data-dependants]', { timeout: 20_000 });

const rows = page.locator('[aria-label="Used by"] [data-dependants] a');
record((await rows.count()) === 1, `one row for one importer (${await rows.count()})`);

const row = rows.first();
const named = await row.getAttribute('data-dependant-name');
const kind = await row.getAttribute('data-dependant-kind');
const href = await row.getAttribute('href');
record(named === tool.name, `the row names the tool that imports it (${named})`);
record(kind === 'TOOL', `and says what kind of thing that is (${kind})`);
record(href === `/workspace/${WORKSPACE}/tools/${tool.id}`, `pointing at that tool's editor (${href})`);
record((await row.innerText()).includes('tool'), 'with the kind beside the name, so the reader knows which list');

// Scrolled to first: the panel lives at the bottom of a side column that
// scrolls inside itself, so a full-page picture of this editor does not contain
// the thing the picture is of.
await page.locator('[aria-label="Used by"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: shot('used-by-panel.png') });

// ------------------------------------------------- followed to the end, in place

/*
 * The half an href cannot prove. It is pressed, and what answers has to be that
 * tool - read off the page rather than off the URL, because an id that resolves
 * to the wrong row produces a perfectly well-formed URL and a page about
 * somebody else's tool.
 */
await row.click();
await page.waitForURL(`**/workspace/${WORKSPACE}/tools/${tool.id}`, { timeout: 20_000 });
if (!(await drawn(page, "the tool's editor, after following the row"))) await done();
await page.waitForTimeout(800);

const landed = new URL(page.url()).pathname;
record(landed === `/workspace/${WORKSPACE}/tools/${tool.id}`, `following the row lands on that tool (${landed})`);

/*
 * The name field rather than the heading. A tool editor's <h1> is the word
 * "Tool" on every one of them, so a check reading that would pass whichever
 * tool it landed on - which is precisely the failure this is here to catch.
 */
await page.waitForSelector('input#tool-name', { timeout: 20_000 });
const shown = (await page.locator('input#tool-name').inputValue()).trim();
record(
  shown === tool.name,
  `and the page that answered is ${JSON.stringify(tool.name)} rather than ${JSON.stringify(shown)}`,
);

// ---------------------------------------------------- the other end of the arrow

/*
 * The tool it landed on has its own panel, and what it says is not the same
 * question: a tool is used by the agents granted it, not by what it imports.
 * Asserted because a panel that answered "used by the function it imports"
 * would be the arrow drawn backwards, and would look right on this screen.
 */
/*
 * Settled, not merely present. This is the one assertion here written the
 * negative way round, and a negative read off a panel still fetching its rows
 * passes on an empty box - so the arrow could be drawn backwards and this would
 * agree with it. `settled` is what the check already uses to wait for an
 * answer; the reason it is needed is the same one, one screen over.
 */
await settled();
const toolPanel = await page.locator('[aria-label="Used by"]').innerText();
record(
  toolPanel.includes('Nothing uses this yet') && !toolPanel.includes(shared.name),
  `the tool's own panel answered, and does not name the function it imports - that arrow points ` +
    `the other way (${JSON.stringify(toolPanel.replace(/\s+/g, ' ').trim())})`,
);

// ------------------------------------------------ the same rows, one screen up

/*
 * Issue #268, which is this list read from the other end. The libraries screen
 * is the one place a dependant can be in a workspace the reader is not standing
 * in, and it is what was reported: the removal is refused with a sentence
 * naming `slugify in Backend`, and `slugify` was not something anybody could
 * press.
 */
const LIBRARY_KEY = 'usedbycheck';
const LIBRARY_SOURCE = 'export default { shout: (word) => word };';

const uploaded = await context.request.post(`${BASE}/api/libraries`, {
  multipart: {
    file: { name: `${LIBRARY_KEY}.js`, mimeType: 'text/javascript', buffer: Buffer.from(LIBRARY_SOURCE) },
  },
});
record(uploaded.ok(), `a library to import (${uploaded.status()})`);
const library = await uploaded.json();

const IMPORTER_SOURCE = 'export default function f(word) { return imports.lib.shout(word); }';
const { createFunction: importer } = await graphql(
  `mutation ($input: CreateFunctionInput!) { createFunction(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: `${SCRATCH}importer`,
      source: IMPORTER_SOURCE,
      typescript: IMPORTER_SOURCE,
      params: [{ name: 'word', type: 'STRING' }],
      libraries: [{ libraryId: library.id, name: 'lib' }],
    },
  },
);

await page.goto(`${BASE}/admin/libraries`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the libraries screen'))) await done();
await page.waitForSelector(`a[data-dependant-name="${importer.name}"]`, { timeout: 20_000 });

const inline = page.locator(`a[data-dependant-name="${importer.name}"]`);
record((await inline.count()) === 1, 'the importer named under the library is something to press');
record(
  (await inline.getAttribute('href')) === `/workspace/${WORKSPACE}/functions/${importer.id}`,
  `pointing at that function (${await inline.getAttribute('href')})`,
);

// Refused, and said on the row rather than as a sentence at the top of the card.
await page.getByRole('button', { name: `Remove ${LIBRARY_KEY}` }).click();
await page.getByRole('button', { name: 'Remove', exact: true }).click();
await page.waitForTimeout(1500);
const refusal = (await page.locator('[role="alert"]').first().innerText().catch(() => '')).trim();
record(refusal.includes('Still imported'), `the refusal lands in one line (${JSON.stringify(refusal)})`);
record(
  (await page.locator(`a[data-dependant-name="${importer.name}"]`).count()) === 1,
  'with the importer still there to press, which is what to do about it',
);
await page.screenshot({ path: shot('used-by-libraries.png'), fullPage: true });

// And followed to the end, on the screen that reaches out of a workspace.
await page.locator(`a[data-dependant-name="${importer.name}"]`).click();
await page.waitForURL(`**/workspace/${WORKSPACE}/functions/${importer.id}`, { timeout: 20_000 });
if (!(await drawn(page, "the importer's editor, after following the row"))) await done();
await page.waitForSelector('input#function-name', { timeout: 20_000 });
const landedName = (await page.locator('input#function-name').inputValue()).trim();
record(
  landedName === importer.name,
  `following it from the libraries table opens ${JSON.stringify(importer.name)} rather than ` +
    `${JSON.stringify(landedName)}`,
);

await done();
