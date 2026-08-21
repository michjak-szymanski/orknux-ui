/**
 * Deleting an issue asks before it does it.
 *
 * The trash button used to delete on the click that reached it, which is what
 * issue #135 is about. This files an issue of its own, presses the trash, checks
 * nothing has gone yet, cancels, presses again and confirms, and then checks the
 * issue is really gone from the server and not only from the page.
 */
import { BASE, WORKSPACE, open, drawn, shot, finish } from './suite/harness.mjs';

const TITLE = `Delete confirmation check ${Date.now()}`;

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

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
/*
 * Judged, not assumed. This was `const left = true;` under a `waitForURL` -
 * a line printed as a verdict that could only ever say yes, and a wait whose
 * failure would have thrown before it anyway. What it means is asked instead.
 */
const left = await page
  .waitForURL(new RegExp(`/workspace/${WORKSPACE}/issues$`), { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);

await page.screenshot({ path: shot('delete-issue-confirm.png') });

/*
 * Gone on the server, not just off the page - and read off a page that has
 * actually drawn.
 *
 * "the title is not on this page" is the assertion, and eight hundred
 * milliseconds after a navigation the page may be showing nothing at all: the
 * loader draws nothing for its first three seconds, so a slow reload is a blank
 * screen and a blank screen contains no title. The strongest evidence in this
 * check would have passed on an empty document.
 */
await page.goto(url, { waitUntil: 'domcontentloaded' });
const drewIt = await drawn(page, 'the deleted issue, reopened');
const body = drewIt ? await page.locator('body').innerText() : '';
const gone = drewIt && !body.includes(TITLE);

console.log(`dialog on the first click: ${asks ? 'shown' : 'not shown'}`);
console.log(`it names the issue:        ${names ? 'yes' : 'no'}`);
console.log(`after cancel:              ${closed ? 'closed' : 'still open'}, ${stillHere && stillLoads ? 'issue intact' : 'issue lost'}`);
console.log(`after confirm:             ${left ? 'back at the list' : 'stayed'}, reload ${gone ? 'finds nothing' : 'still finds it'}`);

console.log(asks ? 'PASS: the click asks first' : 'FAIL: it deleted without asking');
console.log(names ? 'PASS: the dialog names the issue' : 'FAIL: the dialog does not say which issue');
console.log(closed && stillHere && stillLoads ? 'PASS: cancel keeps the issue' : 'FAIL: cancel did not keep the issue');
console.log(left ? 'PASS: confirm goes back to the list' : 'FAIL: confirm stayed where it was');
console.log(gone ? 'PASS: confirm deletes it' : 'FAIL: confirm did not delete it');

await finish(browser, asks, names, closed, stillHere, stillLoads, left, gone);
