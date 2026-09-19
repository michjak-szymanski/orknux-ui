/**
 * The page a list is on, and the workspace switch that used to keep it.
 *
 * Reported 2026-09-06: open Acme Support, go to Triggers, turn to page 3,
 * switch workspace - and the triggers list is empty on a workspace that has
 * triggers. The page number is state on a screen the switcher does not
 * unmount: the route is the same shape with a different id, so React keeps the
 * component and the number with it, and page 3 of a workspace with one page is
 * a truthful answer of nothing.
 *
 * Every paged list on a workspace had it; the triggers screen is where it was
 * found. What is asserted here is the rule rather than the screen: **turning a
 * page and then switching workspace lands on the first page of the new one**,
 * and the list drawn is that workspace's.
 *
 * It makes its own two workspaces - one with enough triggers for three pages,
 * one with a single trigger - because the bug needs a "before" with more pages
 * than the "after". Both are removed at the end, and any left by a killed run
 * are swept at the start.
 */
import { BASE, open, record, drawn, finish } from './suite/harness.mjs';

const PREFIX = 'zzPageReset';
/*
 * Stamped, because removing a workspace does not release its name - the
 * definition stays and the name stays taken with it, so a second run of a
 * check that reused one would be refused by the server rather than by
 * anything it is testing.
 */
const STAMP = Date.now();
/*
 * The default every list footer starts on - `DEFAULT_PAGE_SIZE` in
 * `src/components/pageSize.ts`. The triggers list paged at five when this was
 * written; the footers were then given a shared picker defaulting to ten, and
 * a fixture one trigger past two five-row pages stopped reaching page 3.
 */
const PAGE_SIZE = 10;

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const sweep = async () => {
  const { workspaces } = await graphql(`query { workspaces(page: 0, size: 200) { content { id name } } }`);
  for (const old of workspaces.content.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeWorkspace(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept workspace ${old.name} (#${old.id})`);
  }
};

await sweep();

const workspaceCalled = async (name) =>
  (
    await graphql(`mutation($input: CreateWorkspaceInput!) { createWorkspace(input: $input) { id } }`, {
      input: { name, description: 'Made by page-reset-check, and removed again.' },
    })
  ).createWorkspace.id;

const trigger = (workspaceId, name) =>
  graphql(`mutation($input: CreateTriggerInput!) { createTrigger(input: $input) { id } }`, {
    input: { workspaceId, name, type: 'SCHEDULED', cron: '0 0 * * *', timezone: 'UTC' },
  });

/* Three pages here, one page there. */
const many = await workspaceCalled(`${PREFIX} many ${STAMP}`);
for (let n = 0; n < PAGE_SIZE * 2 + 1; n += 1) await trigger(many, `${PREFIX} trigger ${n + 1}`);

const few = await workspaceCalled(`${PREFIX} few ${STAMP}`);
await trigger(few, `${PREFIX} the only one`);

const clean = async () => {
  await sweep();
  await finish(browser);
};

/* -------------------------------------------------------------------- drive */

await page.goto(`${BASE}/workspace/${many}/triggers`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the triggers screen', { within: 30_000 }))) await clean();

/*
 * The rows, counted by the way into each one. The list is divs with hashed
 * class names, and every row carries a link titled "Settings for <name>".
 */
const rows = async () =>
  (
    await page.$$eval('a[title^="Settings for "]', (found) =>
      // By name: a row carries more than one way into the same trigger, so
      // counting the links counts each row twice.
      new Set(found.map((one) => one.getAttribute('title'))).size,
    )
  );

/*
 * Which page the pager says it is on. Scoped to a number, because the top
 * navigation marks the current section with `aria-current="page"` too and it
 * comes first in the document.
 */
const pagerSays = async () => {
  const shown = page.locator('[aria-current="page"]').filter({ hasText: /^\s*\d+\s*$/ });
  return (await shown.count()) === 0 ? '' : (await shown.first().innerText()).trim();
};

// Waited for rather than assumed: `drawn` answers about the screen, and the
// list is one fetch further on than the screen it is drawn in.
await page.waitForSelector('a[title^="Settings for "]', { timeout: 20_000 }).catch(() => undefined);
const first = await rows();
record(first > 0, `the workspace with many triggers draws ${first} rows on its first page`);

/* ---- to page three, the way somebody does it ---- */

for (let turned = 0; turned < 2; turned += 1) {
  await page.getByRole('button', { name: 'Next', exact: true }).first().click();
  await page.waitForTimeout(600);
}

const onThird = await pagerSays();
record(onThird === '3', `the list is on page 3 (${JSON.stringify(onThird)})`);

/* ---- switch workspace, which is the whole of the report ---- */

await page.selectOption('select[aria-label="Selected workspace"]', few);
await page.waitForTimeout(1200);
if (!(await drawn(page, 'the triggers screen after switching', { within: 30_000 }))) await clean();

record(
  page.url().includes(`/workspace/${few}/`),
  `switching lands on the other workspace (${page.url().replace(BASE, '')})`,
);

const after = await rows();
record(
  after > 0,
  `and its trigger is drawn rather than an empty page 3 of a workspace with one page (${after} rows)`,
);

const nowOn = await pagerSays();
record(nowOn === '1' || nowOn === '', `and the list is back on the first page (${JSON.stringify(nowOn)})`);

await clean();
