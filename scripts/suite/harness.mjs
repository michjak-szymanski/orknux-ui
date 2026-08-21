/**
 * The plumbing every check in this folder had a copy of.
 *
 * Thirty scripts opened a browser, posted to /api/session as alice, kept a
 * `results` array, printed PASS/FAIL and exited 0 or 1 - each in its own
 * slightly different words, and each with its own idea of where a screenshot
 * goes. None of that is the value of a check; the assertions are. So the
 * assertions stayed exactly where they were written and only this moved.
 *
 * What a check now says at the top:
 *
 *   import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';
 *   const { browser, page } = await open();
 *
 * and at the bottom:
 *
 *   await finish(browser);            // pass if everything recorded passed
 *   await finish(browser, a, b);      // ...and if these are true as well
 *
 * `finish` is the only exit. It closes the browser first, so a check that fails
 * does not leave a chromium behind for the runner to wait on, and it prints one
 * summary line the runner reads back.
 *
 * And `drawn(page, name)`, for the other half of the same problem: a check that
 * reads a page which has not arrived is a check that asserts things about an
 * empty screen. See its own note below.
 */
import { mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { chromium } from 'playwright';

export { chromium };

/**
 * Where the interface is. In development that is the vite server, which proxies
 * /api and /graphql to the server on 8080 so the session cookie stays
 * first-party. In CI it is the all-in-one image, which serves both on one port
 * itself - which is why every check speaks to one origin and never two.
 */
export const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';

/**
 * Who signs in. Overridable because the seed can be told to build its fixture
 * under another account, and because CI's administrator is not called alice.
 */
export const USER = process.env.ORKNUX_USER ?? 'alice';
export const PASSWORD = process.env.ORKNUX_PASSWORD ?? 'password';

/**
 * The fixture the checks are written against. These are ids rather than names
 * because that is what a route needs, and they are variables rather than
 * constants because a database built from nothing does not hand out the same
 * ones a developer's has. `scripts/suite/seed-fixture.mjs` prints the values to
 * set; the defaults are the developer database this was all written on.
 */
export const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';
export const WORKFLOW = process.env.ORKNUX_WORKFLOW ?? '9';

/**
 * Where pictures go.
 *
 * They used to land in the working directory, which is the repository root, so
 * running the checks left eight untracked PNGs beside package.json. One folder,
 * ignored by git, and the runner can hand the whole of it to CI as an artifact.
 */
export const SHOT_DIR = process.env.ORKNUX_SHOT_DIR ?? 'scripts/suite/shots';

/** A path under SHOT_DIR, making the folder on the way. */
export function shot(name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  return `${SHOT_DIR}/${basename(name)}`;
}

/**
 * A browser, a page, and a session.
 *
 * Sign-in is a POST rather than the sign-in form on purpose: what these checks
 * are about is what happens after, and driving the form thirty times over would
 * be thirty chances to fail for a reason none of them is testing. The one check
 * that is about signing in should drive the form.
 *
 * The cookie is set on the context, so `context.request` and the page share the
 * session - which is what lets a check set its own fixture up over GraphQL and
 * then look at it in the browser.
 */
export async function signIn(context) {
  const signedIn = await context.request.post(`${BASE}/api/session`, {
    data: { username: USER, password: PASSWORD },
  });
  if (!signedIn.ok()) {
    console.error(`FAIL: could not sign in as ${USER} at ${BASE}: ${signedIn.status()}`);
    await context.browser()?.close().catch(() => {});
    process.exit(1);
  }
  return context;
}

export async function open(options = {}) {
  const { viewport = { width: 1440, height: 900 }, launch = {}, context: contextOptions = {} } = options;
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport, ...contextOptions });
  const page = await context.newPage();
  await signIn(context);

  /**
   * One GraphQL call as this session. Throws on errors rather than returning
   * them: a check whose fixture half-built is a check that fails for the wrong
   * reason, and the stack says where.
   */
  const graphql = async (query, variables = {}) => {
    const answer = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
    const body = await answer.json();
    if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors));
    return body.data;
  };

  return { browser, context, page, graphql };
}

/** Everything recorded so far, in the order it was recorded. */
const results = [];

/**
 * One assertion, in the form most of these checks were already written in.
 * Prints it and remembers it.
 */
export function record(ok, message) {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
  return Boolean(ok);
}

/**
 * The same thing in the other form some of them used, where the sentence to
 * print differs between passing and failing.
 */
export function check(ok, pass, fail) {
  return record(ok, ok ? pass : fail);
}

/** How many recorded assertions failed. For a check that prints its own tally. */
export function failures() {
  return results.filter((ok) => !ok).length;
}

/**
 * Wait until a page has actually drawn something, and fail by name if it never
 * does.
 *
 * This is the shape that produced most of this suite's false alarms. A check
 * navigates, sleeps a fixed second and a half, and reads the page - and the
 * loader deliberately draws nothing for its first three seconds, so a page that
 * was merely slow is an *empty* page. Every assertion of the form "X is no
 * longer printed under a field" then passes on a blank screen, and the only
 * thing left to complain about is a missing control, which reads exactly like
 * prose deleted and never replaced. It sent somebody looking for a deletion
 * that was never made, twice.
 *
 * So: wait on the page rather than on the clock, and when nothing arrives, say
 * *that* - with what the page did hold, because a settings page asked for a
 * thing that is not there answers with a short card saying so, and a bare "drew
 * nothing" cannot tell that from a page that failed to render.
 *
 * Returns true when the page drew, false when it did not - having already
 * recorded the failure, so the caller's job is only to stop reading.
 *
 *   if (!(await drawn(page, 'admin settings'))) continue;
 */
export async function drawn(page, name, options = {}) {
  const { within = 20_000, atLeast = 1, where = 'body' } = options;
  const upTo = Date.now() + within;
  let held = '';
  for (;;) {
    held = await page.evaluate((selector) => document.querySelector(selector)?.innerText ?? '', where);
    // A [role="status"] is the loading mark; while one is on screen the page is
    // still deciding what it holds, and what it holds now is not an answer.
    const loading = (await page.locator('[role="status"]').count()) > 0;
    if (held.trim().length >= atLeast && !loading) return true;
    if (Date.now() >= upTo) break;
    await page.waitForTimeout(250);
  }
  return record(
    false,
    `${name}: the page drew ${held.trim().length} characters in ${within / 1000}s and settled on none of it, ` +
      `so nothing read off it means a thing. <${where}> holds: ${JSON.stringify(held.replace(/\s+/g, ' ').slice(0, 200))}`,
  );
}

/**
 * Close the browser, say what happened, and exit.
 *
 * Extra booleans are for the checks that computed their verdict in local
 * variables rather than through `record`; they are ANDed with everything
 * recorded. A check that recorded nothing and passes nothing here fails, on
 * purpose: a suite whose tests can silently assert nothing is the suite we
 * already had.
 */
export async function finish(browser, ...extras) {
  await browser?.close().catch(() => {});

  const recorded = results.every(Boolean);
  const extra = extras.every(Boolean);
  const asserted = results.length + extras.length;

  if (asserted === 0) {
    console.log('FAIL: this check asserted nothing');
    process.exit(1);
  }

  const passed = recorded && extra;
  const failed = results.filter((ok) => !ok).length + extras.filter((ok) => !ok).length;
  console.log(passed ? `ALL PASS (${asserted} checks)` : `SOME FAILED (${failed} of ${asserted})`);
  process.exit(passed ? 0 : 1);
}
