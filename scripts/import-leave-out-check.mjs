/**
 * Taking components out of an import, on the rows where that means something.
 *
 * The report was a screenshot of the import dialog for a workflow file, with a
 * WORKFLOW listed as Renamed and an ACTION and a TRIGGER as Not here, and the
 * ask was "remove components". The two are not the same sort of row. The
 * workflow is *in* the envelope; the action and the trigger are names it points
 * at and never carried, so there is nothing there to remove — the fix for those
 * is to make them here, or to export again with more depth.
 *
 * So this drives the real dialog on the real file and checks three things:
 * that Leave out is offered on what the file carries and on nothing else, that
 * leaving out the last thing in a file says so instead of offering an import
 * that creates nothing, and that leaving out something a kept component needs
 * takes that one with it and says so before anything is written.
 */
import { writeFileSync } from 'node:fs';
import { BASE, open, finish } from './suite/harness.mjs';

/** Where the workflow lives, and which one. */
const FROM = process.env.ORKNUX_WORKSPACE ?? '9';
const WORKFLOW = process.env.ORKNUX_WORKFLOW ?? '118';
/** A workspace that has none of what the workflow runs. */
const BARE = process.env.ORKNUX_BARE_WORKSPACE ?? '24';

const { browser, context, page } = await open({ viewport: { width: 1440, height: 980 } });

async function envelope(depth, to) {
  const answered = await context.request.post(`${BASE}/graphql`, {
    data: {
      query: `query { exportComponent(workspaceId: ${FROM}, kind: WORKFLOW, id: ${WORKFLOW}, depth: ${depth}) { json } }`,
    },
  });
  const json = (await answered.json()).data.exportComponent.json;
  writeFileSync(to, json);
  return json;
}

const SHALLOW = '/tmp/leave-out-shallow.orkx.json';
const DEEP = '/tmp/leave-out-deep.orkx.json';
await envelope('SHALLOW', SHALLOW);
await envelope('DEEP', DEEP);

/** Every row of the plan: what it is, what it says, and what it offers. */
async function rows() {
  return page.locator('dialog[open] li').evaluateAll((items) =>
    items
      .map((item) => {
        const spans = item.querySelectorAll(':scope > span > span');
        if (spans.length < 3) return null;
        const button = item.querySelector('button');
        return {
          kind: spans[0].textContent.trim(),
          name: spans[1].textContent.trim(),
          badge: spans[2].textContent.trim(),
          offers: button === null ? null : button.textContent.trim(),
        };
      })
      .filter((row) => row !== null),
  );
}

function show(where, listed) {
  console.log(where);
  listed.forEach((row) => {
    console.log(`  ${row.kind.padEnd(10)} ${row.name.padEnd(34)} [${row.badge}]  ${row.offers ?? '—'}`);
  });
}

async function openWith(workspaceId, file) {
  await page.goto(`${BASE}/workspace/${workspaceId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Showing', { timeout: 20_000 });
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForSelector('dialog[open] h2:has-text("Import")', { timeout: 20_000 });
  await page.waitForTimeout(1500);
}

// ------------------------------------------ the file from the report, as it was

await openWith(BARE, SHALLOW);
const reported = await rows();
show("the reported file's plan:", reported);
await page.screenshot({ path: '/tmp/leave-out-before.png' });

const workflowRow = reported.find((row) => row.kind === 'Workflow');
const notHere = reported.filter((row) => row.badge === 'Not here');
const carriedOffers = workflowRow?.offers === 'Leave out';
const referencesOfferNothing = notHere.length > 0 && notHere.every((row) => row.offers === null);
console.log(`the file carries the workflow, and it offers: ${workflowRow?.offers ?? 'nothing'}`);
console.log(`it points at ${notHere.length} things it does not carry, and they offer: ` +
  `${[...new Set(notHere.map((row) => row.offers ?? 'nothing'))].join(', ')}`);

// Leaving out the only thing it carries: nothing left to do, said out loud.
await page.locator(`dialog[open] button[aria-label^="Leave out"]`).first().click();
await page.waitForTimeout(1800);
const emptied = await rows();
show('after leaving the workflow out:', emptied);
await page.screenshot({ path: '/tmp/leave-out-emptied.png' });
const message = await page.locator('dialog[open] p').allInnerTexts();
const saysNothingLeft = message.some((said) => /nothing left to import/i.test(said));
const importOff = await page.locator('dialog[open] button:has-text("Import")').last().isDisabled();
console.log(`says there is nothing left: ${saysNothingLeft}; Import is off: ${importOff}`);

// And Keep puts it back.
await page.locator('dialog[open] button[aria-label^="Keep"]').first().click();
await page.waitForTimeout(1800);
const restored = await rows();
const putBack = restored.find((row) => row.kind === 'Workflow')?.badge === 'Renamed';
console.log(`Keep put it back: ${putBack}`);
await page.locator('dialog[open] button:has-text("Cancel")').click();
await page.waitForTimeout(500);

// --------------------------------- leaving out something the rest cannot do without

await openWith(BARE, DEEP);
const whole = await rows();
show('the deep file, whole:', whole);

await page.locator('dialog[open] button[aria-label="Leave out Send Slack Message"]').click();
await page.waitForTimeout(1800);
const cascaded = await rows();
show('after leaving out the action the workflow runs:', cascaded);
await page.screenshot({ path: '/tmp/leave-out-cascade.png' });

const alsoWent = cascaded.filter((row) => row.badge === 'Left out').map((row) => row.name);
const warned = (await page.locator('dialog[open] p').allInnerTexts()).some((said) =>
  /more (was|were) left out with it/i.test(said),
);
const workflowWent = cascaded.find((row) => row.kind === 'Workflow')?.badge === 'Left out';
const saysWhy = cascaded.find((row) => row.kind === 'Workflow' && row.badge === 'Left out');
const detail = workflowWent
  ? (await page.locator('dialog[open] li', { hasText: saysWhy.name }).first().innerText()).replace(/\s+/g, ' ')
  : '';
console.log(`left out: ${alsoWent.join(', ')}`);
console.log(`the cost is stated above the list: ${warned}`);
console.log(`the workflow's row says: ${detail.slice(0, 220)}`);
await page.locator('dialog[open] button:has-text("Cancel")').click();
await page.waitForTimeout(500);

// ------------------------------- and one that actually imports with a row left out

const before = await context.request.post(`${BASE}/graphql`, {
  data: { query: `{ workspaceActions(workspaceId: ${FROM}, page: 0, size: 100) { totalElements } }` },
});
const actionsBefore = (await before.json()).data.workspaceActions.totalElements;

await openWith(FROM, DEEP);
await page.locator('dialog[open] button[aria-label="Leave out Send Slack Message"]').click();
await page.waitForTimeout(1800);
const reusing = await rows();
show('into the workspace it came from, with the action left out:', reusing);
await page.screenshot({ path: '/tmp/leave-out-reuse.png' });

const stillImportable = !(await page.locator('dialog[open] button:has-text("Import")').last().isDisabled());
const pointsAtTheOneHere = reusing.some(
  (row) => row.name === 'Send Slack Message' && row.badge === 'Already here' && row.offers === null,
);
await page.locator('dialog[open] button:has-text("Import")').last().click();
await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(2500);

const after = await context.request.post(`${BASE}/graphql`, {
  data: { query: `{ workspaceActions(workspaceId: ${FROM}, page: 0, size: 100) { totalElements } }` },
});
const actionsAfter = (await after.json()).data.workspaceActions.totalElements;
console.log(`actions in the workspace: ${actionsBefore} before, ${actionsAfter} after`);

console.log(carriedOffers ? 'PASS: Leave out is offered on what the file carries' : 'FAIL: no control on a carried row');
console.log(
  referencesOfferNothing
    ? 'PASS: nothing is offered on a row the file only points at'
    : 'FAIL: a control was offered on a reference',
);
console.log(saysNothingLeft && importOff ? 'PASS: an emptied import says so and is refused' : 'FAIL: an emptied import was still offered');
console.log(putBack ? 'PASS: Keep puts it back' : 'FAIL: Keep did not restore it');
console.log(workflowWent ? 'PASS: what needed the left-out one went with it' : 'FAIL: a dependent was left pointing at nothing');
console.log(warned ? 'PASS: and the dialog says so before the button' : 'FAIL: the cost was not stated');
console.log(pointsAtTheOneHere ? "PASS: what is kept points at the workspace's own" : 'FAIL: it did not fall back to the one here');
console.log(stillImportable ? 'PASS: and the import is still offered' : 'FAIL: Import was refused');
console.log(actionsAfter === actionsBefore ? 'PASS: the left-out action was not created' : 'FAIL: it was created anyway');

await browser.close();
await finish(browser, carriedOffers, referencesOfferNothing, saysNothingLeft, importOff, putBack, workflowWent, warned, pointsAtTheOneHere, stillImportable, actionsAfter === actionsBefore);
