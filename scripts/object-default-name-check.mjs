/**
 * Picking a shape into a nameless object node names the output after it.
 *
 * An unnamed object node spreads its fields and nothing can point at the
 * whole; a name is what makes the object referenceable, and nobody should
 * have to know that to get one. So choosing a shape fills the empty name box
 * with the shape's own name, first letter down - derived rather than a fixed
 * word, because output names are unique on a graph and every object node
 * defaulting to the same one would refuse to save. A name somebody typed is
 * never touched; that half is the ordinary controlled-input behaviour and is
 * not driven here.
 *
 * Its own workflow and object under stamped names, removed at the end.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });
const STAMP = Date.now();

const { createObject } = await graphql(
  `mutation ($input: CreateObjectInput!) { createObject(input: $input) { id } }`,
  { input: { workspaceId: WORKSPACE, name: `ZzDefaultName${STAMP}`, properties: [{ name: 'a', kind: 'STRING' }] } },
);
const { createWorkflow } = await graphql(
  `mutation ($input: CreateWorkflowInput!) { createWorkflow(input: $input) { workflowId } }`,
  { input: { workspaceId: WORKSPACE, name: `ZzDefaultFlow${STAMP}` } },
);
const workflowId = createWorkflow.workflowId;
await graphql(
  `mutation ($workspaceId: ID!, $workflowId: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $workspaceId, workflowId: $workflowId, input: $input) { nodes { key } } }`,
  { workspaceId: WORKSPACE, workflowId,
    input: { nodes: [{ key: 'keep', kind: 'OBJECT', name: 'Holder', x: 100, y: 100 }], edges: [] } },
);

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${workflowId}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(800);
await page.locator('.react-flow__node', { hasText: 'Holder' }).first().click();
await page.waitForTimeout(600);

// Pick the shape through the panel's own picker.
await page.locator('#node-object').click();
await page.waitForTimeout(300);
await page.locator(`text=ZzDefaultName${STAMP}`).first().click();
await page.waitForTimeout(500);

const named = await page.locator('#node-output-name').inputValue();
record(named === `zzDefaultName${STAMP}`, `the name box filled itself: "${named}"`);

await graphql(`mutation ($id: ID!) { removeWorkflow(id: $id) }`, { id: workflowId }).catch(() => {});
await graphql(`mutation ($id: ID!) { deleteObject(id: $id) }`, { id: createObject.id }).catch(() => {});
await finish(browser);
