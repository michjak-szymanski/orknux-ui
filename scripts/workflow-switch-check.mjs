/**
 * Switching a workflow off from the editor, which had no way to do it.
 *
 * The editor drew a **Switched off** badge and offered nothing to press: the
 * only control was on the workflows list, and somebody who has just drawn a
 * workflow is in the editor rather than the list. Issue #330.
 *
 * Four things:
 *
 *   it is there   the badge is a control, and says which state it is in
 *   asks first    switching off asks the same question the list asks, because
 *                 a workflow that stops answering its triggers is a quiet
 *                 change with loud consequences
 *   it sticks     the server was told, so a reload still says off
 *   and back on   switching on again does not ask, and takes
 *
 * Makes a workflow and removes it.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const PREFIX = 'zzWorkflowSwitch';
const STAMP = Date.now();

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

const sweep = async () => {
  const { workspaceWorkflows } = await graphql(
    `query($w: ID!) { workspaceWorkflows(workspaceId: $w, page: 0, size: 200) { content { id name } } }`,
    { w: WORKSPACE },
  );
  for (const old of workspaceWorkflows.content.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: old.id }).catch(() => undefined);
  }
};

await sweep();

const made = await graphql(`mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { workflowId } }`, {
  input: { workspaceId: WORKSPACE, name: `${PREFIX} ${STAMP}`, description: 'Made by workflow-switch-check.' },
});
const WORKFLOW = made.createWorkflow.workflowId;

const clean = async () => {
  await sweep();
  await finish(browser);
};

const stored = async () =>
  (
    await graphql(
      `query($w: ID!, $f: ID!) { workflowGraph(workspaceId: $w, workflowId: $f) { enabled assignmentId } }`,
      { w: WORKSPACE, f: WORKFLOW },
    )
  ).workflowGraph;

/* -------------------------------------------------------------------- drive */

const switchControl = () => page.getByRole('button', { name: /^Switched (on|off)$/ });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the editor', { within: 30_000, still: 0 }))) await clean();

await switchControl().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);

record(await switchControl().isVisible().catch(() => false), 'the editor offers the switch');
record(
  (await switchControl().innerText().catch(() => '')).trim() === 'Switched on',
  'and says a new workflow is switched on',
);

/* ---- off, which asks first ---- */

await switchControl().click();
const asked = await page
  .getByRole('button', { name: /Switch off|Disable/i })
  .first()
  .waitFor({ timeout: 8_000 })
  .then(() => true)
  .catch(() => false);
record(asked, 'switching off asks before it does it');

if (asked) {
  await page.getByRole('button', { name: /Switch off|Disable/i }).first().click();
  await page.waitForTimeout(1200);
}

record((await stored()).enabled === false, 'the server was told, and says it is off');
record(
  (await switchControl().innerText().catch(() => '')).trim() === 'Switched off',
  'and the editor says so without a reload',
);

/* ---- a reload still says off ---- */

await page.reload({ waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the editor after a reload', { within: 30_000, still: 0 })) {
  await switchControl().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  record(
    (await switchControl().innerText().catch(() => '')).trim() === 'Switched off',
    'a reload still says off',
  );
}

/* ---- and back on, which does not ask ---- */

await switchControl().click();
await page.waitForTimeout(1200);
record((await stored()).enabled === true, 'switching on again takes, and asks nothing');

await clean();
