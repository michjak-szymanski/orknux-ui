/**
 * What an issue is, as against what is said about it.
 *
 * Issue #241. The tracker had labels and nothing else, so "is this a bug or a
 * feature" was a convention somebody kept by typing the same word carefully.
 * A type is a row in the workspace's own list instead: exactly one per issue or
 * none, administered in the settings, and refused deletion while issues carry
 * it.
 *
 * Three things are driven here, and each is a thing a label could not have
 * done:
 *
 *   Settings -> Issues      a type is added, and appears with a count
 *   the list                the type filter narrows it, and Untyped narrows it
 *                           the other way
 *   Settings -> Issues      deleting one that issues carry is refused, in
 *                           words, saying how many
 *
 * The last is the one worth driving in a browser rather than asserting on the
 * server, because the whole of it is that an administrator is *told*: the count
 * is on the row before anything is pressed, and the refusal that comes back is
 * printed as the server wrote it rather than rephrased into "Could not delete".
 *
 * A type and two issues of this check's own, made and removed over GraphQL, so
 * nothing anybody else reads is touched by running it. The type's name carries
 * the mark for the same reason the issues' titles do - a run killed halfway
 * through leaves rows behind, and the sweep at the top is what makes the next
 * run honest.
 */
import { BASE, WORKSPACE, open, drawn, record, shot, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const MARK = 'issueTypesCheck';

const LIST = `query($id: ID!, $q: String) {
  workspaceIssues(workspaceId: $id, page: 0, size: 100, search: $q) { content { id title } }
}`;
const TYPES = `query($id: ID!) { workspaceIssueTypes(workspaceId: $id) { id name issues } }`;

/** Whatever an earlier run died holding. Issues first: a type in use will not go. */
const sweep = async () => {
  const left = await graphql(LIST, { id: WORKSPACE, q: MARK });
  for (const old of left.workspaceIssues.content.filter((held) => held.title.startsWith(MARK))) {
    await graphql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept ${old.title} from an earlier run`);
  }
  const held = await graphql(TYPES, { id: WORKSPACE });
  for (const old of held.workspaceIssueTypes.filter((one) => one.name.startsWith(MARK))) {
    await graphql(`mutation($id: ID!) { deleteIssueType(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept the type ${old.name} from an earlier run`);
  }
};

await sweep();

const file = async (title, typeId = null) => {
  const made = await graphql(`mutation($input: IssueInput!) { createIssue(input: $input) { id number title } }`, {
    input: { workspaceId: WORKSPACE, title, status: 'OPEN', typeId },
  });
  return made.createIssue;
};

/* ------------------------------------------- the settings card adds a type */

const NAME = `${MARK}-chore`;

await page.goto(`${BASE}/workspace/${WORKSPACE}/settings`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'workspace settings')) {
  /*
   * `drawn` says the page has settled on something, not that this card is on
   * it: the shell and the heading arrive first and the workspace itself - which
   * is what `administered` is read off, and this card is behind - arrives after.
   * So counting the box the moment `drawn` returns is a coin toss, and it came
   * down tails often enough to report a missing card on a page that then let
   * the very next line type into it.
   *
   * Every wait in this file is on the thing about to be read, with the count
   * left to decide. A box that never arrives is still counted as zero.
   */
  const box = page.locator('input#new-issue-type');
  await box.waitFor({ timeout: 15_000 }).catch(() => undefined);
  record((await box.count()) === 1, 'settings: the Issues card is on the workspace settings page');

  await box.fill(NAME);
  await page.locator('button', { hasText: /^Add$/ }).first().click();

  const row = page.locator('button', { hasText: NAME }).first();
  await row.waitFor({ timeout: 15_000 }).catch(() => undefined);
  record((await row.count()) === 1, `settings: ${NAME} is in the list after adding it`);

  // The count is on the row, before anything is pressed. That is the point of
  // it: the refusal below must not be the first anybody hears of it.
  const counts = await page.locator('li').filter({ hasText: NAME }).allInnerTexts();
  record(
    counts.some((said) => said.includes('0 issues')),
    `settings: and says how many issues carry it (${JSON.stringify(counts)})`,
  );
  await page.screenshot({ path: shot('issue-types-settings.png') });
}

const made = await graphql(TYPES, { id: WORKSPACE });
const mine = made.workspaceIssueTypes.find((one) => one.name === NAME);
record(mine !== undefined, 'settings: and the server has it, not only the page');

/* --------------------------------------------------- the list filters by it */

const typed = await file(`${MARK} something broke`, mine?.id ?? null);
const untyped = await file(`${MARK} nobody has decided`);

await page.goto(`${BASE}/workspace/${WORKSPACE}/issues?q=${MARK}`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the issue list')) {
  // The filter is only drawn once the workspace's types have been fetched, and
  // the rows once the search has: both after `drawn` is satisfied by the shell.
  const filter = page.locator('select[aria-label="Filter by type"]');
  await filter.waitFor({ timeout: 15_000 }).catch(() => undefined);
  record((await filter.count()) === 1, 'list: there is a type filter beside the states');

  const rows = page.locator('a[href*="/issues/"]');
  await rows.nth(1).waitFor({ timeout: 15_000 }).catch(() => undefined);
  const both = await rows.allInnerTexts();
  record(
    both.some((said) => said.includes('something broke')) && both.some((said) => said.includes('nobody has decided')),
    `list: unfiltered, both issues are there (${both.length} rows)`,
  );

  /*
   * Choosing a filter re-queries, and while it does the list holds nothing at
   * all: the rows are behind `!loading` and the loader draws nothing for its
   * first three seconds. So the window between pressing and answering is an
   * empty list, indistinguishable from a filter that matched nothing - which is
   * exactly what a naive "wait until the other one has gone" walks into, and
   * did: it was satisfied by the blank and read `[]` off both filters.
   *
   * What is waited for is the query settling, not the answer being the right
   * one: a row drawn, or the sentence a settled empty answer prints. Which rows
   * they are is left to the assertion, which is the whole point of it. The half
   * second in front is for the refetch to start, so a list that has not yet
   * been emptied is not mistaken for one that has already come back.
   */
  const settled = () =>
    page
      .waitForFunction(
        () =>
          document.querySelectorAll('a[href*="/issues/"]').length > 0 ||
          /Nothing matches that\.|Nothing open\./.test(document.body.innerText ?? ''),
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => undefined);

  if ((await filter.count()) === 1 && mine !== undefined) {
    await filter.selectOption(mine.id);
    await page.waitForTimeout(500);
    await settled();
    const only = await rows.allInnerTexts();
    record(
      only.some((said) => said.includes('something broke')) &&
        !only.some((said) => said.includes('nobody has decided')),
      `list: filtered to ${NAME}, only the typed one is left (${JSON.stringify(only.map((s) => s.slice(0, 40)))})`,
    );

    // The half a nullable id could not have asked for, and the half that
    // matters most on a tracker older than its types.
    await filter.selectOption('untyped');
    await page.waitForTimeout(500);
    await settled();
    const none = await rows.allInnerTexts();
    record(
      none.some((said) => said.includes('nobody has decided')) && !none.some((said) => said.includes('something broke')),
      `list: filtered to Untyped, only the untyped one is left (${JSON.stringify(none.map((s) => s.slice(0, 40)))})`,
    );
    await page.screenshot({ path: shot('issue-types-filter.png') });
  }
}

/* ------------------------------- and deleting one in use is refused, in words */

await page.goto(`${BASE}/workspace/${WORKSPACE}/settings`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'workspace settings')) {
  const held = page.locator('li').filter({ hasText: NAME });
  await held.first().waitFor({ timeout: 15_000 }).catch(() => undefined);

  const said = await held.allInnerTexts();
  record(
    said.some((one) => one.includes('1 issue')),
    `settings: the row now says one issue carries it (${JSON.stringify(said)})`,
  );

  await page.locator(`button[aria-label="Delete ${NAME}"]`).click();

  const alert = page.locator('[role="alert"]');
  await alert.first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  const refusal = await alert.allInnerTexts();
  record(
    refusal.some((one) => one.includes('cannot be deleted') && one.includes('1 issue')),
    `settings: deleting it is refused, and the refusal says how many (${JSON.stringify(refusal)})`,
  );
  record(
    (await page.locator('button', { hasText: NAME }).count()) === 1,
    'settings: and the type is still there afterwards',
  );
  await page.screenshot({ path: shot('issue-types-in-use.png') });
}

/* Retyped, and now it goes - which is the way out the refusal names. */
await graphql(`mutation($id: ID!, $input: IssueInput!) { updateIssue(id: $id, input: $input) { id } }`, {
  id: typed.id,
  input: { typeId: '' },
});
const gone = await graphql(`mutation($id: ID!) { deleteIssueType(id: $id) }`, { id: mine?.id }).catch(() => null);
record(gone?.deleteIssueType === true, 'settings: once nothing carries it, the same delete goes through');

/* ------------------------------------------------------------------- tidy up */

for (const held of [typed, untyped]) {
  await graphql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: held.id }).catch(() => undefined);
}
await sweep();

await finish(browser);
