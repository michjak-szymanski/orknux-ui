/**
 * Issue #221: Shift+Enter puts a line in the message and the box gets a line
 * taller, all the way up to the top.
 *
 * The composer was one line tall with `max-height: 200px` and no growth at all,
 * so a second line went somewhere the writer could not see it: the field kept
 * its 20px and scrolled, and anything longer than a sentence was composed
 * through a slot. Ten lines were in there; one was on screen.
 *
 * Three things have to hold, and each of them has been the bug on its own in
 * some product or other:
 *
 *   - **A line at a time.** Not "it gets bigger": the step is measured and every
 *     step has to be the same, because a box that jumps by a chunk on the first
 *     press and then sticks is what a fixed `min-height` looks like from
 *     outside.
 *   - **Up to the top.** The cap is the conversation above it, not a number, so
 *     the check keeps typing well past what any hard-coded ceiling would allow
 *     and asserts the box really did take the room - and then that it stopped,
 *     with the header still on screen. A box that never stops pushes the title
 *     bar off the top of the window, which is what the first attempt at this
 *     did.
 *   - **Then it scrolls.** At the cap there is more text than box, so
 *     `overflow-y` has to become something that can be scrolled. Growing to the
 *     top and clipping the rest is the original complaint in a taller box.
 *
 * And Shift+Enter must not send. That is the whole point of the gesture, and it
 * is asserted by counting the turns in the conversation before and after -
 * nothing this check types ever reaches the server.
 */
import { BASE, open, record, finish, shot } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' });
const composer = page.locator('#chat-composer');
await composer.waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(700);

/** Everything this check reads off the screen, in one pass. */
const read = () =>
  page.evaluate(() => {
    const box = document.getElementById('chat-composer');
    const header = document.querySelector('h1').parentElement.getBoundingClientRect();
    const rect = box.getBoundingClientRect();
    return {
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      headerBottom: Math.round(header.bottom),
      overflow: getComputedStyle(box).overflowY,
      lineHeight: Math.round(parseFloat(getComputedStyle(box).lineHeight)),
      needs: box.scrollHeight,
    };
  });

const turns = () => page.locator('[class*="userRow"]').count();

const before = await turns();
const start = await read();
record(
  start.height <= start.lineHeight + 8,
  `an empty composer is one line (${start.height}px, and a line is ${start.lineHeight}px)`,
);

/* --------------------------------------------------------- a line at a time */

await composer.click();
const steps = [];
let last = start.height;
for (let line = 0; line < 5; line += 1) {
  await page.keyboard.type(`line ${line}`);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(120);
  const now = await read();
  steps.push(now.height - last);
  last = now.height;
}
record(
  steps.every((step) => step === start.lineHeight),
  `each Shift+Enter adds exactly one line: steps were ${steps.join(', ')}px, a line is ${start.lineHeight}px`,
);

const afterFive = await read();
record(
  afterFive.overflow === 'hidden' && afterFive.needs <= afterFive.height + 1,
  `six lines are all on screen rather than scrolled (the box is ${afterFive.height}px and holds ${afterFive.needs}px)`,
);
record(before === (await turns()), 'Shift+Enter puts in a line rather than sending the message');

/* -------------------------------------------------------------- up to the top */

/*
 * Far more lines than any fixed ceiling would have allowed - the old one was
 * 200px, ten of these - and far more than the window can hold, so the same run
 * proves both that it goes on growing and that it eventually stops.
 */
for (let line = 0; line < 60; line += 1) {
  // A character rather than a sentence: the box is measured against the number
  // of lines, and sixty typed words is half a minute of this check's runtime.
  await page.keyboard.type('x');
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(15);
}
await page.waitForTimeout(300);
const tall = await read();

record(tall.height > 200, `it grows past the old 200px ceiling (${tall.height}px)`);
record(
  tall.top - tall.headerBottom <= 120,
  `it grows up to the top of the conversation (${tall.top - tall.headerBottom}px of it left under the title bar)`,
);
record(
  tall.headerBottom > 0,
  `and stops there rather than pushing the title bar off the window (its bottom is at ${tall.headerBottom}px)`,
);
record(
  tall.needs > tall.height,
  `there is more text than box by then (${tall.needs}px of lines in ${tall.height}px)`,
);
record(
  tall.overflow === 'auto' || tall.overflow === 'scroll',
  `so the rest is scrolled to rather than clipped (overflow-y is "${tall.overflow}")`,
);

await page.screenshot({ path: shot('composer-growth.png') });

/* ------------------------------------------------------------ and back again */

/*
 * Through the native setter and an `input` event: assigning `value` does not
 * tell React anything, and a box that grew and never shrank is only half of
 * this working.
 */
await page.evaluate(() => {
  const box = document.getElementById('chat-composer');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(box, '');
  box.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
const emptied = await read();
record(
  emptied.height === start.height,
  `emptying it puts it back to one line (${emptied.height}px, from ${start.height}px)`,
);
record(emptied.overflow === 'hidden', `and it stops offering a scrollbar (overflow-y is "${emptied.overflow}")`);

await finish(browser);
