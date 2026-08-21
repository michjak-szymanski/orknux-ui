/**
 * What a component has been, browsed and put back, from the screen.
 *
 * Issue #141 asked for three things and only the first two are testable from a
 * server: browse the history, see the snapshot at a given time, and restore
 * one. The third is the one that goes wrong quietly in an interface — a
 * Restore that calls the mutation and leaves the editor holding the version it
 * just replaced will put that version straight back on the next save, and
 * nothing on screen says so. So this presses the button and then reads the
 * component back off the server.
 *
 * Two halves, because the rule behind them differs. A tool has no draft, so
 * every save is a version of it. A workflow has one, so only publishing is —
 * and restoring a publication deliberately does not touch the draft, which is
 * the assertion at the end.
 *
 * Builds its own tool and its own workflow, and takes both away again - except
 * the workflow *definition*, which nothing can remove: `removeWorkflow`
 * unassigns it from the workspace and the definition is kept on purpose, so the
 * name stays taken and every run needs a new one. That is why everything here
 * is named after the clock.
 */
import { BASE, WORKSPACE, open, record, drawn, shot, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open();

/** Unique per run: tool names and workflow names are both taken for good. */
const TAG = `history${Date.now().toString(36)}`;

let toolId = null;
let assignmentId = null;
let workflowId = null;
let functionId = null;
let catalogId = null;
let agentId = null;

try {
  // ------------------------------------------------------- a tool's history

  toolId = (
    await graphql(
      'mutation($workspaceId: ID!, $name: String!) { createTool(input: { workspaceId: $workspaceId, name: $name }) { id } }',
      { workspaceId: WORKSPACE, name: TAG },
    )
  ).createTool.id;

  const first = `export default function ${TAG}() { return 'first'; }`;
  const second = `export default function ${TAG}() { return 'second'; }`;
  const write = (code) =>
    graphql('mutation($id: ID!, $code: String!) { updateTool(id: $id, input: { source: $code, typescript: $code }) { id } }', {
      id: toolId,
      code,
    });
  await write(first);
  await write(second);

  await page.goto(`${BASE}/workspace/${WORKSPACE}/tools/${toolId}`, { waitUntil: 'domcontentloaded' });
  if (await drawn(page, 'the tool editor')) {
    const history = page.getByRole('region', { name: 'History' });
    await history.waitFor({ timeout: 20_000 }).catch(() => {});

    /*
      The stub the tool was created as, and the first thing written over it -
      waited for rather than counted straight away. `count()` does not
      auto-wait, and this panel fetches its list after the page it is on has
      drawn - so counting immediately counts an empty list and reports a
      missing feature.
    */
    const rows = history.locator('li');
    await rows.first().waitFor({ timeout: 20_000 }).catch(() => {});
    record((await rows.count()) === 2, `the tool's history shows ${await rows.count()} versions, and two saves were made`);

    // Newest first, so the top row is what the second save replaced.
    await rows.first().getByRole('button').click();
    const shown = await history.getByLabel('This version').innerText({ timeout: 10_000 });
    record(shown.includes("'first'"), 'opening it shows the code that version held');
    record(!shown.includes("'second'"), 'and not the code that replaced it');

    await page.screenshot({ path: shot('component-history.png'), fullPage: true });

    await history.getByRole('button', { name: 'Restore this version' }).click();

    // The measured half. What is stored is what the version held, and the list
    // is one longer because the restore kept what it displaced.
    await page.waitForTimeout(1500);
    const restored = (await graphql('query($id: ID!) { tool(id: $id) { typescript } }', { id: toolId })).tool;
    record(restored.typescript === first, 'restoring put that version back into the tool');

    const after = await rows.count();
    record(after === 3, `the list redrew with ${after} versions, because the restore kept what it replaced`);
  }

  // ------------------------------------------ a workflow's publications

  const created = (
    await graphql(
      'mutation($workspaceId: ID!, $name: String!) { createWorkflow(input: { workspaceId: $workspaceId, name: $name }) { id workflowId } }',
      { workspaceId: WORKSPACE, name: TAG },
    )
  ).createWorkflow;
  assignmentId = created.id;
  workflowId = created.workflowId;

  const draw = (nodeName) =>
    graphql(
      `mutation($workspaceId: ID!, $workflowId: ID!, $name: String!) {
         saveWorkflowGraph(workspaceId: $workspaceId, workflowId: $workflowId, input: {
           nodes: [{ key: "one", kind: AGENT, name: $name, x: 0, y: 0 }], edges: []
         }) { status }
       }`,
      { workspaceId: WORKSPACE, workflowId, name: nodeName },
    );
  const publish = () =>
    graphql(
      'mutation($workspaceId: ID!, $workflowId: ID!) { publishWorkflow(workspaceId: $workspaceId, workflowId: $workflowId) { status } }',
      { workspaceId: WORKSPACE, workflowId },
    );

  await draw('First answer');
  await publish();
  await draw('Second answer');
  await publish();

  await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${workflowId}/settings`, {
    waitUntil: 'domcontentloaded',
  });
  if (await drawn(page, 'the workflow settings page')) {
    const publications = page.getByRole('region', { name: 'Publications' });
    await publications.waitFor({ timeout: 20_000 }).catch(() => {});

    const rows = publications.locator('li');
    await rows.first().waitFor({ timeout: 20_000 }).catch(() => {});
    record((await rows.count()) === 2, `the workflow shows ${await rows.count()} publications, and it was published twice`);
    record(
      (await publications.getByText('Live', { exact: true }).count()) === 1,
      'exactly one of them is marked Live',
    );

    // The older one is the only row with a button on it.
    await publications.getByRole('button', { name: 'Restore' }).first().click();
    await page.waitForTimeout(1500);

    const running = (
      await graphql('query($workspaceId: ID!, $workflowId: ID!) { workflowPublications(workspaceId: $workspaceId, workflowId: $workflowId) { id current restoredFrom } }', {
        workspaceId: WORKSPACE,
        workflowId,
      })
    ).workflowPublications;
    record(running.length === 3, `restoring published again rather than reviving a row: ${running.length} publications`);
    record(running[0].current === true && running[0].restoredFrom !== null, 'the newest says which one it copied');

    // The half that would be a silent data loss if it were wrong.
    const draft = (
      await graphql('query($workspaceId: ID!, $workflowId: ID!) { workflowGraph(workspaceId: $workspaceId, workflowId: $workflowId) { status nodes { name } } }', {
        workspaceId: WORKSPACE,
        workflowId,
      })
    ).workflowGraph;
    record(draft.nodes[0].name === 'Second answer', 'the draft on the canvas was left alone');
    record(draft.status === 'DRAFT', 'and the badge says so, because what runs is not what is drawn');

    await page.screenshot({ path: shot('publication-history.png'), fullPage: true });
  }

  // ------------------------------- the other three panels, drawn at all

  /*
   * The same panel stands in three more frames - the function editor's aside,
   * the skill editor's, and a card on the agent settings page - and the way it
   * fails in any of them is by not being there: a page whose layout it broke,
   * or a page it was wired into and never rendered. Behaviour is covered by the
   * tool above; this is that it arrived.
   */
  functionId = (
    await graphql(
      'mutation($workspaceId: ID!, $name: String!) { createFunction(input: { workspaceId: $workspaceId, name: $name }) { id } }',
      { workspaceId: WORKSPACE, name: TAG },
    )
  ).createFunction.id;
  catalogId = (
    await graphql('mutation($workspaceId: ID!, $name: String!) { createSkillCatalog(workspaceId: $workspaceId, name: $name) { id } }', {
      workspaceId: WORKSPACE,
      name: TAG,
    })
  ).createSkillCatalog.id;
  const skillId = (
    await graphql(
      'mutation($workspaceId: ID!, $catalogId: ID!, $name: String!) { createSkill(input: { workspaceId: $workspaceId, catalogId: $catalogId, name: $name }) { id } }',
      { workspaceId: WORKSPACE, catalogId, name: TAG },
    )
  ).createSkill.id;
  agentId = (
    await graphql(
      'mutation($workspaceId: ID!, $name: String!) { createAgent(input: { workspaceId: $workspaceId, name: $name, type: LLM }) { id } }',
      { workspaceId: WORKSPACE, name: TAG },
    )
  ).createAgent.id;

  const elsewhere = [
    ['the function editor', `/workspace/${WORKSPACE}/functions/${functionId}`],
    ['the skill editor', `/workspace/${WORKSPACE}/skills/${skillId}`],
    ['the agent settings page', `/workspace/${WORKSPACE}/agents/${agentId}/settings`],
  ];
  for (const [what, path] of elsewhere) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    if (!(await drawn(page, what))) continue;
    const history = page.getByRole('region', { name: 'History' });
    const there = await history
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    record(there, `${what} shows the history panel`);
  }
} finally {
  // Its own data, swept up, whichever assertion failed on the way.
  if (toolId !== null) {
    await graphql('mutation($id: ID!) { deleteTool(id: $id) }', { id: toolId }).catch(() => undefined);
  }
  if (assignmentId !== null) {
    await graphql('mutation($id: ID!) { removeWorkflow(id: $id) }', { id: assignmentId }).catch(() => undefined);
  }
  if (agentId !== null) {
    await graphql('mutation($id: ID!) { deleteAgent(id: $id) }', { id: agentId }).catch(() => undefined);
  }
  // The catalog takes the skill in it, which is why the skill is not deleted
  // by name here.
  if (catalogId !== null) {
    await graphql('mutation($id: ID!) { deleteSkillCatalog(id: $id) }', { id: catalogId }).catch(() => undefined);
  }
  if (functionId !== null) {
    await graphql('mutation($id: ID!) { deleteFunction(id: $id) }', { id: functionId }).catch(() => undefined);
  }
}

await finish(browser);
