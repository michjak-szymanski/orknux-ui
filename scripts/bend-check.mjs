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
 *
 * ---------------------------------------------------------------------------
 * Why the whole battery runs twice
 *
 * It used to pick one line - whichever had most of itself in the open - and
 * measure that. Every line on the workflow the suite is pointed at carries
 * fields, so the one it picked was always a labelled line, and a bare one was
 * never driven at all. Then the opposite turned out to be the broken half: a
 * labelled line would not take a second bend, because its label lay over the
 * middle of it and answered the double-click that adds a point by taking its
 * own point off. The check could not have caught it either way round, since it
 * only ever knew one kind of line.
 *
 * So it builds its own graph - two agents wired to two more, one pair passing a
 * field between them and one pair passing nothing - and runs the same battery
 * against each. A labelled line and a bare line, measured to the same pixel,
 * and the fixture is removed afterwards.
 *
 * That is also what took it off the seeded workflow, which is the reason it was
 * held out of CI: it wanted a line it could find a handle on and get at, and
 * "whichever line this database happens to have" is not that.
 * ---------------------------------------------------------------------------
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';
import { anyOf } from './suite/named.mjs';

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

/** Every number in a path, for comparing two of them without minding the spacing. */
const numbersIn = (d) => (d ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/* ----------------------------------------------------------------- fixture */

const PREFIX = 'zzBend137';
const WORKFLOW_NAME = `${PREFIX} ${Date.now()}`;

/** Anything a run that died halfway through left behind, and this run's own. */
async function sweep() {
  const { workspaceWorkflows } = await graphql(
    `query($id: ID!) { workspaceWorkflows(workspaceId: $id, page: 0, size: 200) { content { id name } } }`,
    { id: WORKSPACE },
  );
  for (const old of workspaceWorkflows.content.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept workflow ${old.name} (#${old.id})`);
  }
}

await sweep();

/*
 * Whichever agent this workspace has. Four nodes point at the same one: what is
 * being measured is a line, and an agent node is only the shortest way to two
 * nodes that can be wired together and pass a field.
 */
const AGENT = await anyOf(graphql, 'agent', WORKSPACE, null);
if (AGENT === null) {
  record(false, 'this workspace has no agent, so there is nothing to wire together');
  await finish(browser);
}

const made = await graphql(`mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id } }`, {
  input: {
    workspaceId: WORKSPACE,
    name: WORKFLOW_NAME,
    description: 'Made by scripts/bend-check.mjs to bend two lines, and removed again after.',
  },
});
const WORKFLOW = made.createWorkflow.id;
console.log(`made workflow ${WORKFLOW_NAME} (#${WORKFLOW}) around agent #${AGENT}`);

/** Where the arrangement is kept. Named here because this check reads it. */
const STORE = `orknux.edge-labels.${WORKFLOW}`;

const node = (key, name, outputName, x, y, expression, mode) => ({
  key,
  kind: 'AGENT',
  name,
  agentId: AGENT,
  outputName,
  x,
  y,
  mappings: [{ name: 'prompt', expression, mode }],
});

/*
 * Two pairs, far enough apart that neither line runs under the other's nodes
 * and long enough that there is line either side of anything sitting on it.
 *
 * The upper pair passes a field - `carries` reads what `holds` produces - so
 * the editor writes what it carries beside the line, which is what makes it a
 * labelled line. The lower pair passes a written value, so nothing is written
 * beside it and its line is bare. That difference is the whole point of the
 * fixture: they are otherwise the same two nodes and the same one edge.
 */
const graph = await graphql(
  `mutation($ws: ID!, $id: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $ws, workflowId: $id, input: $input) { workflowId problems { message } }
   }`,
  {
    ws: WORKSPACE,
    id: WORKFLOW,
    input: {
      nodes: [
        node('holds', `${PREFIX} holds`, 'held', 40, 40, 'Say something.', 'VALUE'),
        node('carries', `${PREFIX} carries`, 'carried', 640, 40, 'held', 'REFERENCE'),
        node('bare', `${PREFIX} bare`, 'bareSaid', 40, 460, 'Say something else.', 'VALUE'),
        node('plain', `${PREFIX} plain`, 'plainSaid', 640, 460, 'And again.', 'VALUE'),
      ],
      edges: [
        { source: 'holds', target: 'carries' },
        { source: 'bare', target: 'plain' },
      ],
    },
  },
);
console.log(`graph: ${graph.saveWorkflowGraph.problems.map((one) => one.message).join('; ') || 'no problems'}`);

/** The two lines, by the names the editor gives them. */
const LABELLED = 'holds-plain->carries';
const BARE = 'bare-plain->plain';

async function openEditor() {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
  } catch {
    const held = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
    record(false, `the editor drew no node in thirty seconds. The page holds: ${JSON.stringify(held)}`);
    await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: WORKFLOW }).catch(() => undefined);
    await finish(browser);
  }
  await page.waitForTimeout(1200);
}

await openEditor();

/* --------------------------------------------------------------- the drill */

/**
 * The battery, against one line.
 *
 * Everything below was written against whichever line the check happened to
 * pick; it is a function now so that both kinds get all of it rather than one
 * kind getting all of it and the other getting none. `what` names the line in
 * every sentence it prints, because "the line follows the pointer" said twice
 * is not a result anybody can read.
 */
async function battery(edgeId, what) {
  const say = (ok, message) => record(ok, `${what}: ${message}`);

  /** One point's handle: the dot on the line, which every point now has. */
  const point = (at) => page.locator(`button[data-edge="${edgeId}"][data-point="${at}"]`);
  const points = () => page.locator(`button[data-edge="${edgeId}"][data-point]`).count();
  /** The label, where there is one - a second way to take hold of the first point. */
  const label = page.locator(`ul[data-edge="${edgeId}"]`);

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
            ((Math.atan2(on2.y, on2.x) - Math.atan2(back.y, back.x) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
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
   * A line runs over nodes and under its own handles, and a double-click landing
   * on one of those is a double-click on that instead. So the spot is chosen by
   * asking the page what is on top at each of forty places along the stretch
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
      const handle = on.closest('[data-edge][data-point]');
      return {
        what: `${on.tagName.toLowerCase()}[${on.getAttribute('class') ?? '-'}]`,
        edge: handle?.getAttribute('data-edge') ?? null,
        point: handle?.getAttribute('data-point') ?? null,
      };
    }, spot);

  /** Drags one handle by a known amount and says how far it actually went. */
  const dragBy = async (locator, by) => {
    const before = await centreOf(locator);
    /*
     * A press goes to whatever is on top, and a handle covered by a node or by
     * another line's label is a drag of that instead - which shows up as a
     * handle that did not move and reads like the product losing the drag. So
     * the press is checked before it is made, and says what was in the way.
     */
    const under = await whatIsAt(before);
    if (under.edge !== edgeId) {
      say(false, `a handle could not be pressed: ${under.what} is on top of it`);
    }
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    // In steps, because a single jump would not catch a handler that reads the
    // pointer's position rather than its travel since the drag began.
    await page.mouse.move(before.x + by.x / 2, before.y + by.y / 2, { steps: 10 });
    await page.mouse.move(before.x + by.x, before.y + by.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await centreOf(locator);
    const travelled = { x: after.x - before.x, y: after.y - before.y };
    return Math.max(Math.abs(travelled.x - by.x), Math.abs(travelled.y - by.y));
  };

  const dragPoint = (at, by) => dragBy(point(at), by);

  // -------------------------------------------------------------------------
  // One point: the line follows the pointer, and it is one curve.
  // -------------------------------------------------------------------------

  if ((await points()) === 0) {
    say(false, 'no handle on this line to take hold of');
    return;
  }

  const off = await dragPoint(0, DRAGS[0]);
  console.log(`${what}: dragged by ${JSON.stringify(DRAGS[0])}, worst axis off by ${off.toFixed(1)}px`);
  say(off <= EXACT, 'the line follows the pointer');

  const bent = await shapeOf([]);
  console.log(`${what}: the bent line is ${bent.d.slice(0, 70)}`);
  say(
    bent.d.startsWith('M') && (bent.d.match(/[CQ]/g) ?? []).length === 1,
    'one curve through the one point',
  );

  // -------------------------------------------------------------------------
  // Two more, put on by double-clicking the line where they belong.
  // -------------------------------------------------------------------------

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
    console.log(`${what}: double-clicked ${(spot.fraction * 100).toFixed(0)}% along the line`);
  }

  const on = await points();
  say(on >= 3, `double-clicking the line put more points on it (${on} in all)`);
  /*
   * The canvas zooms in on a double-click of its own, and the only thing calling
   * that off over a line is the class on the stretch that was clicked. Lose it
   * and every point put on the line jumps the whole graph a step closer.
   */
  const zoomNow = await zoom();
  console.log(`${what}: the canvas was at ${zoomWas.toFixed(3)} and is at ${zoomNow.toFixed(3)}`);
  say(Math.abs(zoomNow - zoomWas) < 0.001, 'adding a point did not zoom the canvas');
  if (on < 2) return;

  // -------------------------------------------------------------------------
  // Each of them is dragged, and each has to travel exactly as far as the
  // pointer did - the same measurement the one point has always been held to.
  // -------------------------------------------------------------------------

  /*
   * The first was dragged above, which is the same gesture and the same
   * measurement; dragging it twice would only walk it over the top of the ones
   * put on since.
   */
  for (let at = 1; at < on; at += 1) {
    const by = DRAGS[at % DRAGS.length];
    const wentBy = await dragPoint(at, by);
    console.log(`${what}: point ${at + 1} dragged by ${JSON.stringify(by)}, off by ${wentBy.toFixed(1)}px`);
    say(wentBy <= EXACT, `point ${at + 1} of ${on} follows the pointer`);
  }

  const centres = [];
  for (let at = 0; at < on; at += 1) centres.push(await centreOf(point(at)));
  const many = await shapeOf(centres);

  console.log(`${what}: the line through ${on} points is ${many.d.slice(0, 90)}…`);
  console.log(
    `${what}: it turns ${joinsIn(many.d).toFixed(1)}° where its stretches meet, ` +
      `and ${many.corner.toFixed(1)}° at its tightest between samples`,
  );
  console.log(`${what}: each point is ${many.found.map((one) => one.away.toFixed(1)).join(', ')}px from the line`);
  console.log(`${what}: and sits ${many.found.map((one) => (one.along * 100).toFixed(0)).join('%, ')}% along it`);

  say(
    (many.d.match(/C/g) ?? []).length === on + 1 && (many.d.match(/Q/g) ?? []).length === 0,
    `${on + 1} stretches for ${on} points, one curve command each`,
  );
  say(joinsIn(many.d) <= NO_CORNER, 'the line has no corner where one stretch meets the next');
  say(
    many.found.every((one) => one.away <= EXACT),
    'the line passes through every point rather than near it',
  );
  say(
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
  console.log(`${what}: written down as ${JSON.stringify(written)}`);
  say(
    written !== null &&
      Number.isFinite(written.x) &&
      Number.isFinite(written.y) &&
      (written.more ?? []).length === on - 1,
    `${on} points are written down as the first one and ${on - 1} beside it`,
  );

  // -------------------------------------------------------------------------
  // The label, on the line that has one: still a handle for its own point, and
  // no longer the only one.
  // -------------------------------------------------------------------------

  if ((await label.count()) > 0) {
    /*
     * The label is drawn above the first point rather than over it, which is
     * what leaves the line under it clickable. Both halves are measured: that
     * it sits clear of the point, and that dragging it still moves that point
     * and nothing else.
     */
    const dot = await centreOf(point(0));
    const box = await label.boundingBox();
    console.log(
      `${what}: the label is ${box.width.toFixed(0)}x${box.height.toFixed(0)} and its foot is ` +
        `${(dot.y - (box.y + box.height)).toFixed(0)}px above its point`,
    );
    say(box.y + box.height <= dot.y, 'the label sits clear of the point it belongs to');

    const others = [];
    for (let at = 1; at < on; at += 1) others.push(await centreOf(point(at)));
    const dragged = await dragBy(label, DRAGS[1]);
    console.log(`${what}: the label dragged by ${JSON.stringify(DRAGS[1])}, off by ${dragged.toFixed(1)}px`);
    say(dragged <= EXACT, 'the label still drags its own point, exactly as far as the pointer');

    let movedOthers = 0;
    for (let at = 1; at < on; at += 1) {
      const where = await centreOf(point(at));
      movedOthers = Math.max(movedOthers, Math.hypot(where.x - others[at - 1].x, where.y - others[at - 1].y));
    }
    console.log(`${what}: the other points moved ${movedOthers.toFixed(1)}px while the label was dragged`);
    say(movedOthers <= EXACT, 'and moves nothing but its own point');

    /*
     * And the thing this whole rewrite is about: the stretch of line the label
     * covers is still line. The double-click is aimed at where the label is,
     * offset along the line rather than at its middle so it lands on the label
     * and not on the dot underneath - which is the press that used to take the
     * point off instead of putting one on.
     */
    const under = await page.evaluate(
      ({ id }) => {
        const box2 = document.querySelector(`ul[data-edge="${id}"]`).getBoundingClientRect();
        const path = document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
        const line = path.parentElement.querySelector('path.nopan');
        const length = path.getTotalLength();
        for (let step = 0; step <= 200; step += 1) {
          const spot = path.getPointAtLength((length * step) / 200).matrixTransform(path.getScreenCTM());
          // Somewhere the label's own box hangs over the line.
          if (spot.x < box2.x || spot.x > box2.x + box2.width) continue;
          if (document.elementFromPoint(spot.x, spot.y) === line) return { x: spot.x, y: spot.y, reachable: true };
        }
        return { reachable: false };
      },
      { id: edgeId },
    );
    say(under.reachable, 'the line under the label can still be aimed at');

    if (under.reachable) {
      const was = await points();
      await page.mouse.dblclick(under.x, under.y);
      await page.waitForTimeout(300);
      const now = await points();
      console.log(`${what}: double-clicking the line beneath the label took it from ${was} points to ${now}`);
      say(now === was + 1, 'and a double-click there adds a point rather than taking one off');
    }
  }

  // -------------------------------------------------------------------------
  // And one taken off again, which is what makes the others worth adding.
  // -------------------------------------------------------------------------

  const before = await points();
  const centresNow = [];
  for (let at = 0; at < before; at += 1) centresNow.push(await centreOf(point(at)));

  /*
   * Whichever point can actually be pressed.
   *
   * It used to be point two, and a point dragged by a known amount from a line
   * the fixture happened to put near the top of the canvas ends up under the
   * toolbar - where the double-click lands on the toolbar and the check reports
   * a removal that did not happen, which is a fixture accident wearing the
   * costume of a product bug. The gesture is what is being measured, so it is
   * measured on a point the pointer can reach; none of them being reachable is
   * itself the failure, and says so.
   */
  let taking = -1;
  for (let at = 0; at < before; at += 1) {
    const on = await whatIsAt(await centreOf(point(at)));
    if (on.edge === edgeId && on.point === String(at)) {
      taking = at;
      break;
    }
    console.log(`${what}: point ${at + 1} is under ${on.what}, so not that one`);
  }
  if (taking < 0) {
    say(false, 'not one of its points could be pressed, so the removal was never tried');
    return;
  }

  const middle = await centreOf(point(taking));
  console.log(`${what}: taking point ${taking + 1} of ${before} off`);
  await page.mouse.dblclick(middle.x, middle.y);
  await page.waitForTimeout(300);
  const left = await points();
  say(left === before - 1, `double-clicking a point took it off (${left} left of ${before})`);

  const survived = centresNow.filter((_, at) => at !== taking);
  let stayed = 0;
  for (let at = 0; at < survived.length; at += 1) {
    const where = await centreOf(point(at));
    stayed = Math.max(stayed, Math.hypot(where.x - survived[at].x, where.y - survived[at].y));
  }
  console.log(`${what}: the ${survived.length} that stayed moved ${stayed.toFixed(1)}px`);
  say(stayed <= EXACT, 'taking one point off leaves the others where they were');

  /*
   * And a line back down to its last point is the line it was before any of this
   * - the same one curve the fix for the wide S settled on, rather than a chain
   * of stretches with only one knot left in it.
   */
  if (left === 1) {
    const one = await shapeOf([]);
    say((one.d.match(/[CQ]/g) ?? []).length === 1, 'down to one point it is one curve again');
  }

  // -------------------------------------------------------------------------
  // The arrangement is the browser's own, so what has to survive is a reload.
  // -------------------------------------------------------------------------

  const shapeWas = await shapeOf([]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
  await page.waitForTimeout(1500);

  const back = await points();
  const after = await shapeOf([]);
  const numbersWere = numbersIn(shapeWas.d);
  const numbersNow = numbersIn(after.d);
  const moved =
    numbersWere.length === numbersNow.length
      ? Math.max(...numbersWere.map((one, at) => Math.abs(one - numbersNow[at])))
      : Infinity;
  console.log(`${what}: after a reload the line is ${(after.d ?? '(gone)').slice(0, 90)}…`);
  console.log(`${what}: the furthest any of its numbers moved is ${moved.toFixed(1)}`);
  say(back === left, `the points came back (${back} of ${left})`);
  say(moved <= EXACT, 'the shape came back as it was left');

  // -------------------------------------------------------------------------
  // And an arrangement from before any of this: one point, written as one point.
  // -------------------------------------------------------------------------

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
  console.log(`${what}: an arrangement written the old way came back ${shifted.toFixed(1)}px from where it was`);
  say(older === 1, `a line written the old way has one point on it (${older})`);
  say(shifted <= EXACT, 'and that point is where it was left');
  say((only.d.match(/[CQ]/g) ?? []).length === 1, 'and its line is the one curve it always was');

  // Nothing of this line's is left behind for the next one to read.
  await page.evaluate((key) => window.localStorage.removeItem(key), STORE);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
  await page.waitForTimeout(1200);
}

/* ------------------------------------------------------------- both of them */

const drawn = await page.evaluate(() =>
  [...document.querySelectorAll('.react-flow__edge')].map((group) => group.getAttribute('data-id')),
);
console.log(`the graph drew: ${drawn.join(', ')}`);
record(drawn.includes(BARE), 'the bare line is on the canvas');
record(drawn.includes(LABELLED), 'the labelled line is on the canvas');
record(
  (await page.locator(`ul[data-edge="${LABELLED}"]`).count()) === 1 &&
    (await page.locator(`ul[data-edge="${BARE}"]`).count()) === 0,
  'one of them carries a label and the other does not, which is what makes this two checks',
);

if (drawn.includes(BARE)) await battery(BARE, 'a bare line');
if (drawn.includes(LABELLED)) await battery(LABELLED, 'a labelled line');

/* -------------------------------------------------- and the fixture is gone */

await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: WORKFLOW }).catch(() => undefined);
console.log(`swept workflow ${WORKFLOW_NAME} (#${WORKFLOW})`);

await finish(browser);
