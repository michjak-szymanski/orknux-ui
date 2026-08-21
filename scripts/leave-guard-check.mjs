/**
 * The function editor asking before it lets unsaved work be walked away from.
 *
 * Issue #138. Somebody edited a function's code, clicked a link, and the work
 * was gone without a word - so this drives the three cases that decide whether
 * a guard is worth having, and the three that decide whether it is worth
 * ignoring:
 *
 *   dirty then leave   - asks, and the page is still there behind the question
 *   clean then leave   - says nothing; the editor was only read
 *   typed then undone  - says nothing either, which is the difference between
 *                        comparing against what was loaded and counting keys
 *   saved then leave   - says nothing. This is the one that matters most: a
 *                        guard that asks after a save is a guard people learn
 *                        to click through, and then it protects nobody
 *   Back, pressed      - asks, and the address bar has not moved
 *   the answers        - "Leave" really does throw the edit away, and
 *                        "Save & Leave" really does store it
 *
 * Two mechanisms are measured, because there are two. A link inside the
 * application is react-router's to follow and the editor's to intercept, so
 * that one is measured by clicking a link and looking for the dialog. Closing
 * the tab is the browser's, and a page may only answer it by calling
 * `preventDefault` on `beforeunload` - there is no dialog of ours to look for,
 * and Chromium will not show its own to a script - so that one is measured by
 * asking the page whether it would: dispatch a cancelable `beforeunload` and
 * see whether anything stops it. That is exactly the question the browser acts
 * on when the tab is closed.
 *
 * The function is this check's own, made and deleted over GraphQL, so nothing
 * in the workspace is edited by running it.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const NAME = `leaveGuardCheck${Date.now()}`;

/*
 * Anything a run that died halfway through left behind.
 *
 * This check makes a function and deletes it at the end, and the end is not
 * reached when an assertion throws - so a workspace that has been used to debug
 * this collects scratch functions until somebody notices. Swept at the start
 * rather than guarded at the end, because the sweep also cleans up after the
 * runs that were killed by the suite's timeout, which no `finally` can.
 */
const left = await graphql(
  `query($id: ID!) { workspaceFunctions(workspaceId: $id, page: 0, size: 100) { content { id name } } }`,
  { id: WORKSPACE },
);
for (const old of left.workspaceFunctions.content.filter((held) => held.name.startsWith('leaveGuardCheck'))) {
  await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept ${old.name} (#${old.id}) from an earlier run`);
}

const made = await graphql(
  `mutation($input: CreateFunctionInput!) {
     createFunction(input: $input) { id name typescript source }
   }`,
  { input: { workspaceId: WORKSPACE, name: NAME, returnType: 'STRING' } },
);
const scratch = made.createFunction;
console.log(`made ${scratch.name} (#${scratch.id})`);

/** What the server holds for it, which is the only witness that a save landed. */
const stored = async () => {
  const read = await graphql(`query($id: ID!) { function(id: $id) { typescript source } }`, {
    id: scratch.id,
  });
  return read.function.typescript ?? read.function.source;
};

const WHERE = `${BASE}/workspace/${WORKSPACE}/functions/${scratch.id}`;
const LIST = `/workspace/${WORKSPACE}/functions`;
const EDIT = '//edited-by-the-check';

/* -------------------------------------------------------------- the rulers */

const wouldAsk = () =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

const dialog = page.locator('dialog[data-check="unsaved-function"][open]');
const asking = async () => (await dialog.count()) > 0;
const press = (label) => dialog.getByRole('button', { name: label, exact: true }).click();

const code = () => page.locator('.view-lines').innerText();

async function openEditor() {
  await page.goto(WHERE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.view-lines', { timeout: 30_000 });
  // Monaco, the objects, the variables and the parameter sync all have to have
  // settled: until they have, "nothing has changed yet" is not yet true.
  await page.waitForTimeout(2500);
}

/** Types at the end of the first line, which is somebody editing the code. */
async function type(what) {
  await page.locator('.view-lines').click();
  await page.keyboard.press('End');
  await page.keyboard.type(what);
  await page.waitForTimeout(700);
}

/** The way out this check uses: the breadcrumb back to the list. */
const outLink = page.locator(`a[href="${LIST}"]`).last();

/* ------------------------------------------------------ clean, and left alone */

await openEditor();
record((await wouldAsk()) === false, 'untouched: the browser would not ask on the way out');
record((await asking()) === false, 'untouched: nothing is being asked');
await outLink.click();
await page.waitForTimeout(900);
record(page.url().endsWith(LIST), `clean then leave: the link was followed (${page.url()})`);
record((await asking()) === false, 'clean then leave: without a question');

/* ----------------------------------------------------------- dirty, and asked */

await openEditor();
const opened = await code();
await type(EDIT);
record((await wouldAsk()) === true, 'dirty: the browser would ask on the way out');

await outLink.click();
await page.waitForTimeout(700);
record(await asking(), 'dirty then leave: the editor asks first');
record(page.url().startsWith(WHERE), `dirty then leave: and has not gone anywhere (${page.url()})`);

await press('Cancel');
await page.waitForTimeout(400);
record((await asking()) === false, 'cancel: the question is put away');
record((await code()).includes(EDIT), 'cancel: the edit is still on screen');

/* ------------------------------------------------------------ Back, pressed */

await page.goBack();
await page.waitForTimeout(900);
record(await asking(), 'Back while dirty: the editor asks');
record(page.url().startsWith(WHERE), `Back while dirty: and the address has not moved (${page.url()})`);
await press('Cancel');
await page.waitForTimeout(400);

/* ------------------------------------------- typed, then taken back out again */

await page.locator('.view-lines').click();
await page.keyboard.press('End');
for (let at = 0; at < EDIT.length; at += 1) await page.keyboard.press('Backspace');
await page.waitForTimeout(900);
record((await code()) === opened, 'undone: the code is what was loaded again');
record((await wouldAsk()) === false, 'undone: so the browser would not ask');
await outLink.click();
await page.waitForTimeout(900);
record(page.url().endsWith(LIST), `undone then leave: the link was followed (${page.url()})`);
record((await asking()) === false, 'undone then leave: without a question');

/* ------------------------------------------------------- leave without saving */

await openEditor();
await type('//thrown-away');
await outLink.click();
await page.waitForTimeout(700);
record(await asking(), 'leave without saving: asked');
await press('Leave');
await page.waitForTimeout(1200);
record(page.url().endsWith(LIST), `leave without saving: the link was followed (${page.url()})`);
record(!(await stored()).includes('//thrown-away'), 'leave without saving: the server never heard about it');

/* --------------------------------------------------------------- save & leave */

await openEditor();
await type('//kept');
await outLink.click();
await page.waitForTimeout(700);
record(await asking(), 'save & leave: asked');
await press('Save & Leave');
await page.waitForTimeout(5000);
record(page.url().endsWith(LIST), `save & leave: the link was followed (${page.url()})`);
record((await stored()).includes('//kept'), 'save & leave: and the change was stored');

/* --------------------------------------- saved by hand, then leave: no question */

await openEditor();
await type('//saved-by-hand');
await page.locator('button', { hasText: 'Save Changes' }).click();
await page.waitForTimeout(5000);
record((await stored()).includes('//saved-by-hand'), 'saved: the change reached the server');
record((await wouldAsk()) === false, 'saved then leave: the browser would not ask');
await outLink.click();
await page.waitForTimeout(900);
record((await asking()) === false, 'saved then leave: the editor does not ask either');
record(page.url().endsWith(LIST), `saved then leave: the link was followed (${page.url()})`);

/* ----------------------------------- a function being written, which has no baseline */

/*
 * The create form has nothing on the server to compare against, so its baseline
 * is the page as it opens: the name it arrives with, no details, and the stub
 * the page itself prints in the column. Opening it and leaving again must be as
 * silent as opening a stored function - it is the same page, and it prints into
 * its own code column before anybody touches it.
 */
await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/new`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.view-lines', { timeout: 30_000 });
await page.waitForTimeout(2500);
record((await wouldAsk()) === false, 'new function, untouched: the browser would not ask');
record(
  (await page.evaluate(() => JSON.stringify(window.history.state))).includes('orknuxUnsavedFunction') === false,
  'new function, untouched: and no history entry was put on to defend nothing',
);

await page.locator('#function-name').fill('leaveGuardCheckNever');
await page.waitForTimeout(700);
record((await wouldAsk()) === true, 'new function, named: the browser would ask');
await outLink.click();
await page.waitForTimeout(700);
record(await asking(), 'new function, named then leave: the editor asks');
await press('Leave');
await page.waitForTimeout(1200);
record(page.url().endsWith(LIST), `new function, left: the link was followed (${page.url()})`);
const never = await graphql(
  `query($id: ID!) { workspaceFunctions(workspaceId: $id, page: 0, size: 100) { content { name } } }`,
  { id: WORKSPACE },
);
record(
  !never.workspaceFunctions.content.some((held) => held.name === 'leaveGuardCheckNever'),
  'new function, left: nothing was created',
);

/* ------------------------------- and created for real, over the top of the guard */

/*
 * Creating one is the awkward corner: the page pushes its spare history entry
 * the moment a name is typed, and then `Create Function` replaces whatever it
 * is standing on with the address of the function it just made. If the two
 * disagreed, somebody would create a function and then be asked whether they
 * really meant to leave it.
 */
const CREATED = `leaveGuardCheckMade${Date.now()}`;
await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/new`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.view-lines', { timeout: 30_000 });
await page.waitForTimeout(2500);
await page.locator('#function-name').fill(CREATED);
await page.waitForTimeout(700);
await page.locator('button', { hasText: 'Create Function' }).click();
await page.waitForTimeout(6000);
record(/\/functions\/\d+\?made=1$/.test(page.url()), `created: landed on the function (${page.url()})`);
record((await wouldAsk()) === false, 'created then leave: the browser would not ask');
await outLink.click();
await page.waitForTimeout(900);
record((await asking()) === false, 'created then leave: the editor does not ask either');
record(page.url().endsWith(LIST), `created then leave: the link was followed (${page.url()})`);

/* ------------------------------------------ Back, once, on an editor left clean */

await openEditor();
await page.goBack();
await page.waitForTimeout(1500);
record(
  !page.url().startsWith(WHERE),
  `clean: one press of Back leaves, rather than being swallowed by the guard (${page.url()})`,
);

/* ------------------------------------------------------------------- tidy up */

/* By name rather than by id, so the one the check created through the form goes too. */
const mine = await graphql(
  `query($id: ID!) { workspaceFunctions(workspaceId: $id, page: 0, size: 100) { content { id name } } }`,
  { id: WORKSPACE },
);
for (const held of mine.workspaceFunctions.content.filter((one) => one.name.startsWith('leaveGuardCheck'))) {
  await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: held.id }).catch((cause) => {
    console.log(`could not delete ${held.name} (#${held.id}): ${cause.message}`);
  });
}

await finish(browser);
