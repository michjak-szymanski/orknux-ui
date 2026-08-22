/**
 * Every small icon control in the product answers the pointer.
 *
 * The narrow check beside this one - `row-action-check.mjs` - proves four pages
 * and the stylesheets behind them. It passed while a fifth of the controls in
 * the product still did nothing under the pointer, because the square had been
 * declared under other names: `.settings` on the agents page, `.addMenu` in the
 * chat, `.refresh` on three, and `.toggle` bare in nine. A check written around
 * the names somebody already knew about could not have found any of them.
 *
 * So this one knows no names. It walks the pages, finds everything drawn at
 * roughly the size of an icon button, hovers each, and reads what changed. A
 * new alias is covered the day it is drawn.
 *
 * **Unreachable is not dead.** The first version of this reported fifteen dead
 * controls on the triggers page. They were not dead: the table is wide, the
 * buttons were off the right-hand edge, `hover()` threw, and a `.catch(() => {})`
 * turned "I could not reach it" into "it did not respond". Silence read as a
 * finding. The two are counted apart now, and being unable to reach a control
 * is itself a failure - a check that cannot see something must say so rather
 * than pass quietly.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

/** Far enough apart that somebody can tell it happened. */
const APART = 8;

/*
 * The current page in a pagination strip. It is drawn like a button and is not
 * one: pressing it goes where you already are, so answering the pointer would
 * promise something. Named here rather than skipped by silence.
 */
const NOT_A_CONTROL = /^Page \d+ of /;

const { browser, page } = await open({ viewport: { width: 1920, height: 1080 } });

const distance = (one, two) => {
  const nums = (colour) => (colour.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const [a, b] = [nums(one), nums(two)];
  if (a.length < 3 || b.length < 3) return 0;
  return Math.max(...a.map((channel, i) => Math.abs(channel - b[i])));
};

const paintOf = async (handle) =>
  page.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, border: style.borderColor, opacity: Number(style.opacity) };
  }, await handle.elementHandle());

const PAGES = [
  ['workflows', `/workspace/${WORKSPACE}/workflows`],
  ['agents', `/workspace/${WORKSPACE}/agents`],
  ['objects', `/workspace/${WORKSPACE}/objects`],
  ['variables', `/workspace/${WORKSPACE}/variables`],
  ['triggers', `/workspace/${WORKSPACE}/triggers`],
  ['skills', `/workspace/${WORKSPACE}/skills`],
  ['tools', `/workspace/${WORKSPACE}/tools`],
  ['models', `/workspace/${WORKSPACE}/models`],
  ['issues', `/workspace/${WORKSPACE}/issues?status=all`],
  ['admin', '/admin'],
  ['admin/workspaces', '/admin/workspaces'],
  ['admin/plugins', '/admin/plugins'],
  ['admin/roles', '/admin/roles'],
  ['admin/networking', '/admin/networking'],
  ['admin/shell', '/admin/shell'],
  ['admin/integrations', '/admin/integrations'],
  ['chat', '/chat'],
];

let seen = 0;

for (const [name, path] of PAGES) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);

  const controls = page.locator('button[aria-label], a[aria-label]');
  const count = await controls.count();
  const dead = [];
  const unreachable = [];
  let looked = 0;

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const box = await control.boundingBox().catch(() => null);
    /* Icon-sized, and clear of the sidebar, whose chrome is a different thing. */
    if (box === null || box.width > 60 || box.height > 60 || box.width < 20 || box.height < 20) continue;
    if (box.x < 340) continue;

    const label = (await control.getAttribute('aria-label')) ?? '';
    if (NOT_A_CONTROL.test(label)) continue;
    looked += 1;
    seen += 1;

    await page.mouse.move(4, 4);
    await page.waitForTimeout(50);
    const before = await paintOf(control);

    let reached = true;
    await control.hover({ timeout: 3000 }).catch(() => {
      reached = false;
    });
    if (!reached) {
      unreachable.push(label);
      continue;
    }

    await page.waitForTimeout(110);
    const after = await paintOf(control);
    const moved = Math.max(
      distance(before.background, after.background),
      distance(before.border, after.border),
      Math.round(Math.abs(before.opacity - after.opacity) * 100),
    );
    if (moved < APART) dead.push(`${label} [${moved}]`);
  }

  record(looked > 0, `${name}: found ${looked} icon control(s) to try`);
  record(
    unreachable.length === 0,
    `${name}: every control could be reached${unreachable.length ? ` - could not hover ${unreachable.join(', ')}` : ''}`,
  );
  record(
    dead.length === 0,
    `${name}: every control answers the pointer${dead.length ? ` - these do not: ${dead.join(', ')}` : ''}`,
  );
}

/*
 * The floor, and what it is a floor against.
 *
 * It exists so that a sweep which silently found nothing - a selector that
 * stopped matching, a sign-in that failed, a page that never drew - cannot
 * report seventeen pages of green. It is not a measure of how much product
 * there is.
 *
 * It was 200, and 200 was measured on the machine this was written on, whose
 * database has years of workspaces in it and offers 241. A seeded installation
 * offers 144, so the first time CI ran this it failed here - with every one of
 * those 144 controls having answered the pointer correctly on all seventeen
 * pages. The check was right about the product and wrong about itself.
 *
 * 120 is under what the seed produces and far above what any of the failures
 * this guards against would leave behind, which is the only two things it has
 * to be. Calibrate it against the smallest real installation it runs on, never
 * against a developer's.
 */
record(seen >= 120, `${seen} controls were actually tried, which is enough of the product to mean something`);

await finish(browser);
