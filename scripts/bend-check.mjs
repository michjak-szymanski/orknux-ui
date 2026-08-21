/**
 * Drags a line's bend handles and measures whether the line went where it was put.
 *
 * The bend used to be drawn as two half-beziers meeting at the point, each
 * forced to leave and arrive horizontally, so touching a nearly straight line
 * snapped it into a wide S and a pixel of drag moved it much further than a
 * pixel. This drags by a known amount and checks the handle travelled exactly
 * that far - and that a line with one point on it is still the one curve that
 * fix settled on.
 *
 * A line can now be pulled through more than one point, so the rest of it is
 * about what that added: a point put on by double-clicking the line, every
 * point dragged with the same one-to-one travel as the first, a curve that
 * passes through all of them without a corner anywhere, and a point taken off
 * again by double-clicking it. Where the points are is the browser's own
 * arrangement of its own view - it is not part of the graph the server keeps -
 * so the round trip that has to hold is a reload.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, finish } from './suite/harness.mjs';

/** Where the arrangement is kept. Named here because this check reads it. */
const STORE = `orknux.edge-labels.${WORKFLOW}`;

/** How far each point is dragged. Different for each, so none can stand in for another. */
const DRAGS = [
  { x: 120, y: -80 },
  { x: -70, y: -110 },
  { x: 40, y: 95 },
];

/** How far off a measurement may be and still count as exact. */
const EXACT = 1.5;

/**
 * How far, in degrees, the line may change direction where two of its stretches
 * meet.
 *
 * This is the whole difference between a curve and a polyline, so it is
 * measured at the joins themselves rather than by sampling: the direction the
 * line arrives at a point against the direction it leaves by. Sampling cannot
 * tell a corner from a legitimately tight turn - two points dragged close
 * together make a curve that turns fifty degrees between samples and is
 * perfectly smooth - but a corner is a change of direction at the join and
 * nowhere else, and that is exactly what this reads.
 */
const NO_CORNER = 3;

/** The sharpest change of direction where two of a path's stretches meet. */
function joinsIn(d) {
  const stretches = [...(d ?? '').matchAll(/[CQ][^CQMZ]+/g)].map((one) =>
    (one[0].match(/-?\d+(\.\d+)?/g) ?? []).map(Number),
  );
  const start = ((d ?? '').match(/M(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/) ?? []).slice(1);
  let from = { x: Number(start[0]), y: Number(start[2]) };
  let worst = 0;
  let leaving = null;
  stretches.forEach((numbers) => {
    // A quadratic has one control point and a cubic two; either way the last
    // pair is where the stretch ends and the pair before it aims into that end.
    const to = { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] };
    const out = { x: numbers[0] - from.x, y: numbers[1] - from.y };
    const into = { x: to.x - numbers[numbers.length - 4], y: to.y - numbers[numbers.length - 3] };
    if (leaving !== null) {
      const turn = Math.abs(
        ((Math.atan2(out.y, out.x) - Math.atan2(leaving.y, leaving.x) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
      );
      worst = Math.max(worst, (turn * 180) / Math.PI);
    }
    leaving = into;
    from = to;
  });
  return worst;
}

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(1000);

/*
 * Which line to work on.
 *
 * A bare line is dragged by its handle and a labelled one by its label, and
 * both are the same drag - so either will do. What is not interchangeable is
 * how much of a line is in the open: a point is put on by double-clicking the
 * line, and on a graph this dense most lines spend most of their length under
 * a node or their own label, where a double-click lands on that instead. So
 * the line with the most of itself uncovered is the one measured here, which
 * also keeps this check off the fixture's exact geometry.
 */
const edgeId = await page.evaluate(() => {
  const openness = [...document.querySelectorAll('[data-edge][data-point]')].map((handle) => {
    const id = handle.getAttribute('data-edge');
    const path = document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
    const line = path.parentElement.querySelector('path.nopan');
    const length = path.getTotalLength();
    let open = 0;
    for (let step = 0; step <= 20; step += 1) {
      const spot = path.getPointAtLength(length * (0.05 + (0.9 * step) / 20)).matrixTransform(path.getScreenCTM());
      if (document.elementFromPoint(spot.x, spot.y) === line) open += 1;
    }
    return { id, open };
  });
  return openness.sort((one, other) => other.open - one.open)[0]?.id ?? null;
});
if (edgeId === null) {
  record(false, 'no line on this graph to bend');
  await finish(browser);
}
console.log(`working on the line ${edgeId}`);
/** One point's handle, whether it is a dot or the label standing in for it. */
const point = (at) => page.locator(`[data-edge="${edgeId}"][data-point="${at}"]`);
const points = () => page.locator(`[data-edge="${edgeId}"][data-point]`).count();

const centreOf = async (locator) => {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/**
 * The drawn line, measured rather than read.
 *
 * Sampled off the path element itself and put back into screen coordinates, so
 * what comes back can be compared with where the handles are: how far the line
 * turns at its sharpest, how far it runs from each handle, and how far along it
 * each handle sits.
 */
const shapeOf = (centres) =>
  page.evaluate(
    ({ id, centres: on }) => {
      const path = document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
      if (path === null) return null;
      const matrix = path.getScreenCTM();
      const length = path.getTotalLength();
      const steps = 240;
      const drawn = [];
      for (let at = 0; at <= steps; at += 1) {
        const spot = path.getPointAtLength((length * at) / steps).matrixTransform(matrix);
        drawn.push({ x: spot.x, y: spot.y });
      }

      let corner = 0;
      for (let at = 1; at < drawn.length - 1; at += 1) {
        const back = { x: drawn[at].x - drawn[at - 1].x, y: drawn[at].y - drawn[at - 1].y };
        const on2 = { x: drawn[at + 1].x - drawn[at].x, y: drawn[at + 1].y - drawn[at].y };
        const turn = Math.abs(
          (Math.atan2(on2.y, on2.x) - Math.atan2(back.y, back.x) + 3 * Math.PI) % (2 * Math.PI) - Math.PI,
        );
        corner = Math.max(corner, (turn * 180) / Math.PI);
      }

      const found = on.map((centre) => {
        let away = Infinity;
        let along = 0;
        drawn.forEach((spot, at) => {
          const gap = Math.hypot(spot.x - centre.x, spot.y - centre.y);
          if (gap < away) {
            away = gap;
            along = at / (drawn.length - 1);
          }
        });
        return { away, along };
      });

      return { d: path.getAttribute('d'), corner, found };
    },
    { id: edgeId, centres },
  );

/**
 * A place on the drawn line, in screen coordinates, that nothing is covering.
 *
 * A line runs over nodes and under its own label, and a double-click landing on
 * one of those is a double-click on that instead. So the spot is chosen by
 * asking the page what is on top at each of twenty places along the stretch
 * asked for, rather than by picking a fraction and hoping.
 */
const spotOn = (target) =>
  page.evaluate(
    ({ id, target: wanted }) => {
      const path = document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
      const line = path.parentElement.querySelector('path.nopan');
      const length = path.getTotalLength();
      let best = null;
      for (let step = 0; step <= 40; step += 1) {
        const fraction = 0.05 + (0.9 * step) / 40;
        const spot = path.getPointAtLength(length * fraction).matrixTransform(path.getScreenCTM());
        if (document.elementFromPoint(spot.x, spot.y) !== line) continue;
        if (best === null || Math.abs(fraction - wanted) < Math.abs(best.fraction - wanted)) {
          best = { x: spot.x, y: spot.y, fraction };
        }
      }
      return best;
    },
    { id: edgeId, target },
  );

/**
 * What is on top at a place on the screen, in enough words to say what went
 * wrong when a press lands on something other than the handle it was aimed at.
 */
const whatIsAt = (spot) =>
  page.evaluate(({ x, y }) => {
    const on = document.elementFromPoint(x, y);
    if (on === null) return { what: 'nothing' };
    // The handle a press lands on, which for a label is the box around whatever
    // word the pointer is actually over.
    const handle = on.closest('[data-edge][data-point]');
    return {
      what: `${on.tagName.toLowerCase()}[${on.getAttribute('class') ?? '-'}]`,
      edge: handle?.getAttribute('data-edge') ?? null,
      point: handle?.getAttribute('data-point') ?? null,
    };
  }, spot);

/** Drags one handle by a known amount and says how far it actually went. */
const dragPoint = async (at, by) => {
  const before = await centreOf(point(at));
  /*
   * A press goes to whatever is on top, and a handle covered by a node or by
   * another line's label is a drag of that instead - which shows up as a
   * handle that did not move and reads like the product losing the drag. So
   * the press is checked before it is made, and says what was in the way.
   */
  const under = await whatIsAt(before);
  if (under.edge !== edgeId || under.point !== String(at)) {
    record(false, `point ${at + 1} could not be pressed: ${under.what} is on top of it`);
  }
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  // In steps, because a single jump would not catch a handler that reads the
  // pointer's position rather than its travel since the drag began.
  await page.mouse.move(before.x + by.x / 2, before.y + by.y / 2, { steps: 10 });
  await page.mouse.move(before.x + by.x, before.y + by.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await centreOf(point(at));
  const travelled = { x: after.x - before.x, y: after.y - before.y };
  return Math.max(Math.abs(travelled.x - by.x), Math.abs(travelled.y - by.y));
};

/** Every number in a path, for comparing two of them without minding the spacing. */
const numbersIn = (d) => (d ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];

// ---------------------------------------------------------------------------
// One point: the line follows the pointer, and it is one curve.
// ---------------------------------------------------------------------------

const off = await dragPoint(0, DRAGS[0]);
console.log(`dragged by:   ${JSON.stringify(DRAGS[0])}`);
console.log(`worst axis is off by ${off.toFixed(1)}px`);
record(off <= EXACT, 'the line follows the pointer');

const bent = await shapeOf([]);
console.log(`the bent line is: ${bent.d.slice(0, 70)}`);
record(
  bent.d.startsWith('M') && (bent.d.match(/[CQ]/g) ?? []).length === 1,
  'one curve through the one point',
);

// ---------------------------------------------------------------------------
// Two more, put on by double-clicking the line where they belong.
// ---------------------------------------------------------------------------

/** How far the canvas is zoomed in, which a double-click must not change. */
const zoom = () =>
  page.evaluate(() => {
    const drawn = document.querySelector('.react-flow__viewport').style.transform;
    return Number((drawn.match(/scale\(([\d.]+)\)/) ?? [0, 1])[1]);
  });

const zoomWas = await zoom();

for (const target of [0.25, 0.75]) {
  const spot = await spotOn(target);
  if (spot === null) continue;
  await page.mouse.dblclick(spot.x, spot.y);
  await page.waitForTimeout(300);
  console.log(`double-clicked ${(spot.fraction * 100).toFixed(0)}% along the line`);
}

const on = await points();
record(on >= 2, `double-clicking the line put more points on it (${on} in all)`);
/*
 * The canvas zooms in on a double-click of its own, and the only thing calling
 * that off over a line is the class on the stretch that was clicked. Lose it
 * and every point put on the line jumps the whole graph a step closer.
 */
const zoomNow = await zoom();
console.log(`the canvas was at ${zoomWas.toFixed(3)} and is at ${zoomNow.toFixed(3)}`);
record(Math.abs(zoomNow - zoomWas) < 0.001, 'adding a point did not zoom the canvas');
if (on < 2) await finish(browser);

// ---------------------------------------------------------------------------
// Each of them is dragged, and each has to travel exactly as far as the
// pointer did - the same measurement the one point has always been held to.
// ---------------------------------------------------------------------------

/*
 * The first was dragged above, which is the same gesture and the same
 * measurement; dragging it twice would only walk it over the top of the ones
 * put on since - it is the label on a labelled line, and a label covers a lot.
 */
for (let at = 1; at < on; at += 1) {
  const by = DRAGS[at % DRAGS.length];
  const wentBy = await dragPoint(at, by);
  console.log(`point ${at + 1} dragged by ${JSON.stringify(by)}, off by ${wentBy.toFixed(1)}px`);
  record(wentBy <= EXACT, `point ${at + 1} of ${on} follows the pointer`);
}

const centres = [];
for (let at = 0; at < on; at += 1) centres.push(await centreOf(point(at)));
const many = await shapeOf(centres);

console.log(`the line through ${on} points is: ${many.d.slice(0, 90)}…`);
console.log(
  `it turns ${joinsIn(many.d).toFixed(1)}° where its stretches meet, ` +
    `and ${many.corner.toFixed(1)}° at its tightest between samples`,
);
console.log(`each point is ${many.found.map((one) => one.away.toFixed(1)).join(', ')}px from the line`);
console.log(`and sits ${many.found.map((one) => (one.along * 100).toFixed(0)).join('%, ')}% along it`);

record(
  (many.d.match(/C/g) ?? []).length === on + 1 && (many.d.match(/Q/g) ?? []).length === 0,
  `${on + 1} stretches for ${on} points, one curve command each`,
);
record(joinsIn(many.d) <= NO_CORNER, 'the line has no corner where one stretch meets the next');
record(
  many.found.every((one) => one.away <= EXACT),
  'the line passes through every point rather than near it',
);
record(
  many.found.every((one, at) => at === 0 || one.along > many.found[at - 1].along),
  'the points are passed through in the order they sit along the line',
);

/*
 * What is written down for a line with several points on it.
 *
 * The first point is the record and the rest hang off it under `more`, so a
 * browser running a build from before lines could bend twice reads `x` and `y`
 * and finds the first bend where it left it, instead of an array it cannot use
 * and a line that goes nowhere.
 */
const written = await page.evaluate(
  ({ key, id }) => JSON.parse(window.localStorage.getItem(key) ?? '{}')[id] ?? null,
  { key: STORE, id: edgeId },
);
console.log(`written down: ${JSON.stringify(written)}`);
record(
  written !== null &&
    Number.isFinite(written.x) &&
    Number.isFinite(written.y) &&
    (written.more ?? []).length === on - 1,
  `${on} points are written down as the first one and ${on - 1} beside it`,
);

// ---------------------------------------------------------------------------
// And one taken off again, which is what makes the other two worth adding.
// ---------------------------------------------------------------------------

const middle = await centreOf(point(1));
await page.mouse.dblclick(middle.x, middle.y);
await page.waitForTimeout(300);
const left = await points();
record(left === on - 1, `double-clicking a point took it off (${left} left of ${on})`);

const survived = centres.filter((_, at) => at !== 1);
let stayed = 0;
for (let at = 0; at < survived.length; at += 1) {
  const where = await centreOf(point(at));
  stayed = Math.max(stayed, Math.hypot(where.x - survived[at].x, where.y - survived[at].y));
}
console.log(`the ${survived.length} that stayed moved ${stayed.toFixed(1)}px`);
record(stayed <= EXACT, 'taking one point off leaves the others where they were');

/*
 * And a line back down to its last point is the line it was before any of this
 * - the same one curve the fix for the wide S settled on, rather than a chain
 * of stretches with only one knot left in it.
 */
if (left === 1) {
  const one = await shapeOf([]);
  record((one.d.match(/[CQ]/g) ?? []).length === 1, 'down to one point it is one curve again');
}

// ---------------------------------------------------------------------------
// The arrangement is the browser's own, so what has to survive is a reload.
// ---------------------------------------------------------------------------

const before = await shapeOf([]);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(1500);

const back = await points();
const after = await shapeOf([]);
const was = numbersIn(before.d);
const now = numbersIn(after.d);
const moved = was.length === now.length ? Math.max(...was.map((one, at) => Math.abs(one - now[at]))) : Infinity;
console.log(`after a reload the line is: ${(after.d ?? '(gone)').slice(0, 90)}…`);
console.log(`the furthest any of its numbers moved is ${moved.toFixed(1)}`);
record(back === left, `the points came back (${back} of ${left})`);
record(moved <= EXACT, 'the shape came back as it was left');

// ---------------------------------------------------------------------------
// And an arrangement from before any of this: one point, written as one point.
// ---------------------------------------------------------------------------

/*
 * The record above with `more` taken off it, which is both what a browser from
 * before this change would have written for this line and all of what one
 * would read from what is written now. Either way the first point has to come
 * back where it was, on a line bent once through it.
 */
const firstWas = await centreOf(point(0));
await page.evaluate(
  ({ key, id }) => {
    const held = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    window.localStorage.setItem(key, JSON.stringify({ [id]: { x: held[id].x, y: held[id].y } }));
  },
  { key: STORE, id: edgeId },
);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(1500);

const older = await points();
const nowAt = older > 0 ? await centreOf(point(0)) : { x: Infinity, y: Infinity };
const shifted = Math.hypot(nowAt.x - firstWas.x, nowAt.y - firstWas.y);
const only = await shapeOf([]);
console.log(`an arrangement written the old way came back ${shifted.toFixed(1)}px from where it was`);
record(older === 1, `a line written the old way has one point on it (${older})`);
record(shifted <= EXACT, 'and that point is where it was left');
record((only.d.match(/[CQ]/g) ?? []).length === 1, 'and its line is the one curve it always was');

await finish(browser);
