/**
 * Every text field on the node panel opens out, and the big box IS the field.
 *
 * A prompt does not fit a one-line field, and a one-line field is most of
 * what the panel has room for - so each value field and the description carry
 * an Expand that opens the same text at the size of the screen. The box edits
 * the draft directly, exactly as the small field does: what is typed in one
 * is in the other, there is nothing to save or cancel, and Done, the
 * backdrop and Escape all just close it. References have no Expand - they
 * are picked, not written.
 *
 * Its own workflow under a stamped name, removed at the end.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });
const STAMP = Date.now();

const { createWorkflow } = await graphql(
  `mutation ($input: CreateWorkflowInput!) { createWorkflow(input: $input) { workflowId } }`,
  { input: { workspaceId: WORKSPACE, name: `ZzExpandFlow${STAMP}` } },
);
const workflowId = createWorkflow.workflowId;
await graphql(
  `mutation ($workspaceId: ID!, $workflowId: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $workspaceId, workflowId: $workflowId, input: $input) { nodes { key } } }`,
  { workspaceId: WORKSPACE, workflowId,
    input: { nodes: [{ key: 'keep', kind: 'OBJECT', name: 'Holder', x: 100, y: 100,
      mappings: [{ name: 'note', expression: 'hello', mode: 'VALUE' }] }], edges: [] } },
);

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${workflowId}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(800);
await page.locator('.react-flow__node', { hasText: 'Holder' }).first().click();
await page.waitForTimeout(600);

await page.locator('button[aria-label="Expand note"]').click();
const box = page.locator('[role="dialog"] textarea');
record((await box.count()) === 1, 'Expand opens the big box');
record((await box.inputValue()) === 'hello', 'holding what the small field holds');

await box.fill('hello, at length, across many lines');
await page.getByRole('button', { name: 'Done', exact: true }).click();
await page.waitForTimeout(300);
const small = await page.locator('#node-mapping-note').inputValue();
record(small === 'hello, at length, across many lines', `and the small field carries it: "${small}"`);

// The description's own Expand, and Escape as the way out.
await page.locator('button[aria-label="Expand Description"]').click();
await page.locator('[role="dialog"] textarea').fill('what this node is for');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
record((await page.locator('[role="dialog"] textarea').count()) === 0, 'Escape closes the box');
const described = await page.locator('#node-description').inputValue();
record(described === 'what this node is for', 'and the description kept what was typed');

await graphql(`mutation ($id: ID!) { removeWorkflow(id: $id) }`, { id: workflowId }).catch(() => {});
await finish(browser);
