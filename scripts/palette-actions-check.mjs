/**
 * Quick actions offers things to do, not only places to be - and is named for it.
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
import { readFileSync } from 'node:fs';

import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

/**
 * The verbs, read off the one list the palette reads them off.
 *
 * Told apart from the destinations by name rather than by shape. It was "the
 * label starts with Create" for as long as every action was a Create; the
 * fourth one is called *Start a task*, which is a verb the palette draws with
 * the same plus as the other three and this check counted as a page. Asking
 * `navigation.ts` costs a file read and cannot go stale: a page that carries an
 * `action` is an action here for the same reason it is one there.
 */
const VERBS = new Set(
  [...readFileSync('src/navigation.ts', 'utf8').matchAll(/action: \{ label: t\('([^']+)'/g)].map((one) => one[1]),
);

const BOX = 'input[aria-label="Quick actions"]';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}`, { waitUntil: 'domcontentloaded' });

/* ---- what the box says it is ---- */

/*
 * Read off whatever input is in the top bar rather than off the name this check
 * drives it by. Asserting the label with a selector that already assumes the
 * label turns a wrong word into a thirty-second timeout and a report about a
 * missing box, which is the wrong sentence entirely.
 */
await page.waitForSelector('header input', { timeout: 20_000 });
const named = await page.evaluate(() => {
  const box = document.querySelector('header input');
  return { placeholder: box?.getAttribute('placeholder') ?? '', aria: box?.getAttribute('aria-label') ?? '' };
});
const bothNames = `${named.placeholder} ${named.aria}`;

record(
  !/go to/i.test(bothNames),
  `the box no longer calls itself Go to ("${named.placeholder}" / "${named.aria}")`,
);
record(
  /quick actions/i.test(named.placeholder),
  `it is called Quick actions, which is what the person who asked for it calls it ("${named.placeholder}")`,
);
/*
 * And read out as what is printed in it. Two names for one box is two boxes to
 * anybody using a screen reader, who then hears one thing and is told another
 * by whoever is helping them.
 */
record(
  named.aria.trim() !== '' && named.placeholder.replace(/…|\.\.\./g, '').trim() === named.aria.trim(),
  `what it is read out as is what is printed in it ("${named.aria}")`,
);

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
 * The pages have not been crowded out. A resting palette that is all verbs
 * would have taken away the thing this box was built for.
 *
 * It read "more than half" when there were three actions and a dozen screens.
 * There are five now - *Start a task* is the newest - and the resting list is
 * ten rows with every action offered before any page, so five and five is what
 * the design produces and the old wording made a correct palette fail. The
 * property worth keeping is the one this measures: the verbs may not outnumber
 * the places. A sixth action is what would trip it, which is the moment to
 * decide whether ten rows is still the right number.
 */
const destinations = resting.filter((row) => !VERBS.has(row.label));
record(
  destinations.length >= resting.length - destinations.length,
  `the verbs have not crowded out the pages (${destinations.length} of ${resting.length} rows)`,
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

/* ---- and the other place the old name was written ---- */

/*
 * The keystroke that opens it is a setting, and it was called Go To Shortcut. A
 * rename that leaves the old word beside the key somebody presses is the same
 * complaint again, one screen further along - so the whole of Preferences is
 * read rather than the one label.
 */
await page.goto(`${BASE}/preferences`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#palette-shortcut', { timeout: 20_000 });
const preferences = (await page.evaluate(() => document.querySelector('main')?.innerText ?? '')).replace(
  /\s+/g,
  ' ',
);

record(!/go to/i.test(preferences), 'Preferences does not call the shortcut Go To either');
record(
  /Quick Actions Shortcut/i.test(preferences),
  `it names the shortcut after the box it opens (${/([A-Za-z]+ ?[A-Za-z]* Shortcut)/.exec(preferences)?.[1] ?? 'nothing found'})`,
);
/*
 * Title case here and sentence case in the box, which is not a drift: every
 * label on that page is title case. What would be drift is a different *word*,
 * so it is the word that is asserted.
 */
record(
  !/search shortcut/i.test(preferences),
  'and does not still call it the Search shortcut, which it was for one commit',
);

await finish(browser);
