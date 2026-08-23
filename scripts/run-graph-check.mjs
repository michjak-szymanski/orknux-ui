/**
 * Issue #235: the run's graph, drawn as an empty card.
 *
 * React Flow gives a node it has no measurement for `visibility: hidden`, and it
 * throws every measurement away whenever the node objects are replaced. This
 * page builds its node objects out of the answer to the run query, so every read
 * of the run replaces all of them - and every read therefore blanks the whole
 * graph until the browser has measured the boxes again. Usually that is the next
 * frame and nobody sees it. When the read lands in the same batch as the
 * measurement it did land, React never renders the state in between, the effect
 * that would observe the boxes again does not re-run, and the ResizeObserver has
 * no size change to report: the nodes stay hidden until the page is reloaded.
 *
 * Which is why the reported symptom - sometimes empty on load - is not what is
 * driven here. Waiting for it would be waiting for a race to fall the wrong way,
 * and it fell that way twice in twenty cold loads on the machine this was
 * written on. The order is forced instead: the page is left to settle, so every
 * node is measured and drawn, and then the run is read again with the Refresh
 * control. On the code this was written against that blanked all four nodes for
 * a frame, ten times out of ten. A frame in which the graph is not drawn is the
 * bug whether or not the frame after it recovers, so that is what is asserted -
 * measured every animation frame, not sampled once when it is over.
 *
 * The other half is what the reader actually complained about: a graph that is
 * on the screen. Both ends are checked - that the nodes are visible once the
 * page has settled, and that they are inside the card rather than framed off the
 * side of it, which is the other way this card has been empty.
 *
 * The fixture is one run with steps in it, found rather than made: starting a
 * run needs a model, and the seed already starts several.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/* ----------------------------------------------------------------- fixture */

/**
 * A run whose graph has something in it.
 *
 * A run with no steps recorded draws a sentence instead of a canvas, and every
 * assertion below would pass on it having looked at nothing.
 */
const { workspaceExecutions } = await graphql(
  `query($id: ID!) { workspaceExecutions(workspaceId: $id, page: 0, size: 25) { content { id } } }`,
  { id: WORKSPACE },
);

let runId = null;
for (const candidate of workspaceExecutions.content) {
  const { execution } = await graphql(`query($id: ID!) { execution(id: $id) { id steps { key } } }`, {
    id: candidate.id,
  });
  if ((execution?.steps ?? []).length > 0) {
    runId = candidate.id;
    break;
  }
}

if (runId === null) {
  record(false, 'no run in this workspace recorded any step, so there is no graph to look at');
  await finish(browser);
}

console.log(`reading run #${runId}`);
await page.goto(`${BASE}/workspace/${WORKSPACE}/executions/${runId}`, { waitUntil: 'domcontentloaded' });
await page.locator('.react-flow__node').first().waitFor({ state: 'attached', timeout: 30_000 });
// Long enough for the late fit and for anything the load kicked off to land.
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
record(settled.nodes > 0, `the run's graph draws its steps (${settled.nodes} nodes)`);
record(settled.hidden === 0, `every step is drawn once the page has settled (${settled.hidden} hidden)`);
record(
  settled.inside > 0,
  `the graph is framed inside its card rather than off the side of it (${settled.inside} of ${settled.nodes} in view)`,
);

/* ------------------------------------------------- reading the run again */

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
const READS = 3;
for (let read = 1; read <= READS; read += 1) {
  await page.evaluate(() => {
    window.__graphFrom = window.__graphFrames.length;
  });

  await page.getByTitle('Reload this run').click();
  // The read, the re-render, and enough frames after it to see a recovery.
  await page.waitForTimeout(1500);

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
    `reading the run again: the canvas was watched while it happened (${during.frames} frames)`,
  );
  record(
    during.blanked === 0,
    `reading the run again does not blank the graph (read ${read}: ${during.blanked} of ${during.frames} frames ` +
      `drew nothing, worst ${during.worst} nodes hidden at once)`,
  );
  record(
    during.ended !== null && during.ended.hidden === 0 && during.ended.nodes === settled.nodes,
    `reading the run again leaves every step on the canvas (read ${read}: ${JSON.stringify(during.ended)})`,
  );
}

await finish(browser);
