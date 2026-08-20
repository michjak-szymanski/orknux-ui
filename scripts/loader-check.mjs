/**
 * Issue #117: the screens that fetch but draw nothing while they fetch.
 *
 * Every screen already rendered <Loader />, but the component stayed silent for
 * five seconds before drawing anything, so no real load ever reached it. The
 * fix is the quiet period, not the screens — which means the thing to check is
 * that a load slow enough to notice now shows the mark, that the mark goes away
 * once the data lands, and that a list which finished loading and is genuinely
 * empty says so instead of spinning forever.
 *
 * The API is held back deliberately: against a local server these loads finish
 * in well under 200ms, and at that speed staying quiet is the correct behaviour.
 *
 * Temporary: delete once it has been looked at.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';

/** Long enough to clear the 250ms quiet period by a wide margin. */
const HELD_MS = 1500;

const results = [];
const record = (ok, message) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: 'alice', password: 'password' },
});
if (!signedIn.ok()) {
  console.error('sign-in failed');
  process.exit(1);
}

const page = await context.newPage();

// The loader is the only role=status that carries the waiting label.
const loader = page.locator('[role="status"]', { hasText: 'Loading' });

let holding = false;
await page.route('**/graphql', async (route) => {
  if (holding) await new Promise((resolve) => setTimeout(resolve, HELD_MS));
  await route.continue();
});

const seen = (locator) => locator.first().waitFor({ state: 'visible', timeout: 20_000 });

/**
 * Drives one screen with the API held back and reports both halves: the mark
 * has to be there while the wait is on, and gone once the screen has settled.
 */
async function check(name, url, settled) {
  holding = true;
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  let appeared = true;
  try {
    await loader.first().waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    appeared = false;
  }
  record(appeared, `${name}: the loader is shown while the data is on its way`);

  holding = false;
  let landed = true;
  try {
    await settled();
  } catch (cause) {
    landed = false;
    console.log(`  (${name} never settled: ${cause.message.split('\n')[0]})`);
  }

  // Not merely hidden: the screen stops rendering it altogether.
  await page.waitForTimeout(500);
  const cleared = (await loader.count()) === 0;
  record(landed && cleared, `${name}: the screen settles and the loader goes away`);
}

// --- executions, one of the two screens the issue names ---------------------
// This workspace's runs are all older than a day, so the default range loads to
// an empty list. That makes it the case worth being careful about: the loader
// has to give way to words, not go on turning over a list that has finished.

await check('executions list', `${BASE}/workspace/${WORKSPACE}/executions`, () =>
  seen(page.getByText('No runs match those filters.')),
);
record(
  await page.getByText('No runs match those filters.').first().isVisible(),
  'executions list: a list that loaded empty says so rather than spinning',
);

// The same list with rows in it, so the settled state is not only the empty one.
await page.getByLabel('Date range').selectOption('');
await seen(page.locator('a[href*="/executions/"]'));
const runs = await page.locator('a[href*="/executions/"]').count();
record(runs > 0, `executions list: renders its rows once loaded (${runs} runs)`);

const firstRun = await page.locator('a[href*="/executions/"]').first().getAttribute('href');

await check('execution detail', `${BASE}${firstRun}`, () =>
  seen(page.getByText('Summary', { exact: true })),
);

// --- issues, the other screen the issue names -------------------------------

await check('issues list', `${BASE}/workspace/${WORKSPACE}/issues`, () =>
  seen(page.getByText(/opened by/)),
);

await check('issue detail', `${BASE}/workspace/${WORKSPACE}/issues/117`, () =>
  seen(page.getByText('#117', { exact: true })),
);

await browser.close();

const passed = results.every(Boolean);
console.log(passed ? 'ALL PASS' : 'SOME FAILED');
process.exit(passed ? 0 : 1);
