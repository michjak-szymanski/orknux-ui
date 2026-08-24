/**
 * Issue #242: the editor's graph, and the frame in which it is not drawn.
 *
 * The same defect as #235, on the other page that mounts a canvas. React Flow
 * draws a node it has no measurement for with `visibility: hidden`, and it
 * recognises the node it measured by the object: replace the node objects and
 * every measurement it holds goes with them. Normally the browser measures the
 * boxes again on the next frame and nobody sees the gap. When the replacement
 * lands in the same batch as the measurement that did land, React never renders
 * the state in between, the effect that would observe the boxes again never
 * re-runs, its ResizeObserver has no size change to report, and the nodes stay
 * hidden for as long as the page is open.
 *
 * The editor is not exposed everywhere the run page was. Its nodes carry
 * `measured` - React Flow writes it back through `onNodesChange` - so the paths
 * that rebuild the array by spreading what is there (undo, redo, add, duplicate,
 * the ports and panel effects) hand the measurement straight back. Only
 * `loadGraph` builds node objects out of the server's answer, and that is
 * opening the editor and pressing Discard.
 *
 * So Discard is what is driven. Waiting for the symptom would be waiting for a
 * race; what is asserted instead is the thing the race is between - the frame in
 * which the graph is not drawn, which happened on every single Discard before
 * this was fixed. Measured every animation frame, because when it recovers it
 * recovers within one.
 *
 * The other half is the size. These nodes are resizable, and a node somebody
 * widened by hand must not be shrunk back to the minimum by a fix that tells
 * React Flow how big an unmeasured node is. So one is dragged wider and taller
 * and then measured, and it has to still be the size it was dragged to.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, {
  waitUntil: 'domcontentloaded',
});
await page.locator('.react-flow__node').first().waitFor({ state: 'attached', timeout: 30_000 });
// Long enough for the fit and for anything the load kicked off to land.
await page.waitForTimeout(1500);

/** What is drawn, as the canvas would be photographed. */
const drawing = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('.react-flow');
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const card = canvas?.getBoundingClientRect() ?? null;
    const inside = (node) => {
      const box = node.getBoundingClientRect();
      return (
        card !== null &&
        box.width > 0 &&
        box.height > 0 &&
        box.right > card.left &&
        box.left < card.right &&
        box.bottom > card.top &&
        box.top < card.bottom
      );
    };
    return {
      nodes: nodes.length,
      hidden: nodes.filter((node) => getComputedStyle(node).visibility === 'hidden').length,
      inside: nodes.filter(inside).length,
    };
  });

const settled = await drawing();
record(settled.nodes > 0, `the editor draws the saved graph (${settled.nodes} nodes)`);
record(settled.hidden === 0, `every node is drawn once the page has settled (${settled.hidden} hidden)`);
record(
  settled.inside > 0,
  `the graph is framed inside its canvas rather than off the side of it ` +
    `(${settled.inside} of ${settled.nodes} in view)`,
);

/* --------------------------------------------------- a node somebody widened */

/*
 * `offsetWidth`, not the bounding box: the canvas is scaled by whatever zoom the
 * fit chose, and the number that matters here is the one React Flow and the
 * stylesheet are arguing about, which is in graph units.
 */
const sizeOfFirst = () =>
  page.evaluate(() => {
    const node = document.querySelector('.react-flow__node');
    if (node === null) return null;
    return {
      width: node.offsetWidth,
      height: node.offsetHeight,
      // What React Flow put on the element itself, as opposed to what the
      // stylesheet worked out. Empty until the node carries a size of its own.
      inlineWidth: node.style.width || null,
      inlineHeight: node.style.height || null,
    };
  });

const asDrawn = await sizeOfFirst();
console.log(`the first node as the graph holds it: ${JSON.stringify(asDrawn)}`);

const first = page.locator('.react-flow__node').first();
await first.click();
await page.waitForTimeout(400);

/*
 * The corner control the resizer draws on a selected node. Dragged rather than
 * set, because the point is to leave the node in the state a person's hand
 * leaves it in - `width` and `height` on the node object - and only the resizer
 * puts them there.
 */
const corner = page.locator('.react-flow__resize-control.handle.bottom.right').first();
const grip = await corner.boundingBox();

let dragged = null;
if (grip === null) {
  record(false, 'the selected node offers a bottom-right resize control');
} else {
  record(true, 'the selected node offers a bottom-right resize control');
  const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 160, from.y + 80, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  dragged = await sizeOfFirst();
  console.log(`the same node after dragging its corner: ${JSON.stringify(dragged)}`);

  record(
    dragged !== null && dragged.width > asDrawn.width && dragged.height > asDrawn.height,
    `dragging the corner makes the node bigger (${asDrawn.width}x${asDrawn.height} → ` +
      `${dragged?.width}x${dragged?.height})`,
  );
  /*
   * The size a fix for the blanking is tempted to pin every node to is the
   * minimum the stylesheet and the resizer both name - 220 by 96. A node that
   * has been given a size of its own has to beat it, or the cure has taken the
   * resize handles away from everybody who used them.
   */
  record(
    dragged !== null && dragged.width > 220 && dragged.height > 96,
    `and the size it was dragged to is what it keeps, not the 220x96 minimum ` +
      `(${dragged?.width}x${dragged?.height}, inline ${dragged?.inlineWidth}x${dragged?.inlineHeight})`,
  );

  /*
   * And it survives the re-render that a change of selection replaces the node
   * objects for, which is the shape of the wipe without the load behind it.
   *
   * Which node is selected next has to be worked out rather than counted to,
   * because the drag above has just made the first node bigger: on a narrower
   * fit it now covers its neighbour, and clicking a covered node waits thirty
   * seconds for a box that is never going to be on top. So the next node is one
   * whose box is clear of the one that grew, clicked where it is rather than
   * where the list says it is.
   */
  const elsewhere = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    if (nodes.length < 2) return null;
    const grown = nodes[0].getBoundingClientRect();
    for (const node of nodes.slice(1)) {
      const box = node.getBoundingClientRect();
      const covered =
        box.left < grown.right &&
        box.right > grown.left &&
        box.top < grown.bottom &&
        box.bottom > grown.top;
      if (!covered) return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return null;
  });

  if (elsewhere !== null) {
    await page.mouse.click(elsewhere.x, elsewhere.y);
    await page.waitForTimeout(400);
    const still = await sizeOfFirst();
    record(
      still !== null && still.width === dragged.width && still.height === dragged.height,
      `and it is still that size after the canvas has been re-rendered around it ` +
        `(${still?.width}x${still?.height})`,
    );
  } else {
    console.log('no node was clear of the one that grew, so the re-render was not driven here');
  }
}

/* ------------------------------------------------------ putting the graph back */

/*
 * Every animation frame, not every second: the gap this is about is one frame
 * wide when it recovers, and reading it after the fact would find nothing.
 */
await page.evaluate(() => {
  window.__graphFrames = [];
  const tick = () => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    window.__graphFrames.push({
      nodes: nodes.length,
      hidden: nodes.filter((node) => getComputedStyle(node).visibility === 'hidden').length,
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

/** Three, because one could be luck; the failure it is watching for was every time. */
const DISCARDS = 3;
for (let go = 1; go <= DISCARDS; go += 1) {
  await page.evaluate(() => {
    window.__graphFrom = window.__graphFrames.length;
  });

  // The bar's Discard, then the dialog's - which is the same word, so they are
  // told apart by where they are rather than by what they say.
  await page.locator('button[data-tip^="Discard changes"]').click();
  await page.locator('dialog').getByRole('button', { name: 'Discard' }).click();
  // The read, the re-render, and enough frames after it to see a recovery.
  await page.waitForTimeout(2000);

  const during = await page.evaluate(() => {
    const frames = window.__graphFrames.slice(window.__graphFrom);
    return {
      frames: frames.length,
      blanked: frames.filter((frame) => frame.hidden > 0).length,
      worst: frames.reduce((most, frame) => Math.max(most, frame.hidden), 0),
      ended: frames[frames.length - 1] ?? null,
    };
  });

  record(
    during.frames > 0,
    `putting the graph back: the canvas was watched while it happened (${during.frames} frames)`,
  );
  record(
    during.blanked === 0,
    `Discard does not blank the graph (discard ${go}: ${during.blanked} of ${during.frames} frames ` +
      `drew nothing, worst ${during.worst} nodes hidden at once)`,
  );
  record(
    during.ended !== null && during.ended.hidden === 0 && during.ended.nodes === settled.nodes,
    `Discard leaves every node on the canvas (discard ${go}: ${JSON.stringify(during.ended)})`,
  );
}

await finish(browser);
