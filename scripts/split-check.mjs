/**
 * The function editor's split, dragged.
 *
 * The code column and the details panel divided the row at a fixed 380px, which
 * is the wrong answer for both of the people who open this page. This drives the
 * handle between them and checks the four things that can go wrong:
 *
 *  - both columns actually change, rather than one growing into the page,
 *  - the split survives a reload, because it is meant to be a preference,
 *  - Monaco is told to measure itself again. It caches the box it was last given
 *    and positions glyphs and click-to-offset arithmetic against that cache, so
 *    a wider column with a stale cache draws the old width and lands the caret
 *    in the wrong place. Checked twice: the editor's own reported layout width,
 *    and a click in the strip that was outside the old width, which a stale
 *    editor cannot resolve to the character under the pointer.
 *  - the handle answers the keyboard, for somebody who cannot hold a pointer.
 */
import { BASE, WORKSPACE, open, record, SHOT_DIR, finish } from './suite/harness.mjs';
import { NAMES, idOf } from './suite/named.mjs';

const SHOTS = SHOT_DIR;

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

// By name: `?? '29'` was one developer's function number, and against any other
// database this check dragged a divider on the page that says the function does
// not exist.
const FUNCTION = await idOf(
  graphql,
  'function',
  WORKSPACE,
  NAMES.PANEL_FUNCTION,
  process.env.ORKNUX_PANEL_FUNCTION ?? process.env.ORKNUX_FUNCTION,
);
if (FUNCTION === null) {
  record(false, `there is no function called ${NAMES.PANEL_FUNCTION} whose editor to split`);
  await finish(browser);
}

const where = `${BASE}/workspace/${WORKSPACE}/functions/${FUNCTION}`;
await page.goto(where, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.view-lines', { timeout: 30_000 });
await page.waitForTimeout(1500);

const handle = page.locator('[role="separator"][aria-orientation="vertical"]');
const column = page.locator('#function-code-column');
const panel = page.locator('aside').first();

/** What Monaco says its own box is, which is not what the page says it is. */
const monacoWidth = () =>
  page.evaluate(() => {
    // Found through the lines it draws: the page also holds Monaco's detached
    // node for overflowing widgets, which wears the same class and has no size.
    const held = document.querySelector('.view-lines').closest('.monaco-editor');
    // Monaco writes the size it last laid out to onto its own root.
    return { root: parseFloat(getComputedStyle(held).width), declared: held.style.width };
  });

async function widths(note) {
  const code = await column.boundingBox();
  const side = await panel.boundingBox();
  const monaco = await monacoWidth();
  console.log(
    `${note}: code ${code.width.toFixed(0)}, panel ${side.width.toFixed(0)}, monaco ${monaco.root.toFixed(0)} (declared ${monaco.declared || 'none'})`,
  );
  return { code: code.width, panel: side.width, monaco: monaco.root };
}

/**
 * Drags the divider by `by` pixels: negative widens the panel, positive the code.
 *
 * Reads both widths while the button is still down and without waiting, which is
 * the measurement that distinguishes being told to lay out from being left to
 * notice. Monaco's own `automaticLayout` does catch up - given a frame - so a
 * check taken after the drag has settled would pass either way and prove nothing.
 */
async function drag(by) {
  const box = await handle.boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // In steps, so the page sees a drag rather than a teleport, and anything that
  // only redraws on pointermove is actually exercised.
  await page.mouse.move(from.x + by, from.y, { steps: 20 });
  const midway = await page.evaluate(() => {
    const held = document.querySelector('.view-lines').closest('.monaco-editor');
    return {
      monaco: parseFloat(getComputedStyle(held).width),
      code: document.querySelector('#function-code-column').getBoundingClientRect().width,
    };
  });
  await page.mouse.up();
  await page.waitForTimeout(400);
  return midway;
}

const opened = await widths('opened      ');

// Panel wide, code narrow.
const heldWide = await drag(-260);
const wide = await widths('panel wide  ');
await page.screenshot({ path: `${SHOTS}/split-panel-wide.png` });

// And back the other way, past where it started.
const heldNarrow = await drag(420);
const narrow = await widths('panel narrow');
await page.screenshot({ path: `${SHOTS}/split-code-wide.png` });

const bothMoved =
  wide.panel > opened.panel + 40 &&
  wide.code < opened.code - 40 &&
  narrow.panel < wide.panel - 40 &&
  narrow.code > wide.code + 40;
console.log(bothMoved ? 'PASS: both columns change against each other' : 'FAIL: the columns did not trade width');

/* Monaco's own measurement, against the column it is drawn in. */
const settled = Math.abs(narrow.monaco - narrow.code) < 6 && narrow.monaco > wide.monaco + 40;
console.log(settled ? 'PASS: Monaco re-measured to the new column' : 'FAIL: Monaco is still drawing the old width');

console.log(
  `mid-drag: monaco ${heldWide.monaco.toFixed(0)} against column ${heldWide.code.toFixed(0)}, then ${heldNarrow.monaco.toFixed(0)} against ${heldNarrow.code.toFixed(0)}`,
);
const keptUp = Math.abs(heldWide.monaco - heldWide.code) < 6 && Math.abs(heldNarrow.monaco - heldNarrow.code) < 6;
console.log(keptUp ? 'PASS: Monaco is the right width during the drag, not after it' : 'FAIL: Monaco lags the drag');
const measured = settled && keptUp;

/*
 * The caret, which is what a stale measurement actually costs somebody.
 *
 * A line long enough to run past where the narrow column ended is typed in (and
 * never saved), then clicked in the strip that only exists at the wide split. An
 * editor still holding the narrow box has no columns out there to land in.
 */
await page.locator('.view-lines').click();
await page.keyboard.press('Control+A');
/*
 * Inserted in one go rather than typed key by key. The page holds the code in
 * React state and writes it back when the two disagree, and a hundred keystrokes
 * in a few milliseconds outruns that - the editor gets reset to a value from two
 * renders ago mid-word. A person cannot type fast enough to see it; Playwright
 * can, and what is being measured here is not that.
 *
 * Short words, because the editor wraps: one long token would be carried whole
 * to the next row and leave the row being clicked in nearly empty.
 */
await page.keyboard.insertText('// ' + 'abcd '.repeat(50));
await page.waitForTimeout(800);

/*
 * The top row of the wrapped line, found by position rather than by document
 * order - Monaco reuses and reorders the nodes it draws rows with.
 */
const row = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.view-line')]
    .map((held) => ({ held, box: held.getBoundingClientRect() }))
    .sort((one, two) => one.box.top - two.box.top);
  const first = rows[0];
  // Every span of it: Monaco draws a row in chunks, so the first one is a
  // fraction of the text and measuring only that says the row ends early.
  const spans = [...first.held.querySelectorAll('span span')];
  const right = Math.max(...spans.map((held) => held.getBoundingClientRect().right));
  const letters = spans.reduce((count, held) => count + held.textContent.length, 0);
  return {
    x: first.box.x,
    y: first.box.y,
    height: first.box.height,
    text: right - first.box.x,
    glyph: (right - first.box.x) / letters,
  };
});

// Inside the strip the narrow split did not have, and short of the row's end.
const target = row.x + wide.code + 60;
const reachable = target < row.x + row.text - 8;
await page.mouse.click(target, row.y + row.height / 2);
await page.waitForTimeout(300);

const shown = await page.getByText(/^Ln \d+, Col \d+$/).innerText();
const landed = Number(/Col (\d+)/.exec(shown)[1]);
const wanted = Math.round((target - row.x) / row.glyph) + 1;
console.log(
  `caret: clicked ${(target - row.x).toFixed(0)}px into a row ${row.text.toFixed(0)}px wide, glyph ${row.glyph.toFixed(2)}px, wanted col ~${wanted}, got ${shown}`,
);
// One glyph of slack: a click lands in a character, not between two.
const caretRight = reachable && Math.abs(landed - wanted) <= 1;
console.log(caretRight ? 'PASS: the caret lands where it was clicked' : 'FAIL: the caret is not where the pointer was');

/* The chosen split is this person's, so it outlives the page. */
const stored = await page.evaluate(() => window.localStorage.getItem('orknux.function-editor.panel-width'));
await page.goto(where, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.view-lines', { timeout: 30_000 });
await page.waitForTimeout(1500);
const reloaded = await widths('reloaded    ');
const kept = Math.abs(reloaded.panel - narrow.panel) < 3;
console.log(`stored: ${stored}`);
console.log(kept ? 'PASS: the split survives a reload' : 'FAIL: the split was forgotten');

/* And the same from the keyboard. */
await handle.focus();
const focused = await page.evaluate(() => document.activeElement?.getAttribute('role'));
const before = await widths('before keys ');
for (let press = 0; press < 4; press += 1) await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(400);
const nudged = await widths('after Left  ');
const said = await handle.getAttribute('aria-valuenow');
const keyed =
  focused === 'separator' && nudged.panel > before.panel + 60 && Math.abs(nudged.monaco - nudged.code) < 6;
console.log(`focused element role: ${focused}, aria-valuenow now ${said}`);
console.log(keyed ? 'PASS: arrows move the split, and Monaco follows' : 'FAIL: the handle ignores the keyboard');

/*
 * And below the width where the columns stop being columns. One above the other
 * there is nothing to divide, so the handle goes - out of sight and out of the
 * tab order - and the panel takes the whole measure whatever it was dragged to.
 */
await page.setViewportSize({ width: 1100, height: 1000 });
await page.waitForTimeout(600);
const stackedHandle = await handle.isVisible();
const stacked = await widths('stacked     ');
const stowed = !stackedHandle && stacked.panel > stacked.code - 4;
console.log(`stacked: handle ${stackedHandle ? 'shown' : 'hidden'}, panel ${stacked.panel.toFixed(0)}, code ${stacked.code.toFixed(0)}`);
console.log(stowed ? 'PASS: no handle where there is nothing to divide' : 'FAIL: the handle survived the stack');

await finish(browser, bothMoved, measured, caretRight, kept, keyed, stowed);
