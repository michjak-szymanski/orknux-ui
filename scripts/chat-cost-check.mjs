/**
 * The switch that puts what an answer cost beside how long it took (issue #227).
 *
 * The number itself is the server's and is pinned there - `ChatCostTest` follows
 * a provider's counts onto the answer, adds them up across an agent's rounds,
 * costs them at the model's prices and refuses to cost them at nothing where
 * there are none. What that cannot see is the half this feature actually is: a
 * control on a page, off until somebody turns it on, and remembered for them
 * rather than for the browser they happened to be sitting at.
 *
 * So this drives the control, and asserts three things about it.
 *
 * **It is off to begin with.** The issue asked for a setting to turn the cost
 * on, which is a claim about the default and not only about the control's
 * existing. A control that shipped on would be the feature nobody asked for
 * arriving switched on for everybody.
 *
 * **What it remembers survives a different browser.** This is the whole of why
 * it is a column on `app_user` and not a key in local storage, and the two are
 * indistinguishable from one page: both come back after a reload. So the second
 * half of the assertion reads it from a browser context that has never seen the
 * first one - a fresh cookie jar, a fresh storage - which only the server can
 * answer.
 *
 * **Its explanation is behind the (?), not printed under it.** The house rule,
 * and the one most likely to rot: the note explaining that the figure is the
 * whole turn rather than the last call in it is exactly the kind of thing
 * somebody later moves out into the open where it can be seen without a click.
 * `hint-prose-check` would catch a paragraph in a muted class; this catches the
 * simpler failure of the label itself growing into a sentence, by measuring
 * that it is drawn on one line.
 *
 * It puts the switch back off at the end, because alice is a fixture and the
 * next check to read her preferences should find them as it left them.
 *
 * **What it deliberately does not assert, and where that boundary now runs.**
 * The per-answer figures are still not kept: they arrive on the stream's
 * `onDone` and nowhere else, `ChatMessage` carries no spend for the history to
 * hand back, and a reopened conversation shows no disclosure under an answer
 * three turns up. That part is the boundary rather than a gap - keeping it
 * would mean a per-turn record of our own, which is the messages table the chat
 * history convention rules out.
 *
 * What did change is the other number. The chat's own running total is kept, on
 * `chat_session`, and is under the corner of the composer whatever was said
 * when; `chat-total-check` is what drives it. So a reopened chat draws a total
 * and no per-answer line, and both of those are correct.
 */
import { BASE, chromium, record, shot, signIn, finish } from './suite/harness.mjs';

/** The control, found by the label its (?) carries rather than by a class name. */
const HINT = '[data-hint="Answer Cost"]';

/** Reads the state of the two buttons, and the shape of the label above them. */
async function readControl(page) {
  return page.evaluate((hint) => {
    const button = document.querySelector(hint);
    if (button === null) return null;
    const setting = button.closest('[class*="_setting_"]');
    const label = setting.querySelector('[class*="_settingLabel_"]');
    const options = [...setting.querySelectorAll('[role="radio"]')].map((option) => ({
      text: option.textContent.trim(),
      on: option.getAttribute('aria-checked') === 'true',
    }));
    /*
     * How many lines the label is drawn on, counted from the line boxes the
     * text actually occupies rather than from its height over its line-height.
     *
     * The arithmetic was the whole of the assertion and it could not fail.
     * Nothing in this stylesheet declares a `line-height` on the label, so the
     * computed value is the string `normal`, `parseFloat` of that is NaN, and
     * the NaN branch answered 1 - for a label of any length, on any number of
     * lines. Measured against a label deliberately grown into a sentence, the
     * box was 32px tall over two 16px lines and the check still said one.
     *
     * A range over the contents gives one client rect per line box, which needs
     * no line-height to exist and is what wrapping actually means. Distinct
     * tops rather than a count of rects, because a label made of two elements
     * side by side is still one line.
     */
    const range = document.createRange();
    range.selectNodeContents(label);
    const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));

    /*
     * What the setting says out loud, with the label, the (?) and the two
     * buttons taken out of it. Anything left is prose printed in the open,
     * which is the failure the house rule is about - and the old test for it
     * looked for an *open* popover, which at this moment there never is.
     */
    const spare = setting.cloneNode(true);
    for (const part of spare.querySelectorAll(
      '[class*="_settingLabel_"], [role="radiogroup"], button[data-hint]',
    )) {
      part.remove();
    }

    return {
      label: label.textContent.trim(),
      lines: Math.max(tops.size, 1),
      // Whatever is drawn in the setting besides the label and its two buttons.
      beside: spare.textContent.replace(/\s+/g, ' ').trim(),
      options,
    };
  }, HINT);
}

async function preferences(browser) {
  // A context of its own each time: the point of the second visit is that it
  // shares nothing with the first but the account.
  const context = await signIn(await browser.newContext());
  const page = await context.newPage();
  await page.goto(`${BASE}/preferences`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(HINT);
  await page.waitForTimeout(400);
  return { context, page };
}

const browser = await chromium.launch();

// ---------------------------------------------------------------------------
// Off to begin with, and its explanation is behind the (?).

const first = await preferences(browser);
const before = await readControl(first.page);

record(before !== null, before !== null ? 'the Answer Cost control is on Preferences' : 'no Answer Cost control');

const startsOff = before !== null && before.options.some((option) => option.text === 'Off' && option.on);
record(
  startsOff,
  startsOff
    ? 'it is off until somebody turns it on'
    : `it did not start off (${JSON.stringify(before?.options)})`,
);

const oneLine = before !== null && before.lines === 1 && before.beside === '';
record(
  oneLine,
  oneLine
    ? `"${before.label}" is one line, with the rest behind the (?)`
    : `the label runs to ${before?.lines} lines, or something else is printed beside it: ` +
      `${JSON.stringify(before?.beside)}`,
);

// The note is a click away, and says which rounds the figure covers.
await first.page.click(HINT);
await first.page.waitForTimeout(300);
const note = await first.page.evaluate(() => {
  const popover = document.querySelector('[class*="_popover_"]');
  return popover === null ? null : popover.textContent;
});
const saysWhichRounds = note !== null && /whole turn/i.test(note);
record(
  saysWhichRounds,
  saysWhichRounds
    ? 'the (?) says the figure is the whole turn and not the last call in it'
    : `the (?) does not say which rounds are counted (${JSON.stringify(note)})`,
);
await first.page.keyboard.press('Escape');

// ---------------------------------------------------------------------------
// Turned on here, and still on in a browser that has never seen this one.

await first.page
  .locator('[class*="_setting_"]', { has: first.page.locator(HINT) })
  .getByRole('radio', { name: 'On' })
  .click();
await first.page.waitForTimeout(600);
await first.page.screenshot({ path: shot('chat-cost-preference.png') });
await first.context.close();

const second = await preferences(browser);
const carried = await readControl(second.page);
const stillOn = carried !== null && carried.options.some((option) => option.text === 'On' && option.on);
record(
  stillOn,
  stillOn
    ? 'it is still on in a browser that has never seen the one it was set in'
    : `a second browser found it ${JSON.stringify(carried?.options)}`,
);

// Put back, so the next check finds alice as it left her.
await second.page
  .locator('[class*="_setting_"]', { has: second.page.locator(HINT) })
  .getByRole('radio', { name: 'Off' })
  .click();
await second.page.waitForTimeout(600);
const restored = await readControl(second.page);
record(
  restored !== null && restored.options.some((option) => option.text === 'Off' && option.on),
  'put back off',
);
await second.context.close();

await finish(browser);
