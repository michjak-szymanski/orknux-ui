/**
 * The plugins screen: two tabs, two shelves, and the one state an outage can
 * put it in.
 *
 * The outage half is the interesting half and the reason this exists. A
 * marketplace that cannot be reached used to leave an empty box beside a pane
 * inviting somebody to choose from nothing - and worse, the attempt was made
 * again on every render, which wiped the message before it could be read. So
 * what is pinned here is that the shelf says one thing, says what still
 * works, and asks once.
 */
import { BASE, open, record, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

/** Every catalog query this page makes, so "asks once" is a count. */
const asks = [];
await page.route('**/graphql', async (route) => {
  const body = route.request().postData() ?? '';
  if (body.includes('marketplacePlugins')) {
    asks.push(Date.now());
    // Slowly, so the state between the question and the answer can be looked at.
    await new Promise((done) => setTimeout(done, 800));
    // The marketplace being down, as the server reports it.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        errors: [{ message: 'The marketplace could not be read: it could not be reached.' }],
        data: null,
      }),
    });
    return;
  }
  await route.continue();
});

await page.goto(`${BASE}/admin/plugins`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[role=tablist]', { timeout: 20_000 });

record(await page.getByRole('tab', { name: 'Installed' }).isVisible(), 'the screen opens on two tabs');
record(await page.getByRole('tab', { name: 'Catalog' }).isVisible(), 'and Catalog is the other');

// Installed draws without asking the marketplace anything at all.
await page.waitForTimeout(600);
record(asks.length === 0, `Installed asks the marketplace nothing (${asks.length} calls)`);

/*
 * The two tables answer two questions, so they carry two sets of columns.
 * Installed is the plugin's own account of itself; a file's questions - which
 * API, how large, loaded when - belong on the shelf where files are loaded.
 * Carrying both sets everywhere is what this pins shut.
 */
const installedColumns = (await page.locator('[class*="tableHeader"]').first().innerText())
  .split('\n')
  .map((one) => one.trim().toLowerCase())
  .filter(Boolean);
record(
  installedColumns.join('|') === 'plugin|version|author|source|actions',
  `Installed says what a plugin is (${installedColumns.join(', ')})`,
);

await page.getByRole('tab', { name: 'Catalog' }).click();
await page.waitForSelector('text=Marketplace', { timeout: 10_000 });
await page.waitForTimeout(600);

/*
 * Catalog opens on Local - the shelf that always works - so the marketplace
 * is still unasked at this point, which is the point.
 */
const opened = await page.locator('main, body').first().innerText();
record(opened.includes('Load Plugin'), 'Catalog opens on Local, which always works');
record(asks.length === 0, `and the marketplace is still unasked (${asks.length} calls)`);

await page.getByRole('button', { name: 'Marketplace', exact: true }).click();

/*
 * Mid-flight: nothing is laid out yet. Drawing the list and the details pane
 * while the answer is still coming means drawing two empty columns that turn
 * out to have been wrong - the marketplace was down all along.
 */
await page.waitForTimeout(300);
const waiting = await page.locator('main, body').first().innerText();
record(!waiting.includes('From the marketplace'), 'nothing is drawn before the answer arrives');
record(
  !waiting.includes('Choose a plugin to read what it does'),
  'and no pane invites a choice from a list that has not come',
);

await page.waitForTimeout(1500);

const shown = await page.locator('main, body').first().innerText();
record(shown.includes('cannot be reached'), 'the outage is said in a sentence');
record(
  shown.includes('Every plugin already installed keeps running'),
  'and what still works is said beside it',
);
record(!shown.includes('Choose a plugin to read what it does'), 'the details pane does not invite a choice from nothing');
record(asks.length === 1, `and it is asked once, not in a loop (${asks.length} calls)`);

// Local goes on working while the marketplace does not.
await page.getByRole('button', { name: 'Local', exact: true }).click();
await page.waitForTimeout(400);
const local = await page.locator('main, body').first().innerText();
record(local.includes('Load Plugin'), 'Local still offers to load a file');
record(local.includes('Load from URL'), 'and to load from a URL');

const localColumns = (await page.locator('[class*="tableHeader"]').first().innerText())
  .split('\n')
  .map((one) => one.trim().toLowerCase())
  .filter(Boolean);
record(
  localColumns.join('|') === 'name|api|size|loaded|actions',
  `and Local asks a file's questions (${localColumns.join(', ')})`,
);

// Trying again is a button, and it asks exactly one more time.
await page.getByRole('button', { name: 'Marketplace', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Try again' }).click();
await page.waitForTimeout(1200);
record(asks.length === 2, `Try again asks once more (${asks.length} calls)`);

await finish(browser);
