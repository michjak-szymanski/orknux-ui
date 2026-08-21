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
import { BASE, WORKSPACE, open, finish } from './suite/harness.mjs';

const WORKFLOW = process.env.ORKNUX_WORKFLOW ?? '118';
/** What the workspace the checks live in is called, for the switcher. */
const WORKSPACE_NAME = process.env.ORKNUX_WORKSPACE_NAME ?? 'Acme Support';
/** A workspace with more than one page of workflows, to switch away from. */
const BIGGER = process.env.ORKNUX_BIGGER_WORKSPACE ?? '1';
const ENVELOPE = '/tmp/import-refresh-check.orkx.json';

const { browser, context, page } = await open({ viewport: { width: 1440, height: 900 } });

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
    await page.locator('select[aria-label="How many templates to show at once"]').inputValue(),
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

await page.goto(`${BASE}/workspace/${WORKSPACE}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Showing', { timeout: 20_000 });
await page.waitForTimeout(1000);

const before = await state();
console.log(`before the import: ${before.rows} rows, footer "${before.summary}"`);

await page.locator('input[type="file"]').first().setInputFiles(ENVELOPE);
await page.waitForSelector('dialog[open] h2:has-text("Import")', { timeout: 20_000 });
await page.waitForTimeout(1500);

const confirm = page.locator('dialog[open] button:has-text("Import")').last();
if (await confirm.isDisabled()) {
  console.error('FAIL: the dialog refused the file this installation just wrote');
  console.error(await page.locator('dialog[open]').innerText());
  process.exit(1);
}
await confirm.click();
await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(2500);

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
