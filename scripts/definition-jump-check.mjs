/**
 * Jumping from a function's object parameter to the object's definition.
 *
 * Issue #93 asked for a way out to variables and then asked the same of object
 * definitions. This starts where a person would - in the function editor, giving
 * a parameter an object type - presses the link that appears, and checks the tab
 * it opens is that object's editor.
 *
 * Two places name an object and both are asked, but they are no longer on one
 * screen: the return type moved to the function's settings page when the panel
 * was split, so the second half of this walks there. Still two links and still
 * the same rule - one way of reaching an object's definition, wherever a field
 * names one - counted one screen at a time rather than two on a page.
 */
import { BASE, WORKSPACE, open, record, shot, finish } from './suite/harness.mjs';
import { NAMES, idOf } from './suite/named.mjs';

const { browser, context, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/*
 * Looked up rather than written down. This said `?? '28'`, which is a function
 * in one developer's database; anywhere else 28 belongs to nothing and the
 * editor answers with "That function does not exist" - a page this check would
 * then have waited twenty seconds on, and reported as a page that drew nothing.
 */
const FUNCTION = await idOf(graphql, 'function', WORKSPACE, NAMES.FUNCTION, process.env.ORKNUX_FUNCTION);
if (FUNCTION === null) {
  record(false, `there is no function called ${NAMES.FUNCTION} to give an object parameter to`);
  await finish(browser);
}

await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${FUNCTION}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Parameters', { timeout: 20_000 });
await page.waitForTimeout(800);

const jumps = page.locator('a[title="Opens the object\'s definition in a new tab"]');

// Nothing to open while no field names an object.
const before = await jumps.count();

// A parameter of object type, made the way somebody would.
await page.locator('button', { hasText: /^Add Parameter$/ }).click();
await page.waitForTimeout(300);
const rows = await page.locator('select[aria-label^="Parameter "][aria-label$=" type"]').count();
await page.locator(`select[aria-label="Parameter ${rows} type"]`).selectOption('OBJECT');
await page.waitForTimeout(400);

const paramJump = jumps.first();
const shownForParam = await paramJump.isVisible();
const paramHref = await paramJump.getAttribute('href');
const chosen = await page.locator(`select[aria-label^="Object for "]`).first().inputValue();
// One on this screen, and no more: the parameter's. Written as a count rather
// than as "at least one", so a stray second link here is still a failure.
const oneOnTheEditor = (await jumps.count()) === 1;

await page.screenshot({ path: shot('definition-jump.png') });

// Pressed, not merely present: a new tab, and the object's own editor in it.
const opened = context.waitForEvent('page');
await paramJump.click();
const tab = await opened;
await tab.waitForLoadState('domcontentloaded');
await tab.waitForTimeout(1200);
const landedOn = new URL(tab.url()).pathname;
const heading = (await tab.locator('h1').first().innerText().catch(() => '')).trim();

console.log(`links before any object field: ${before}`);
console.log(`parameter link href:           ${paramHref}`);
console.log(`object chosen in the select:   ${chosen}`);
console.log(`landed on:                     ${landedOn}`);
console.log(`that page's heading:           ${heading}`);

const quiet = before === 0;
const offered = shownForParam === true;
const points = paramHref === `/workspace/${WORKSPACE}/objects/${chosen}`;
const arrives = landedOn === `/workspace/${WORKSPACE}/objects/${chosen}` && heading !== '';
const newTab = context.pages().length === 2 && page.url().includes(`/functions/${FUNCTION}`);

/*
 * The second place a function names an object: its return type, which is on the
 * settings page now.
 *
 * Opened in a page of its own rather than by navigating this one. The parameter
 * added above has not been saved, so leaving would put the unsaved-work question
 * on screen - which is a different check's subject and would answer this one's
 * question with a dialog.
 */
const settings = await context.newPage();
await settings.goto(`${BASE}/workspace/${WORKSPACE}/functions/${FUNCTION}/settings`, {
  waitUntil: 'domcontentloaded',
});
await settings.waitForSelector('select[aria-label="Return type"]', { timeout: 20_000 });
const returnJumps = settings.locator('a[title="Opens the object\'s definition in a new tab"]');
const noneUntilNamed = (await returnJumps.count()) === 0;
await settings.locator('select[aria-label="Return type"]').selectOption('OBJECT');
await settings.waitForTimeout(400);
const returned = await settings.locator('select[aria-label="Returned object"]').inputValue();
const returnHref = await returnJumps.first().getAttribute('href');
await settings.screenshot({ path: shot('definition-jump-settings.png') });

console.log(`links on the settings page before: ${noneUntilNamed ? 0 : 'some'}`);
console.log(`return type link href:             ${returnHref}`);

const bothPlaces =
  oneOnTheEditor &&
  noneUntilNamed &&
  (await returnJumps.count()) === 1 &&
  returnHref === `/workspace/${WORKSPACE}/objects/${returned}`;

console.log(quiet ? 'PASS: no link while nothing names an object' : 'FAIL: shown with nothing to open');
console.log(offered ? 'PASS: offered beside the object parameter' : 'FAIL: not offered for a parameter');
console.log(
  bothPlaces
    ? "PASS: offered beside the returned object too, on the function's settings page"
    : 'FAIL: the return type on the settings page has none, or the editor grew a second',
);
console.log(points ? 'PASS: points at the chosen object' : 'FAIL: points elsewhere');
console.log(arrives ? "PASS: lands on that object's editor" : 'FAIL: landed somewhere else');
console.log(newTab ? 'PASS: a new tab, the editor left as it was' : 'FAIL: the editor was navigated away');

await finish(browser, quiet, offered, bothPlaces, points, arrives, newTab);
