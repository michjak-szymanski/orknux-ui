/**
 * Drives the node editor the way the bug reports described it.
 *
 * One: typing in an object field's name used to remount the input on every
 * keystroke — the list was keyed by the name being edited — so focus was lost,
 * and the next Backspace reached the canvas, where it deleted the selected node.
 *
 * Two: editing a node used to replace its data wholesale, dropping the ports the
 * server had worked out, so a field vanished from the node until a save.
 */
import { BASE, WORKSPACE, WORKFLOW, open, finish } from './suite/harness.mjs';

const WATCHED = 'Reply in the thread';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });

/** The ports a node draws, read off the canvas rather than out of the store. */
async function portsOf(selector) {
  const texts = await page.locator(selector).allInnerTexts();
  const node = texts[0];
  if (node === undefined) return null;
  return node
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => ['llmResult', 'channel', 'ts'].includes(line));
}

// The node itself, before and after — selected, because editing the name
// changes the text it would otherwise be found by.
const watched = page.locator('.react-flow__node').filter({ hasText: WATCHED }).first();
await watched.click();
await page.waitForTimeout(500);
const portsBefore = await portsOf('.react-flow__node.selected');
await page.getByLabel('Node name').click();
await page.keyboard.type('!', { delay: 50 });
// Longer than the preview's debounce, so its answer has landed.
await page.waitForTimeout(1500);
const portsAfter = await portsOf('.react-flow__node.selected');

console.log(`ports before the edit: ${JSON.stringify(portsBefore)}`);
console.log(`ports after the edit:  ${JSON.stringify(portsAfter)}`);
const kept = portsBefore !== null && portsBefore.length > 0 && portsAfter?.length === portsBefore.length;
console.log(kept ? 'PASS - the ports stayed' : 'FAIL - editing dropped the ports');

const nodesBefore = await page.locator('.react-flow__node').count();
await page.getByRole('button', { name: 'Object', exact: true }).click();
await page.waitForTimeout(800);
const withObject = await page.locator('.react-flow__node').count();

await page.getByRole('button', { name: '+ Add field' }).click();
await page.waitForTimeout(400);
const field = page.getByLabel('Name of field 1');
await field.click();
await field.fill('');
await field.type('customer', { delay: 40 });
for (let press = 0; press < 5; press += 1) {
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
}

const nodesAfter = await page.locator('.react-flow__node').count();
const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '<not an input>');
const reads = await field.inputValue().catch(() => '<the input is gone>');

console.log(`\nnodes: ${nodesBefore}, ${withObject} after adding one, ${nodesAfter} after typing`);
console.log(`field now reads:       ${reads}`);
console.log(`focus stayed on:       ${focused}`);
const survived = nodesAfter === withObject;
console.log(survived ? 'PASS - the node survived' : 'FAIL - a node was deleted while typing');

await finish(browser, kept, survived);
