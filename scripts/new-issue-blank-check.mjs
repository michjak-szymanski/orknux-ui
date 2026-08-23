/**
 * A new issue starts blank, and one issue does not leak into the next.
 *
 * Issue #238. Somebody reading an issue opened Quick actions, chose "Create
 * issue", and the form came up already filled in with the title and the
 * description of the issue they had been reading - so filing it would have
 * duplicated the report they were looking at.
 *
 * Nothing was being restored and nothing was being remembered: `/issues/4` and
 * `/issues/new` are two addresses on one component, React kept the instance
 * across the move because its type and its position had not changed, and the
 * form was simply the old page with the load effect switched off. So this
 * drives the reported route, then the same defect one door along, and - the
 * half that matters more - the place on this page where state is *meant* to
 * survive:
 *
 *   detail -> Quick actions -> Create issue   the form is empty
 *   detail -> Quick actions -> another issue  the comment box does not travel
 *   File another, ticked                      the label DOES stay, and so does
 *                                             the line naming what was filed
 *
 * The last one is why the fix is a key on the address rather than a reset on
 * mount. A page that empties itself when it mounts would pass everything above
 * it here and quietly throw away the run of issues somebody was filing.
 *
 * Everything is reached through Quick actions rather than through `page.goto`,
 * and that is not a convenience: a `goto` unloads the whole application and
 * mounts a fresh component, so it would find nothing wrong however broken this
 * is. The bug only exists inside one running page.
 *
 * Two issues of this check's own, made and deleted over GraphQL, so nothing
 * anybody else reads is touched by running it.
 */
import { BASE, WORKSPACE, open, drawn, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const MARK = 'newIssueBlankCheck';

const LIST = `query($id: ID!, $q: String) {
  workspaceIssues(workspaceId: $id, page: 0, size: 100, search: $q) { content { id title } }
}`;

/*
 * Anything a run that died halfway through left behind - the same sweep the
 * leave-guard checks do, and for the same reason: the end of this file is not
 * reached when an assertion throws or the suite's timeout kills it.
 */
const left = await graphql(LIST, { id: WORKSPACE, q: MARK });
for (const old of left.workspaceIssues.content.filter((held) => held.title.startsWith(MARK))) {
  await graphql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept ${old.title} (#${old.id}) from an earlier run`);
}

const file = async (title, description, labels = []) => {
  const made = await graphql(`mutation($input: IssueInput!) { createIssue(input: $input) { id number title } }`, {
    input: { workspaceId: WORKSPACE, title, description, labels, status: 'OPEN' },
  });
  console.log(`made ${made.createIssue.title} (#${made.createIssue.number})`);
  return made.createIssue;
};

/* Labelled, so "no label came across" is an assertion about something rather
   than about an issue that never had one. */
const first = await file(`${MARK} the one being read`, 'A description that must not travel.', [
  `${MARK}-seeded-label`,
]);
const second = await file(`${MARK} the one read next`, 'Another description entirely.');

/* -------------------------------------------------------------- the rulers */

const titleBox = page.locator('input[aria-label="Title"]');
const descriptionBox = page.locator('[aria-label="Description"]').first();

async function openIssue(number, called) {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/${number}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, `issue #${number}`))) return false;
  // The load has to have landed in the fields, not merely drawn the shell:
  // reading an empty box a beat too early would pass every assertion below.
  await page
    .waitForFunction((wanted) => document.querySelector('input[aria-label="Title"]')?.value === wanted, called, {
      timeout: 20_000,
    })
    .catch(() => undefined);
  return true;
}

/** Quick actions, typed into and taken up on: a router navigation, not a reload. */
async function palette(typed, going) {
  const box = page.locator('input[aria-label="Quick actions"]');
  await box.click();
  await box.fill(typed);
  await page.waitForTimeout(600);
  await page.locator('[role="option"]', { hasText: typed }).first().click();
  await page.waitForURL(going, { timeout: 20_000 });
  await page.waitForTimeout(1000);
}

/** What the form holds right now, as one object, so a failure prints both halves. */
const form = async () => ({
  title: await titleBox.inputValue(),
  description: (await descriptionBox.count()) === 0 ? '' : await descriptionBox.inputValue(),
});

/* ------------------------------------- the reported route: through Quick actions */

if (await openIssue(first.number, `${MARK} the one being read`)) {
  record((await form()).title !== '', 'the issue being read has its title in the box, as it always did');
  record((await page.locator('button[title="Remove this label"]').count()) === 1, 'and its label beside it, likewise');

  await palette('Create issue', /\/issues\/new$/);

  const carried = await form();
  record(carried.title === '', `Quick actions: the new issue's title is empty (${JSON.stringify(carried.title)})`);
  record(
    carried.description === '',
    `Quick actions: and so is its description (${JSON.stringify(carried.description.slice(0, 60))})`,
  );
  record(
    (await page.locator('button[title="Remove this label"]').count()) === 0,
    'Quick actions: and the label of the issue being read did not come across either',
  );
}

/* --------------------------------------- one issue to the next, without a reload */

/*
 * The same defect one door along, and the one that says the fix is about the
 * page's identity rather than about the word `new`: two issues are also one
 * component at one position, so what was typed under the first one used to be
 * sitting in the box under the second.
 */
if (await openIssue(first.number, `${MARK} the one being read`)) {
  await page.locator('textarea[aria-label="Add a comment"]').fill('half a sentence about the first one');
  await page.waitForTimeout(300);

  await palette(`${MARK} the one read next`, new RegExp(`/issues/${second.number}$`));

  const held = await form();
  record(
    held.title.includes('the one read next'),
    `issue to issue: the second issue's own title is showing (${JSON.stringify(held.title)})`,
  );
  const boxes = await page.locator('textarea').evaluateAll((all) => all.map((one) => one.value));
  record(
    !boxes.some((text) => text.includes('half a sentence about the first one')),
    `issue to issue: and the comment typed under the first one did not come with it (${JSON.stringify(boxes)})`,
  );
}

/* ------------------------------- what must NOT be reset: a run of issues being filed */

/*
 * "File another" is the draft behaviour on this page, and it is what a
 * mount-time reset would have destroyed. Four issues filed in a row are usually
 * four issues about one thing, so filing one keeps the labels and the assignee
 * for the next - and the address does not change while that is happening, which
 * is exactly why a key on the address is safe where a reset is not.
 */
await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/new`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[aria-label="Title"]', { timeout: 20_000 });
await page.waitForTimeout(700);

await page.locator('label', { hasText: 'File another' }).locator('input[type="checkbox"]').check();
await page.locator('input[aria-label="Add a label"]').fill(`${MARK}-label`);
await page.keyboard.press('Enter');
await titleBox.fill(`${MARK} first of a run`);
await page.locator('button', { hasText: /^File Issue$/ }).click();
await page.waitForTimeout(3000);

record(page.url().endsWith('/issues/new'), `File another: still on the form (${page.url()})`);
record((await form()).title === '', 'File another: with the title cleared for the next one');
record(
  (await page.locator('button[title="Remove this label"]').count()) === 1,
  'File another: and the label kept, which is the whole point of the checkbox',
);
record(
  (await page.locator('[role="status"]').allInnerTexts()).some((said) => said.includes('The next one is ready')),
  'File another: and the one just filed is still named on the form',
);

/* ------------------------------------------------------------------- tidy up */

const mine = await graphql(LIST, { id: WORKSPACE, q: MARK });
for (const held of mine.workspaceIssues.content.filter((one) => one.title.startsWith(MARK))) {
  await graphql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: held.id }).catch((cause) => {
    console.log(`could not delete ${held.title} (#${held.id}): ${cause.message}`);
  });
}

await finish(browser);
