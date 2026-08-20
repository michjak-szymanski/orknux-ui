/**
 * What the node panel looks like, and whether a field's explanation is
 * reachable without it sitting under the field.
 *
 * Alice's complaint is visual - the panel prints a paragraph under half its
 * fields - so this takes pictures of the panel as well as pressing the (?)
 * controls that replace them: opened by mouse, opened from the keyboard,
 * closed by Escape.
 *
 * Temporary: delete once issue #136 has been looked at.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';
const WORKFLOW = process.env.ORKNUX_WORKFLOW ?? '9';
/** "before" or "after"; only what the files are called. */
const WHEN = process.argv[2] ?? 'after';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
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

// An agent node, which is the one that has every field this is about: a
// definition to pick, parameters, retries and a failure branch.
const agent = page.locator('.react-flow__node').filter({ hasText: 'Agent' }).first();
await agent.click();
await page.waitForTimeout(600);

const panel = page.locator('aside').filter({ hasText: 'Node Properties' }).first();
await panel.screenshot({ path: `panel-${WHEN}-top.png` });

// Down to the retry box, which is where the longest paragraph was.
await panel.evaluate((el) => {
  el.scrollTop = el.scrollHeight / 2;
});
await page.waitForTimeout(300);
await panel.screenshot({ path: `panel-${WHEN}-retries.png` });

const hints = panel.locator('button[data-hint]');
const count = await hints.count();
console.log(`(?) controls in the panel: ${count}`);
const paragraphs = await panel.locator('p[data-hint-text]').count();
console.log(`explanations printed under a field: ${paragraphs}`);

if (count === 0) {
  console.log('nothing more to drive; the panel has no (?) controls yet');
  await browser.close();
  process.exit(0);
}

// The retry box, which is where the longest paragraph was and what the first
// half of this issue is about.
const retries = panel.locator('button[data-hint="Retries"]');
if ((await retries.count()) > 0) {
  await retries.scrollIntoViewIfNeeded();
  await retries.click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `panel-${WHEN}-retries-open.png`, clip: { x: 1160, y: 0, width: 280, height: 1100 } });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// Opened by mouse.
const first = hints.first();
await first.scrollIntoViewIfNeeded();
await first.click();
await page.waitForTimeout(250);
const openedByClick = await panel.locator('[role="note"]').first().isVisible();
await panel.screenshot({ path: `panel-${WHEN}-open.png` });

// Escape puts it away and gives the focus back to the control that opened it.
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const closedByEscape = (await panel.locator('[role="note"]').count()) === 0;
const focusReturned = await first.evaluate((el) => el === document.activeElement);

// And opened from the keyboard, which is the whole point of it being a button.
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const openedByKey = await panel.locator('[role="note"]').first().isVisible();
const expanded = await first.getAttribute('aria-expanded');

// Anywhere else puts it away too.
await page.locator('.react-flow__pane').click({ position: { x: 40, y: 40 } });
await page.waitForTimeout(250);
const closedByOutside = (await page.locator('[role="note"]').count()) === 0;

console.log(`opened by click:    ${openedByClick}`);
console.log(`closed by Escape:   ${closedByEscape} (focus back on the control: ${focusReturned})`);
console.log(`opened by Enter:    ${openedByKey} (aria-expanded ${expanded})`);
console.log(`closed by clicking elsewhere: ${closedByOutside}`);

const ok = openedByClick && closedByEscape && focusReturned && openedByKey && expanded === 'true' && closedByOutside;
console.log(ok ? 'PASS: the (?) opens, closes and is reachable by keyboard' : 'FAIL: see above');

await browser.close();
process.exit(ok ? 0 : 1);
