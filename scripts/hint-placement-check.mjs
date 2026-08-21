/**
 * Measures where the note actually lands, on a page inside the shell.
 *
 * `position: fixed` is measured against the window only while no ancestor
 * carries a transform. The shell animates its content in with a filling
 * animation, which leaves one on `main` - so the note was landing offset by
 * exactly the content area's origin on every page except the editor, which is
 * the one page that skips that animation.
 *
 * This asserts the note sits under its own control, which is the thing that was
 * wrong, rather than asserting it exists, which was true all along.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

// Pages inside the shell, which is where this went wrong, and the editor, which
// is where it did not - so a fix that only moved the problem would show here.
const pages = [
  { what: 'admin shell settings', at: '/admin/shell' },
  { what: 'admin settings', at: '/admin/settings' },
  { what: 'workflow editor', at: `/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, select: '.react-flow__node' },
];

for (const { what, at, select } of pages) {
  await page.goto(`${BASE}${at}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (select !== undefined) {
    await page.waitForSelector(select, { timeout: 20_000 });
    await page.locator(select).first().click();
    await page.waitForTimeout(800);
  }

  const hint = page.locator('[data-hint]').first();
  if ((await hint.count()) === 0) {
    console.log(`(skipped ${what}: no (?) found)`);
    continue;
  }

  await hint.hover();
  await page.waitForTimeout(300);
  const note = page.locator('[role="note"]').first();
  if ((await note.count()) === 0) {
    record(false, `${what}: the note did not open`);
    continue;
  }

  const onControl = await hint.boundingBox();
  const onNote = await note.boundingBox();

  // Under it, and lined up with its left edge - unless the window's right edge
  // pushed it back, which is the one legitimate reason for them to differ.
  const below = onNote.y > onControl.y && onNote.y - (onControl.y + onControl.height) < 24;
  const lined = Math.abs(onNote.x - onControl.x) <= 2 || onNote.x + onNote.width >= 1440 - 12;
  record(below && lined, `${what}: the note sits under its own control (control ${Math.round(onControl.x)},${Math.round(onControl.y)} note ${Math.round(onNote.x)},${Math.round(onNote.y)})`);

  await page.mouse.move(20, 880);
  await page.waitForTimeout(400);
}

/*
 * The case a rectangle cannot answer: inside a modal dialog.
 *
 * `showModal()` puts a dialog in the top layer, which paints over everything
 * outside it whatever the z-index. A note portalled to the body from in there
 * lands exactly where it should and is invisible - so this asks what is
 * actually drawn at the note's centre, not where the note thinks it is.
 */
await page.goto(`${BASE}/workspace/${WORKSPACE}/triggers`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const opener = page.getByRole('button', { name: /new trigger|create trigger|add trigger/i }).first();
if ((await opener.count()) > 0) {
  await opener.click();
  await page.waitForTimeout(900);
  const inDialog = page.locator('dialog[open] [data-hint]').first();
  if ((await inDialog.count()) > 0) {
    await inDialog.hover();
    await page.waitForTimeout(400);
    const note = page.locator('[role="note"]').first();
    const box = await note.boundingBox();
    const onTop = await page.evaluate(
      ([x, y]) => {
        const at = document.elementFromPoint(x, y);
        const note = at?.closest('[role="note"]');
        return note !== null && note !== undefined;
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    record(onTop, 'in a modal dialog the note is what is actually drawn on top');
  } else {
    console.log('(no (?) inside the trigger dialog to check)');
  }
} else {
  console.log('(could not open the trigger dialog)');
}

await finish(browser);
