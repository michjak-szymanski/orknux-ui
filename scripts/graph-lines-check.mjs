/**
 * Issue #259: the boxes are there and the lines between them are not.
 *
 * The third of the same family, and the one the first two left behind. #235 and
 * #242 were about a *node* React Flow had no measurement for, which it draws
 * with `visibility: hidden`; both were fixed by telling it how big a node is
 * before anything has measured one. That made the boxes appear and stopped
 * there, because a line is not drawn from a node's size - it is drawn from where
 * the node's handles are, which React Flow keeps in bookkeeping of its own and
 * carries across a rebuild only for a node whose object says `measured`. Replace
 * the node objects without it and `parseHandles` in @xyflow/system throws the
 * handle positions away; an edge whose node has none is not drawn at all.
 *
 * So the reported symptom is exact: every step on the canvas, no line between
 * any of them. It is intermittent for the reason the other two were - the
 * browser measures the boxes again on the next frame and the lines come back -
 * and it sticks when the rebuild lands in the same batch as the measurement that
 * did land, because then React never renders the state in between, the effect
 * that would observe the boxes again does not re-run, and the ResizeObserver has
 * no size change to report. These nodes are exactly as tall as the page says
 * they are, so there is no size change to fall back on.
 *
 * Waiting for the stuck version would be waiting for a race. What is driven here
 * is the thing the race is between, on both canvases: the frame in which the
 * lines are not drawn. Before the fix that frame happened on every single read
 * of a run and on every single Discard in the editor - thirty out of thirty and
 * six out of six on the machine this was written on - so it is watched every
 * animation frame rather than read once when the dust has settled.
 *
 * The count is taken from the run itself rather than from the canvas, because a
 * canvas that draws no lines at all would otherwise agree with itself. A run's
 * graph can name an edge whose source is not a step - a session's line is folded
 * into the agent it leads to before the engine sees it - so what is expected is
 * the edges whose two ends are both steps.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/* ----------------------------------------------------------------- fixture */

const { workspaceExecutions } = await graphql(
  `query($id: ID!) { workspaceExecutions(workspaceId: $id, page: 0, size: 25) { content { id } } }`,
  { id: WORKSPACE },
);

let runId = null;
let runLines = 0;
for (const candidate of workspaceExecutions.content) {
  const { execution } = await graphql(
    `query($id: ID!) { execution(id: $id) { id steps { key } edges { source target } } }`,
    { id: candidate.id },
  );
  const steps = new Set((execution?.steps ?? []).map((step) => step.key));
  const drawable = (execution?.edges ?? []).filter((edge) => steps.has(edge.source) && steps.has(edge.target));
  if (drawable.length > 0) {
    runId = candidate.id;
    runLines = drawable.length;
    break;
  }
}

if (runId === null) {
  record(false, 'no run in this workspace joins two of its steps, so there is no line to look at');
  await finish(browser);
}

/* ------------------------------------------------------------- the measure */

/** What is drawn, as the canvas would be photographed. */
const drawing = () =>
  page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const paths = [...document.querySelectorAll('.react-flow__edge-path')];
    return {
      nodes: nodes.length,
      hidden: nodes.filter((node) => getComputedStyle(node).visibility === 'hidden').length,
      lines: document.querySelectorAll('.react-flow__edge').length,
      // A path of no length is a line drawn nowhere, which counts as one drawn
      // everywhere except on the screen.
      drawn: paths.filter((path) => {
        try {
          return path.getTotalLength() > 1;
        } catch {
          return false;
        }
      }).length,
    };
  });

/*
 * Every animation frame, not every second: the gap this is about is one frame
 * wide when it recovers, and reading it after the fact would find nothing.
 */
const watch = () =>
  page.evaluate(() => {
    window.__lineFrames = [];
    const tick = () => {
      const nodes = [...document.querySelectorAll('.react-flow__node')];
      window.__lineFrames.push({
        nodes: nodes.length,
        hidden: nodes.filter((node) => getComputedStyle(node).visibility === 'hidden').length,
        lines: document.querySelectorAll('.react-flow__edge').length,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const from = () =>
  page.evaluate(() => {
    window.__lineFrom = window.__lineFrames.length;
  });

const since = () =>
  page.evaluate(() => {
    const frames = window.__lineFrames.slice(window.__lineFrom);
    return {
      frames: frames.length,
      ended: frames[frames.length - 1] ?? null,
      fewest: frames.reduce((least, frame) => Math.min(least, frame.lines), Infinity),
    };
  });

/* ------------------------------------------------------------- the run page */

console.log(`reading run #${runId}, which joins ${runLines} of its steps`);
await page.goto(`${BASE}/workspace/${WORKSPACE}/executions/${runId}`, { waitUntil: 'domcontentloaded' });
await page.locator('.react-flow__node').first().waitFor({ state: 'attached', timeout: 30_000 });
// Long enough for the late fit and for anything the load kicked off to land.
await page.waitForTimeout(1500);

const settled = await drawing();
record(
  settled.lines === runLines,
  `the run's graph draws a line for every step it joins (${settled.lines} of ${runLines})`,
);
record(
  settled.drawn === runLines,
  `and every one of them is a line with length rather than an empty path (${settled.drawn} of ${runLines})`,
);

await watch();

/** Three, because one could be luck; the failure it is watching for was every time. */
const READS = 3;
for (let read = 1; read <= READS; read += 1) {
  await from();
  await page.getByTitle('Reload this run').click();
  // The read, the re-render, and enough frames after it to see a recovery.
  await page.waitForTimeout(1500);

  const during = await since();
  record(during.frames > 0, `reading the run again: the canvas was watched while it happened (${during.frames} frames)`);
  record(
    during.fewest === runLines,
    `reading the run again never takes the lines off the canvas (read ${read}: fewest ${during.fewest} ` +
      `of ${runLines} drawn in any frame)`,
  );
  record(
    during.ended !== null && during.ended.lines === runLines && during.ended.hidden === 0,
    `and it ends with the whole graph drawn (read ${read}: ${JSON.stringify(during.ended)})`,
  );
}

/* -------------------------------------------------------------- the editor */

/*
 * The other canvas, where the same rebuild is Discard. Its nodes are resizable,
 * so what it hands back is the measurement React Flow already made rather than a
 * size of its own - a claim about a box's height that the box could contradict
 * is not worth making on a canvas where somebody can drag one taller.
 */
await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.locator('.react-flow__node').first().waitFor({ state: 'attached', timeout: 30_000 });
await page.waitForTimeout(1500);

const drawnGraph = await drawing();
record(drawnGraph.lines > 0, `the editor draws the saved workflow's lines (${drawnGraph.lines})`);
record(
  drawnGraph.drawn === drawnGraph.lines,
  `and every one of them has length (${drawnGraph.drawn} of ${drawnGraph.lines})`,
);

await watch();

const DISCARDS = 3;
for (let go = 1; go <= DISCARDS; go += 1) {
  await from();
  // The bar's Discard, then the dialog's - which is the same word, so they are
  // told apart by where they are rather than by what they say.
  await page.locator('button[data-tip^="Discard changes"]').click();
  await page.locator('dialog').getByRole('button', { name: 'Discard' }).click();
  await page.waitForTimeout(2000);

  const during = await since();
  record(during.frames > 0, `putting the graph back: the canvas was watched while it happened (${during.frames} frames)`);
  record(
    during.fewest === drawnGraph.lines,
    `Discard never takes the lines off the canvas (discard ${go}: fewest ${during.fewest} of ` +
      `${drawnGraph.lines} drawn in any frame)`,
  );
  record(
    during.ended !== null && during.ended.lines === drawnGraph.lines && during.ended.hidden === 0,
    `and it ends with the whole graph drawn (discard ${go}: ${JSON.stringify(during.ended)})`,
  );
}

await finish(browser);
