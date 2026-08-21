/**
 * The (?) beside a field answers two ways, and this checks both.
 *
 * Hovering is the glance: it comes with the pointer and goes with it. Pressing
 * pins it, and a pinned note stays through a press elsewhere and through a
 * scroll, until its own close control is used.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, shot, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.locator('.react-flow__node').first().click();
await page.waitForTimeout(800);

const hint = page.locator('[data-hint]').first();
if ((await hint.count()) === 0) {
  console.error('no (?) on this panel');
  process.exit(1);
}
const note = page.locator('[role="note"]');
const shown = async () => (await note.count()) > 0 && (await note.first().isVisible());

// Somewhere harmless to put the pointer between measurements.
const away = async () => {
  await page.mouse.move(700, 850);
  await page.waitForTimeout(400);
};

await away();
record((await shown()) === false, 'nothing is shown until it is asked for');

// The glance.
await hint.hover();
await page.waitForTimeout(250);
record(await shown(), 'hovering shows the note');

const closeWhileHovered = await page.locator('[role="note"] button').count();
record(closeWhileHovered === 0, 'a hovered note carries no close control');

await away();
record((await shown()) === false, 'it goes when the pointer does');

// Pinned.
await hint.click();
await page.waitForTimeout(250);
record(await shown(), 'pressing it opens the note');
await away();
record(await shown(), 'a pinned note stays when the pointer leaves');

// A press elsewhere on the canvas: the case that closes a glance.
await page.mouse.click(700, 820);
await page.waitForTimeout(300);
record(await shown(), 'a pinned note survives a press elsewhere');

await page.screenshot({ path: shot('hint-pinned.png'), clip: { x: 900, y: 100, width: 540, height: 420 } });

const closer = page.locator('[role="note"] button');
record((await closer.count()) === 1, 'a pinned note carries a close control');
const inNote = await note.first().boundingBox();
const onCloser = await closer.first().boundingBox();
const cornered =
  onCloser !== null && inNote !== null && onCloser.x + onCloser.width > inNote.x + inNote.width - 28 && onCloser.y < inNote.y + 24;
record(cornered, 'the close control is in the note’s upper right corner');

await closer.click();
await page.waitForTimeout(300);
record((await shown()) === false, 'the close control puts it away');

// The keyboard: focus is the hover, and Enter pins.
await page.keyboard.press('Tab');
await hint.focus();
await page.waitForTimeout(250);
record(await shown(), 'focusing it shows the note');
await hint.press('Enter');
await page.waitForTimeout(250);
record(await shown(), 'Enter pins it');
await hint.press('Escape');
await page.waitForTimeout(250);
record((await shown()) === false, 'Escape closes a pinned note');

await finish(browser);
