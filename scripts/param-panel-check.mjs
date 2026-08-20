/**
 * The function editor's details panel, after three complaints about it.
 *
 * One: a parameter's box was made a column so its object selector could sit
 * inside it, and External Parameters wore the same class - so its remove button
 * left the line it belongs on and centred itself underneath. The two boxes now
 * have a class each.
 *
 * Two: the notched TYPE label was painted a colour that does not exist, over a
 * select that paints itself raised, so the word lay on a block instead of
 * breaking the outline. Checked by measuring, not by eye: the label's paint and
 * the select's paint have to be the same colour.
 *
 * Three: "Open definition ↗" is a link mark now, and a mark with no words has to
 * carry its name some other way.
 *
 * Temporary: delete once it has been looked at.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';
const FUNCTION = process.env.ORKNUX_FUNCTION ?? '29';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: 'alice', password: 'password' },
});
if (!signedIn.ok()) {
  console.error('sign-in failed');
  process.exit(1);
}

await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${FUNCTION}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Function Details', { timeout: 20_000 });
await page.waitForTimeout(1200);

// A parameter that names an object and an external, so both boxes are real.
await page.getByLabel('Parameter 1 type').selectOption('OBJECT');
await page.getByRole('button', { name: 'Add External' }).click();
await page.waitForTimeout(600);

/** The external's three controls, and whether they share a line. */
const external = page.locator('select[aria-label="External parameter 1"]');
const externalRow = external.locator('xpath=..');
const remove = page.getByRole('button', { name: 'Remove external parameter 1' });
const selectBox = await external.boundingBox();
const removeBox = await remove.boundingBox();
const rowBox = await externalRow.boundingBox();
const sameLine = Math.abs(
  (selectBox.y + selectBox.height / 2) - (removeBox.y + removeBox.height / 2),
) < 6;
// Beside it, not under it: a stacked row is more than twice a control's height.
const oneLine = rowBox.height < selectBox.height * 2;

console.log(`external row: ${rowBox.height.toFixed(0)}px tall, select centre ${(selectBox.y + selectBox.height / 2).toFixed(0)}, × centre ${(removeBox.y + removeBox.height / 2).toFixed(0)}`);
console.log(sameLine && oneLine ? 'PASS: the external × sits beside its fields' : 'FAIL: the external × is off its line');

/** The parameter's own box still holds its object selector inside it. */
const objectSelect = page.locator('select[aria-label^="Object for"]').first();
const paramBox = await page.locator('select[aria-label="Parameter 1 type"]')
  .locator('xpath=ancestor::div[contains(@class,"paramGroup")]').boundingBox();
const objectBox = await objectSelect.boundingBox();
const inside = objectBox.y > paramBox.y && objectBox.y + objectBox.height <= paramBox.y + paramBox.height + 1;
console.log(`object selector at ${objectBox.y.toFixed(0)}, box ${paramBox.y.toFixed(0)}..${(paramBox.y + paramBox.height).toFixed(0)}`);
console.log(inside ? 'PASS: the object selector is inside the parameter box' : 'FAIL: the object selector escaped its box');

/**
 * The notch. A label notched into an outline is painted the colour behind that
 * outline; if it does not match the control it lies across, it reads as a block
 * on top of the word — which is what "the select hides label" was.
 */
async function notchMatches(themed) {
  const paints = await page.evaluate(() => {
    const select = document.querySelector('select[aria-label="Parameter 1 type"]');
    const label = document.querySelector('label[for="param-type-0"]');
    return {
      label: getComputedStyle(label).backgroundColor,
      select: getComputedStyle(select).backgroundColor,
      z: getComputedStyle(label).zIndex,
    };
  });
  const matched = paints.label === paints.select && paints.label !== 'rgba(0, 0, 0, 0)';
  console.log(`${themed}: label notch ${paints.label}, select ${paints.select}`);
  console.log(matched ? `PASS: the notch matches the select it breaks (${themed})` : `FAIL: notch and select disagree (${themed})`);
  return matched;
}

const darkOk = await notchMatches('dark');
// The same measurement with the focus ring on it, which is the other state.
await page.getByLabel('Parameter 1 type').focus();
await page.waitForTimeout(200);
const focusedOk = await notchMatches('dark, focused');

await page.evaluate(() => {
  window.localStorage.setItem('orknux.theme', 'light');
  document.documentElement.setAttribute('data-theme', 'light');
});
await page.waitForTimeout(300);
const lightOk = await notchMatches('light');

/** The link mark: no words, but still a name and a tooltip. */
const jump = page.getByRole('link', { name: /^Open definition of/ }).first();
const named = await jump.getAttribute('aria-label');
const titled = await jump.getAttribute('title');
const words = (await jump.innerText()).trim();
console.log(`jump: text ${JSON.stringify(words)}, aria-label ${JSON.stringify(named)}, title ${JSON.stringify(titled)}`);
const marked = words === '' && (named ?? '') !== '' && (titled ?? '') !== '';
console.log(marked ? 'PASS: the link is a mark with a name' : 'FAIL: the link lost its name or kept its words');

await browser.close();
const ok = sameLine && oneLine && inside && darkOk && focusedOk && lightOk && marked;
process.exit(ok ? 0 : 1);
