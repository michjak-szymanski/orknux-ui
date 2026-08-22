/**
 * Go to offers things to do, not only places to be.
 *
 * Issue #218, whose description was one line: "- Create issue". The box in the
 * top bar could take you to the issue list, and starting one from there was two
 * more clicks - so the fastest way to file what you just noticed was slower
 * than the thing you were doing when you noticed it.
 *
 * What is measured is that the row is offered *before* anything is typed - a
 * quick action nobody can find is not quick - that typing the verb finds it,
 * that it is told apart from a destination by its own icon, and that pressing
 * it lands on the page that starts one. The last is the one that matters: a row
 * in a list is not a feature until it goes somewhere.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const BOX = 'input[aria-label="Go to a page"]';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(BOX, { timeout: 20_000 });

/** What the palette is offering, in the order it offers it. */
async function offered() {
  await page.waitForSelector('ul[role="listbox"]', { timeout: 10_000 }).catch(() => {});
  // Three spans to a row, in this order: the mark, what it is called, and where
  // it belongs. Read by position rather than by class, since the class names
  // are hashed by the build.
  return page.$$eval('ul[role="listbox"] [role="option"]', (rows) =>
    rows.map((row) => {
      const spans = [...row.querySelectorAll('span')];
      return {
        label: spans[1]?.textContent?.trim() ?? '',
        where: spans[2]?.textContent?.trim() ?? '',
        icon: spans[0] === undefined ? '' : getComputedStyle(spans[0]).maskImage,
      };
    }),
  );
}

/* ---- offered before a letter is typed ---- */

await page.click(BOX);
const resting = await offered();
const create = resting.find((row) => row.label.toLowerCase() === 'create issue');

record(resting.length > 0, `the palette offers ${resting.length} rows before anything is typed`);
record(create !== undefined, 'Create issue is one of them, without having to know to type it');
/*
 * The pages are still most of the list. There are three actions and a dozen
 * screens, so a resting palette that is all verbs would have taken away the
 * thing this box was built for.
 */
const destinations = resting.filter((row) => !row.label.toLowerCase().startsWith('create'));
record(
  destinations.length > resting.length / 2,
  `the pages are still most of it (${destinations.length} of ${resting.length} rows)`,
);

/*
 * Its own mark. Every row here is a place or a thing except these, and a list
 * where the one that *does* something looks exactly like the fifteen that go
 * somewhere is a list nobody reads twice.
 */
const destination = destinations[0];
record(
  create !== undefined &&
    destination !== undefined &&
    create.icon !== '' &&
    create.icon !== destination.icon,
  `it is drawn with a mark of its own, not the one ${destination?.label ?? 'a page'} carries`,
);

/* ---- and found by typing ---- */

/*
 * One word at a time, which is what this box matches on: a row is scored
 * against the whole of what was typed, so "new issue" is a phrase no label and
 * no list of also-known-as contains. Worth knowing rather than worth asserting
 * the opposite of - the words below are the ones somebody reaching for this
 * actually types.
 */
for (const typed of ['create', 'issue', 'new']) {
  await page.fill(BOX, '');
  await page.type(BOX, typed, { delay: 30 });
  await page.waitForTimeout(300);
  const found = await offered();
  record(
    found.some((row) => row.label.toLowerCase() === 'create issue'),
    `typing "${typed}" finds it (${found.map((row) => row.label).join(', ') || 'nothing'})`,
  );
}

/* ---- and it does the thing ---- */

await page.fill(BOX, '');
await page.type(BOX, 'create issue', { delay: 20 });
await page.waitForTimeout(300);

const row = page.locator('[role="option"]', { hasText: 'Create issue' }).first();
const there = (await row.count()) > 0;
record(there, 'the row is there to be pressed');

if (there) {
  await row.click();
  await page.waitForTimeout(1500);

  const landed = new URL(page.url()).pathname;
  record(
    landed === `/workspace/${WORKSPACE}/issues/new`,
    `pressing it opens the page that starts one (${landed})`,
  );

  const drew = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
  const asks = (await page.locator('input[placeholder="What is wrong?"]').count()) > 0;
  record(asks, `and that page drew the box to write it in ("${drew.replace(/\s+/g, ' ').slice(0, 60)}…")`);
}

await finish(browser);
