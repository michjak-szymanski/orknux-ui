/**
 * The condition editor as a page of its own, and the way out to its function.
 *
 * Issue #87 asked for the condition editor to stop being a modal, and #88 for
 * an "Open definition" beside the function it points at. This walks the path a
 * person walks: Conditions, Create Condition, fill it in, save, find it again
 * in the list, change it, reload and see the change, then press Open definition
 * and check where it lands.
 */
import { BASE, WORKSPACE, open, check, shot, finish } from './suite/harness.mjs';

const stamp = Date.now();
const NAME = `zz Scratch Condition ${stamp}`;
const RENAMED = `${NAME} edited`;

const { browser, context, page } = await open({ viewport: { width: 1440, height: 900 } });

/** The API this app talks: one endpoint, queries by name. */
async function gql(query, variables = {}) {
  const response = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await response.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

/** Pick a row out of an open DefinitionPicker by the name on it. */
async function pick(pickerId, label) {
  await page.locator(`#${pickerId}`).click();
  const menu = page.locator('[role="listbox"]');
  await menu.waitFor({ timeout: 5000 });
  await menu.locator('input[type="search"]').fill(label);
  await page.waitForTimeout(300);
  await menu.locator('[role="option"]', { hasText: label }).first().click();
}

// --- #87: the list opens the editor as a page -------------------------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/conditions`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Create Condition', { timeout: 20_000 });

await page.locator('a', { hasText: 'Create Condition' }).first().click();
await page.waitForURL(/\/conditions\/new$/, { timeout: 10_000 });

const openDialogs = await page.locator('dialog[open]').count();
check(
  page.url().endsWith(`/workspace/${WORKSPACE}/conditions/new`) && openDialogs === 0,
  `Create Condition goes to ${page.url()} with no modal open`,
  `expected a page, got ${page.url()} with ${openDialogs} dialog(s) open`,
);

// The breadcrumb the other editor pages have.
const crumb = await page.locator('a', { hasText: /^Conditions$/ }).count();
check(crumb > 0, 'the page carries a breadcrumb back to Conditions', 'no breadcrumb back to Conditions');

// Fill it in: a function condition, so #88 has something to open.
await page.locator('#condition-name').fill(NAME);
await page.locator('#condition-type').selectOption('FUNCTION');
await page.waitForTimeout(300);

const functionBody = await gql(
  `query($workspaceId: ID!) {
     workspaceFunctions(workspaceId: $workspaceId, page: 0, size: 100) {
       content { id name returnType }
     }
   }`,
  { workspaceId: WORKSPACE },
);
// Only a function that answers a question can be a condition, so only those
// are in the picker.
const target = functionBody.workspaceFunctions.content.find((fn) => fn.returnType === 'BOOLEAN');
if (target === undefined) {
  console.log('FAIL: the workspace has no function to point a condition at');
  process.exit(1);
}
await pick('condition-function', target.name);
await page.waitForTimeout(300);

// --- #88: Open definition, beside the function ------------------------------

const jump = page.locator('a', { hasText: 'Open definition' });
check(await jump.first().isVisible(), 'Open definition is offered beside the function', 'no Open definition link');

const href = await jump.first().getAttribute('href');
check(
  href === `/workspace/${WORKSPACE}/functions/${target.id}`,
  `Open definition points at ${href}`,
  `Open definition points at ${href}, expected the chosen function`,
);

// Where it lands: a tab of its own, as the trigger form's own link does.
const [opened] = await Promise.all([
  context.waitForEvent('page', { timeout: 10_000 }),
  jump.first().click(),
]);
await opened.waitForLoadState('domcontentloaded');
await opened.waitForTimeout(1500);
const landedAt = opened.url();
const landedOn = await opened.locator('#function-name, input#function-name').first().inputValue().catch(() => null);
check(
  landedAt.includes(`/workspace/${WORKSPACE}/functions/${target.id}`),
  `Open definition lands on the function editor at ${landedAt}${landedOn === null ? '' : ` showing "${landedOn}"`}`,
  `Open definition landed on ${landedAt}`,
);
await opened.close();

// --- #87 again: it saves, and the page survives a reload --------------------

await page.locator('button[type="submit"]', { hasText: 'Create Condition' }).click();
await page.waitForURL(new RegExp(`/workspace/${WORKSPACE}/conditions$`), { timeout: 10_000 });

const madeBody = await gql(
  `query($workspaceId: ID!) {
     workspaceConditions(workspaceId: $workspaceId, page: 0, size: 200) { content { id name } }
   }`,
  { workspaceId: WORKSPACE },
);
const mine = madeBody.workspaceConditions.content.find((row) => row.name === NAME) ?? null;
check(mine !== null, 'saving from the page created the condition', 'the condition was not created');
if (mine === null) {
  await browser.close();
  process.exit(1);
}

// Opened from its own address, as a link that can be pasted or reloaded.
await page.goto(`${BASE}/workspace/${WORKSPACE}/conditions/${mine.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#condition-name', { timeout: 10_000 });
const loadedName = await page.locator('#condition-name').inputValue();
check(loadedName === NAME, `the address alone opens the condition ("${loadedName}")`, `the page showed "${loadedName}"`);

const stillNoDialog = await page.locator('dialog[open]').count();
check(stillNoDialog === 0, 'editing an existing condition is a page too', 'a modal is still in the way');

// Edit, save, reload, and find the change.
await page.locator('#condition-name').fill(RENAMED);
await page.locator('button[type="submit"]', { hasText: 'Save Changes' }).click();
await page.waitForURL(new RegExp(`/workspace/${WORKSPACE}/conditions$`), { timeout: 10_000 });

await page.goto(`${BASE}/workspace/${WORKSPACE}/conditions/${mine.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#condition-name', { timeout: 10_000 });
await page.waitForTimeout(500);
const afterReload = await page.locator('#condition-name').inputValue();
check(
  afterReload === RENAMED,
  `the edit survived a reload ("${afterReload}")`,
  `after reloading the page said "${afterReload}"`,
);

// The Danger Zone the other editor pages have, in place of the dialog's Delete.
const danger = await page.locator('text=Danger Zone').count();
check(danger > 0, 'an existing condition has a Danger Zone', 'no Danger Zone on the page');

await page.screenshot({ path: shot('condition-page.png'), fullPage: true });

// Clear up after ourselves: this condition was made by the check.
await gql(`mutation($id: ID!) { deleteCondition(id: $id) }`, { id: mine.id });

await finish(browser);
