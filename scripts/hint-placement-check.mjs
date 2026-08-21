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
import { BASE, WORKSPACE, WORKFLOW, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

// Pages inside the shell, which is where this went wrong, and the editor, which
// is where it did not - so a fix that only moved the problem would show here.
const pages = [
  /*
   * The shell *form*, not the shell list.
   *
   * This said `/admin/shell`, which is the list of machines and has never had a
   * (?) on it - so the one line that measured this page found nothing, wrote
   * "(skipped admin shell settings: no (?) found)" and moved on. The run then
   * reported three assertions where the file names four pages, and passed. The
   * page it meant is the one with the fields on it.
   */
  { what: 'admin shell settings', at: '/admin/shell/new' },
  { what: 'admin settings', at: '/admin/settings' },
  { what: 'workflow editor', at: `/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, select: '.react-flow__node' },
];

for (const { what, at, select } of pages) {
  await page.goto(`${BASE}${at}`, { waitUntil: 'domcontentloaded' });
  /*
   * Waited for rather than slept through. A second and a half is less than the
   * three seconds the loader stays deliberately silent for, so a slow page was
   * a blank one - and a blank page has no (?) on it, which this used to write
   * off as "no (?) found" and skip. Three pages could vanish out of a run that
   * still reported a pass.
   */
  if (!(await drawn(page, what))) continue;
  if (select !== undefined) {
    await page.waitForSelector(select, { timeout: 20_000 });
    await page.locator(select).first().click();
    await page.waitForTimeout(800);
  }

  const hint = page.locator('[data-hint]').first();
  const there = await hint
    .waitFor({ state: 'attached', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!there) {
    record(false, `${what}: the page drew, but no (?) on it in 15s - there is nothing here to place`);
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
/*
 * The same treatment, and for the same reason: the two ways out of this block
 * were `console.log` and nothing else, so a triggers list that had not arrived
 * dropped the one measurement here a rectangle cannot make - and the run said
 * nothing about it.
 */
const listed = await drawn(page, 'the trigger dialog');
const opener = page.getByRole('button', { name: /new trigger|create trigger|add trigger/i }).first();
const offered = listed
  ? await opener
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
  : false;
if (!listed) {
  // Already recorded by `drawn`; there is nothing further to say about it.
} else if (!offered) {
  record(false, 'the trigger dialog: nothing on the triggers list opens one in 15s');
} else {
  await opener.click();
  await page.waitForTimeout(900);
  const inDialog = page.locator('dialog[open] [data-hint]').first();
  if ((await inDialog.count()) === 0) {
    record(false, 'the trigger dialog: it opened, but with no (?) in it to measure');
  } else {
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
  }
}

await finish(browser);
