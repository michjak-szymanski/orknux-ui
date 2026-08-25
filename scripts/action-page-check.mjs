/**
 * The action editor as a page of its own.
 *
 * An action was the last of the components still edited only in a modal, and
 * this walks the path a person walks: Actions, Create Action, fill it in, save,
 * open it again from its own address, change it, reload and see the change,
 * read what runs it, and take it away from the Danger Zone.
 *
 * The same shape `condition-page-check.mjs` holds for the condition editor,
 * because the action followed the condition (issue #87) rather than inventing a
 * third arrangement. What is asserted here and not there is the `Used by` panel:
 * #258 put it inside the dialog for one stated reason - that an action had no
 * page - and this is where it went when that stopped being true.
 *
 * The action it builds is a wait on a fixed time, which is the one subtype that
 * needs nothing else in the workspace. It is deleted at the end, and anything an
 * earlier run left behind is swept at the start, because a `finally` cannot
 * clean up after the suite's own timeout.
 */
import { BASE, WORKSPACE, open, check, shot, finish } from './suite/harness.mjs';

const stamp = Date.now();
const NAME = `zz Scratch Action ${stamp}`;
const RENAMED = `${NAME} edited`;

const { browser, context, page } = await open({ viewport: { width: 1440, height: 1000 } });

/** The API this app talks: one endpoint, queries by name. */
async function gql(query, variables = {}) {
  const response = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await response.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

const listOf = async () =>
  (
    await gql(
      `query($workspaceId: ID!) {
         workspaceActions(workspaceId: $workspaceId, page: 0, size: 200) { content { id name } }
       }`,
      { workspaceId: WORKSPACE },
    )
  ).workspaceActions.content;

for (const old of (await listOf()).filter((row) => row.name.startsWith('zz Scratch Action'))) {
  await gql(`mutation($id: ID!) { deleteAction(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept action ${old.name} (#${old.id}) from an earlier run`);
}

// --- the list opens the editor as a page ------------------------------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/actions`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Create Action', { timeout: 20_000 });

await page.locator('a', { hasText: /^\+ Create Action$/ }).first().click();
await page.waitForURL(/\/actions\/new$/, { timeout: 30_000 });

const openDialogs = await page.locator('dialog[open]').count();
check(
  page.url().endsWith(`/workspace/${WORKSPACE}/actions/new`) && openDialogs === 0,
  `Create Action goes to ${page.url()} with no modal open`,
  `expected a page, got ${page.url()} with ${openDialogs} dialog(s) open`,
);

// The breadcrumb the other editor pages have.
const crumb = await page.locator('a', { hasText: /^Actions$/ }).count();
check(crumb > 0, 'the page carries a breadcrumb back to Actions', 'no breadcrumb back to Actions');

// A wait on a fixed time: the one subtype that names nothing else.
await page.waitForSelector('#action-name', { timeout: 20_000 });
await page.locator('#action-name').fill(NAME);
await page.locator('#action-type').selectOption('WAIT');
await page.waitForTimeout(300);
await page.locator('#action-subtype').selectOption('TIME');
await page.waitForTimeout(300);
await page.locator('#action-duration').fill('5');

await page.locator('button[type="submit"]', { hasText: 'Create Action' }).click();
await page.waitForURL(new RegExp(`/workspace/${WORKSPACE}/actions$`), { timeout: 30_000 });

const mine = (await listOf()).find((row) => row.name === NAME) ?? null;
check(mine !== null, 'saving from the page created the action', 'the action was not created');
if (mine === null) await finish(browser);

// --- and it is a page at its own address ------------------------------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/actions/${mine.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#action-name', { timeout: 30_000 });
const loadedName = await page.locator('#action-name').inputValue();
check(loadedName === NAME, `the address alone opens the action ("${loadedName}")`, `the page showed "${loadedName}"`);

const stillNoDialog = await page.locator('dialog[open]').count();
check(stillNoDialog === 0, 'editing an existing action is a page too', 'a modal is still in the way');

/*
 * What an action is cannot change, and the page says so where the dialog said
 * it: Type is disabled while an existing action is being edited. Asserted here
 * because it is the one field whose behaviour differs between creating and
 * editing, and a page that let it be changed would be a different product.
 */
const typeFixed = await page.locator('#action-type').isDisabled();
check(typeFixed, 'Type is fixed on an action that exists', 'Type can be changed on an existing action');

// --- the panel #258 asked for, now that there is a page to put it on --------

const usedBy = page.locator('[aria-label="Used by"]');
const hasPanel = await usedBy
  .waitFor({ state: 'visible', timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
check(hasPanel, 'the page draws Used by', 'no Used by panel on the action page');
if (hasPanel) {
  const said = (await usedBy.innerText()).replace(/\s+/g, ' ').trim();
  check(
    said.includes('Nothing uses this yet'),
    `and an action no workflow runs says so (${JSON.stringify(said)})`,
    `Used by said ${JSON.stringify(said)}`,
  );
}

// --- edit, save, reload, and find the change --------------------------------

await page.locator('#action-name').fill(RENAMED);
await page.locator('button[type="submit"]', { hasText: 'Save Changes' }).click();
await page.waitForURL(new RegExp(`/workspace/${WORKSPACE}/actions$`), { timeout: 30_000 });

await page.goto(`${BASE}/workspace/${WORKSPACE}/actions/${mine.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#action-name', { timeout: 30_000 });
await page.waitForTimeout(500);
const afterReload = await page.locator('#action-name').inputValue();
check(
  afterReload === RENAMED,
  `the edit survived a reload ("${afterReload}")`,
  `after reloading the page said "${afterReload}"`,
);

await page.screenshot({ path: shot('action-page.png'), fullPage: true });

// --- the Danger Zone, which is where deleting went --------------------------

const danger = await page.locator('text=Danger Zone').count();
check(danger > 0, 'an existing action has a Danger Zone', 'no Danger Zone on the page');

/*
 * Pressed, rather than read. Deleting asks twice on this page - the same second
 * click the condition's page asks for - so a check that only found the button
 * would not notice the confirmation going away.
 */
const deleteButton = page.locator('button', { hasText: /^Delete Action$/ });
await deleteButton.first().click();
await page.waitForTimeout(300);
const keep = await page.locator('button', { hasText: /^Keep$/ }).count();
check(keep === 1, 'deleting asks a second time before it does anything', 'Delete Action deleted on one click');

await page.locator('button', { hasText: /^Delete Action$/ }).last().click();
await page.waitForURL(new RegExp(`/workspace/${WORKSPACE}/actions$`), { timeout: 30_000 });

const left = (await listOf()).find((row) => row.name === RENAMED) ?? null;
check(left === null, 'the Danger Zone deleted it and went back to the list', 'the action is still there');
if (left !== null) await gql(`mutation($id: ID!) { deleteAction(id: $id) }`, { id: left.id }).catch(() => undefined);

await finish(browser);
