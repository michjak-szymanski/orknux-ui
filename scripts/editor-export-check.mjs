/**
 * Exporting the workflow you are looking at.
 *
 * Export was on the workflows list and nowhere else, so getting a file of the
 * workflow open in the editor meant going back to the list to find the row.
 * This drives the toolbar button: it opens the depth choice, downloads with
 * each of the two, and reads what actually came back.
 *
 * The assertion that matters is the second one. "This one only" writes an
 * envelope holding the workflow and nothing it runs, which is precisely the
 * file that arrives somewhere else refusing to import; the default has to be
 * the one that carries the agents, actions and triggers with it.
 *
 * Temporary: delete once it has been looked at.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';
const WORKFLOW = process.env.ORKNUX_WORKFLOW ?? '9';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();

const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: 'alice', password: 'password' },
});
if (!signedIn.ok()) {
  console.error('sign-in failed');
  process.exit(1);
}

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(1200);

const button = page.locator('button[aria-label^="Export"]');
const offered = await button.count();
console.log(`export button in the toolbar: ${offered === 1 ? 'there' : `${offered} of them`}`);
console.log(`its words: ${await button.first().getAttribute('data-tip')}`);

/** Opens the dialog, picks a depth, downloads, and reads the file. */
async function exportWith(depthTitle) {
  await button.first().click();
  await page.waitForSelector('dialog[open] h2:has-text("Export")', { timeout: 10_000 });
  await page.waitForTimeout(400);
  if (depthTitle !== null) await page.locator(`dialog[open] label:has-text("${depthTitle}")`).click();
  await page.screenshot({ path: `/tmp/editor-export-${depthTitle === null ? 'default' : 'shallow'}.png` });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.locator('dialog[open] button:has-text("Download")').click(),
  ]);
  const where = await download.path();
  const envelope = JSON.parse(readFileSync(where, 'utf-8'));
  await page.waitForTimeout(500);
  return { name: download.suggestedFilename(), envelope };
}

const deep = await exportWith(null);
const kindsDeep = deep.envelope.components.map((held) => held.kind);
console.log(`default download: ${deep.name}`);
console.log(`  depth in the file: ${deep.envelope.depth}`);
console.log(`  carries: ${kindsDeep.join(', ')}`);

const shallow = await exportWith('This one only');
const kindsShallow = shallow.envelope.components.map((held) => held.kind);
console.log(`"this one only" download: ${shallow.name}`);
console.log(`  depth in the file: ${shallow.envelope.depth}`);
console.log(`  carries: ${kindsShallow.join(', ')}`);

// And the file the default writes has to be one this installation would take
// back: a workflow whose actions and triggers are missing is refused.
const planned = await context.request.post(`${BASE}/graphql`, {
  data: {
    query: `query Plan($workspaceId: ID!, $envelope: String!) {
      componentImportPlan(workspaceId: $workspaceId, envelope: $envelope) {
        importable entries { kind external name disposition } problems
      }
    }`,
    variables: { workspaceId: WORKSPACE, envelope: JSON.stringify(deep.envelope) },
  },
});
const plan = (await planned.json()).data.componentImportPlan;
console.log(`the default file plans as importable: ${plan.importable}`);
if (!plan.importable) console.log(`  problems: ${plan.problems.join(' ')}`);

const there = offered === 1;
const isDeep = deep.envelope.depth === 'DEEP';
const carriesWorkflow = kindsDeep.includes('WORKFLOW');
const carriesMore = kindsDeep.length > 1;
const shallowIsBare = kindsShallow.length === 1 && kindsShallow[0] === 'WORKFLOW';

console.log(there ? 'PASS: the toolbar offers Export' : 'FAIL: no Export in the toolbar');
console.log(isDeep ? 'PASS: the default depth is DEEP' : `FAIL: the default was ${deep.envelope.depth}`);
console.log(carriesWorkflow ? 'PASS: the file holds the workflow' : 'FAIL: no workflow in the file');
console.log(
  carriesMore
    ? `PASS: and the ${kindsDeep.length - 1} things it runs`
    : 'FAIL: the workflow travelled alone',
);
console.log(
  shallowIsBare
    ? 'PASS: "this one only" is still there, and is still bare'
    : 'FAIL: the shallow choice did not do what it says',
);
console.log(plan.importable ? 'PASS: the default file imports' : 'FAIL: the default file is refused');

await browser.close();
process.exit(there && isDeep && carriesWorkflow && carriesMore && shallowIsBare && plan.importable ? 0 : 1);
