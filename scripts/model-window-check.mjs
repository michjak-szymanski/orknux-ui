/**
 * Setting a model's context window, where the application says it is set.
 *
 * Issue #252. Refusing a session memory share says *"Set the model's context
 * window on the Models screen first"*, and the Models screen printed the window
 * and offered no way to change it: it could be typed once, in Add Model, and
 * never again - so every model discovered from a provider, imported, or added
 * before somebody knew the number was stuck at nothing, and the sentence sent
 * people to a screen that could not do what it said. `updateModel` had been in
 * the schema the whole time with no form behind it.
 *
 * The assertions are in two halves, and the second is the one that matters.
 *
 * **That the form saves.** A window and a max output typed in, saved, and still
 * there after a reload - rather than held in a field until the page is left.
 * And that the model's other details survive it: `updateModel` replaces a
 * model's details rather than patching them, so a card sending only its own two
 * fields would quietly clear the name, the id and the prices.
 *
 * **That it is the number the rest of the application reads.** The same model
 * is asked for a session memory budget before and after: refused first, in the
 * sentence that names this screen, and worked out afterwards against the window
 * that was typed. A screen that stored this somewhere of its own would pass
 * every assertion above and fail here, which is the reason the query is asked
 * rather than the row read back.
 *
 * It makes a provider and a model of its own, under names nobody would mistake
 * for real, and removes them at the end - sweeping any a killed run left
 * behind. Nothing seeded is touched.
 */
import { BASE, WORKSPACE, open, record, shot, finish } from './suite/harness.mjs';

/** Nobody's provider is called this. The sweep is by prefix. */
const SCRATCH = 'windowCheckScratch_';

/** What is typed in. Not round numbers a form could invent by itself. */
const WINDOW = 131072;
const OUTPUT = 8192;

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

// ---------------------------------------------------------------- the fixture

const listProviders = async () =>
  (await graphql(`query ($w: ID!) { modelProviders(workspaceId: $w) { id name } }`, { w: WORKSPACE }))
    .modelProviders;

const removeProvider = (id) => graphql(`mutation ($id: ID!) { removeModelProvider(id: $id) }`, { id });

for (const stale of (await listProviders()).filter((one) => one.name.startsWith(SCRATCH))) {
  await removeProvider(stale.id).catch(() => {});
}

const { createModelProvider: provider } = await graphql(
  `mutation ($input: CreateModelProviderInput!) { createModelProvider(input: $input) { id name } }`,
  { input: { workspaceId: WORKSPACE, name: `${SCRATCH}provider`, endpoint: 'https://models.invalid/v1' } },
);

/*
 * Deliberately with no window and with prices on it: the window is what this
 * screen is for, and the prices are what a form that sent only its own fields
 * would wipe out on the way.
 */
const { createModel: made } = await graphql(
  `mutation ($input: CreateModelInput!) { createModel(input: $input) { id name modelId kind } }`,
  {
    input: {
      providerId: provider.id,
      name: `${SCRATCH}model`,
      modelId: 'window-check-1',
      kind: 'CHAT',
      inputCostPerMillion: 3,
      outputCostPerMillion: 15,
    },
  },
);

const readModel = async () =>
  (
    await graphql(
      `query ($id: ID!) {
         model(id: $id) {
           id name modelId kind contextWindow maxOutput enabled
           inputCostPerMillion outputCostPerMillion tokenLimit resetInterval
         }
       }`,
      { id: made.id },
    )
  ).model;

/** What a session on this model would be allowed, asked exactly as an agent asks. */
const budgetFor = async () =>
  (
    await graphql(
      `query ($w: ID!, $m: ID) {
         memoryBudget(workspaceId: $w, modelId: $m, share: 20) {
           contextWindow derived totalTokens refusal
         }
       }`,
      { w: WORKSPACE, m: made.id },
    )
  ).memoryBudget;

async function done(...extras) {
  await removeProvider(provider.id).catch(() => {});
  await finish(browser, ...extras);
}

// ------------------------------------------------------- what it was like before

const before = await budgetFor();
record(
  before.refusal !== null && before.contextWindow === null,
  `a share of a model with no window recorded is refused: ${JSON.stringify(before.refusal)}`,
);
record(
  /context window/i.test(before.refusal ?? '') && /Models screen/i.test(before.refusal ?? ''),
  'and the refusal is the one that sends somebody to the Models screen',
);

// ------------------------------------------------------------------- the form

const settings = `/workspace/${WORKSPACE}/models/${made.id}`;
await page.goto(`${BASE}${settings}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#context-window', { timeout: 20_000 });

const form = page.locator('form:has(#context-window)');
const windowBox = page.locator('#context-window');
const output = page.locator('#max-output');

record((await windowBox.inputValue()) === '', 'the model arrives with the window box empty, which is "not recorded"');
record((await output.inputValue()) === '', 'and with the max output box empty');
record(
  (await form.locator('button[data-hint="Context Window"]').count()) === 1,
  'the field carries the (?) that says what the number is for',
);

await windowBox.fill(String(WINDOW));
await output.fill(String(OUTPUT));
await form.locator('button[type="submit"]').click();
await page.waitForTimeout(1200);

record(
  (await form.innerText()).includes('Saved.'),
  'saving the card says so, on the card that was saved',
);
await page.screenshot({ path: shot('model-window-saved.png') });

const stored = await readModel();
record(
  stored.contextWindow === WINDOW && stored.maxOutput === OUTPUT,
  `the window and the output are stored on the model (${stored.contextWindow} / ${stored.maxOutput})`,
);
record(
  stored.name === made.name && stored.modelId === made.modelId && stored.kind === made.kind,
  'and its name, id and kind came through the save untouched',
);
record(
  Number(stored.inputCostPerMillion) === 3 && Number(stored.outputCostPerMillion) === 15,
  `as did its prices (${stored.inputCostPerMillion} / ${stored.outputCostPerMillion}), which this card does not show`,
);

// Reloaded rather than trusted: a field that keeps what was typed until the
// page is left looks exactly like one that saved it.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#context-window', { timeout: 20_000 });
await page.waitForTimeout(500);
record(
  (await page.locator('#context-window').inputValue()) === String(WINDOW),
  'and the page comes back holding it',
);

// --------------------------------------------- and what the rest of it makes of it

const after = await budgetFor();
record(after.refusal === null, 'the share that was refused before is worked out now');
record(
  after.derived && after.contextWindow === WINDOW,
  `against the window this screen wrote - ${after.contextWindow} tokens, ${after.totalTokens} for a session`,
);

// ---------------------------------------------------------- and taken off again

/*
 * Empty is "not recorded", which is a thing this form has to be able to say:
 * without it a number typed by mistake could never be taken off, only replaced.
 */
await page.locator('#context-window').fill('');
await page.locator('form:has(#context-window) button[type="submit"]').click();
await page.waitForTimeout(1200);
const cleared = await readModel();
record(cleared.contextWindow === null, 'emptying the box takes the window off again');
record(cleared.maxOutput === OUTPUT, 'and leaves the max output beside it alone');
record((await budgetFor()).refusal !== null, 'so the share is refused again, as it was at the start');

await done();
