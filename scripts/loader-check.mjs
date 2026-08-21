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
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

/** Long enough to clear the loader's three-second quiet period. */
const HELD_MS = 4000;

const { browser, context, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

// The loader is the only role=status that carries the waiting label.
const loader = page.locator('[role="status"]', { hasText: 'Loading' });

let holding = false;
/*
 * Whether the executions list is to be answered with nothing.
 *
 * "A list which finished loading and is genuinely empty says so" is half of
 * #117, and it used to be reached by leaning on the fixture: *this workspace's
 * runs are all older than a day, so the default range loads to an empty list*.
 * That is a sentence about one database. Against a workspace whose runs are
 * recent the list drew rows, the empty sentence never came, and the check
 * reported that the screen never settled - a fixture assumption read back as a
 * loading bug, on a screen that was working. So the emptiness is made here
 * rather than hoped for, the way catalogue-failure-check makes its failures.
 */
let emptying = false;
await page.route('**/graphql', async (route) => {
  if (holding) await new Promise((resolve) => setTimeout(resolve, HELD_MS));
  if (emptying && (route.request().postData() ?? '').includes('WorkspaceExecutions')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { workspaceExecutions: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 } },
      }),
    });
  }
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

const EXECUTIONS = `${BASE}/workspace/${WORKSPACE}/executions`;

/**
 * Either answer this screen is allowed to settle on: the rows it found, or the
 * sentence saying it found none. Which of the two it is depends on what is in
 * the database and is not what this assertion is about - what it is about is
 * that the mark goes away when one of them arrives.
 */
const listSettled = () =>
  Promise.any([
    seen(page.locator('a[href*="/executions/"]')),
    seen(page.getByText('No runs match those filters.')),
  ]);

await check('executions list', EXECUTIONS, listSettled);

// And the same screen with nothing to show, which is the case worth being
// careful about: the loader has to give way to words, not go on turning over a
// list that has finished.
emptying = true;
await check('executions list, answered empty', EXECUTIONS, () =>
  seen(page.getByText('No runs match those filters.')),
);
record(
  await page.getByText('No runs match those filters.').first().isVisible(),
  'executions list: a list that loaded empty says so rather than spinning',
);
emptying = false;

// The same list with rows in it, so the settled state is not only the empty one.
await page.goto(EXECUTIONS, { waitUntil: 'domcontentloaded' });
/*
 * The control, waited for rather than reached for. This screen is behind a
 * loader like the rest, so a `selectOption` the moment the navigation resolves
 * is a `selectOption` against a page that has drawn nothing - which ends the
 * whole script in a stack trace and leaves everything below it unrun and
 * unreported.
 */
const range = page.getByLabel('Date range');
const filtersDrew = await range
  .waitFor({ state: 'visible', timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
let runs = 0;
if (!filtersDrew) {
  record(false, 'executions list: the Date range filter never drew, so the rows could not be asked for');
} else {
  await range.selectOption('');
  const anyRuns = await seen(page.locator('a[href*="/executions/"]'))
    .then(() => true)
    .catch(() => false);
  runs = anyRuns ? await page.locator('a[href*="/executions/"]').count() : 0;
  record(runs > 0, `executions list: renders its rows once loaded (${runs} runs)`);
}

/*
 * The detail screen needs a run to open, and this is the one thing here that
 * cannot be made up: it is why the check is marked as needing a fixture. With
 * no run at all, that is said rather than thrown - everything above has already
 * been judged and is worth reporting.
 */
if (runs === 0) {
  record(false, 'execution detail: this workspace has no run to open, so the detail screen is unread');
} else {
  const firstRun = await page.locator('a[href*="/executions/"]').first().getAttribute('href');

  await check('execution detail', `${BASE}${firstRun}`, () =>
    seen(page.getByText('Summary', { exact: true })),
  );
}

// --- issues, the other screen the issue names -------------------------------

await check('issues list', `${BASE}/workspace/${WORKSPACE}/issues`, () =>
  seen(page.getByText(/opened by/)),
);

/*
 * Whichever issue the tracker opens with, rather than the number this was
 * written against. What is asserted is the same either way - a detail screen
 * shows the mark while it fetches and stops once it has - and a hard-coded
 * number is a fixture only one database has.
 */
const { workspaceIssues } = await graphql(
  'query($w: ID!) { workspaceIssues(workspaceId: $w, page: 0, size: 1) { content { number } } }',
  { w: WORKSPACE },
);
const anIssue = workspaceIssues.content[0]?.number;
if (anIssue === undefined) {
  record(false, 'issue detail: there are no issues in this workspace to open');
} else {
  await check('issue detail', `${BASE}/workspace/${WORKSPACE}/issues/${anIssue}`, () =>
    seen(page.getByText(`#${anIssue}`, { exact: true })),
  );
}

await finish(browser);
