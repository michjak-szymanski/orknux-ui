/**
 * The chat's title bar: one row, a search that searches, and a delete that
 * asks.
 *
 * Three reports about the same strip of chrome.
 *
 * **It asks before deleting.** It did not. The trash button called `deleteChat`
 * straight through, from the header and from the row menu both - one press,
 * nothing said, every message in the chat gone. This is the assertion that
 * matters: pressing delete must leave the chat where it is until somebody
 * confirms, and cancelling must leave it there for good.
 *
 * **The search searches this conversation.** It focused `#chat-search`, a hidden
 * read-only input that existed only to be focused, so it did nothing at all.
 * Then it focused the sidebar's box, which was wrong in a subtler way and had
 * to be said out loud to be seen: that box asks *which chat was that in* and
 * filters a list of titles, while this control sits above the conversation. The
 * question here is *where in this one was it said*, and the answer is a
 * position in the log - so the check searches for a word that is in the open
 * chat and asserts a turn is marked and counted.
 *
 * **One row.** The title had a row and the model picker had another below it
 * carrying a single word. They share one now, so the check reads their tops:
 * two numbers within a few pixels of each other, rather than a class name that
 * says nothing about where the thing was drawn.
 */
import { BASE, open, record, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' });
await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(700);

const title = page.locator('h1').first();
const named = (await title.textContent())?.trim() ?? '';

/* ---- one row ---- */
/*
 * Scoped to the title bar. A bare `button[aria-expanded]` finds the app shell's
 * workspace switcher first, 63px higher up, and the check then reports the
 * header as two rows when it is one - a locator failing as a layout failure.
 */
const titleBar = page.locator('h1').first().locator('..');
const picker = titleBar.locator('button[aria-expanded]').first();
const titleBox = await title.boundingBox();
const pickerBox = await picker.boundingBox();
const searchButton = page.locator('button[aria-label="Find in this chat"]');
const searchBox = await searchButton.boundingBox();

const drop = Math.abs(titleBox.y + titleBox.height / 2 - (pickerBox.y + pickerBox.height / 2));
record(drop <= 6, `the title and the model picker share a row (their middles are ${Math.round(drop)}px apart)`);
record(
  pickerBox.x + pickerBox.width <= searchBox.x,
  `the model picker sits left of the search control (picker ends ${Math.round(pickerBox.x + pickerBox.width)}, search starts ${Math.round(searchBox.x)})`,
);

/* ---- the search searches this conversation ---- */
/*
 * Out of the conversation, not out of the page. Reading `document.body` picked
 * "ORKNUX" off the nav bar - a word that is on screen and is in no turn - and
 * the check then failed the find for correctly not finding it.
 */
const said = await page.locator('[data-find], .assistantRow, [class*="assistantBody"]').first().innerText();
const needle = said.split(/\s+/).find((word) => /^[a-zA-Z]{6,}$/.test(word)) ?? '';
record(needle !== '', `there is a word in this chat worth looking for ("${needle}")`);

await searchButton.click();
await page.waitForTimeout(300);
const field = page.locator('input[aria-label="Find in this chat"]');
record((await field.count()) === 1, 'pressing search opens a find strip under the title');

await field.fill(needle);
await page.waitForTimeout(600);
const marked = await page.locator('[data-find="at"]').count();
const counted = ((await page.locator('[role="status"]').last().textContent()) ?? '').trim();
record(marked === 1, `the turn it found is marked (${marked} marked)`);
record(/^\d+ of \d+$/.test(counted), `it says how many there are ("${counted}")`);

/*
 * A word that is not in the conversation has to say so. Without this the check
 * would pass on a find that marks everything.
 */
await field.fill('zzqqxx-not-in-any-conversation');
await page.waitForTimeout(500);
record((await page.locator('[data-find="at"]').count()) === 0, 'a word that is not there marks nothing');
record(
  ((await page.locator('[role="status"]').last().textContent()) ?? '').trim() === 'Nothing',
  'and says so rather than showing an empty count',
);

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
record((await page.locator('input[aria-label="Find in this chat"]').count()) === 0, 'Escape shuts the find strip');

/* ---- the delete asks ---- */
const remove = page.locator('button[aria-label="Delete this chat"]');
await remove.click();
await page.waitForTimeout(500);

const asked = await page.locator('dialog[open]').count();
record(asked === 1, `pressing delete asks first (${asked} dialog open)`);

const stillThere = (await page.locator('h1').first().textContent())?.trim() ?? '';
record(stillThere === named, `the chat is still open while the question stands (it says "${stillThere}")`);

const cancel = page.locator('dialog[open] button', { hasText: /^Cancel$/ });
await cancel.click();
await page.waitForTimeout(500);
const afterCancel = (await page.locator('h1').first().textContent())?.trim() ?? '';
record(afterCancel === named, `cancelling keeps the chat (it says "${afterCancel}")`);
record((await page.locator('dialog[open]').count()) === 0, 'cancelling shuts the question');

await finish(browser);
