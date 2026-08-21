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
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';
import { NAMES, anyOf, workspaceIdOf } from './suite/named.mjs';

/** Where the workflow lives. */
const FROM = WORKSPACE;

const { browser, context, page, graphql } = await open({ viewport: { width: 1440, height: 980 } });

/** What a DEEP export of one workflow carries: a kind and a name each. */
async function componentsOf(workflowId) {
  const answered = await context.request.post(`${BASE}/graphql`, {
    data: {
      query: `query { exportComponent(workspaceId: ${FROM}, kind: WORKFLOW, id: ${workflowId}, depth: DEEP) { json } }`,
    },
  });
  const json = (await answered.json()).data?.exportComponent?.json ?? null;
  return json === null ? [] : (JSON.parse(json).components ?? []);
}

/*
 * The workflow, the action inside it and the empty workspace, all asked for
 * rather than written down.
 *
 * This used to press `Leave out Send Slack Message`, which names a component of
 * one developer's workflow #118, and to import into workspace 24 on the grounds
 * that 24 was empty there - it is a seeded workspace full of content on this
 * machine, and a check that imports into somebody's real workspace is worse
 * than one that fails. The file being imported carries the names, so the name
 * is read out of the envelope; the empty workspace is the one `fixture.mjs`
 * makes, found by its name; and the workflow is whichever one here actually
 * carries an action, since a workflow with none has nothing to leave out.
 */
/** What kinds of node a workflow holds - a cheap reading of how heavy it is. */
const kindsIn = async (workflowId) => {
  const { workflowGraph } = await graphql(
    'query($w: ID!, $f: ID!) { workflowGraph(workspaceId: $w, workflowId: $f) { nodes { kind } } }',
    { w: FROM, f: workflowId },
  );
  return (workflowGraph?.nodes ?? []).map((node) => node.kind);
};

const WORKFLOW = await anyOf(graphql, 'workflow', FROM, NAMES.WORKFLOW, {
  override: process.env.ORKNUX_WORKFLOW,
  /*
   * An action to leave out, and no agent to drag along.
   *
   * The last phase here really does import, into the workspace the file came
   * from, so everything the envelope carries is copied under a new name. Aim
   * that at a workflow with an agent's skills hanging off it and the copies get
   * copied next time: `Answering in a thread`, then `(2)`, then `(2) (2)` - the
   * export was over a megabyte and doubling. An action, a trigger and a
   * function is more than enough to have a dependant and a reference in the
   * plan.
   */
  fits: async (row) => {
    const kinds = await kindsIn(row.id);
    return kinds.includes('ACTION') && !kinds.includes('AGENT');
  },
});
/** A workspace that has none of what the workflow runs. */
const BARE = await workspaceIdOf(graphql, NAMES.BARE_WORKSPACE, process.env.ORKNUX_BARE_WORKSPACE);

if (WORKFLOW === null || BARE === null) {
  record(
    false,
    `nothing to run against: workflow ${WORKFLOW}, empty workspace ${BARE}. ` +
      'Run scripts/suite/fixture.mjs against this server.',
  );
  await finish(browser);
}

const held = await componentsOf(WORKFLOW);
/** The action the workflow runs, named by the file rather than by the check. */
const ACTION = held.find((one) => one.kind === 'ACTION')?.name ?? null;
if (ACTION === null) {
  record(false, `workflow ${WORKFLOW} carries no action to leave out; it holds ${held.map((one) => one.kind).join(', ')}`);
  await finish(browser);
}
console.log(`leaving out the action ${JSON.stringify(ACTION)} of workflow ${WORKFLOW}, into workspace ${BARE}`);

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
  /*
   * Waited on the dialog rather than on the clock. "Reading the file…" is what
   * it says while it works the plan out, and how long that takes belongs to the
   * envelope - a deep export carrying an agent's skills is over a megabyte.
   * Every row read before the plan lands is read off a list that is not there.
   */
  const planned = await page
    .waitForFunction(
      () => {
        const dialog = document.querySelector('dialog[open]');
        return dialog !== null && !dialog.innerText.includes('Reading the file');
      },
      { timeout: 60_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!planned) {
    record(false, `the import dialog was still reading ${file} after a minute`);
    await finish(browser);
  }
  await page.waitForTimeout(600);
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

await page.locator(`dialog[open] button[aria-label="Leave out ${ACTION}"]`).click();
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

/**
 * Every action in the workspace by name.
 *
 * It used to be the count alone, and the assertion under it was
 * `actionsAfter === actionsBefore` - which is only true of a workflow that
 * carries exactly one action. The developer's #118 did; a workflow with two
 * leaves one out and imports the other, and the count grows for the right
 * reason while the check calls it "it was created anyway". What the sentence
 * means is that *the left-out one* was not made, so that is what is asked: an
 * import renames what it creates, so a new copy of it would be there under its
 * own name or under that name with a number after it.
 */
const actionNames = async () => {
  const answered = await context.request.post(`${BASE}/graphql`, {
    data: { query: `{ workspaceActions(workspaceId: ${FROM}, page: 0, size: 200) { content { name } } }` },
  });
  return (await answered.json()).data.workspaceActions.content.map((row) => row.name);
};
const actionsBefore = await actionNames();

/**
 * Everything in the workspace that an import can create, by id, so that what
 * this one creates can be taken back out.
 *
 * It was not, and the cost compounded: this check imports the file into the
 * workspace it came from, every component lands under a new name, and the next
 * run exports those too. Six runs took the workspace from fifteen workflows to
 * twenty-five and the envelope from five kilobytes to over a megabyte - which
 * is how `workflow-list-check` came to fail on a list that was ordered
 * perfectly, and how the import dialog came to need longer to read the file
 * than this check was willing to wait. The rule is already written in
 * `workflow-list-check`: a check that leaves rows behind changes the answer the
 * next one gets.
 */
const KINDS = [
  // In the order they are removed: what points at things first.
  ['workspaceWorkflows', 'removeWorkflow'],
  ['workspaceActions', 'deleteAction'],
  ['workspaceTriggers', 'deleteTrigger'],
  ['workspaceAgents', 'deleteAgent'],
  ['workspaceConditions', 'deleteCondition'],
  ['workspaceTools', 'deleteTool'],
  ['workspaceSkills', 'deleteSkill'],
  ['workspaceFunctions', 'deleteFunction'],
];

const snapshot = async () => {
  const held = new Map();
  for (const [list] of KINDS) {
    const answered = await graphql(
      `query($w: ID!) { ${list}(workspaceId: $w, page: 0, size: 500) { content { id } } }`,
      { w: FROM },
    );
    held.set(list, new Set(answered[list].content.map((row) => String(row.id))));
  }
  return held;
};

/** Whatever appeared since the snapshot, removed in the order above. */
const sweep = async (was) => {
  let taken = 0;
  for (const [list, mutation] of KINDS) {
    const answered = await graphql(
      `query($w: ID!) { ${list}(workspaceId: $w, page: 0, size: 500) { content { id } } }`,
      { w: FROM },
    );
    for (const row of answered[list].content) {
      if (was.get(list).has(String(row.id))) continue;
      const done = await graphql(`mutation($id: ID!) { ${mutation}(id: $id) }`, { id: row.id })
        .then(() => true)
        .catch((cause) => {
          console.log(`  could not ${mutation}(${row.id}): ${cause.message.slice(0, 120)}`);
          return false;
        });
      if (done) taken += 1;
    }
  }
  return taken;
};

const wasHere = await snapshot();

await openWith(FROM, DEEP);
await page.locator(`dialog[open] button[aria-label="Leave out ${ACTION}"]`).click();
await page.waitForTimeout(1800);
const reusing = await rows();
show('into the workspace it came from, with the action left out:', reusing);
await page.screenshot({ path: '/tmp/leave-out-reuse.png' });

const stillImportable = !(await page.locator('dialog[open] button:has-text("Import")').last().isDisabled());
const pointsAtTheOneHere = reusing.some(
  (row) => row.name === ACTION && row.badge === 'Already here' && row.offers === null,
);
await page.locator('dialog[open] button:has-text("Import")').last().click();
await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(2500);

const actionsAfter = await actionNames();
const madeByTheImport = actionsAfter.filter((name) => !actionsBefore.includes(name));
// A copy of the left-out one, under its own name or that name with a number.
const leftOutWasMade = madeByTheImport.some(
  (name) => name === ACTION || name.startsWith(`${ACTION} (`),
);
console.log(`actions in the workspace: ${actionsBefore.length} before, ${actionsAfter.length} after`);
console.log(`the import made: ${madeByTheImport.join(', ') || '(nothing)'}`);

// Everything that import created, back out again - measured first, so the
// assertions above are about what really happened.
console.log(`swept ${await sweep(wasHere)} components the import created`);

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
console.log(!leftOutWasMade ? 'PASS: the left-out action was not created' : `FAIL: ${ACTION} was created anyway`);

await browser.close();
await finish(browser, carriedOffers, referencesOfferNothing, saysNothingLeft, importOff, putBack, workflowWent, warned, pointsAtTheOneHere, stillImportable, !leftOutWasMade);
