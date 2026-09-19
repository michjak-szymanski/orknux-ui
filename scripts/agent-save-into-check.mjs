/**
 * An agent's answer, saved into an object node on the graph.
 *
 * The Answer Shape control's other mode: instead of a shape picked inline, the
 * agent points at an object node already on the canvas. The shape is derived
 * from the target at the save - never sent - and the answer is spoken for:
 * the agent offers nothing inline any more, the object node is where the
 * fields are read, and the canvas draws the pointing as a dashed line ending
 * in an arrow: a dependency, since nothing runs along it, with the arrow
 * saying which way the answer moves. The run half - the node's fields
 * actually filled from the answer - is `AgentNodeRunnerTest` on the server;
 * this is the screen.
 *
 * It makes its own object and workflow under stamped names and removes both;
 * what a killed run leaves behind is swept by prefix at the start.
 */
import { BASE, WORKSPACE, open, record, shot, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

const PREFIX = 'zzSaveInto';
const STAMP = Date.now();

// What an earlier killed run left behind, taken out first.
const { workspaceWorkflows } = await graphql(
  `query ($workspaceId: ID!) { workspaceWorkflows(workspaceId: $workspaceId, page: 0, size: 100) {
     content { workflowId name } } }`,
  { workspaceId: WORKSPACE },
).catch(() => ({ workspaceWorkflows: { content: [] } }));
for (const old of (workspaceWorkflows?.content ?? []).filter((one) => one.name.startsWith(PREFIX))) {
  await graphql(`mutation ($id: ID!) { removeWorkflow(id: $id) }`, { id: old.workflowId }).catch(() => {});
  console.log(`NOTE: swept workflow ${old.name}`);
}
const { workspaceObjects } = await graphql(
  `query ($workspaceId: ID!) { workspaceObjects(workspaceId: $workspaceId, page: 0, size: 100) {
     content { id name } } }`,
  { workspaceId: WORKSPACE },
).catch(() => ({ workspaceObjects: { content: [] } }));
for (const old of (workspaceObjects?.content ?? []).filter((one) => one.name.startsWith(PREFIX))) {
  await graphql(`mutation ($id: ID!) { deleteObject(id: $id) }`, { id: old.id }).catch(() => {});
  console.log(`NOTE: swept object ${old.name}`);
}

const { createObject } = await graphql(
  `mutation ($input: CreateObjectInput!) { createObject(input: $input) { id } }`,
  { input: { workspaceId: WORKSPACE, name: `zzSaveInto${STAMP}`, properties: [
    { name: 'intentType', kind: 'STRING' }, { name: 'userMessage', kind: 'STRING' } ] } },
);
const { createWorkflow } = await graphql(
  `mutation ($input: CreateWorkflowInput!) { createWorkflow(input: $input) { workflowId } }`,
  { input: { workspaceId: WORKSPACE, name: `zzSaveIntoFlow${STAMP}` } },
);
const workflowId = createWorkflow.workflowId;

const saved = await graphql(
  `mutation ($workspaceId: ID!, $workflowId: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $workspaceId, workflowId: $workflowId, input: $input) {
       nodes { key outputObjectId outputNodeKey }
     }
   }`,
  {
    workspaceId: WORKSPACE,
    workflowId,
    input: {
      nodes: [
        { key: 'think', kind: 'AGENT', name: 'Support responder', outputNodeKey: 'keep',
          outputName: 'llmResult', x: 100, y: 100 },
        { key: 'keep', kind: 'OBJECT', name: 'SlackUserPrompt', objectId: createObject.id, x: 600, y: 300 },
      ],
      edges: [],
    },
  },
);
const savedAgent = saved.saveWorkflowGraph.nodes.find((node) => node.key === 'think');
record(savedAgent.outputObjectId === createObject.id, 'the shape is derived from the target at the save');
record(savedAgent.outputNodeKey === 'keep', 'and the reference is stored');

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${workflowId}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(1200);

// The dotted line, drawn from the reference rather than from any wire.
const savesEdge = page.locator('.react-flow__edge[data-id^="saves:think"]');
record((await savesEdge.count()) === 1, 'the saving is drawn as a line of its own');
const path = savesEdge.locator('path.react-flow__edge-path').first();
const dash = await path.evaluate((el) => getComputedStyle(el).strokeDasharray);
record(dash !== 'none' && dash !== '', `the line is dashed (${dash})`);
const marker = await path.getAttribute('marker-end');
record(marker !== null && marker !== '', `and ends in an arrow (${marker})`);

/*
 * The answer is spoken for: the object node is where it is read, so the agent
 * offers nothing - no chips, no fields in any picker - and the object node
 * offers the shape instead. One answer, one place to read it.
 */
const agentNode = page.locator('.react-flow__node', { hasText: 'Support responder' }).first();
const nodeText = await agentNode.innerText();
record(!nodeText.includes('llmResult'), 'the agent no longer offers its answer inline');
const objectNode = page.locator('.react-flow__node', { hasText: 'SlackUserPrompt' }).first();
const objectText = await objectNode.innerText();
record(objectText.includes('intentType'), 'the object node is where the fields are read');

// The panel says where the answer goes.
await agentNode.click();
await page.waitForTimeout(800);
const picker = page.locator('#node-answer-shape');
record((await picker.count()) === 1, 'the Answer Shape control is on the panel');
const pickerText = await picker.innerText().catch(() => '');
record(pickerText.includes('SlackUserPrompt'), `and it names the object node ("${pickerText.trim()}")`);

await page.screenshot({ path: shot('save-into-editor.png') });

await graphql(`mutation ($id: ID!) { removeWorkflow(id: $id) }`, { id: workflowId }).catch(() => {});
await graphql(`mutation ($id: ID!) { deleteObject(id: $id) }`, { id: createObject.id }).catch(() => {});
await finish(browser);
