/**
 * The chat composer is one control to the eye, so it is one control to the
 * pointer.
 *
 * Reported: clicking the box did nothing unless the pointer happened to land on
 * the one line of text. It looks like a single wide field and is several things
 * - a 20px textarea beside taller buttons, inside padding - so most of what
 * plainly reads as "the input" was dead ground. The box is 54px tall and the
 * textarea 24 of them; everything else was a click that went nowhere.
 *
 * Three presses, in the three places somebody would actually aim: the padding
 * above the text, the padding below it, and the wide gap between the end of the
 * text and the buttons on the right. Each has to leave the caret in the
 * composer.
 *
 * The height is asserted too, because the fix and the complaint next to it were
 * about the same element: the padding was reduced at the same time, and a check
 * that only proves the clicks work would let it grow back.
 */
import { BASE, open, record, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' });
const composer = page.locator('#chat-composer');
await composer.waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(500);

const box = await composer.evaluateHandle((el) => el.parentElement);
const rect = await page.evaluate((el) => {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}, box);
const text = await composer.boundingBox();

/*
 * A ceiling rather than an exact height: the box grows with what is typed into
 * it, and pinning the number would make this a check about the font.
 */
const TALLEST = 60;
record(
  rect.height <= TALLEST,
  `the composer is ${Math.round(rect.height)}px tall, wanted ${TALLEST} or less (the text in it is ${Math.round(text.height)})`,
);

const focused = async () => page.evaluate(() => document.activeElement?.id ?? '');

const aim = [
  ['the padding above the text', { x: rect.x + rect.width / 2, y: rect.y + 3 }],
  ['the padding below the text', { x: rect.x + rect.width / 2, y: rect.y + rect.height - 3 }],
  ['the gap before the buttons', { x: rect.x + rect.width - 200, y: rect.y + 5 }],
];

for (const [where, point] of aim) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(150);
  const now = await focused();
  record(now === 'chat-composer', `clicking ${where} puts the caret in the composer (focus went to "${now}")`);
}

await finish(browser);
