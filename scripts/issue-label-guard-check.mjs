/**
 * A label added to an issue and saved leaves nothing behind to be warned about.
 *
 * Issue #282. The labels are a set on the server and are handed back sorted;
 * the box adds a new one to the end of what is on screen. The page compared the
 * two position by position, so an issue given a label that did not happen to
 * sort last was reported as holding unsaved work from the moment it was saved
 * until the page was closed - and reopening it, which takes both sides from the
 * same answer, said nothing. That last part is what made it look like a ghost.
 *
 * Driven in the order that makes the difference visible:
 *
 *   a label that sorts last     saved, and leaving says nothing - this always
 *                               worked, and is here so a fix that breaks it is
 *                               caught rather than celebrated
 *   a label that sorts first    saved, and leaving must say nothing either
 *   a label added and not saved asks, because that is the guard doing its job
 *
 * The third case is the point of keeping the guard at all: a comparison loose
 * enough to end the false warning must not be so loose that it stops noticing a
 * real change. A set comparison is the one that does both.
 *
 * Files one issue and deletes it, and sweeps what an earlier killed run left.
 */
import { BASE, WORKSPACE, open, drawn, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const MARK = 'issueLabelGuardCheck';

/*
 * Two labels chosen for where they sort around the one the issue opens with.
 *
 * `mmm` is what is on it to begin with, so `zzz` lands after it and `aaa`
 * before. Only `aaa` ever reproduced the bug: appended to the end on screen and
 * returned first by the server, it is the one arrangement where position tells
 * a different story from membership.
 */
const HELD = `${MARK}-mmm`;
const AFTER = `${MARK}-zzz`;
const BEFORE = `${MARK}-aaa`;

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

const seeded = await graphql(`mutation($input: IssueInput!) { createIssue(input: $input) { id number title } }`, {
  input: {
    workspaceId: WORKSPACE,
    title: `${MARK} one to label`,
    description: 'Opened with a label already on it, so a second one has somewhere to sort.',
    labels: [HELD],
    status: 'OPEN',
  },
});
const number = seeded.createIssue.number;
console.log(`made ${seeded.createIssue.title} (#${number})`);

/* -------------------------------------------------------------- the rulers */

const dialog = page.locator('dialog[data-check="unsaved-work"][open]');
const labelBox = page.locator('input[aria-label="Add a label"]');

const asking = async () => (await dialog.count()) > 0;

/** Open the issue, fresh, with both sides of the comparison taken from the server. */
async function openIssue() {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/${number}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the issue'))) return false;
  await labelBox.waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  return true;
}

/** Type a label into the box and commit it the way somebody does, with Enter. */
async function addLabel(text) {
  await labelBox.fill(text);
  await labelBox.press('Enter');
  await page.waitForTimeout(600);
}

/** Press Save and wait for the server to have taken it. */
async function save() {
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.waitForTimeout(2500);
}

/**
 * Leave by the breadcrumb, and say whether anything stood in the way.
 *
 * The breadcrumb rather than the picker because this check is about the
 * comparison behind the guard and not about which exits it covers - that is
 * issue-leave-guard-check's ground, and driving it again here would only make
 * two checks fail for one cause.
 */
async function leave() {
  await page.locator(`a[href="/workspace/${WORKSPACE}/issues"]`).last().click();
  await page.waitForTimeout(1200);
  return asking();
}

/** Put the question away, so the next case opens on a page that is not mid-dialog. */
async function cancel() {
  if (await asking()) {
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(400);
  }
}

/* --------------------------------------- a label that sorts after the held one */

if (await openIssue()) {
  await addLabel(AFTER);
  await save();
  record((await leave()) === false, 'a label sorting last: saved, and leaving says nothing');
  await cancel();
}

/* -------------------------------------- a label that sorts before the held one */

if (await openIssue()) {
  await addLabel(BEFORE);
  await save();
  record((await leave()) === false, 'a label sorting first: saved, and leaving says nothing either');
  await cancel();
}

/* ------------------------------------------ a label added and deliberately not saved */

if (await openIssue()) {
  await addLabel(`${MARK}-unsaved`);
  record(await leave(), 'a label added and not saved: still asked about, which is the guard working');
  await cancel();
}

/* ------------------------------------------------------------------- tidy up */

await sweep();

await finish(browser);
