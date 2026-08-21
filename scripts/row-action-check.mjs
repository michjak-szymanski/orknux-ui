/**
 * The small square at the end of a row answers the pointer, and answers it the
 * same way everywhere.
 *
 * The report was a screenshot of three buttons side by side on one row: two did
 * nothing under the pointer and the third turned green. Behind it were sixteen
 * copies of `.rowAction` in sixteen stylesheets, byte-identical in their base
 * rule and holding five different answers to `:hover` - three with none at all,
 * six lifting the border to muted, three to the brand green, two lifting the
 * background, one background and opacity.
 *
 * The fix is one file the twelve square ones compose from, and this is what
 * stops the thirteenth copy being written. It checks two things a person cannot
 * check by eye across pages:
 *
 * 1. **In the browser.** Every row button on the pages that carry them changes
 *    under the pointer, and every one on a page changes to the same colour.
 *    Read off `getComputedStyle`, so a rule that exists but is overridden fails
 *    exactly like a rule nobody wrote.
 *
 * 2. **In the source.** No stylesheet declares its own `.rowAction` square. A
 *    page that copies the block back in would pass the first half on the page
 *    it was measured on and drift the moment somebody edits one of the two - so
 *    the population is asserted where the population lives.
 *
 * The borderless icon buttons - the chat's, the admin overview's, the triggers'
 * - are deliberately outside this. They have no border to lift, so they lift
 * the background, and those three already agree with each other.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../src');

/** Every .module.css under src/, however deep. */
function stylesheets(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...stylesheets(full));
    else if (entry.name.endsWith('.module.css')) out.push(full);
  }
  return out;
}

/* ---- 1. The source: nobody keeps their own copy of the square ---- */

/**
 * The borderless family, which is a different control and says so here rather
 * than by being missed. Adding a name to this list is a decision somebody makes
 * on purpose; forgetting to is a failure.
 */
const BORDERLESS = new Set(['AdminPage.module.css', 'ChatPage.module.css', 'WorkspaceTriggersPage.module.css']);

/** A text button with a label, not a square. Same name, different thing. */
const NOT_A_SQUARE = new Set(['AdminRolesPage.module.css']);

const own = [];
for (const file of stylesheets(src)) {
  const name = file.split(/[\/]/).pop();
  if (name === 'rowAction.module.css') continue;
  const text = readFileSync(file, 'utf8');
  const block = text.match(/^\.rowAction \{[^}]*\}/m);
  if (!block) continue;
  if (BORDERLESS.has(name) || NOT_A_SQUARE.has(name)) continue;
  if (!/composes:\s*rowAction from/.test(block[0])) own.push(relative(src, file));
}
record(
  own.length === 0,
  own.length === 0
    ? 'no stylesheet keeps its own copy of the row-action square'
    : `${own.length} stylesheet(s) declare their own .rowAction square: ${own.join(', ')}`,
);

/* ---- 2. The browser: every square answers, and answers alike ---- */

const { browser, context, page } = await open({ viewport: { width: 1440, height: 1000 } });

/**
 * How far apart two painted colours are, per channel.
 *
 * Inequality is not the test. The first fix here lifted only the border, from
 * #27272a to #71717a, and every assertion passed because the value had moved -
 * then it was reported as still not working, and a screenshot settled it: 1px
 * of slightly lighter grey on a 32px square is a change a stylesheet can prove
 * and an eye cannot find. So the check asks how far, not whether.
 */
const APART = 8;

const distance = (one, two) => {
  const nums = (colour) => (colour.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const [a, b] = [nums(one), nums(two)];
  if (a.length < 3 || b.length < 3) return 0;
  return Math.max(...a.map((channel, i) => Math.abs(channel - b[i])));
};

/** What the square is painted with: its fill and its edge, both. */
const paintOf = async (button) =>
  page.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, border: style.borderColor };
  }, await button.elementHandle());

async function rowOf(path, what) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  /*
   * By what the button says it is for, not by class: the class is exactly the
   * thing under test, so finding the buttons by it would make this check agree
   * with itself. Four verbs because the pages spell the same square four ways.
   */
  const VERBS = ['Export', 'Save', 'Open', 'Settings'];
  /*
   * `a` as well as `button`. The integrations rows draw the same square as an
   * anchor - which is why two of these stylesheets carry `text-decoration:
   * none` - and a button-only locator found nothing there and reported the page
   * as having no row buttons rather than as unmeasured. Same square, either tag.
   */
  const buttons = page.locator(
    VERBS.flatMap((verb) => [`button[aria-label^="${verb}"]`, `a[aria-label^="${verb}"]`]).join(', '),
  );
  /*
   * Waited for rather than slept past. A fixed pause found nothing on the
   * integrations page, whose rows arrive after two requests rather than one -
   * and "no buttons" from a page that had not drawn yet is the failure mode
   * where a check quietly stops covering a page.
   */
  await buttons.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  const count = await buttons.count();
  if (count === 0) {
    record(false, `${what}: no row buttons found, so this page was not measured`);
    return;
  }
  const answers = [];
  for (let i = 0; i < Math.min(count, 3); i += 1) {
    const button = buttons.nth(i);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(150);
    const before = await paintOf(button);
    await button.hover();
    await page.waitForTimeout(200);
    const after = await paintOf(button);
    const label = await button.getAttribute('aria-label');

    const fill = distance(before.background, after.background);
    const edge = distance(before.border, after.border);
    record(
      fill >= APART,
      `${what}: "${label}" fills differently under the pointer - ${before.background} -> ${after.background}, ${fill} apart, wanted ${APART}`,
    );
    record(
      edge >= APART,
      `${what}: "${label}" edges differently under the pointer - ${before.border} -> ${after.border}, ${edge} apart, wanted ${APART}`,
    );
    answers.push(`${after.background} / ${after.border}`);
  }
  const alike = answers.every((colour) => colour === answers[0]);
  record(alike, `${what}: the row answers alike${alike ? ` (${answers[0]})` : ` - ${answers.join(' | ')}`}`);
}

await rowOf(`/workspace/${WORKSPACE}/functions`, 'functions');
await rowOf(`/workspace/${WORKSPACE}/actions`, 'actions');
await rowOf(`/workspace/${WORKSPACE}/conditions`, 'conditions');
await rowOf(`/workspace/${WORKSPACE}/integrations`, 'integrations');

await finish(browser);
