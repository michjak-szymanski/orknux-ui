/**
 * Taking a comment off an issue, and what "off" has to mean.
 *
 * Issue #276. The tracker could add a comment and change one and had nothing at
 * all that removed one, so a comment posted by mistake - or one carrying a
 * credential - was permanent.
 *
 * The assertions that earn this a place in a browser are the three the server
 * suite cannot make.
 *
 * The **dialog does not quote the comment back**. That is a product decision and
 * it is invisible to any test of the mutation: the words on screen are asked
 * for by name here, because the most likely reason somebody is pressing this
 * button is that those exact words should not be in front of anybody, and a
 * confirmation that helpfully repeats them is the feature failing at the last
 * step. It is checked to name the author instead, so the question is still
 * answerable.
 *
 * The **history line reads as a removal**. `said()` in WorkspaceIssuePage falls
 * through to "commented" for anything it does not recognise, so a new event kind
 * that nobody wrote a sentence for renders as the opposite of what happened -
 * and it renders perfectly, with no error anywhere. Only a page can say.
 *
 * And the **words are gone from what the server will hand over**, asked for
 * after a reload rather than read off the page that has just pruned itself. The
 * whole issue is fetched over GraphQL and the answer is searched for the string
 * as text: a tombstone the interface merely hides would pass every assertion
 * about the thread and fail this one.
 *
 * It files its own issue and deletes it at the end, and sweeps what an earlier
 * killed run left behind, so nothing anybody else's check reads is touched.
 */
import { BASE, USER, WORKSPACE, open, record, check, drawn, shot, finish } from './suite/harness.mjs';

const stamp = Date.now();
const TITLE = `zz Scratch comment removal ${stamp}`;
/*
 * A string nothing else in the product ever says, and shaped like the thing
 * this feature exists for. Every "is it gone" assertion below looks for exactly
 * this, so a partial removal cannot pass by leaving a shortened copy behind.
 */
const SECRET = `orkx_scratch_secret_${stamp}`;
const KEPT = `Something else entirely ${stamp}`;

const { browser, context, page } = await open({ viewport: { width: 1440, height: 900 } });

async function gql(query, variables = {}) {
  const response = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await response.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

/*
 * What an earlier run left. Swept at the start rather than in a `finally`,
 * because a `finally` cannot clean up after the suite's own timeout.
 */
const before = await gql(
  `query($w: ID!) {
     workspaceIssues(workspaceId: $w, search: "zz Scratch comment removal", size: 100) { content { id } }
   }`,
  { w: WORKSPACE },
);
for (const old of before.workspaceIssues.content) {
  await gql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: old.id }).catch(() => undefined);
}

/*
 * Filed over the API rather than through the form. What this check is about
 * starts once there is a thread, and driving the new-issue page here would be
 * `new-issue-blank-check`'s job done again badly.
 */
const filed = await gql(
  `mutation($input: IssueInput!) { createIssue(input: $input) { id number } }`,
  { input: { workspaceId: WORKSPACE, title: TITLE, description: 'Made by remove-comment-check.mjs.' } },
);
const issueId = filed.createIssue.id;
const number = filed.createIssue.number;
console.log(`filed #${number}`);

// Two comments: the one that goes, and one beside it that must not.
await gql(
  `mutation($id: ID!, $content: String!) { commentOnIssue(id: $id, content: $content) { id } }`,
  { id: issueId, content: `Here is the key: ${SECRET}` },
);
await gql(
  `mutation($id: ID!, $content: String!) { commentOnIssue(id: $id, content: $content) { id } }`,
  { id: issueId, content: KEPT },
);

const url = `${BASE}/workspace/${WORKSPACE}/issues/${number}`;
await page.goto(url, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the issue with its comments'))) await finish(browser, false);

const thread = page.locator('article[id^="comment-"]');
/*
 * Waited on rather than counted straight away. `drawn` says the page has
 * settled on something, which the header and the description satisfy before
 * the thread is on screen - so the first three assertions here read an issue
 * page with no comments yet and reported a missing button on a page that has
 * one. Every later assertion passed, because Playwright's own actions wait and
 * `isVisible()` does not, which is exactly how a check ends up disagreeing with
 * itself about the same page.
 */
const drew = await page
  .waitForFunction(() => document.querySelectorAll('article[id^="comment-"]').length === 2, null, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
record(drew, 'the thread has both comments on it before anything is pressed');
if (!drew) await finish(browser, false);

/*
 * The comment that is going, found by what it says rather than by position: a
 * check that pressed the first Remove on the page would still pass having
 * removed the wrong one.
 */
const doomed = thread.filter({ hasText: SECRET });
const remove = doomed.locator('button[aria-label="Remove this comment"]');
record(await remove.isVisible().catch(() => false), 'Remove is offered on a comment the reader may take off');
record(
  await doomed.locator('button', { hasText: /^Edit$/ }).isVisible().catch(() => false),
  'and Edit is still beside it, which is the narrower of the two rules',
);

await remove.click();
await page.waitForTimeout(400);

const dialog = page.locator('dialog[open]');
const asks = await dialog.isVisible().catch(() => false);
record(asks, 'the click asks before it removes anything');

const said = asks ? await dialog.innerText() : '';
/*
 * The assertion this check exists for. Quoting the comment back at somebody who
 * is removing it because those words should not be on screen is the feature
 * failing at the last step, and no test of the mutation can see it.
 */
check(
  asks && !said.includes(SECRET),
  'the question does not repeat what the comment said',
  `the question repeats the comment: ${JSON.stringify(said.replace(/\s+/g, ' ').slice(0, 200))}`,
);
record(asks && said.includes(USER), 'and it names who wrote it, so the question can still be answered');

await dialog.locator('button', { hasText: /^Cancel$/ }).click();
await page.waitForTimeout(400);
record((await dialog.count()) === 0, 'Cancel closes it');
record((await thread.count()) === 2, 'and leaves both comments where they were');

await remove.click();
await page.waitForTimeout(400);
await page.locator('dialog[open] button', { hasText: /^Remove$/ }).click();

// Waited on the thread rather than on the clock: the page redraws from the
// server's answer, and how long that takes is the machine's business.
const wentFromThePage = await page
  .waitForFunction(() => document.querySelectorAll('article[id^="comment-"]').length === 1, null, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
record(wentFromThePage, 'confirming takes it off the thread');

await page.screenshot({ path: shot('remove-comment.png') });

const left = await page.locator('body').innerText();
record(!left.includes(SECRET), 'and the words are not drawn anywhere else on the page');
record(left.includes(KEPT), 'the comment beside it is untouched');

/*
 * The history is the whole reason this deletes rather than tombstones: a thread
 * that quietly loses a message is a thread nobody can trust. `said()` falls
 * through to "commented" for a kind it does not know, so a removal rendered by
 * the default reads as the opposite of what happened - and reads perfectly.
 */
await page.locator('button', { hasText: /^History$/ }).click();
await page.waitForTimeout(800);
const history = await page.locator('body').innerText();
record(/removed a comment/i.test(history), 'the history says a comment was removed');
record(!history.includes(SECRET), 'and never says what it said');
/*
 * Counted, because that is what tells a written sentence from the fallthrough.
 * One comment is left, so the history holds exactly one "commented" line. A
 * removal rendered by `said()`'s default would make two, and the page would look
 * entirely correct while saying the opposite of what happened.
 */
const commented = (history.match(/ commented/g) ?? []).length;
check(
  commented === 1,
  'the removal is drawn as a removal rather than as another comment being made',
  `the history holds ${commented} "commented" lines where one comment is left; the removal fell through to the default sentence`,
);

/*
 * Gone on the server, not merely off a page that pruned itself - and asked for
 * as the whole issue, so a tombstone the interface hides would fail here.
 */
const read = await gql(
  `query($w: ID!, $n: Int!) {
     workspaceIssue(workspaceId: $w, number: $n) {
       lastCommentAt
       comments { id author content }
     }
     issueHistory(workspaceId: $w, number: $n) { entries { kind actor was said } }
   }`,
  { w: WORKSPACE, n: number },
);
const answered = JSON.stringify(read);
record(!answered.includes(SECRET), 'the server hands back nothing holding those words either');
record(read.workspaceIssue.comments.length === 1, 'one comment is left, and it is the other one');
record(read.workspaceIssue.comments[0]?.content === KEPT, 'which is the one that was never touched');

const removal = read.issueHistory.entries.find((entry) => entry.kind === 'COMMENT_REMOVED');
record(removal !== undefined, 'the history carries a COMMENT_REMOVED entry');
record(removal?.actor === USER && removal?.was === USER, 'naming who took it and whose it was');
record(removal?.said === null || removal?.said === undefined, 'and carrying no text at all');

/*
 * `lastCommentAt` is what the LAST_COMMENT sort reads. The removed comment was
 * the older of the two, so this should still be the kept one's moment - and the
 * point is that it is a real moment rather than left pointing at a row nobody
 * can find.
 */
record(read.workspaceIssue.lastCommentAt !== null, 'the last-comment mark still names a comment that exists');

await gql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: issueId }).catch(() => undefined);
console.log(`removed the scratch issue #${number}`);

await finish(browser);
