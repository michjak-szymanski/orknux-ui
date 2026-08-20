/**
 * Deleting an issue asks before it does it.
 *
 * The trash button used to delete on the click that reached it, which is what
 * issue #135 is about. This files an issue of its own, presses the trash, checks
 * nothing has gone yet, cancels, presses again and confirms, and then checks the
 * issue is really gone from the server and not only from the page.
 *
 * Temporary: delete once it has been looked at.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';
const TITLE = `Delete confirmation check ${Date.now()}`;

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

// Our own issue to delete, so the check never touches anybody else's.
await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/new`, { waitUntil: 'domcontentloaded' });
await page.fill('input[aria-label="Title"]', TITLE);
await page.locator('button', { hasText: /^File Issue$/ }).click();
await page.waitForURL(/\/issues\/\d+$/, { timeout: 20_000 });
const url = page.url();
const number = url.split('/').pop();
console.log(`filed #${number}`);

const trash = page.locator('button[aria-label="Delete this issue"]');
const dialog = page.locator('dialog[open]');

await trash.click();
await page.waitForTimeout(400);
const asks = await dialog.isVisible().catch(() => false);
const names = asks ? (await dialog.innerText()).includes(TITLE) : false;

// Cancel has to leave the issue where it was, not merely close the dialog.
await dialog.locator('button', { hasText: /^Cancel$/ }).click();
await page.waitForTimeout(400);
const closed = (await dialog.count()) === 0;
const stillHere = page.url() === url;
const stillLoads = (await page.locator('input[aria-label="Title"]').inputValue()) === TITLE;

await trash.click();
await page.waitForTimeout(400);
await page.locator('dialog[open] button', { hasText: /^Delete Issue$/ }).click();
await page.waitForURL(new RegExp(`/workspace/${WORKSPACE}/issues$`), { timeout: 20_000 });
const left = true;

await page.screenshot({ path: 'delete-issue-confirm.png' });

// Gone on the server, not just off the page.
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const body = await page.locator('body').innerText();
const gone = !body.includes(TITLE);

console.log(`dialog on the first click: ${asks ? 'shown' : 'not shown'}`);
console.log(`it names the issue:        ${names ? 'yes' : 'no'}`);
console.log(`after cancel:              ${closed ? 'closed' : 'still open'}, ${stillHere && stillLoads ? 'issue intact' : 'issue lost'}`);
console.log(`after confirm:             ${left ? 'back at the list' : 'stayed'}, reload ${gone ? 'finds nothing' : 'still finds it'}`);

console.log(asks ? 'PASS: the click asks first' : 'FAIL: it deleted without asking');
console.log(names ? 'PASS: the dialog names the issue' : 'FAIL: the dialog does not say which issue');
console.log(closed && stillHere && stillLoads ? 'PASS: cancel keeps the issue' : 'FAIL: cancel did not keep the issue');
console.log(gone ? 'PASS: confirm deletes it' : 'FAIL: confirm did not delete it');

await browser.close();
process.exit(asks && names && closed && stillHere && stillLoads && gone ? 0 : 1);
