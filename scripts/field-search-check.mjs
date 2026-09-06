/**
 * The field picker's search, which used to keep whole groups it should not.
 *
 * Reported 2026-09-06: typing two letters into *Search fields* narrowed
 * nothing. The filter matched the group's heading as well as the field, so a
 * graph with a *Slack reply received* trigger and an *Azure E2E Agent* answered
 * `re` with every field of both - "reply", "received" and "azure" all contain
 * it - and a box that returns everything reads as a box that does nothing.
 *
 * The invariant, rather than one workspace's answer to it: **every option left
 * on screen carries what was typed**, in its field name or in the expression it
 * stands for. That is true of any graph, so this does not care what the fixture
 * is called; it reads the groups off the open list and picks its own needle out
 * of a heading, which is exactly the case that was broken.
 *
 * Writes nothing. It opens a picker, types in it, and leaves without saving.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1600, height: 1000 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
const drew = await page
  .waitForSelector('.react-flow__node', { timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
record(drew, 'the editor drew the graph');
if (!drew) await finish(browser);

await page.waitForTimeout(1000);

/*
 * A node with a reference to point. Which node that is depends on the graph, so
 * they are tried in turn: some draw a picker already, and some need the
 * parameter switching from Value to Reference first.
 */
const nodes = page.locator('.react-flow__node');
const pickerAt = 'button[aria-label$=" reference"]';
let opened = false;
for (let at = 0; at < (await nodes.count()); at += 1) {
  await nodes.nth(at).click();
  await page.waitForTimeout(700);
  if ((await page.locator(pickerAt).count()) === 0 && (await page.getByRole('button', { name: 'Reference' }).count()) > 0) {
    await page.getByRole('button', { name: 'Reference' }).first().click();
    await page.waitForTimeout(700);
  }
  if ((await page.locator(pickerAt).count()) > 0) {
    opened = true;
    break;
  }
}
record(opened, 'a node with a parameter pointed at a reference is open');
if (!opened) await finish(browser);

await page.locator(pickerAt).first().click();
const listed = await page
  .waitForSelector('[data-field-menu]', { timeout: 10_000 })
  .then(() => true)
  .catch(() => false);
record(listed, 'the field picker opens a list');
if (!listed) await finish(browser);

const read = () =>
  page.locator('[data-field-menu]').evaluate((menu) => ({
    groups: [...menu.querySelectorAll('[data-field-group]')].map((one) => one.textContent.trim()),
    options: [...menu.querySelectorAll('[data-field-option]')].map((one) => ({
      field: one.getAttribute('data-field-option'),
      expression: one.getAttribute('data-field-expression'),
    })),
  }));

const whole = await read();
record(whole.options.length > 0, `the list offers ${whole.options.length} fields across ${whole.groups.length} groups`);

/*
 * A needle out of a heading that no field answers to. This is the shape the
 * report was about, and picking it off the page rather than writing it down
 * means the check keeps asking the right question when the fixture changes.
 */
const needle = (() => {
  for (const group of whole.groups) {
    for (const word of group.toLowerCase().split(/\s+/)) {
      for (let size = 2; size <= word.length; size += 1) {
        const bit = word.slice(0, size);
        const answers = whole.options.some(
          (one) => one.field.toLowerCase().includes(bit) || one.expression.toLowerCase().includes(bit),
        );
        if (!answers) return bit;
      }
    }
  }
  return null;
})();

record(needle !== null, `a heading holds ${JSON.stringify(needle)}, which no field on this graph does`);
if (needle === null) await finish(browser);

await page.locator('[data-field-menu] input').fill(needle);
await page.waitForTimeout(400);

const after = await read();
record(
  after.options.length < whole.options.length,
  `typing ${JSON.stringify(needle)} narrows the list: ${whole.options.length} fields before, ${after.options.length} after`,
);
record(
  after.options.length === 0,
  `and leaves none of them, because the word is only in a heading (${JSON.stringify(after.options.map((one) => one.field))})`,
);

/* And the invariant, on a needle that does match something. */
const real = whole.options[0].field.slice(0, 3).toLowerCase();
await page.locator('[data-field-menu] input').fill(real);
await page.waitForTimeout(400);

const kept = await read();
const strays = kept.options.filter(
  (one) => !one.field.toLowerCase().includes(real) && !one.expression.toLowerCase().includes(real),
);
record(kept.options.length > 0, `typing ${JSON.stringify(real)} keeps ${kept.options.length} fields`);
record(
  strays.length === 0,
  `and every one of them carries it (${JSON.stringify(strays.map((one) => one.field))} do not)`,
);

await finish(browser);
