/**
 * Recently opened: the box in the top bar puts you back where you were.
 *
 * Issue #246, whose description was three lines. The product is wide enough that
 * the thing somebody wants next is usually the thing they had five minutes ago,
 * and the only way back to it was to remember what it was called and type that.
 *
 * What is measured, in the order it is measured:
 *
 *  - a list page is not somewhere you were. `/functions` is walked through on the
 *    way to a function and must not turn up in the list; only the pages the
 *    registry marks as being about one particular thing are remembered.
 *  - the keystroke opens the box straight onto that list, newest first.
 *  - following an entry lands on the address it names. A row that goes nowhere
 *    is not a feature.
 *  - **a name is resolved, not remembered.** A function renamed behind the
 *    browser's back is listed under the name it has now. This is the assertion
 *    the whole design turns on: the list holds addresses, and everything else is
 *    read off what the workspace holds at the moment the box is opened.
 *  - **and a deleted one is not listed at all**, without a request per entry.
 *  - the resting palette still offers Create issue, so #218 was not displaced by
 *    the three rows now above it.
 *  - and the keystroke is a setting, rebound through the real Preferences
 *    control and reset again - not a key written into a component.
 *
 * It builds its own two functions and removes them, so it needs a workspace and
 * nothing else, and the names carry a timestamp so a run that died half way
 * cannot collide with the next one.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const BOX = 'input[aria-label="Quick actions"]';
const RECENT_KEYS = 'Control+Shift+E';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ---- two things to have opened ---- */

const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const FIRST = `zzRecentOne${stamp}`;
const SECOND = `zzRecentTwo${stamp}`;
const RENAMED = `zzRecentRenamed${stamp}`;

const made = async (name) => {
  const data = await graphql(
    `mutation MakeOne($input: CreateFunctionInput!) { createFunction(input: $input) { id name } }`,
    { input: { workspaceId: WORKSPACE, name } },
  );
  return data.createFunction.id;
};

const first = await made(FIRST);
const second = await made(SECOND);

const remove = async (id) => {
  await graphql(`mutation DropOne($id: ID!) { deleteFunction(id: $id) }`, { id }).catch(() => {});
};

/** What the palette is offering, in the order it offers it. */
async function offered() {
  await page.waitForSelector('ul[role="listbox"]', { timeout: 10_000 }).catch(() => {});
  // Three spans to a row, in this order: the mark, what it is called, and where
  // it belongs. Read by position rather than by class, since the class names are
  // hashed by the build.
  return page.$$eval('ul[role="listbox"] [role="option"]', (rows) =>
    rows.map((row) => {
      const spans = [...row.querySelectorAll('span')];
      return { label: spans[1]?.textContent?.trim() ?? '', where: spans[2]?.textContent?.trim() ?? '' };
    }),
  );
}

/** The headings drawn over the groups, if any. */
async function headings() {
  return page.$$eval('ul[role="listbox"] p', (all) => all.map((one) => one.textContent?.trim() ?? ''));
}

/** Open the box by its own keystroke, from wherever the page is. */
async function openRecent(keys = RECENT_KEYS) {
  await page.waitForSelector(BOX, { timeout: 20_000 });
  await page.keyboard.press(keys);
  await page.waitForTimeout(1200);
}

/** Put the box away again without following anything. */
async function shut() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/* ---- walk through a list, then open two things ---- */

// The list first, and deliberately: it is the page somebody passes through on
// the way to a function, and a history of the lists you passed through is noise.
await page.goto(`${BASE}/workspace/${WORKSPACE}/functions`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(BOX, { timeout: 20_000 });
await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${first}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(BOX, { timeout: 20_000 });
await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${second}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(BOX, { timeout: 20_000 });

// Somewhere that is neither of them, so what the list says is what was
// remembered rather than what is on screen.
await page.goto(`${BASE}/workspace/${WORKSPACE}/issues`, { waitUntil: 'domcontentloaded' });

/* ---- the keystroke opens the box onto that list ---- */

await openRecent();

const said = await headings();
record(
  said.some((one) => /recently opened/i.test(one)),
  `${RECENT_KEYS} opens the box onto Recently opened (${said.join(' | ') || 'no heading drawn'})`,
);
record(
  said.some((one) => one.includes('Ctrl+Shift+E')),
  'and the heading says which keys got there, so the next person finds it without being told',
);
/*
 * *Onto* that list, and not merely into the box with the list somewhere in it.
 * The keystroke exists because the question it answers is not "what is this
 * called" - so the verbs and the twenty pages are not what it opens on.
 */
record(
  !said.some((one) => /quick actions/i.test(one)),
  'onto that list and nothing else - the verbs and the pages are what the other keystroke is for',
);

const listed = await offered();
record(
  listed.length === 2,
  `it holds the two things that were opened and nothing else (${listed.length}: ${listed.map((one) => one.label).join(', ') || 'nothing'})`,
);
record(
  listed[0]?.label === SECOND && listed[1]?.label === FIRST,
  `newest first (${listed.map((one) => one.label).join(' then ') || 'nothing'})`,
);
/*
 * The list that was walked through on the way is not in it. Asserted by name
 * rather than by counting, because a count says the same thing right up until
 * somebody adds a row for another reason.
 */
record(
  !listed.some((one) => one.label === 'Functions'),
  'the list page walked through on the way is not offered as somewhere you were',
);
/*
 * Which section it is in, read off the registry rather than written down at
 * visit time - so a page moved between sections moves here with it.
 */
record(
  listed[0]?.where === 'Functions',
  `each row says which section it is in (${listed[0]?.where ?? 'nothing'})`,
);

/* ---- and following one goes there ---- */

const row = page.locator('[role="option"]', { hasText: FIRST }).first();
const there = (await row.count()) > 0;
record(there, 'the older of the two is there to be pressed');

if (there) {
  await row.click();
  await page.waitForTimeout(1500);
  const landed = new URL(page.url()).pathname;
  record(
    landed === `/workspace/${WORKSPACE}/functions/${first}`,
    `pressing it opens the thing it names (${landed})`,
  );
}

/* ---- a name is resolved, not remembered ---- */

/*
 * The one the whole design turns on. What is stored is the address; the name is
 * read off the workspace's own contents at the moment the box is opened. So a
 * rename made behind this browser's back has to show through - and a stored
 * label would go on printing the old word for ever, which is worse than showing
 * nothing at all.
 */
await graphql(
  `mutation RenameOne($id: ID!, $input: UpdateFunctionInput!) { updateFunction(id: $id, input: $input) { id name } }`,
  { id: first, input: { name: RENAMED } },
);

await page.goto(`${BASE}/workspace/${WORKSPACE}/issues`, { waitUntil: 'domcontentloaded' });
await openRecent();
const afterRename = await offered();
record(
  afterRename.some((one) => one.label === RENAMED),
  `a thing renamed since it was opened is listed under the name it has now (${afterRename.map((one) => one.label).join(', ') || 'nothing'})`,
);
record(
  !afterRename.some((one) => one.label === FIRST),
  'and not under the one it had when it was opened',
);
await shut();

/* ---- a deleted thing is not offered ---- */

await remove(second);

await page.goto(`${BASE}/workspace/${WORKSPACE}/issues`, { waitUntil: 'domcontentloaded' });
await openRecent();
const afterDelete = await offered();
record(
  !afterDelete.some((one) => one.label === SECOND),
  `a thing deleted since it was opened is gone from the list (${afterDelete.map((one) => one.label).join(', ') || 'nothing'})`,
);
record(
  afterDelete.some((one) => one.label === RENAMED),
  'and the one beside it is untouched, so the whole list did not go with it',
);
await shut();

/* ---- and the resting palette still does what it did ---- */

/*
 * Issue #218 put Create issue in front of somebody who had typed nothing, on the
 * argument that a quick action nobody knows about is not a quick action. Three
 * recent rows above it must not be what pushes it off the end.
 */
await page.click(BOX);
await page.waitForTimeout(600);
const resting = await offered();
record(
  resting.some((one) => one.label.toLowerCase() === 'create issue'),
  `Create issue is still offered before anything is typed (${resting.length} rows)`,
);
record(
  resting[0]?.label === RENAMED,
  `and what was last opened is at the top of it (${resting[0]?.label ?? 'nothing'})`,
);
const restingHeadings = await headings();
record(
  restingHeadings.some((one) => /recently opened/i.test(one)) &&
    restingHeadings.some((one) => /quick actions/i.test(one)),
  `the two groups are told apart (${restingHeadings.join(' | ') || 'no headings'})`,
);

/*
 * Typing turns it back into the box it was: everything, scored against what was
 * typed, with no recent group in the way.
 */
await page.fill(BOX, '');
await page.type(BOX, 'create', { delay: 30 });
await page.waitForTimeout(400);
record(
  (await headings()).length === 0,
  'and typing puts the groups away, so a search is a search again',
);
await shut();

/* ---- it is a setting, not a key written into a component ---- */

await page.goto(`${BASE}/preferences`, { waitUntil: 'domcontentloaded' });
const offeredThere = await page
  .locator('#recent-shortcut')
  .waitFor({ timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
record(offeredThere, 'Preferences lists a Recently Opened Shortcut of its own');

if (offeredThere) {
  record(
    (await page.locator('[data-hint="Recently Opened Shortcut"]').count()) === 1,
    'with a (?) beside it like every other setting on the page, rather than a paragraph under it',
  );

  /* The row's own controls, not the (?) beside its label: both are buttons. */
  const options = page.locator('#recent-shortcut').locator('xpath=../..').locator('[class*="_options_"]');
  const shown = (await options.locator('button').first().innerText()).trim();
  record(shown === 'Ctrl+Shift+E', `and the default the issue asked for (${shown})`);

  await options.locator('button', { hasText: 'Ctrl+Shift+E' }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Alt+J');
  await page.waitForTimeout(600);
  const chosen = (await options.locator('button').first().innerText()).trim();
  record(chosen === 'Ctrl+Alt+J', `Preferences took a new keystroke (${chosen})`);

  await page.goto(`${BASE}/workspace/${WORKSPACE}/issues`, { waitUntil: 'domcontentloaded' });
  await openRecent('Control+Shift+E');
  record(
    (await headings()).every((one) => !/recently opened/i.test(one)),
    'the old keystroke does nothing once it has been given up',
  );
  await shut();

  await openRecent('Control+Alt+J');
  record(
    (await headings()).some((one) => /recently opened/i.test(one)),
    'and the new one opens the list',
  );
  record(
    (await headings()).some((one) => one.includes('Ctrl+Alt+J')),
    'with the heading saying the keys that were chosen, not the ones that were shipped',
  );
  await shut();

  await page.goto(`${BASE}/preferences`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#recent-shortcut', { timeout: 20_000 });
  const back = page.locator('#recent-shortcut').locator('xpath=../..').locator('[class*="_options_"]');
  await back.locator('button', { hasText: /^Reset$/ }).click();
  await page.waitForTimeout(400);
  record(
    (await back.locator('button').first().innerText()).trim() === 'Ctrl+Shift+E',
    'Reset puts the default back, like the nine rows around it',
  );
}

/* ---- and nothing of this check is left behind ---- */

await remove(first);

await finish(browser);
