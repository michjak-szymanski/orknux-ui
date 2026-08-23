/**
 * Turning a node from the canvas rather than from the panel.
 *
 * R has always turned the selected node and the details panel has always had a
 * button, but neither is in view when somebody is looking at the shape of a
 * graph. This checks the control appears on the selected node, that pressing it
 * turns the node, and that R still does the same thing through the same path.
 *
 * It is a small square at the node's top-right corner rather than a labelled
 * button on a bar above the node, so where it sits is part of what is measured.
 * It sat *inside* that corner until it was reported: over the node's own first
 * line, wearing a two-arrow glyph that reads as refresh. It now floats just
 * outside the corner, and what is measured is the whole of that claim - outside
 * the node's border box on both axes, close enough to still belong to it, clear
 * of the resizer's corner control, and the thing a press at its middle actually
 * lands on. That last one is the assertion worth having: a corner is also where
 * the resizer puts a control and where a node facing one way puts a handle, and
 * an icon underneath either of those is a control nobody can press however good
 * it looks in a screenshot.
 *
 * And the glyph, by file name. A single circular arrow is "rotate"; the two
 * chasing arrows this used to wear are "refresh", which on a control drawn over
 * a node is a fair guess at "reload this node" - a wrong guess about a button
 * that changes the shape of the graph.
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

  const right = around.x + around.width;
  const bottom = around.y + around.height;
  console.log(
    `the node's border box: ${around.x.toFixed(0)},${around.y.toFixed(0)} ` +
      `${around.width.toFixed(0)}x${around.height.toFixed(0)} (right edge ${right.toFixed(0)}, top ${around.y.toFixed(0)})`,
  );
  console.log(
    `the turn control:      ${box.x.toFixed(0)},${box.y.toFixed(0)} ${box.width.toFixed(0)}x${box.height.toFixed(0)} ` +
      `(${(box.x - right).toFixed(0)}px right of the node, ${(around.y - (box.y + box.height)).toFixed(0)}px above it)`,
  );

  /*
   * Outside, and outside on both axes rather than merely poking over one edge.
   * "In the corner but outside the node" is the whole of what was asked for, and
   * a control that hangs over the top edge while still standing on the node's
   * own width is the thing it was asked to stop being.
   */
  const clear = box.x >= right && box.y + box.height <= around.y;
  record(clear, "the turn control is outside the node's border box, past its top-right corner");

  /*
   * And still the node's. Twenty-four pixels of gap on either axis is about a
   * button's width; further than that and it stops reading as belonging to the
   * node it acts on, which is the failure in the other direction.
   */
  const gap = Math.max(box.x - right, around.y - (box.y + box.height));
  record(gap <= 24, `and floats just beyond it rather than away from it (${gap.toFixed(0)}px)`);
  record(box.width <= 28 && box.height <= 28, `and is small (${box.width.toFixed(0)}x${box.height.toFixed(0)})`);

  /*
   * Clear of the selection handles. The resizer draws one at each corner of a
   * selected node, and the top-right one is centred on exactly the corner this
   * button is measured from - so this is the collision that was actually
   * possible, and the reason the offset is eight pixels rather than two.
   */
  const handles = await page.locator('.react-flow__resize-control.handle').all();
  const overlapping = [];
  for (const handle of handles) {
    const at = await handle.boundingBox();
    if (at === null) continue;
    const apart =
      at.x + at.width <= box.x || at.x >= box.x + box.width || at.y + at.height <= box.y || at.y >= box.y + box.height;
    if (!apart) overlapping.push(`${at.x.toFixed(0)},${at.y.toFixed(0)} ${at.width}x${at.height}`);
  }
  console.log(`${handles.length} selection handles, ${overlapping.length} of them over the control`);
  record(handles.length > 0, 'the selected node has its resize handles');
  record(overlapping.length === 0, 'and not one of them lies over the turn control');

  /*
   * And nothing else is over it, and nothing has clipped it away. A press goes
   * to whatever is on top, so this asks the page what that is - once at the
   * middle of the control and once at its far corner, which is the first part
   * an ancestor with `overflow: hidden` would take off a child hung outside the
   * box. A resize handle or a neighbouring node winning either is the failure
   * this whole section exists for.
   */
  const landsOn = async (x, y) =>
    page.evaluate(({ x, y }) => {
      const on = document.elementFromPoint(x, y);
      if (on === null) return 'nothing';
      const button = on.closest('button');
      return button === null
        ? `${on.tagName.toLowerCase()}[${on.getAttribute('class') ?? '-'}]`
        : `button[title=${JSON.stringify(button.getAttribute('title'))}]`;
    }, { x, y });

  const middle = await landsOn(box.x + box.width / 2, box.y + box.height / 2);
  const far = await landsOn(box.x + box.width - 2, box.y + 2);
  console.log(`what a press lands on: ${middle} at its middle, ${far} at its outer corner`);
  record(middle.startsWith('button[title="Turn the node (R) —'), 'a press at its middle lands on it');
  record(far.startsWith('button[title="Turn the node (R) —'), 'and its outer corner is drawn rather than clipped away');

  /*
   * The glyph. By file name, because that is the only thing about an icon a
   * check can read and be sure of - and because the report was precisely that
   * the file was the wrong one: refresh-cw, two arrows chasing each other, where
   * a single circular arrow was meant.
   */
  const glyph = await onCanvas().locator('img').getAttribute('src');
  console.log(`its glyph: ${glyph}`);
  record(/rotate/.test(glyph ?? ''), 'the glyph is a rotate icon');
  record(!/refresh|sync/.test(glyph ?? ''), 'and not the refresh one it used to wear');

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
