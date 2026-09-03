/**
 * The card that turns chat compaction on, and the refusal it has to show.
 *
 * Issue #286. The server half is `ChatCompactionTest`: it proves the older
 * turns become one summary, that the recent ones are kept word for word, and
 * that a summariser which will not answer leaves the thread alone. What no
 * server test can say is whether anybody can turn the thing on — whether the
 * three settings are on a screen at all, whether an empty box means off, and
 * what happens to somebody who types two numbers the server will not take.
 *
 * That last one is the reason this exists. The three numbers are saved together
 * behind one button, and a summary allowed to be as long as the conversation
 * that triggers it is refused rather than clamped. A refusal that arrived as
 * "internal error", or in a card other than the one being typed into, is the
 * failure mode this is watching for — the server's sentence names what to do
 * instead, and it is worth nothing if it is not drawn where the boxes are.
 *
 * Four things:
 *
 *   the card       three fields, and empty is off - which is where the seeded
 *                  workspace starts
 *   a refusal      a summary as long as the threshold is refused *in words*,
 *                  beside the boxes, and nothing is saved
 *   saving         a threshold, a length and a summariser land on the workspace
 *   turning it off  clearing the threshold clears the other two with it, rather
 *                  than leaving a model behind to surprise the next person who
 *                  types a number
 *
 * It puts the workspace back to off, because that is what it found.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/** What compaction was set to before this ran, so it can be put back. */
const before = (
  await graphql(`query($id: ID!) { workspace(id: $id) { compactAfterTokens compactionSummaryTokens compactionModelId } }`, {
    id: WORKSPACE,
  })
).workspace;

async function off() {
  await graphql(
    `mutation($w: ID!) { setWorkspaceCompaction(workspaceId: $w, afterTokens: null, summaryTokens: null, modelId: null) { id } }`,
    { w: WORKSPACE },
  ).catch(() => undefined);
}

await off();

await page.goto(`${BASE}/workspace/${WORKSPACE}/settings`, { waitUntil: 'domcontentloaded' });
await drawn(page, 'chat-compaction-settings', { within: 20_000 });

const threshold = page.locator('#compact-after');
const length = page.locator('#compaction-summary');
const summariser = page.locator('#compaction-model');

await threshold.waitFor({ state: 'visible', timeout: 20_000 });
record(await length.isVisible(), 'the summary length is on the same card as the threshold');
record(await summariser.isVisible(), 'and so is the model that writes it');

record(
  (await threshold.inputValue()) === '',
  `a workspace that has not asked for compaction shows an empty threshold (it shows "${await threshold.inputValue()}")`,
);
/*
 * The empty box has to say what empty means. A number field with nothing in it
 * and no placeholder is a setting nobody can tell is off from one nobody has
 * scrolled to yet.
 */
const placeholder = (await threshold.getAttribute('placeholder')) ?? '';
record(
  /never|off|empt|nigdy/i.test(placeholder),
  `and the empty box says that is off rather than unset ("${placeholder}")`,
);

/* ------------------------------------------------------------- the refusal */

/*
 * A summary allowed to be exactly as long as the conversation that triggers it.
 * The server refuses this, and what is being watched is where the refusal lands.
 */
await threshold.fill('4000');
await length.fill('4000');
const save = page.locator('#compact-after').locator('xpath=ancestor::section[1]').locator('button:has-text("Save")');
await save.click();

const error = page.locator('#compact-after').locator('xpath=ancestor::section[1]').locator('[role="alert"]');
await error.waitFor({ state: 'visible', timeout: 20_000 });
const said = (await error.innerText()).trim();

record(said.length > 0, `a summary as long as the threshold is refused in the card being typed into ("${said}")`);
record(
  !/internal|unexpected|error occurred|INTERNAL_ERROR/i.test(said),
  `and the refusal is a sentence rather than an internal error ("${said}")`,
);
record(
  /smaller|shorter|budget|krót/i.test(said),
  `and names what to do instead rather than only that something was wrong ("${said}")`,
);

const afterRefusal = (
  await graphql(`query($id: ID!) { workspace(id: $id) { compactAfterTokens } }`, { id: WORKSPACE })
).workspace.compactAfterTokens;
record(
  afterRefusal === null,
  `and nothing is saved on the way to being refused (the workspace holds ${afterRefusal})`,
);

await page.screenshot({ path: shot('chat-compaction-refusal.png'), fullPage: false });

/* -------------------------------------------------------------- turning it on */

/*
 * The picker offers models that answer and nothing else - a model with no
 * endpoint that takes a conversation cannot be found out to be the wrong one
 * until a compaction has already thrown the older half away.
 */
const offered = await summariser.locator('option').allTextContents();
record(offered.length > 1, `the summariser picker offers something to choose (${JSON.stringify(offered)})`);
record(
  /own model|chat|własn/i.test(offered[0] ?? ''),
  `and its first option is the chat's own model rather than a blank ("${offered[0]}")`,
);

const chosen = await summariser.locator('option').nth(1).getAttribute('value');
await length.fill('500');
await summariser.selectOption(chosen);
await save.click();
await page.waitForTimeout(1200);

const saved = (
  await graphql(
    `query($id: ID!) { workspace(id: $id) { compactAfterTokens compactionSummaryTokens compactionModelId } }`,
    { id: WORKSPACE },
  )
).workspace;
record(saved.compactAfterTokens === 4000, `the threshold is saved (the workspace holds ${saved.compactAfterTokens})`);
record(
  saved.compactionSummaryTokens === 500,
  `the summary length with it (${saved.compactionSummaryTokens})`,
);
record(
  String(saved.compactionModelId) === String(chosen),
  `and the model that writes it (${saved.compactionModelId})`,
);

await page.screenshot({ path: shot('chat-compaction-check.png'), fullPage: false });

/* ------------------------------------------------------------ turning it off */

/*
 * Clearing the threshold is how compaction is switched off, and the other two go
 * with it: a summariser nothing calls and a length nothing is cut to are
 * settings that do not exist, and left behind they would come back the day
 * somebody typed a threshold.
 */
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#compact-after').waitFor({ state: 'visible', timeout: 20_000 });
/*
 * Waited for rather than read straight away. The card is drawn before the
 * workspace has been fetched - the boxes are on screen, empty and disabled,
 * until it arrives - so reading immediately measures the loading state and
 * calls it a setting that was not saved.
 */
await page
  .locator('#compact-after')
  .and(page.locator('input:not([disabled])'))
  .waitFor({ state: 'visible', timeout: 20_000 })
  .catch(() => undefined);
const reopened = await page
  .waitForFunction(() => document.querySelector('#compact-after')?.value, null, { timeout: 20_000 })
  .then((held) => held.jsonValue())
  .catch(() => '');
record(reopened === '4000', `what was saved is what the card shows when it is opened again (it shows "${reopened}")`);

await page.locator('#compact-after').fill('');
await page
  .locator('#compact-after')
  .locator('xpath=ancestor::section[1]')
  .locator('button:has-text("Save")')
  .click();
await page.waitForTimeout(1200);

const cleared = (
  await graphql(
    `query($id: ID!) { workspace(id: $id) { compactAfterTokens compactionSummaryTokens compactionModelId } }`,
    { id: WORKSPACE },
  )
).workspace;
record(cleared.compactAfterTokens === null, 'an empty threshold turns compaction off');
record(
  cleared.compactionSummaryTokens === null && cleared.compactionModelId === null,
  `and takes the other two with it (${cleared.compactionSummaryTokens}, ${cleared.compactionModelId})`,
);

/* ------------------------------------------------------------------ tidying */

if (before.compactAfterTokens !== null) {
  await graphql(
    `mutation($w: ID!, $a: Int, $s: Int, $m: ID) {
       setWorkspaceCompaction(workspaceId: $w, afterTokens: $a, summaryTokens: $s, modelId: $m) { id }
     }`,
    {
      w: WORKSPACE,
      a: before.compactAfterTokens,
      s: before.compactionSummaryTokens,
      m: before.compactionModelId,
    },
  ).catch(() => undefined);
}

await finish(browser);
