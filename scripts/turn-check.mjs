/**
 * Turning a node from the canvas rather than from the panel.
 *
 * R has always turned the selected node and the details panel has always had a
 * button, but neither is in view when somebody is looking at the shape of a
 * graph. This checks the control appears on the selected node, that pressing it
 * turns the node, and that R still does the same thing through the same path.
 *
 * It is now a square in the node's top-right corner rather than a labelled
 * button on a bar above the node, so where it sits is part of what is measured:
 * inside the node's own box, in the top-right quarter of it, and the thing a
 * press at its middle actually lands on. That last one is the assertion worth
 * having - a corner is also where the resizer puts a control and where a node
 * facing one way puts a handle, and an icon underneath either of those is a
 * control nobody can press however good it looks in a screenshot.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, shot, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(1000);

/*
 * Found by its title rather than by its words, since it no longer has any. The
 * panel's button carries the same sentence without the facing on the end, which
 * is what keeps these two apart - and what the panel's own selector below
 * depends on.
 */
const onCanvas = () => page.locator('.react-flow__node button[title^="Turn the node (R) —"]').first();

const beforeSelecting = await onCanvas().isVisible().catch(() => false);

const node = page.locator('.react-flow__node').first();
await node.click();
await page.waitForTimeout(600);

const appears = await onCanvas().isVisible();
// The panel names the way the node faces, which is how the turn is read back.
// Found by the button beside it - the icon field alongside wears the same class.
const facing = page.locator('div:has(> button[title="Turn the node (R)"]) > span').first();
const first = (await facing.innerText()).trim();

/* ------------------------------------------------- where the corner control is */

if (appears) {
  const box = await onCanvas().boundingBox();
  const around = await node.boundingBox();
  const inside =
    box.x >= around.x &&
    box.y >= around.y &&
    box.x + box.width <= around.x + around.width &&
    box.y + box.height <= around.y + around.height;
  // The top-right quarter: right of the node's middle, above it.
  const corner = box.x >= around.x + around.width / 2 && box.y + box.height <= around.y + around.height / 2;
  console.log(
    `the node is ${around.width.toFixed(0)}x${around.height.toFixed(0)} and the control is ` +
      `${box.width.toFixed(0)}x${box.height.toFixed(0)}, ` +
      `${(around.x + around.width - (box.x + box.width)).toFixed(0)}px from its right edge and ` +
      `${(box.y - around.y).toFixed(0)}px from its top`,
  );
  record(inside, 'the turn control is inside the node rather than standing off it');
  record(corner, "and in the node's top-right corner");
  record(box.width <= 28 && box.height <= 28, `and small (${box.width.toFixed(0)}x${box.height.toFixed(0)})`);

  /*
   * And nothing is over it. A press goes to whatever is on top, so this asks the
   * page what that is at the middle of the control: a resize handle or a node
   * handle winning here is the failure this whole assertion exists for.
   */
  const under = await page.evaluate(({ x, y }) => {
    const on = document.elementFromPoint(x, y);
    if (on === null) return 'nothing';
    const button = on.closest('button');
    return button === null
      ? `${on.tagName.toLowerCase()}[${on.getAttribute('class') ?? '-'}]`
      : `button[title=${JSON.stringify(button.getAttribute('title'))}]`;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  console.log(`what a press at its middle lands on: ${under}`);
  record(under.startsWith('button[title="Turn the node (R) —'), 'and a press at its middle lands on it');

  // The name a screen reader reads, since the glyph says nothing at all.
  const named = await onCanvas().getAttribute('aria-label');
  console.log(`its accessible name: ${JSON.stringify(named)}`);
  record(
    (named ?? '').startsWith('Turn the node (R)'),
    'it says what it is and which key does the same, for a reader that cannot see it',
  );
}

/* -------------------------------------------------- and it still does the turn */

await onCanvas().click();
await page.waitForTimeout(400);
const afterClick = (await facing.innerText()).trim();

await page.locator('.react-flow__pane').press('r');
await page.waitForTimeout(400);
const afterKey = (await facing.innerText()).trim();

await page.screenshot({ path: shot('turn-node.png') });

console.log(`before selecting anything: ${beforeSelecting ? 'shown' : 'not shown'}`);
console.log(`on the selected node:      ${appears ? 'shown' : 'not shown'}`);
console.log(`facing: ${first} -> click -> ${afterClick} -> R -> ${afterKey}`);

const quiet = beforeSelecting === false;
const offered = appears === true;
const clickTurns = afterClick !== first;
const keyTurns = afterKey !== afterClick;
console.log(quiet ? 'PASS: nothing on an unselected node' : 'FAIL: shown without a selection');
console.log(offered ? 'PASS: offered on the selected node' : 'FAIL: not offered');
console.log(clickTurns ? 'PASS: the button turns it' : 'FAIL: the button did nothing');
console.log(keyTurns ? 'PASS: R still turns it' : 'FAIL: R stopped working');

await finish(browser, quiet, offered, clickTurns, keyTurns);
