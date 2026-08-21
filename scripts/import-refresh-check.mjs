/**
 * The workflow list telling the truth about itself.
 *
 * The report: after an import the table said "No workflows for Acme Support
 * yet." while the footer under it said "Showing 1-3 of 3 templates", and it
 * stayed that way until the page was reloaded.
 *
 * What actually does it is the switcher in the corner. It changes the workspace
 * without leaving this route, so the page number somebody was on survives the
 * move - and a page past the end of the new workspace comes back with no rows
 * and the real total beside them. Both halves of the screen are then drawn from
 * that: an empty table under a footer counting three.
 *
 * So this drives both: an import without a reload, and a switch from page two
 * of a bigger workspace into a smaller one. The assertion that would have
 * caught it is the same in both - the number of rows drawn and the count in the
 * footer have to agree.
 */
import { writeFileSync } from 'node:fs';
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';
import { NAMES, anyOf, workspaceIdOf, workspaceNameOf } from './suite/named.mjs';

const ENVELOPE = '/tmp/import-refresh-check.orkx.json';

const { browser, context, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/*
 * Three numbers, none of them written down any more.
 *
 * They were `?? '118'`, `?? 'Acme Support'` and `?? '1'` - a workflow, a
 * workspace name and a workspace out of one developer's database. Anywhere else
 * 118 is nothing to export, the switcher has no row called Acme Support to
 * choose, and workspace 1 is whatever happens to be first. What this check
 * actually needs is *a* workflow to export, the name of the workspace it is
 * already in, and a second workspace with more than one page - so it asks for
 * those.
 */
/** What kinds of node a workflow holds - a cheap reading of how heavy it is. */
const kindsIn = async (workflowId) => {
  const { workflowGraph } = await graphql(
    'query($w: ID!, $f: ID!) { workflowGraph(workspaceId: $w, workflowId: $f) { nodes { kind } } }',
    { w: WORKSPACE, f: workflowId },
  );
  return (workflowGraph?.nodes ?? []).map((node) => node.kind);
};

const WORKFLOW = await anyOf(graphql, 'workflow', WORKSPACE, NAMES.WORKFLOW, {
  override: process.env.ORKNUX_WORKFLOW,
  /*
   * A workflow without an agent in it. Any workflow proves the point here, and
   * this really imports what it exports - so one carrying an agent brings the
   * agent's skills with it, which on this database is a megabyte-and-a-bit
   * envelope: seconds for the dialog to read, and a copy of every one of those
   * components made in the workspace.
   */
  fits: async (row) => {
    const kinds = await kindsIn(row.id);
    return kinds.length > 0 && !kinds.includes('AGENT');
  },
});
/** What the workspace the checks live in is called, for the switcher. */
const WORKSPACE_NAME = await workspaceNameOf(graphql, WORKSPACE, process.env.ORKNUX_WORKSPACE_NAME);
/** A workspace with more than one page of workflows, to switch away from. */
const BIGGER = await workspaceIdOf(graphql, NAMES.BIGGER_WORKSPACE, process.env.ORKNUX_BIGGER_WORKSPACE);

if (WORKFLOW === null || WORKSPACE_NAME === null || BIGGER === null) {
  record(
    false,
    `nothing to run against: workflow ${WORKFLOW}, workspace name ${JSON.stringify(WORKSPACE_NAME)}, ` +
      `second workspace ${BIGGER}. Run scripts/suite/fixture.mjs against this server.`,
  );
  await finish(browser);
}
console.log(`exporting workflow ${WORKFLOW} out of ${JSON.stringify(WORKSPACE_NAME)}, switching from ${BIGGER}`);

/**
 * What the screen says about itself: rows drawn, the footer's own count, and
 * how many rows a page is set to hold.
 *
 * The size is read off the control rather than written down here. It used to be
 * a constant `4`, which was the number this list was fixed at; issue 145 made it
 * a choice, and a check carrying its own copy of somebody else's default is a
 * check that fails the day the default moves - about the default, while
 * claiming to be about an import.
 */
async function state() {
  const summary = (await page.locator('p:has-text("Showing")').first().innerText()).trim();
  const total = Number(/of (\d+)/.exec(summary)?.[1] ?? -1);
  const rows = await page.locator('a[href*="/workflows/"][href$="/editor"]').count();
  const empty = await page.locator('text=/No workflows for .* yet/').count();
  const size = Number(
    await page.locator('select[aria-label="How many workflows to show at once"]').inputValue(),
  );
  return { summary, total, rows, empty: empty > 0, size };
}

/** The whole point: a table and a footer that cannot contradict each other. */
function agrees(seen) {
  return seen.rows === Math.min(seen.total, seen.size) && !seen.empty;
}

// ----------------------------------------------------- an import, no reload

// The file to import is this installation's own export, so it lands importable.
const exported = await context.request.post(`${BASE}/graphql`, {
  data: {
    query: `query { exportComponent(workspaceId: ${WORKSPACE}, kind: WORKFLOW, id: ${WORKFLOW}, depth: DEEP) { fileName json } }`,
  },
});
const made = (await exported.json()).data.exportComponent;
writeFileSync(ENVELOPE, made.json);
console.log(`exported ${made.fileName} (${made.json.length} bytes)`);

/**
 * Which workflows were here before the import, so the one it makes can be taken
 * back out again.
 *
 * It was not, and every run of this left another copy behind. Six runs took the
 * workspace from fifteen workflows to twenty-five, which is how
 * `workflow-list-check` came to fail on a list the server had ordered perfectly
 * - its "descending is the whole list turned round" only holds while the two
 * pages it reads *are* the whole list. This check's own note says a check that
 * leaves rows behind changes the list the next one measures; it was the one
 * doing it.
 */
const KINDS = [
  // In the order they are removed: what points at things first.
  ['workspaceWorkflows', 'removeWorkflow'],
  ['workspaceActions', 'deleteAction'],
  ['workspaceTriggers', 'deleteTrigger'],
  ['workspaceAgents', 'deleteAgent'],
  ['workspaceConditions', 'deleteCondition'],
  ['workspaceTools', 'deleteTool'],
  ['workspaceSkills', 'deleteSkill'],
  ['workspaceFunctions', 'deleteFunction'],
];

const snapshot = async () => {
  const held = new Map();
  for (const [list] of KINDS) {
    const answered = await graphql(
      `query($w: ID!) { ${list}(workspaceId: $w, page: 0, size: 500) { content { id } } }`,
      { w: WORKSPACE },
    );
    held.set(list, new Set(answered[list].content.map((row) => String(row.id))));
  }
  return held;
};

/** Whatever appeared since the snapshot, removed in the order above. */
const sweep = async (was) => {
  let taken = 0;
  for (const [list, mutation] of KINDS) {
    const answered = await graphql(
      `query($w: ID!) { ${list}(workspaceId: $w, page: 0, size: 500) { content { id } } }`,
      { w: WORKSPACE },
    );
    for (const row of answered[list].content) {
      if (was.get(list).has(String(row.id))) continue;
      const done = await graphql(`mutation($id: ID!) { ${mutation}(id: $id) }`, { id: row.id })
        .then(() => true)
        .catch((cause) => {
          console.log(`  could not ${mutation}(${row.id}): ${cause.message.slice(0, 120)}`);
          return false;
        });
      if (done) taken += 1;
    }
  }
  return taken;
};

const wasHere = await snapshot();

await page.goto(`${BASE}/workspace/${WORKSPACE}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Showing', { timeout: 20_000 });
await page.waitForTimeout(1000);

const before = await state();
console.log(`before the import: ${before.rows} rows, footer "${before.summary}"`);

await page.locator('input[type="file"]').first().setInputFiles(ENVELOPE);
await page.waitForSelector('dialog[open] h2:has-text("Import")', { timeout: 20_000 });
/*
 * Waited on the dialog, not on a second and a half.
 *
 * The dialog says "Reading the file…" while it works the plan out, and how long
 * that takes is a fact about the envelope: a small workflow lands in a blink
 * and a deep export carrying an agent's skills is over a megabyte and does not.
 * A fixed sleep read the button while it was still correctly disabled and this
 * check announced that the installation refuses its own export.
 */
const planned = await page
  .waitForFunction(
    () => {
      const dialog = document.querySelector('dialog[open]');
      return dialog !== null && !dialog.innerText.includes('Reading the file');
    },
    { timeout: 60_000 },
  )
  .then(() => true)
  .catch(() => false);
if (!planned) {
  record(false, 'the import dialog was still reading the file after a minute');
  await finish(browser);
}
await page.waitForTimeout(500);

const confirm = page.locator('dialog[open] button:has-text("Import")').last();
if (await confirm.isDisabled()) {
  record(
    false,
    'the dialog refused the file this installation just wrote: ' +
      (await page.locator('dialog[open]').innerText()).replace(/\s+/g, ' '),
  );
  await finish(browser);
}
await confirm.click();
await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 30_000 }).catch(() => {});
/*
 * Waited on the footer, not on two and a half seconds.
 *
 * How long an import takes to land belongs to the envelope, and this check read
 * the count while the import was still running - then said "the count did not
 * grow" about a workspace that grew a moment later. The wait is bounded and
 * failing it still fails the check; what it no longer does is call a slow
 * import a wrong one.
 */
await page
  .waitForFunction(
    (was) => {
      const said = [...document.querySelectorAll('p')].map((one) => one.innerText).find((text) => text.includes('Showing'));
      return said !== undefined && Number(/of (\d+)/.exec(said)?.[1] ?? -1) > was;
    },
    before.total,
    { timeout: 30_000 },
  )
  .catch(() => undefined);
await page.waitForTimeout(500);

const after = await state();
console.log(`after the import:  ${after.rows} rows, footer "${after.summary}", empty message: ${after.empty}`);
const grew = after.total > before.total;
const importAgrees = agrees(after);

// ------------------------------------------- a switch out of a page that ends

/*
 * The other workspace has to have a second page, and now it has to be made to.
 *
 * It used to have one for nothing: this list held four rows a page and any
 * workspace with five workflows was two pages deep. Issue 145 made the size a
 * choice starting at ten, and the workspace this was pointed at quietly stopped
 * having a page two - so the check sat waiting thirty seconds for a Next button
 * that was correctly disabled. Rather than name a bigger workspace and wait for
 * that one to shrink too, it tops this one up itself and puts it back.
 */
await page.goto(`${BASE}/workspace/${BIGGER}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Showing', { timeout: 20_000 });
await page.waitForTimeout(1200);

/*
 * The smallest page first, and then top up to it.
 *
 * How many rows a page holds is a remembered choice now, and the top-up below
 * makes one more workflow than that - so a run that inherited a hundred a page
 * would sit here creating ninety-six workflows one request at a time. That is
 * how this check spent a run timing out inside a `createWorkflow`, and
 * reporting a slow mutation where the fault was the size it happened to find.
 * Ten a page is the smallest the control offers, and eleven workflows is the
 * whole of what a second page needs.
 */
await page.selectOption('select[aria-label="How many workflows to show at once"]', '10');
await page.waitForTimeout(1200);

const propped = [];
const there = await state();
if (there.total <= there.size) {
  const stamp = Date.now();
  for (let index = there.total; index <= there.size; index += 1) {
    const answer = await context.request.post(`${BASE}/graphql`, {
      data: {
        query: `mutation { createWorkflow(input: { workspaceId: ${BIGGER}, name: "zz page two ${stamp} ${index}" }) { id } }`,
      },
    });
    propped.push((await answer.json()).data.createWorkflow.id);
  }
  console.log(`propped up workspace ${BIGGER} with ${propped.length} workflows so it has a page two`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Showing', { timeout: 20_000 });
  await page.waitForTimeout(1200);
}

await page.locator('button:has-text("Next")').click();
await page.waitForTimeout(1500);
const onPageTwo = await state();
console.log(`page two of the bigger workspace: ${onPageTwo.rows} rows, footer "${onPageTwo.summary}"`);

await page.locator('select').first().selectOption({ label: WORKSPACE_NAME });
await page.waitForTimeout(2500);
const switched = await state();
console.log(
  `after switching workspace: ${switched.rows} rows, footer "${switched.summary}", ` +
    `empty message: ${switched.empty}`,
);
const switchAgrees = agrees(switched);

// Whatever was propped up comes down again, pass or fail: a check that leaves
// rows behind changes the list the next one measures.
for (const id of propped) {
  await context.request
    .post(`${BASE}/graphql`, { data: { query: `mutation { removeWorkflow(id: ${id}) }` } })
    .catch(() => {});
}
if (propped.length > 0) console.log(`took the ${propped.length} propping workflows back out`);

// And everything the import made, for the same reason.
console.log(`swept ${await sweep(wasHere)} components the import created`);

console.log(grew ? 'PASS: the import showed up in the count' : 'FAIL: the count did not grow');
console.log(
  importAgrees
    ? 'PASS: rows and footer agree after an import, with no reload'
    : 'FAIL: rows and footer contradict each other after an import',
);
console.log(
  switchAgrees
    ? 'PASS: rows and footer agree after switching workspace from page two'
    : 'FAIL: the list went empty under a footer still counting',
);

await finish(browser, grew, importAgrees, switchAgrees);
