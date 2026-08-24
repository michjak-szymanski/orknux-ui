/**
 * Putting the builder panel away, from the corner people look in.
 *
 * Open definition on a node opens that definition down the left of the editor.
 * There was a way out of it - the Cancel at the foot of the form - and on a
 * trigger's settings that is three screens of scrolling below the fold, so in
 * practice the panel had no close: "when I want to close a window I look exactly
 * into right upper corner".
 *
 * A panel is not a modal. It is opened with `show()` rather than `showModal()`,
 * because the graph beside it is the whole reason it is a panel, and a non-modal
 * dialog gets neither a backdrop to click nor an Escape from the browser. So
 * both had to be built: an × in the header and a key.
 *
 * What is measured here is the part that is easy to get wrong and impossible to
 * see in a screenshot - that the × does not scroll away. The panel scrolls, and
 * a close control that leaves with the first field is the bug being fixed,
 * differently spelled. So the panel is scrolled to its end and the × is measured
 * again, and it has to be exactly where it was.
 *
 * The Cancel stays and is checked for: it sits beside Save and Delete and
 * belongs to the form, which is a different sentence from "put this panel away".
 * Both of them discard whatever was typed without asking - that is what the
 * Cancel has always done, and the × copies it rather than inventing a second
 * answer.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, drawn, shot, finish } from './suite/harness.mjs';

const EDITOR = `${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`;

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/** Which node carries a definition the panel can open. */
const { workflowGraph: graph } = await graphql(
  `query ($workspaceId: ID!, $workflowId: ID!) {
     workflowGraph(workspaceId: $workspaceId, workflowId: $workflowId) {
       nodes { key kind name agentId triggerId actionId }
     }
   }`,
  { workspaceId: WORKSPACE, workflowId: WORKFLOW },
);

const openable = [
  graph.nodes.find((node) => node.kind === 'TRIGGER' && node.triggerId !== null),
  graph.nodes.find((node) => node.kind === 'AGENT' && node.agentId !== null),
  graph.nodes.find((node) => node.kind === 'ACTION' && node.actionId !== null),
].filter((node) => node !== undefined);

if (openable.length === 0) {
  record(false, 'no node in this workflow points at a definition the panel could open');
  await finish(browser);
}

const panel = () => page.locator('dialog[open]').first();
const closer = () => panel().locator('button[aria-label="Close"]').first();

/** Opens one node's definition down the left, and says whether it got there. */
async function openPanel(name) {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the workflow editor'))) return false;
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.locator('.react-flow__node').filter({ hasText: name }).first().click();
  await page.waitForTimeout(600);
  const jump = page.getByRole('link', { name: /^Open the .+'s definition$/ });
  if ((await jump.count()) !== 1) return false;
  await jump.click();
  await page.waitForTimeout(1200);
  return (await panel().count()) === 1;
}

for (const node of openable) {
  const what = `${node.kind.toLowerCase()} "${node.name}"`;
  if (!(await openPanel(node.name))) {
    record(false, `${what}: the panel did not open, so there is nothing to close`);
    continue;
  }

  record((await closer().count()) === 1, `${what}: the panel carries an × `);
  if ((await closer().count()) !== 1) continue;

  /* ------------------------------------------------ where the × is, and stays */

  const around = await panel().boundingBox();
  const box = await closer().boundingBox();
  console.log(
    `${what}: the panel is ${around.width.toFixed(0)}x${around.height.toFixed(0)}, its × is ` +
      `${(around.x + around.width - (box.x + box.width)).toFixed(0)}px from the right edge and ` +
      `${(box.y - around.y).toFixed(0)}px from the top`,
  );
  record(
    box.x >= around.x + around.width / 2 && box.y <= around.y + 80,
    `${what}: it is in the top-right corner`,
  );

  /*
   * The heading is aligned with the title rather than floating over the first
   * field, which is what "in the corner" is supposed to mean.
   */
  const title = await panel().locator('h2').first().boundingBox();
  const alignment = Math.abs((box.y + box.height / 2) - (title.y + title.height / 2));
  console.log(`${what}: its middle is ${alignment.toFixed(0)}px off the heading's middle`);
  record(alignment <= 12, `${what}: and level with the heading`);

  /*
   * And the measurement this check is for: the panel scrolled to its end, and
   * the × still where it was. A header that scrolls away puts the close back
   * where it was found, which is the whole complaint.
   */
  const scrolled = await page.evaluate(() => {
    const held = document.querySelector('dialog[open]');
    held.scrollTop = held.scrollHeight;
    return { top: held.scrollTop, height: held.scrollHeight, seen: held.clientHeight };
  });
  await page.waitForTimeout(300);
  const after = await closer().boundingBox();
  console.log(
    `${what}: scrolled ${scrolled.top.toFixed(0)}px of ${(scrolled.height - scrolled.seen).toFixed(0)} available; ` +
      `the × moved ${Math.abs(after.y - box.y).toFixed(0)}px`,
  );
  if (scrolled.height - scrolled.seen < 20) {
    console.log(`${what}: this form fits without scrolling, so there was nothing to scroll away from`);
  } else {
    record(Math.abs(after.y - box.y) <= 2, `${what}: the × stays put while the form scrolls under it`);
  }

  // The Cancel at the foot belongs to the form and is not what was replaced.
  const cancel = panel().getByRole('button', { name: /^Cancel$/ });
  record((await cancel.count()) >= 1, `${what}: the Cancel beside Save is still there`);

  /* ------------------------------------------------------- and it closes things */

  await closer().click();
  await page.waitForTimeout(600);
  record((await page.locator('dialog[open]').count()) === 0, `${what}: pressing it closes the panel`);
  record(
    (await page.locator('.react-flow__node').count()) > 0,
    `${what}: and the canvas is still there afterwards`,
  );

  /* ------------------------------------------------------------------- Escape */

  if (!(await openPanel(node.name))) {
    record(false, `${what}: could not reopen the panel to try Escape on it`);
    continue;
  }
  await panel().press('Escape');
  await page.waitForTimeout(600);
  record((await page.locator('dialog[open]').count()) === 0, `${what}: Escape closes it too`);
  record(
    (await page.locator('.react-flow__node').count()) > 0,
    `${what}: and leaves the canvas alone`,
  );
}

await page.screenshot({ path: shot('panel-close.png') });
await finish(browser);
