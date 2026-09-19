/**
 * The marketplace shelf opens on something.
 *
 * The details pane is the larger half of the screen, and a shelf nobody has
 * clicked yet left it empty - which reads as something that failed to load
 * rather than as a prompt, and costs a click to find out otherwise. So the
 * first listing is open the moment the answer arrives, and picking another
 * moves it.
 */
import { BASE, open, record, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

/** A catalog of two, so "the first" is a claim with a second to be wrong about. */
const offered = [
  {
    key: 'alpha',
    name: 'Alpha',
    author: 'Orknux',
    summary: 'The first on the shelf.',
    description: '# Alpha\n\nWhat Alpha does.',
    version: '1.0.0',
    icon: null,
    downloads: 3,
    rating: null,
    reviews: 0,
    published: '2026-01-01T00:00:00Z',
    installed: false,
    installedVersion: null,
    updatable: false,
  },
  {
    key: 'beta',
    name: 'Beta',
    author: 'Orknux',
    summary: 'The second.',
    description: '# Beta\n\nWhat Beta does.',
    version: '2.0.0',
    icon: null,
    downloads: 1,
    rating: null,
    reviews: 0,
    published: '2026-01-02T00:00:00Z',
    installed: false,
    installedVersion: null,
    updatable: false,
  },
];

await page.route('**/graphql', async (route) => {
  const body = route.request().postData() ?? '';
  if (body.includes('marketplacePlugins')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { marketplacePlugins: offered } }),
    });
    return;
  }
  await route.continue();
});

await page.goto(`${BASE}/admin/plugins`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[role=tablist]', { timeout: 20_000 });
await page.getByRole('tab', { name: 'Catalog' }).click();
await page.getByRole('button', { name: 'Marketplace', exact: true }).click();
await page.waitForSelector('text=From the marketplace', { timeout: 10_000 });
await page.waitForTimeout(600);

const shown = await page.locator('main, body').first().innerText();
record(!shown.includes('Choose a plugin to read what it does'), 'nothing asks for a click first');
record(shown.includes('What Alpha does.'), 'the first listing is open on arrival');
record(!shown.includes('What Beta does.'), 'and only that one');

// The row says so too, so the list and the pane agree about what is open.
record(
  (await page.locator('[aria-pressed=true]').first().innerText()).includes('Alpha'),
  'and the row it came from is marked',
);

/*
 * And Install is sized like the act it is, not like a dialog's button. It sits
 * alone at the top of the larger half of the screen; at `.accept`'s size it
 * read as a footnote to the name beside it. Measured against Load Plugin in
 * the header, which is the same act arriving by the other door.
 */
const install = await page.getByRole('button', { name: 'Install', exact: true }).first().boundingBox();
record(install.height >= 36, `Install is sized like a primary action (${Math.round(install.height)}px tall)`);

// Picking another moves it, which is the part the default must not break.
await page.getByRole('button', { name: /Beta/ }).first().click();
await page.waitForTimeout(400);
const after = await page.locator('main, body').first().innerText();
record(after.includes('What Beta does.'), 'picking another moves the pane');
record(!after.includes('What Alpha does.'), 'and leaves the first behind');

await finish(browser);
