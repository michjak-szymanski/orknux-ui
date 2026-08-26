/**
 * An issue being written is not thrown away without a word - including by the
 * workspace picker.
 *
 * Issue #234, and it was two holes rather than one. The issue form was the only
 * editor in the product with no leave guard on it at all, so every way out of it
 * lost what had been typed; and the workspace picker is a `<select>` and a
 * `navigate()`, which is the one exit the guard's document-level click listener
 * could never have seen even if the page had had one.
 *
 * Where switching lands is not what changed and is not asserted as a bug here:
 * a half-written issue belongs to the workspace it was started in, so leaving
 * the form is right, and `workspaceSwitchPath` already lands on the new
 * workspace's issue list. What was wrong was leaving silently. So:
 *
 *   untouched, switch      goes, and says nothing - the guard must not nag
 *   half written, switch   asks, has not moved, and the corner still names here
 *   Cancel                 stays, with the writing still in the boxes
 *   Leave                  goes, and nothing was filed in either workspace
 *   Save & Leave           goes, and the issue exists in the workspace it was
 *                          written in, not in the one we switched to
 *   a link out             asks as well, now that this page has a guard at all
 *   an issue only read     says nothing, because nothing was changed
 *
 * The corner is measured because it is a control the router does not own: the
 * browser puts the chosen name in the box before any code runs, and a question
 * answered with Cancel leaves a select claiming a workspace nobody is in unless
 * something puts it back.
 *
 * Files nothing it does not delete, and sweeps what an earlier killed run left.
 */
import { BASE, WORKSPACE, open, drawn, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const MARK = 'issueLeaveGuardCheck';

const LIST = `query($id: ID!, $q: String) {
  workspaceIssues(workspaceId: $id, page: 0, size: 100, search: $q) { content { id number title } }
}`;

/** Every workspace this account can see, so the check can pick a second one. */
const all = await graphql(`query { workspaces(page: 0, size: 50) { content { id name } } }`);
const elsewhere = all.workspaces.content.find((one) => one.id !== WORKSPACE);
if (elsewhere === undefined) {
  console.log(`FAIL: this account can see one workspace (#${WORKSPACE}), so there is nothing to switch to`);
  await browser.close();
  process.exit(1);
}
console.log(`switching between #${WORKSPACE} and ${elsewhere.name} (#${elsewhere.id})`);

const held = async (workspaceId) => {
  const found = await graphql(LIST, { id: workspaceId, q: MARK });
  return found.workspaceIssues.content.filter((one) => one.title.startsWith(MARK));
};

const sweep = async () => {
  for (const workspaceId of [WORKSPACE, elsewhere.id]) {
    for (const old of await held(workspaceId)) {
      await graphql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: old.id }).catch(() => undefined);
      console.log(`swept ${old.title} (#${old.number}) from workspace ${workspaceId}`);
    }
  }
};

await sweep();

const seeded = await graphql(`mutation($input: IssueInput!) { createIssue(input: $input) { id number title } }`, {
  input: {
    workspaceId: WORKSPACE,
    title: `${MARK} one that already exists`,
    description: 'Read, not written.',
    labels: [],
    status: 'OPEN',
  },
});
console.log(`made ${seeded.createIssue.title} (#${seeded.createIssue.number})`);

/* -------------------------------------------------------------- the rulers */

const picker = page.locator('select[aria-label="Selected workspace"]');
const dialog = page.locator('dialog[data-check="unsaved-work"][open]');
const titleBox = page.locator('input[aria-label="Title"]');

const asking = async () => (await dialog.count()) > 0;

/*
 * Pressing a button in a question that may not have been asked.
 *
 * Written this way rather than as a bare click because of what a bare click
 * does when the guard is missing entirely: it waits thirty seconds for a dialog
 * that will never open and then throws, and a check that dies halfway through
 * reports three failures and hides the eleven behind them. Say what is wrong and
 * carry on - the run is red either way, and the whole of it is worth reading.
 */
async function press(label) {
  if (!(await asking())) return record(false, `there was no question open to answer with ${label}`);
  await dialog.getByRole('button', { name: label, exact: true }).click();
  return true;
}

/** What the title box holds, or nothing when the page is no longer showing one. */
const typed = async () => ((await titleBox.count()) === 0 ? '' : titleBox.inputValue());

const MINE = new RegExp(`/workspace/${WORKSPACE}/issues/new$`);
const THEIRS = new RegExp(`/workspace/${elsewhere.id}/issues$`);
/*
 * And where a switch made from the *form* lands, which is not the same place.
 *
 * It was the list, and #234 is that it should not be: `.../issues/new` is where
 * filing one begins rather than a particular issue, so somebody halfway through
 * writing one and moving workspace meant to go on writing one, not to be put in
 * front of everybody else's. Nothing is carried across - the guard has already
 * asked, and the words belong to the workspace they were written in, which the
 * two assertions under each of these say.
 */
const THEIR_FORM = new RegExp(`/workspace/${elsewhere.id}/issues/new$`);

async function openForm(text) {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/new`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the new issue form'))) return false;
  await titleBox.waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
  if (text !== undefined) {
    await titleBox.fill(text);
    await page.locator('[aria-label="Description"]').first().fill('Prose that took a while to write.');
    await page.waitForTimeout(700);
  }
  return true;
}

/** The picker, used the way somebody uses it. */
async function switchTo(workspaceId) {
  await picker.selectOption(workspaceId);
  await page.waitForTimeout(1400);
}

/* ------------------------------------------- untouched, and left well alone */

if (await openForm()) {
  await switchTo(elsewhere.id);
  record((await asking()) === false, 'untouched: switching workspace asks nothing');
  record(THEIR_FORM.test(page.url()), `untouched: and lands on the other workspace's form (${page.url()})`);
}

/* ------------------------------------------------- half written, and asked */

if (await openForm(`${MARK} never filed`)) {
  await switchTo(elsewhere.id);
  record(await asking(), 'half written: switching workspace asks first');
  record(MINE.test(page.url()), `half written: and has not gone anywhere (${page.url()})`);
  record(
    (await picker.inputValue()) === WORKSPACE,
    `half written: and the corner still names the workspace we are in (${await picker.inputValue()})`,
  );

  await press('Cancel');
  await page.waitForTimeout(500);
  record((await asking()) === false, 'cancel: the question is put away');
  record((await typed()).includes('never filed'), 'cancel: and the writing is still in the box');
  record((await picker.inputValue()) === WORKSPACE, 'cancel: and the corner has not drifted either');

  /* ------------------------------------------------------------------ leave */

  await switchTo(elsewhere.id);
  record(await asking(), 'leave: asked again');
  await press('Leave');
  await page.waitForTimeout(1800);
  record(THEIR_FORM.test(page.url()), `leave: the switch went through (${page.url()})`);
  record(
    (await held(WORKSPACE)).every((one) => !one.title.includes('never filed')) &&
      (await held(elsewhere.id)).length === 0,
    'leave: and nothing was filed in either workspace',
  );
}

/* ------------------------------------------------------------ save & leave */

if (await openForm(`${MARK} kept on the way out`)) {
  await switchTo(elsewhere.id);
  record(await asking(), 'save & leave: asked');
  await press('Save & Leave');
  await page.waitForTimeout(5000);
  record(THEIR_FORM.test(page.url()), `save & leave: the switch went through (${page.url()})`);
  record(
    (await held(WORKSPACE)).some((one) => one.title.includes('kept on the way out')),
    'save & leave: and the issue was filed in the workspace it was written in',
  );
  record(
    (await held(elsewhere.id)).length === 0,
    'save & leave: and not in the one we switched to, which never saw a word of it',
  );
}

/* ------------------------------- the other exits, which the same guard now covers */

/*
 * The picker is what was reported, and it is not the only way out of this form:
 * the breadcrumb back to the list is a link, and before this page had a guard at
 * all it lost the writing just as quietly. One assertion, because the mechanism
 * behind it is the shared hook's and has its own checks.
 */
if (await openForm(`${MARK} left by the breadcrumb`)) {
  await page.locator(`a[href="/workspace/${WORKSPACE}/issues"]`).last().click();
  await page.waitForTimeout(900);
  record(await asking(), 'a link out: asks as well');
  record(MINE.test(page.url()), `a link out: and has not gone anywhere yet (${page.url()})`);
  await press('Leave');
  await page.waitForTimeout(1500);
}

/* -------------------------------------------- an issue that is only being read */

await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/${seeded.createIssue.number}`, {
  waitUntil: 'domcontentloaded',
});
if (await drawn(page, 'the issue')) {
  await page.waitForTimeout(1500);
  await switchTo(elsewhere.id);
  record((await asking()) === false, 'an issue only read: switching workspace asks nothing');
  record(THEIRS.test(page.url()), `an issue only read: and the switch went through (${page.url()})`);
}

/* ------------------------------------------------------------------- tidy up */

await sweep();

await finish(browser);
