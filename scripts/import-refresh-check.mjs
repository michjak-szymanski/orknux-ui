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
 *
 * Temporary: delete once it has been looked at.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';
const WORKFLOW = process.env.ORKNUX_WORKFLOW ?? '118';
/** A workspace with more than one page of workflows, to switch away from. */
const BIGGER = process.env.ORKNUX_BIGGER_WORKSPACE ?? '1';
const PAGE_SIZE = 4;
const ENVELOPE = '/tmp/import-refresh-check.orkx.json';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: 'alice', password: 'password' },
});
if (!signedIn.ok()) {
  console.error('sign-in failed');
  process.exit(1);
}

/** What the screen says about itself: rows drawn, and the footer's own count. */
async function state() {
  const summary = (await page.locator('p:has-text("Showing")').first().innerText()).trim();
  const total = Number(/of (\d+)/.exec(summary)?.[1] ?? -1);
  const rows = await page.locator('a[href*="/workflows/"][href$="/editor"]').count();
  const empty = await page.locator('text=/No workflows for .* yet/').count();
  return { summary, total, rows, empty: empty > 0 };
}

/** The whole point: a table and a footer that cannot contradict each other. */
function agrees(seen) {
  return seen.rows === Math.min(seen.total, PAGE_SIZE) && !seen.empty;
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

await page.goto(`${BASE}/workspace/${BIGGER}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Showing', { timeout: 20_000 });
await page.waitForTimeout(1200);
await page.locator('button:has-text("Next")').click();
await page.waitForTimeout(1500);
const onPageTwo = await state();
console.log(`page two of the bigger workspace: ${onPageTwo.rows} rows, footer "${onPageTwo.summary}"`);

await page.locator('select').first().selectOption({ label: 'Acme Support' });
await page.waitForTimeout(2500);
const switched = await state();
console.log(
  `after switching workspace: ${switched.rows} rows, footer "${switched.summary}", ` +
    `empty message: ${switched.empty}`,
);
const switchAgrees = agrees(switched);

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

await browser.close();
process.exit(grew && importAgrees && switchAgrees ? 0 : 1);
