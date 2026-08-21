/**
 * The workflow list's header row: one line, and the right nouns on it.
 *
 * Issue #174, three faults the owner found in one header while testing 0.9.0:
 *
 *   1. the sort control sat on a row of its own between the heading and the
 *      table, while Auto / Import / Use template / + Create Workflow sat on the
 *      header row above it;
 *   2. the first column was headed "Template name" over a list of workflows -
 *      the same wrong noun the footer under it carried until 788b694, and
 *      wrong for the same reason: a template is a published copy of a
 *      component, kept on another page;
 *   3. "two controls floating under the title, with no label". Those were the
 *      sort control's own select and direction button. Nothing was orphaned and
 *      nothing was missing - the row held one control and its 10px grey label,
 *      which is what a lone control on an empty line looks like.
 *
 * So 1 and 3 are one fault and one fix, and the thing worth holding the page to
 * is *measured*, not photographed: the sort control and the four buttons have
 * to share a row. Vertical centres, because "same line" is a fact about
 * geometry and a screenshot of it is a fact about somebody's eyesight. Two
 * pixels of tolerance for controls of different heights sitting on `align-items:
 * center`.
 *
 * The last assertion is the one that keeps the fix honest rather than pretty:
 * moving a control is only a fix if it still works where it landed, so the
 * direction button is pressed and the list has to come back in the other order.
 */
import { BASE, WORKSPACE, open, record, finish, drawn, shot } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

let failed = false;
try {
  await page.goto(`${BASE}/workspace/${WORKSPACE}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the workflow list'))) throw new Error('the list never drew');
  await page.waitForSelector('#workflow-order', { timeout: 20_000 });

  record(
    (await page.locator('h1').first().innerText()).trim() === 'Workflows',
    'this is the Workflows page',
  );

  // ------------------------------------------------- one row, measured not seen

  /** The vertical centre of one control, or null when it is not on the page. */
  async function centre(name, selector) {
    const box = await page.locator(selector).first().boundingBox().catch(() => null);
    if (box === null) {
      record(false, `${name}: nothing on the page matches ${selector}`);
      return null;
    }
    return { name, y: box.y + box.height / 2, x: box.x, box };
  }

  const controls = (
    await Promise.all([
      centre('sort select', '#workflow-order'),
      centre('sort direction', 'button[aria-label^="Sorted "]'),
      centre('Auto', 'select[aria-label="Refresh automatically"]'),
      centre('Import', 'button:has-text("Import")'),
      centre('Use template', 'button:has-text("Use template")'),
      centre('Create Workflow', 'button:has-text("Create Workflow")'),
    ])
  ).filter((one) => one !== null);

  record(controls.length === 6, `the header draws all six controls (found ${controls.length})`);

  const centres = controls.map((one) => one.y);
  const spread = Math.max(...centres) - Math.min(...centres);
  record(
    spread <= 2,
    `sort shares a row with Auto / Import / Use template / + Create Workflow - ` +
      `their vertical centres span ${spread.toFixed(1)}px: ` +
      controls.map((one) => `${one.name} ${one.y.toFixed(1)}`).join(', '),
  );

  /*
   * And the other half of the same fact, which the spread alone cannot give:
   * the control is inside the header element rather than merely level with it.
   * A second row that happened to overlap would pass the measurement above.
   */
  const inHeader = await page.evaluate(() =>
    document.querySelector('main section > header')?.contains(document.querySelector('#workflow-order')) ?? false,
  );
  record(inHeader, 'and it is in the header element, not a row that lines up with one');

  /*
   * Nothing left behind. The row the sort control was on held nothing else, so
   * it should be gone rather than empty - an empty flex row still costs the
   * card's 16px gap, which is most of what the owner was complaining about.
   */
  const between = await page.evaluate(() => {
    const header = document.querySelector('main section > header');
    const next = header?.nextElementSibling ?? null;
    return next === null ? null : { className: next.className, text: next.innerText.trim().slice(0, 40) };
  });
  record(
    between !== null && /^(TEMPLATE|WORKFLOW)/i.test(between.text),
    `the table follows the header directly, with no row in between ` +
      `(next is <${between?.className}> "${between?.text}")`,
  );

  // ------------------------------------------------------ what the columns say

  const columns = await page.evaluate(() => {
    const header = document.querySelector('main section > header');
    const table = header?.nextElementSibling;
    const row = table?.firstElementChild;
    return [...(row?.children ?? [])].map((one) => one.textContent.trim());
  });
  record(columns.length >= 4, `the table has a header row (${columns.join(' | ')})`);
  record(
    /workflow/i.test(columns[0] ?? ''),
    `the first column names what the rows are - it says "${columns[0]}"`,
  );
  record(
    !columns.some((one) => /template/i.test(one)),
    `and no column is headed with the Templates page's noun (${columns.join(' | ')})`,
  );

  // -------------------------------------------- and it still sorts where it is

  const names = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll('main section a[href*="/editor"]')].map((one) => one.textContent.trim()),
    );

  const ascending = await names();
  await page.locator('button[aria-label^="Sorted "]').first().click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('dir') === 'desc', { timeout: 10_000 });
  await page.waitForTimeout(900);
  const descending = await names();

  record(
    ascending.length > 1 && descending.length > 1,
    `the list has rows to order (${ascending.length} then ${descending.length})`,
  );
  record(
    ascending[0] !== descending[0],
    `pressing the direction where it now sits reorders the list ` +
      `("${ascending[0]}" -> "${descending[0]}")`,
  );

  await page.screenshot({ path: shot('workflow-header-check.png'), clip: { x: 260, y: 80, width: 1180, height: 260 } });
} catch (cause) {
  failed = true;
  console.error(`FAIL: the check threw: ${cause instanceof Error ? cause.stack : String(cause)}`);
}

await finish(browser, !failed);
