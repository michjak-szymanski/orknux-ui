/**
 * The line out of an LLM Session, drawn as a dependency rather than as a step.
 *
 * A session is not something a run passes through. The validator does not count
 * its line towards a node's incoming when it asks whether a run can reach that
 * node, and `AppWorkflowGraphSource` folds a session into the agents it leads to
 * and drops it before the engine ever sees the graph. Drawn solid, that line
 * said the opposite: same grey, same weight as the line that means "and then".
 *
 * So the measurement is a comparison inside one graph rather than a photograph
 * of one line. Three lines are on the canvas at once:
 *
 *   session -> agent   the one this check is about
 *   agent   -> reader  an ordinary flow line, in the same graph, as the control
 *   next   ..> reader  the dependency the editor already drew dashed - a node
 *                      reading a field off a node it is not wired to
 *
 * and what has to hold is that the first matches the third and differs from the
 * second. Held against the existing dashed line rather than against '6 4'
 * written out here: the point of the change was to reuse the one style this
 * canvas already has for a dependency, and a check that hard-codes the dashes
 * would go on passing if somebody gave sessions a third style of their own.
 *
 * The arrowhead is measured too, for the reason the style was changed at all: a
 * dependency with a direction arrow on it still reads as flow. No line in this
 * editor has one, and this says so rather than leaving it to be noticed later.
 *
 * The fixture is built and swept here. It needs no model and never runs: the
 * graph is saved over GraphQL and read back off the canvas, so what is measured
 * is the drawing.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';
import { anyOf } from './suite/named.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/* ----------------------------------------------------------------- fixture */

const PREFIX = 'zzSessionEdge';
const WORKFLOW_NAME = `${PREFIX} ${Date.now()}`;

/** Anything a run that died halfway through left behind, and this run's own. */
async function sweep() {
  const { workspaceWorkflows } = await graphql(
    `query($id: ID!) { workspaceWorkflows(workspaceId: $id, page: 0, size: 200) { content { id name } } }`,
    { id: WORKSPACE },
  );
  for (const old of workspaceWorkflows.content.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept workflow ${old.name} (#${old.id})`);
  }
}

await sweep();

/*
 * Whichever agent the workspace has. This check never opens one and never edits
 * one - an agent node is only what a session is allowed to lead to - so it asks
 * for a row rather than for a particular agent, and a workspace built from
 * nothing works the same as the one this was written on.
 */
const AGENT = await anyOf(graphql, 'agent', WORKSPACE, null);
if (AGENT === null) {
  record(false, 'this workspace has no agent, so there is nothing a session can lead to');
  await finish(browser);
}

const made = await graphql(`mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id } }`, {
  input: {
    workspaceId: WORKSPACE,
    name: WORKFLOW_NAME,
    description: 'Made by scripts/session-edge-check.mjs to look at one line, and removed again after.',
  },
});
const WORKFLOW = made.createWorkflow.id;
console.log(`made workflow ${WORKFLOW_NAME} (#${WORKFLOW}) around agent #${AGENT}`);

const agentNode = (key, name, outputName, x, y, mappings) => ({
  key,
  kind: 'AGENT',
  name,
  agentId: AGENT,
  outputName,
  x,
  y,
  mappings,
});

const graph = await graphql(
  `mutation($ws: ID!, $id: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $ws, workflowId: $id, input: $input) { workflowId problems { message } }
   }`,
  {
    ws: WORKSPACE,
    id: WORKFLOW,
    input: {
      nodes: [
        {
          key: 'session',
          kind: 'SESSION',
          name: 'the conversation this belongs to',
          x: 40,
          y: 260,
          mappings: [
            { name: 'sessionKeyPrefix', expression: PREFIX, mode: 'VALUE' },
            { name: 'sessionKey', expression: 'one', mode: 'VALUE' },
          ],
        },
        agentNode('agent', `${PREFIX} asks`, 'said', 420, 260, [
          { name: 'prompt', expression: 'Say hello.', mode: 'VALUE' },
        ]),
        // Not wired to anything, and produces the field `reader` reads - which
        // is what makes the editor draw the dashed line this is measured against.
        agentNode('next', `${PREFIX} aside`, 'aside', 420, 40, [
          { name: 'prompt', expression: 'Say something else.', mode: 'VALUE' },
        ]),
        agentNode('reader', `${PREFIX} answers`, 'answered', 820, 260, [
          { name: 'prompt', expression: 'aside', mode: 'REFERENCE' },
        ]),
      ],
      edges: [
        { source: 'session', target: 'agent' },
        { source: 'agent', target: 'reader' },
      ],
    },
  },
);
console.log(`graph: ${graph.saveWorkflowGraph.problems.map((one) => one.message).join('; ') || 'no problems'}`);

/* ------------------------------------------------------------- the drawing */

/** How the editor names a line, which is how one is found on the page. */
const edgeId = (source, target) => `${source}-plain->${target}`;

/**
 * How one line is actually painted.
 *
 * Read off the computed style rather than the `style` attribute: what matters
 * is what the browser drew, and a rule in the stylesheet would be as capable of
 * dashing a line as the property React Flow writes. `marker-end` comes with it,
 * from both places - an arrowhead put on by a stylesheet is still an arrowhead.
 */
async function painted(id) {
  return page.evaluate((edge) => {
    const path = document.querySelector(`[data-id="${edge}"] .react-flow__edge-path`);
    if (path === null) return null;
    const style = getComputedStyle(path);
    return {
      dash: style.strokeDasharray,
      stroke: style.stroke,
      width: style.strokeWidth,
      marker: path.getAttribute('marker-end') ?? style.markerEnd,
    };
  }, id);
}

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the workflow editor')) {
  await page.waitForSelector('.react-flow__edge-path', { timeout: 20_000 });
  // The dashed read-from lines are worked out from the nodes' references once
  // the graph has arrived, so a line missing here is a line not drawn yet.
  await page.waitForTimeout(1500);

  const session = await painted(edgeId('session', 'agent'));
  const flow = await painted(edgeId('agent', 'reader'));
  const reads = await painted('reads:next->reader');

  console.log(`session -> agent : ${JSON.stringify(session)}`);
  console.log(`agent   -> reader: ${JSON.stringify(flow)}`);
  console.log(`next    ..> reader: ${JSON.stringify(reads)}`);

  const dashed = (one) => one !== null && one.dash !== 'none' && /\d/.test(one.dash);

  record(session !== null, 'the line out of the session node is on the canvas');
  record(flow !== null, 'the flow line between two agents is on the canvas');
  record(reads !== null, "the editor's existing dependency line is on the canvas to be matched against");

  if (session !== null && flow !== null && reads !== null) {
    record(dashed(session), `the session's line is dashed: ${session.dash}`);
    record(!dashed(flow), `the flow line is not dashed: ${flow.dash}`);
    record(
      session.dash !== flow.dash,
      `the two are drawn differently: ${session.dash} against ${flow.dash}`,
    );
    record(
      session.dash === reads.dash && session.stroke === reads.stroke,
      `the session's line is the dependency style this canvas already had, not a third one: ` +
        `${session.dash} / ${session.stroke} against ${reads.dash} / ${reads.stroke}`,
    );
    const bare = (one) => one.marker === null || one.marker === '' || one.marker === 'none';
    record(
      bare(session) && bare(flow) && bare(reads),
      `no line carries an arrowhead, so a dependency does not point: ` +
        `${session.marker} / ${flow.marker} / ${reads.marker}`,
    );
  }
}

/* -------------------------------------------------- and the fixture is gone */

await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: WORKFLOW }).catch(() => undefined);
console.log(`swept workflow ${WORKFLOW_NAME} (#${WORKFLOW})`);

await finish(browser);
