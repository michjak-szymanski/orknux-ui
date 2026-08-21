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
/**
 * The function this condition is pointed at, made here rather than borrowed.
 *
 * This used to take whichever of the workspace's functions happened to answer
 * a question, and on a database built from nothing there is no such function -
 * the seed writes none that returns a boolean, and the two that do on a
 * developer's machine arrive with plugins. So the check refused to run at all,
 * which is why it was held out of CI. A function of its own costs one mutation,
 * is deleted at the end, and makes the check say the same thing on every
 * installation.
 */
const FUNCTION_NAME = `zzScratchConditionFn${stamp}`;

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

/*
 * Anything a run that was killed halfway through left behind. Swept at the
 * start rather than guarded at the end, because a `finally` cannot clean up
 * after the suite's own timeout.
 */
const before = await gql(
  `query($workspaceId: ID!) {
     workspaceConditions(workspaceId: $workspaceId, page: 0, size: 200) { content { id name } }
     workspaceFunctions(workspaceId: $workspaceId, page: 0, size: 200) { content { id name } }
   }`,
  { workspaceId: WORKSPACE },
);
for (const old of before.workspaceConditions.content.filter((row) => row.name.startsWith('zz Scratch Condition'))) {
  await gql(`mutation($id: ID!) { deleteCondition(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept condition ${old.name} (#${old.id}) from an earlier run`);
}
for (const old of before.workspaceFunctions.content.filter((row) => row.name.startsWith('zzScratchConditionFn'))) {
  await gql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept function ${old.name} (#${old.id}) from an earlier run`);
}

// The function the condition will name. BOOLEAN because only a function that
// answers a question can be a condition, which is what the picker filters on.
const target = (
  await gql(
    `mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id name } }`,
    {
      input: {
        workspaceId: WORKSPACE,
        name: FUNCTION_NAME,
        returnType: 'BOOLEAN',
        description: 'Made by scripts/condition-page-check.mjs, and removed again by it.',
      },
    },
  )
).createFunction;
console.log(`made ${target.name} (#${target.id}) for the condition to point at`);

// --- #87: the list opens the editor as a page -------------------------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/conditions`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Create Condition', { timeout: 20_000 });

await page.locator('a', { hasText: 'Create Condition' }).first().click();
await page.waitForURL(/\/conditions\/new$/, { timeout: 30_000 });

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

await pick('condition-function', target.name);
await page.waitForTimeout(300);

// --- #88: Open definition, beside the function ------------------------------

/*
 * Found by its name and not by its words.
 *
 * It was written as `hasText: 'Open definition'`, which was the label until
 * 2df9a15 made every one of these a mark: the arrow and the two words went,
 * and "Open definition" lives on in the title and the aria-label, which is what
 * a pointer and a screen reader get. The check went on waiting thirty seconds
 * for text nothing draws and reported a missing link on a form that has one -
 * a check problem wearing a product problem's clothes. The accessible name is
 * what the convention actually guarantees, so that is what this asks for.
 */
const jump = page.locator(`a[aria-label="Open the function's definition"]`);
const appeared = await jump
  .first()
  .waitFor({ state: 'visible', timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
check(appeared, 'Open definition is offered beside the function', 'no Open definition link beside the function');
if (!appeared) {
  const drew = await page.locator('main').innerText().catch(() => '<there is no main>');
  console.log(`      the form holds: ${JSON.stringify(drew.replace(/\s+/g, ' ').slice(0, 300))}`);
  await gql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: target.id }).catch(() => undefined);
  await finish(browser);
}

// The mark, and nothing else: the same shape action-jump-check holds the
// action dialog's four to, so there is one convention and not two.
const words = (await jump.first().innerText()).trim();
const titled = await jump.first().getAttribute('title');
check(
  words === '' && (titled ?? '') !== '',
  `drawn as the mark alone, named by its title ("${titled}")`,
  `expected a mark with a title, got text ${JSON.stringify(words)} and title ${JSON.stringify(titled)}`,
);

const href = await jump.first().getAttribute('href');
check(
  href === `/workspace/${WORKSPACE}/functions/${target.id}`,
  `Open definition points at ${href}`,
  `Open definition points at ${href}, expected the chosen function`,
);

// Where it lands: a tab of its own, as the trigger form's own link does.
const [opened] = await Promise.all([
  context.waitForEvent('page', { timeout: 30_000 }),
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
await page.waitForURL(new RegExp(`/workspace/${WORKSPACE}/conditions$`), { timeout: 30_000 });

const madeBody = await gql(
  `query($workspaceId: ID!) {
     workspaceConditions(workspaceId: $workspaceId, page: 0, size: 200) { content { id name } }
   }`,
  { workspaceId: WORKSPACE },
);
const mine = madeBody.workspaceConditions.content.find((row) => row.name === NAME) ?? null;
check(mine !== null, 'saving from the page created the condition', 'the condition was not created');
if (mine === null) {
  await gql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: target.id }).catch(() => undefined);
  await finish(browser);
}

// Opened from its own address, as a link that can be pasted or reloaded.
await page.goto(`${BASE}/workspace/${WORKSPACE}/conditions/${mine.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#condition-name', { timeout: 30_000 });
const loadedName = await page.locator('#condition-name').inputValue();
check(loadedName === NAME, `the address alone opens the condition ("${loadedName}")`, `the page showed "${loadedName}"`);

const stillNoDialog = await page.locator('dialog[open]').count();
check(stillNoDialog === 0, 'editing an existing condition is a page too', 'a modal is still in the way');

// Edit, save, reload, and find the change.
await page.locator('#condition-name').fill(RENAMED);
await page.locator('button[type="submit"]', { hasText: 'Save Changes' }).click();
await page.waitForURL(new RegExp(`/workspace/${WORKSPACE}/conditions$`), { timeout: 30_000 });

await page.goto(`${BASE}/workspace/${WORKSPACE}/conditions/${mine.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#condition-name', { timeout: 30_000 });
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

// Clear up after ourselves: both of these were made by the check. The
// condition first, because it is the thing pointing at the function.
await gql(`mutation($id: ID!) { deleteCondition(id: $id) }`, { id: mine.id });
await gql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: target.id });

await finish(browser);
