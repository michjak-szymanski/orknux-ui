/**
 * Jumping from a function's object parameter to the object's definition.
 *
 * Issue #93 asked for a way out to variables and then asked the same of object
 * definitions. This starts where a person would - in the function editor, giving
 * a parameter an object type - presses the link that appears, and checks the tab
 * it opens is that object's editor.
 *
 * Temporary: delete once it has been looked at.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';
const FUNCTION = process.env.ORKNUX_FUNCTION ?? '28';

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

// The return type wants one too, and is the second place this panel names an object.
await page.locator('select[aria-label="Return type"]').selectOption('OBJECT');
await page.waitForTimeout(400);
const shownForReturn = (await jumps.count()) === 2;

await page.screenshot({ path: 'definition-jump.png' });

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
const bothPlaces = shownForReturn === true;
const points = paramHref === `/workspace/${WORKSPACE}/objects/${chosen}`;
const arrives = landedOn === `/workspace/${WORKSPACE}/objects/${chosen}` && heading !== '';
const newTab = context.pages().length === 2 && page.url().includes(`/functions/${FUNCTION}`);

console.log(quiet ? 'PASS: no link while nothing names an object' : 'FAIL: shown with nothing to open');
console.log(offered ? 'PASS: offered beside the object parameter' : 'FAIL: not offered for a parameter');
console.log(bothPlaces ? 'PASS: offered beside the returned object too' : 'FAIL: return type has none');
console.log(points ? 'PASS: points at the chosen object' : 'FAIL: points elsewhere');
console.log(arrives ? "PASS: lands on that object's editor" : 'FAIL: landed somewhere else');
console.log(newTab ? 'PASS: a new tab, the editor left as it was' : 'FAIL: the editor was navigated away');

await browser.close();
process.exit(quiet && offered && bothPlaces && points && arrives && newTab ? 0 : 1);
