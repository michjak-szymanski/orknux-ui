/**
 * The way back out of an issue returns to the list somebody was actually on.
 *
 * Issue #317. The filters live in the address — that is deliberate, and it is
 * what makes "the open p1 ones" a link rather than a sentence — but every way
 * out of an issue named the list by its bare address. So filtering a tracker
 * down to the four issues that matter, opening one of them and pressing the
 * arrow put you back at Open, newest first, with the filtering to do again.
 *
 * Four things this is here to catch:
 *
 *   the arrow      the back arrow returns to the filtered list, not the bare one
 *   the list       and the list that comes back is narrowed, so the address is
 *                  not merely decorated with a query nothing acted on
 *   the reload     a filtered list, an issue, a refresh of that issue, and the
 *                  arrow still knows the way back. The filters ride on the
 *                  history entry, and an entry that did not survive a reload
 *                  would be a fix that worked only until somebody refreshed
 *   the deep link  an issue opened by its own address — pasted, or followed
 *                  from somewhere else — still has an arrow, and it goes to the
 *                  bare list. Carrying nothing is the right answer there, and a
 *                  fix that broke this would be worse than the bug
 *
 * And the thing the fix must not do, checked by not looking for it: the issue's
 * own address is untouched. An issue's URL is what people paste to each other,
 * and two links to one issue that differ by somebody else's filters are two
 * links that look like two pages — so the filters are on the history entry and
 * the address of the issue is asserted to be exactly its own.
 *
 * Files two issues and deletes them, and sweeps what an earlier killed run left.
 */
import { BASE, WORKSPACE, open, drawn, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const MARK = 'zzIssueFiltersBack';

/** The filters put on the list, which are the thing that has to come back. */
const FILTERS = `?q=${MARK}&status=all&order=TITLE&dir=asc`;

const LIST = `query($id: ID!, $q: String) {
  workspaceIssues(workspaceId: $id, page: 0, size: 100, search: $q) { content { id number title } }
}`;

const held = async () => {
  const found = await graphql(LIST, { id: WORKSPACE, q: MARK });
  return found.workspaceIssues.content.filter((one) => one.title.startsWith(MARK));
};

const sweep = async () => {
  for (const old of await held()) {
    await graphql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept ${old.title} (#${old.number})`);
  }
};

await sweep();

async function file(title) {
  const made = await graphql(`mutation($input: IssueInput!) { createIssue(input: $input) { id number title } }`, {
    input: {
      workspaceId: WORKSPACE,
      title: `${MARK} ${title}`,
      description: 'Filed by issue-filters-back-check, and deleted by it.',
      status: 'OPEN',
    },
  });
  console.log(`filed ${made.createIssue.title} (#${made.createIssue.number})`);
  return made.createIssue;
}

const first = await file('aaa the one that is opened');
const second = await file('bbb the one that stays in the list');

/* ------------------------------------------------------------------ reading */

/** How many rows the list is showing, whatever else is on the page. */
const rows = () => page.$$eval('a[href*="/issues/"]', (found) => found.length);

/** Where the back arrow points, or null if there is not one. */
const backTo = () =>
  page.$eval('a[aria-label="Back to Issues"]', (one) => one.getAttribute('href')).catch(() => null);

const clean = async () => {
  await sweep();
  await finish(browser);
};

/* -------------------------------------------------------------------- drive */

await page.goto(`${BASE}/workspace/${WORKSPACE}/issues${FILTERS}`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the issue list'))) await clean();

const narrowed = await page
  .waitForSelector(`text=${MARK} aaa the one that is opened`, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
record(narrowed, 'the filtered list shows the issues it was filtered to');

if (!narrowed) await clean();

const showing = await rows();

/* ---- through an issue and back again ---- */

await page.click(`text=${MARK} aaa the one that is opened`);
await page.waitForURL(`**/issues/${first.number}`, { timeout: 20_000 });
// The arrow is drawn with the issue, so it is not there the instant the address
// changes; reading before it lands would be measuring the loading.
await page.waitForSelector('a[aria-label="Back to Issues"]', { timeout: 20_000 });

record(
  page.url().endsWith(`/issues/${first.number}`),
  `the issue's own address carries no filters, so a link to it is a link to it (${page.url().replace(BASE, '')})`,
);

const points = await backTo();
record(
  points !== null && points.includes(`q=${MARK}`),
  `the back arrow points at the filtered list (${JSON.stringify(points)})`,
);

await page.click('a[aria-label="Back to Issues"]');
// Tolerated rather than awaited: an arrow pointing at the bare list lands on
// the bare list, which is the bug, and a check that threw there would report
// nothing at all about the four things after it.
await page.waitForURL('**/issues?*', { timeout: 10_000 }).catch(() => undefined);

record(page.url().includes(`q=${MARK}`), `and pressing it lands on the filtered list (${page.url().replace(BASE, '')})`);

/*
 * Waited for rather than asserted on: this issue is on the unfiltered list too,
 * so finding it proves the list has drawn and nothing more. What the list is
 * narrowed *to* is the count below - the bare list is ten rows and this one is
 * two, and that is the difference the arrow either kept or lost.
 */
const back = await page
  .waitForSelector(`text=${MARK} bbb the one that stays in the list`, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
const came = back ? await rows() : 0;
record(
  came === showing,
  `and the list that comes back is the one that was left: ${showing} rows before, ${came} after`,
);

/* ---- the same, with a refresh in the middle ---- */

await page.click(`text=${MARK} aaa the one that is opened`);
await page.waitForURL(`**/issues/${first.number}`, { timeout: 20_000 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('a[aria-label="Back to Issues"]', { timeout: 20_000 });

const afterReload = await backTo();
record(
  afterReload !== null && afterReload.includes(`q=${MARK}`),
  `the way back survives a refresh of the issue (${JSON.stringify(afterReload)})`,
);

/* ---- and an issue nobody opened from a list ---- */

/*
 * The other issue, and by way of the bare list.
 *
 * Not the one just visited: a browser told to go to the address it is already
 * on keeps the history entry it is standing on, filters and all, so opening
 * that one again would be measuring this check rather than the page.
 */
await page.goto(`${BASE}/workspace/${WORKSPACE}/issues`, { waitUntil: 'domcontentloaded' });
await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/${second.number}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('a[aria-label="Back to Issues"]', { timeout: 20_000 });

const deepLinked = await backTo();
record(
  deepLinked !== null && !deepLinked.includes('?'),
  `an issue opened by its own address still has an arrow, and it goes to the bare list ` +
    `(${JSON.stringify(deepLinked)})`,
);

await clean();
