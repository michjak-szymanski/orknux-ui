/**
 * Every icon control in a workflow row's Actions column says it is clickable.
 *
 * Issue #189 was reported as one button. It was the class: export, save as
 * template and the way in to settings all wear `.settings`, and `.settings`
 * never set `cursor`. The last of the three looked right only because it is an
 * `<a href>`, which the browser gives a pointer for nothing - so a rule written
 * for the button that was noticed would have left the other one wrong.
 *
 * Which is why this reads every control in the column rather than the second
 * one. It names the ones it found, so a column that grows a fourth control is
 * covered without anybody editing this file, and a column that has lost one is
 * visible in the output rather than silently unasserted.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}`, { waitUntil: 'domcontentloaded' });

if (await drawn(page, 'the workflow list')) {
  await page.waitForSelector('[aria-label^="Run "]', { timeout: 20_000 });

  const controls = await page.evaluate(() => {
    // The header row wears the same class and holds the word "Actions", so the
    // one wanted is the first that holds controls rather than simply the first.
    const column = [...document.querySelectorAll('span')].find(
      (one) => one.className.includes('colActions') && one.querySelector('button, a') !== null,
    );
    if (column === undefined) return null;
    return [...column.children]
      // A dialog is a sibling of the button that opens it, not a control.
      .filter((one) => one.tagName === 'BUTTON' || one.tagName === 'A')
      .map((one) => ({
        label: one.getAttribute('aria-label'),
        cursor: getComputedStyle(one).cursor,
      }));
  });

  if (controls === null) {
    record(false, 'no Actions column on the workflow list');
  } else {
    record(controls.length >= 3, `the Actions column holds ${controls.length} controls`);
    for (const { label, cursor } of controls) {
      record(cursor === 'pointer', `${JSON.stringify(label)} has cursor ${cursor}`);
    }
  }
}

await finish(browser);
