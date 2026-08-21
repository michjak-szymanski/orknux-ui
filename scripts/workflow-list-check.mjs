/**
 * How many workflows at a time, and in what order.
 *
 * The report (issue 145): "Workflow list is missing show X per page and sorting
 * method". The issue list had both and this one had neither - a fixed four rows
 * a page, and always by name.
 *
 * The half of this worth being careful about is the sorting, because a sort
 * that only orders the rows on screen looks exactly like one that works. So
 * nothing here asserts that "the page changed" - every assertion is about the
 * whole list:
 *
 *   - the two pages read one after the other are the whole list in order, not
 *     two pages each sorted inside themselves;
 *   - descending is the exact reverse of ascending, across both pages;
 *   - a workflow that has never run comes after every one that has, whichever
 *     way round the last-run order is;
 *   - the switched-off ones are together, at the end or at the start.
 *
 * The order the page draws is read out of the DOM. What it is compared against
 * comes from a separate GraphQL call over the same session, so the check knows
 * each row's last run and switch without reading a relative time like "3 days
 * ago" back into a date.
 *
 * The fixture is workflows of its own, removed at the end: enough to take the
 * workspace past one page, and never fewer than three, one of them switched
 * off. Without that last part the order by the switch has one answer for every
 * row and cannot be wrong. The last-run order is the one thing here that reads
 * what is already in the workspace rather than making it - a run cannot be
 * started on a workflow with no nodes in it - so this wants a workspace where
 * at least two workflows have run, which is what the seed builds.
 */
import { BASE, WORKSPACE, open, record, finish, shot } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/** Unique, because removing a workflow leaves its definition and its name taken. */
const STAMP = Date.now();

/**
 * Enough rows that there is a second page to be wrong about.
 *
 * Ten a page, so twelve is the smallest list where "sorted the page" and
 * "sorted the list" can be told apart. Whatever the workspace already holds,
 * this tops it up to that - and never adds fewer than three, because one of
 * them is switched off and the order by the switch needs both answers present.
 */
const WANTED = 12;
const LEAST = 3;

const LIST = `
  query List($w: ID!, $p: Int!, $s: Int!, $o: WorkflowOrder, $a: Boolean) {
    workspaceWorkflows(workspaceId: $w, page: $p, size: $s, order: $o, ascending: $a) {
      totalElements
      content { id name enabled lastRun { startedAt } }
    }
  }
`;

/** What the server says the list is, in the order asked for. */
const asServer = async (order, ascending, size = 200, wanted = 0) =>
  (await graphql(LIST, { w: WORKSPACE, p: wanted, s: size, o: order, a: ascending })).workspaceWorkflows;

/** What the page has actually drawn: one entry per row, in the order drawn. */
const asDrawn = () =>
  page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="/workflows/"][href$="/editor"]')];
    return links.map((link) => ({
      name: link.textContent.trim(),
      enabled: link.parentElement?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true',
    }));
  });

const names = (rows) => rows.map((row) => row.name);
const same = (a, b) => a.length === b.length && a.every((one, at) => one === b[at]);

/** The footer's own sentence, and the total it claims. */
async function footer() {
  const said = (await page.locator('p:has-text("Showing")').first().innerText()).trim();
  return { said, total: Number(/of (\d+)/.exec(said)?.[1] ?? -1) };
}

/** Waits for the rows to settle after a control was used. */
async function settle() {
  await page.waitForSelector('text=Showing', { timeout: 20_000 });
  await page.waitForTimeout(900);
}

async function choose(order) {
  await page.selectOption('#workflow-order', order);
  await settle();
}

/** Presses the direction switch and answers with the direction it is now in. */
async function flip() {
  await page.locator('button[aria-label^="Sorted"]').click();
  await settle();
  return (await page.locator('button[aria-label^="Sorted"]').getAttribute('aria-label')) === 'Sorted ascending';
}

async function showPerPage(size) {
  await page.selectOption('select[aria-label="How many templates to show at once"]', String(size));
  await settle();
}

// ------------------------------------------------------------------- fixture

const held = (await asServer(null, null, 1)).totalElements;
const needed = Math.max(LEAST, WANTED - held);
const created = [];
for (let index = 0; index < needed; index += 1) {
  // Numbered from the end of the alphabet so they land together, which keeps
  // them out of the middle of whatever the workspace already has.
  const name = `zz sort check ${STAMP} ${String(index + 1).padStart(2, '0')}`;
  const made = await graphql(
    `mutation Make($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id name } }`,
    { input: { workspaceId: WORKSPACE, name } },
  );
  created.push(made.createWorkflow.id);
  // The first is switched off, so the switch is not one answer for every row.
  if (index === 0) {
    await graphql(`mutation Off($id: ID!) { setWorkflowEnabled(id: $id, enabled: false) { id } }`, {
      id: made.createWorkflow.id,
    });
  }
}
console.log(`the workspace held ${held}; made ${created.length} scratch workflows: ${created.join(', ')}`);

let failed = false;
try {
  const whole = await asServer(null, null);
  const TOTAL = whole.totalElements;
  console.log(`workspace ${WORKSPACE} holds ${TOTAL} workflows`);
  record(TOTAL > 10, `the workspace has more than one page of workflows to order (${TOTAL})`);

  await page.goto(`${BASE}/workspace/${WORKSPACE}`, { waitUntil: 'domcontentloaded' });
  await settle();

  // ------------------------------------------------- how many at a time

  await showPerPage(10);
  const ten = await asDrawn();
  const tenSaid = await footer();
  record(ten.length === Math.min(10, TOTAL), `10 per page draws ${Math.min(10, TOTAL)} rows (drew ${ten.length})`);
  record(tenSaid.total === TOTAL, `the footer counts the whole list at 10 a page: "${tenSaid.said}"`);

  await showPerPage(25);
  const twentyFive = await asDrawn();
  const bigSaid = await footer();
  record(
    twentyFive.length === Math.min(25, TOTAL),
    `25 per page draws ${Math.min(25, TOTAL)} rows (drew ${twentyFive.length})`,
  );
  record(
    twentyFive.length > ten.length,
    `asking for more rows drew more rows (${ten.length} -> ${twentyFive.length})`,
  );
  record(bigSaid.total === TOTAL, `the footer still counts the whole list: "${bigSaid.said}"`);

  // The size is a fact about the screen somebody is at, so it outlives the page.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();
  const remembered = await page.locator('select[aria-label="How many templates to show at once"]').inputValue();
  record(remembered === '25', `the chosen size survives a reload (came back as ${remembered})`);

  await showPerPage(10);

  // --------------------------------------------- by name, across both pages

  await choose('NAME');
  let ascending = (await page.locator('button[aria-label^="Sorted"]').getAttribute('aria-label')) === 'Sorted ascending';
  record(ascending, 'a list of names opens ascending, not newest-first');

  const upFirst = await asDrawn();
  await page.locator('button:has-text("Next")').click();
  await settle();
  const upSecond = await asDrawn();
  const upDrawn = [...names(upFirst), ...names(upSecond)];

  /** The entire list by name, which is what "the whole list" below means. */
  const byName = names((await asServer('NAME', true)).content);
  record(
    same(upDrawn, byName.slice(0, upDrawn.length)),
    'the two pages read one after the other are the list in the order the server put it',
  );
  record(
    upSecond.length > 0 && !names(upFirst).includes(upSecond[0].name),
    `page two holds rows page one did not (${upSecond.length} of them)`,
  );

  /*
   * Choosing an order while on page two has to go back to page one. Page two of
   * one order is a different ten rows in another, and the number itself means
   * nothing across the change.
   */
  await choose('LAST_RUN');
  const backToFirst = (await footer()).said;
  record(/Showing 1-/.test(backToFirst), `a new order starts at the top again: "${backToFirst}"`);

  // ----------------------------------------- the same list, the other way up

  await choose('NAME');
  ascending = await flip();
  record(!ascending, 'the direction switch says descending after one press');

  const downFirst = await asDrawn();
  await page.locator('button:has-text("Next")').click();
  await settle();
  const downSecond = await asDrawn();
  const downDrawn = [...names(downFirst), ...names(downSecond)];

  /*
   * The whole point, in one line. If the sort were applied to the ten rows on
   * screen rather than to the list, the first page descending would hold the
   * same ten names as the first page ascending - just upside down - and this
   * would fail on the very first name.
   *
   * Against the whole list rather than against the two pages read going up.
   * `downDrawn === upDrawn.reverse()` is only true when those two pages *are*
   * the list; with twenty-two workflows in the workspace the two pages hold
   * twenty, so going up reads names one to twenty and coming down reads
   * twenty-two to three, and the check failed on a list the server had ordered
   * perfectly. It said so three times running before anybody noticed the
   * arithmetic was the check's, not the page's - the same shape as every other
   * false alarm here: an accident of one database written down as a fact.
   */
  record(
    same(downDrawn, [...byName].reverse().slice(0, downDrawn.length)),
    'descending is the whole list turned round, not each page turned round',
  );
  record(
    names(downFirst)[0] !== names(upFirst)[0],
    `the first row changed with the direction ("${names(upFirst)[0]}" -> "${names(downFirst)[0]}")`,
  );

  // ------------------------------------------------------------- by last run

  await choose('LAST_RUN');
  ascending = (await page.locator('button[aria-label^="Sorted"]').getAttribute('aria-label')) === 'Sorted ascending';
  if (ascending) ascending = await flip();
  record(!ascending, 'reading the most recently run first means descending');

  await showPerPage(100);
  const byRun = await asDrawn();
  const ranAt = new Map(
    (await asServer(null, null)).content.map((one) => [one.name, one.lastRun?.startedAt ?? null]),
  );
  const runTimes = names(byRun).map((name) => ranAt.get(name) ?? null);

  const neverFrom = runTimes.findIndex((at) => at === null);
  const neverLast = neverFrom === -1 || runTimes.slice(neverFrom).every((at) => at === null);
  record(neverLast, 'every workflow that has never run is below every one that has');

  const dated = runTimes.filter((at) => at !== null);
  const falling = dated.every((at, index) => index === 0 || at <= dated[index - 1]);
  record(dated.length > 1, `there is more than one run to put in order (${dated.length} of them)`);
  record(falling, 'the ones that have run are newest first');

  // Never-run is not oldest either: turning it round keeps them last.
  ascending = await flip();
  const byRunUp = await asDrawn();
  const upTimes = names(byRunUp).map((name) => ranAt.get(name) ?? null);
  const firstNull = upTimes.findIndex((at) => at === null);
  record(
    firstNull === -1 || upTimes.slice(firstNull).every((at) => at === null),
    'turned round, a workflow that has never run is still last rather than first',
  );
  const rising = upTimes.filter((at) => at !== null);
  record(
    rising.every((at, index) => index === 0 || at >= rising[index - 1]),
    'and the ones that have run are oldest first',
  );

  // ---------------------------------------------------------- by the switch

  await choose('ENABLED');
  ascending = (await page.locator('button[aria-label^="Sorted"]').getAttribute('aria-label')) === 'Sorted ascending';
  if (ascending) ascending = await flip();

  const bySwitch = await asDrawn();
  const offFrom = bySwitch.findIndex((row) => !row.enabled);
  record(
    bySwitch.some((row) => row.enabled) && bySwitch.some((row) => !row.enabled),
    'the list holds both switched-on and switched-off workflows to separate',
  );
  record(
    offFrom !== -1 && bySwitch.slice(offFrom).every((row) => !row.enabled),
    'switched on first, and every switched-off one after them',
  );

  await flip();
  const bySwitchUp = await asDrawn();
  const onFrom = bySwitchUp.findIndex((row) => row.enabled);
  record(
    onFrom !== -1 && bySwitchUp.slice(onFrom).every((row) => row.enabled),
    'and the other way round puts the switched-off ones first',
  );

  // ------------------------------------------- the order is in the address

  const address = new URL(page.url());
  record(
    address.searchParams.get('order') === 'ENABLED',
    `the order is in the address, so the list can be sent to somebody (?${address.searchParams})`,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();
  const afterReload = await page.locator('#workflow-order').inputValue();
  record(afterReload === 'ENABLED', `and it survives a reload (came back as ${afterReload})`);

  await page.screenshot({ path: shot('workflow-list-check.png'), fullPage: false });
} catch (cause) {
  failed = true;
  console.error(`FAIL: the check threw: ${cause instanceof Error ? cause.stack : String(cause)}`);
} finally {
  // The scratch workflows go whether or not the assertions passed; a check that
  // leaves rows behind changes the answer the next one gets.
  for (const id of created) {
    await graphql(`mutation Drop($id: ID!) { removeWorkflow(id: $id) }`, { id }).catch(() => {});
  }
  console.log(`removed ${created.length} scratch workflows`);
}

await finish(browser, !failed);
