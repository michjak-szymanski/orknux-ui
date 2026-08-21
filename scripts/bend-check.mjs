/**
 * Drags a line's bend handle and measures whether the line went where it was put.
 *
 * The bend used to be drawn as two half-beziers meeting at the point, each
 * forced to leave and arrive horizontally, so touching a nearly straight line
 * snapped it into a wide S and a pixel of drag moved it much further than a
 * pixel. This drags by a known amount and checks the handle travelled exactly
 * that far, and that the line is one curve rather than two.
 */
import { BASE, WORKSPACE, WORKFLOW, open, finish } from './suite/harness.mjs';

const BY = { x: 120, y: -80 };

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(1000);

// A bare line is dragged by its handle and a labelled one by its label, and
// both are the same drag - so whichever this graph has will do.
const bare = page.getByLabel('Bend this line').first();
const handle = (await bare.count()) > 0 ? bare : page.locator('[data-edge]').first();
if ((await handle.count()) === 0) {
  console.error('no line on this graph to bend');
  process.exit(1);
}

const centreOf = async (locator) => {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const before = await centreOf(handle);
await page.mouse.move(before.x, before.y);
await page.mouse.down();
// In steps, because a single jump would not catch a handler that reads the
// pointer's position rather than its travel since the drag began.
await page.mouse.move(before.x + BY.x / 2, before.y + BY.y / 2, { steps: 10 });
await page.mouse.move(before.x + BY.x, before.y + BY.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);

const after = await centreOf(handle);
const travelled = { x: after.x - before.x, y: after.y - before.y };
const off = Math.max(Math.abs(travelled.x - BY.x), Math.abs(travelled.y - BY.y));

const edge = await page
  .locator('.react-flow__edge-path')
  .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')).find((d) => d?.includes('Q')) ?? '');

console.log(`dragged by:   ${JSON.stringify(BY)}`);
console.log(`handle moved: ${JSON.stringify(travelled)}`);
console.log(`worst axis is off by ${off.toFixed(1)}px`);
console.log(`the bent line is: ${edge.slice(0, 70)}`);

const follows = off <= 1.5;
const oneCurve = edge.startsWith('M') && (edge.match(/[CQ]/g) ?? []).length === 1;
console.log(follows ? 'PASS: the line follows the pointer' : 'FAIL: the line does not follow the pointer');
console.log(oneCurve ? 'PASS: one curve through the point' : 'FAIL: still more than one curve');

await finish(browser, follows, oneCurve);
