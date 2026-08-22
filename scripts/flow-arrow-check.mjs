/**
 * A line in the workflow editor says which way the run goes.
 *
 * Issue #200. Every line on the canvas was a plain stroke between two boxes,
 * and a graph drawn like that has to be read by working out which end of each
 * line is a node's output - which is possible, since a node carries its
 * orientation and its handles sit accordingly, and is exactly the work a
 * picture is supposed to save. Turn one node around and the picture stops
 * telling you anything at all.
 *
 * So: an arrowhead at the target end of every line a run travels, and none at
 * the source end. That second half is the direction claim, and it is why this
 * reads `marker-start` as well.
 *
 * The dependency lines deliberately keep none. A dashed line here means "this
 * node reads a field from that one" or "this agent keeps that conversation" -
 * neither is a step, the validator does not count them towards a node's
 * incoming, and the engine never sees them. `session-edge-check` made that
 * argument first, when it asserted no line had an arrow at all; the arrow is
 * what now separates the two kinds, so both checks say it from their own side.
 *
 * The fixture is built and swept here: four agent nodes, one failure branch,
 * one node left unwired to make the dashed line. It needs no model and never
 * runs - the graph is saved over GraphQL and read back off the canvas.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';
import { anyOf } from './suite/named.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/* ----------------------------------------------------------------- fixture */

const PREFIX = 'zzFlowArrow';
const WORKFLOW_NAME = `${PREFIX} ${Date.now()}`;

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

const AGENT = await anyOf(graphql, 'agent', WORKSPACE, null);
if (AGENT === null) {
  record(false, 'this workspace has no agent, so there is no node to wire together');
  await finish(browser);
}

const made = await graphql(`mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id } }`, {
  input: {
    workspaceId: WORKSPACE,
    name: WORKFLOW_NAME,
    description: 'Made by scripts/flow-arrow-check.mjs to look at the arrowheads, and removed again after.',
  },
});
const WORKFLOW = made.createWorkflow.id;
console.log(`made workflow ${WORKFLOW_NAME} (#${WORKFLOW}) around agent #${AGENT}`);

const agentNode = (key, name, outputName, x, y, mappings, extra = {}) => ({
  key,
  kind: 'AGENT',
  name,
  agentId: AGENT,
  outputName,
  x,
  y,
  mappings,
  ...extra,
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
        agentNode(
          'first',
          `${PREFIX} asks`,
          'said',
          40,
          260,
          [{ name: 'prompt', expression: 'Say hello.', mode: 'VALUE' }],
          { fallbackEnabled: true },
        ),
        agentNode('second', `${PREFIX} answers`, 'answered', 460, 160, [
          { name: 'prompt', expression: 'aside', mode: 'REFERENCE' },
        ]),
        agentNode('rescue', `${PREFIX} apologises`, 'sorry', 460, 420, [
          { name: 'prompt', expression: 'Say sorry.', mode: 'VALUE' },
        ]),
        // Wired to nothing, and produces the field `second` reads - which is
        // what makes the editor draw the dashed dependency line.
        agentNode('aside', `${PREFIX} aside`, 'aside', 40, 40, [
          { name: 'prompt', expression: 'Say something else.', mode: 'VALUE' },
        ]),
      ],
      edges: [
        { source: 'first', target: 'second' },
        { source: 'first', target: 'rescue', branch: 'FAILURE' },
      ],
    },
  },
);
console.log(`graph: ${graph.saveWorkflowGraph.problems.map((one) => one.message).join('; ') || 'no problems'}`);

/* ------------------------------------------------------------- the drawing */

/** How the editor names a line, which is how one is found on the page. */
const edgeId = (source, target, branch = 'plain') => `${source}-${branch}->${target}`;

/**
 * What is actually painted at each end of one line.
 *
 * The marker is read off the element and then followed to the `<marker>` it
 * names, because "there is a marker-end attribute" is not the request - a URL
 * pointing at a definition nothing rendered draws no arrow at all. The colours
 * come from the computed style of both the line and the arrow's own polyline,
 * so a red line with a grey arrowhead fails here rather than being noticed on a
 * screen later.
 */
async function painted(id) {
  return page.evaluate((edge) => {
    const path = document.querySelector(`[data-id="${edge}"] .react-flow__edge-path`);
    if (path === null) return null;

    const style = getComputedStyle(path);
    const end = path.getAttribute('marker-end') ?? '';
    /*
     * Everything between the `#` and the closing quote. Not `[^)]+`, which is
     * where this check spent its first half hour: React Flow builds the id out
     * of the marker's own properties, so a colour written as a token puts
     * `var(--color-danger)` inside the id and a regex that stops at the first
     * bracket takes half of it.
     */
    const named = /url\(['"]#(.*)['"]\)/.exec(end)?.[1] ?? null;
    const marker = named === null ? null : document.getElementById(named);
    const head = marker?.querySelector('polyline') ?? null;

    return {
      dash: style.strokeDasharray,
      stroke: style.stroke,
      end,
      start: path.getAttribute('marker-start') ?? '',
      /** Whether the definition the line points at is really in the document. */
      defined: marker !== null,
      orient: marker?.getAttribute('orient') ?? null,
      size: [Number(marker?.getAttribute('markerWidth') ?? 0), Number(marker?.getAttribute('markerHeight') ?? 0)],
      headFill: head === null ? null : getComputedStyle(head).fill,
    };
  }, id);
}

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });

if (await drawn(page, 'the workflow editor')) {
  await page.waitForSelector('.react-flow__edge-path', { timeout: 20_000 });
  // The dashed read-from lines are worked out from the nodes' references once
  // the graph has arrived, so a line missing here is a line not drawn yet.
  await page.waitForTimeout(1500);

  const flow = await painted(edgeId('first', 'second'));
  const failure = await painted(edgeId('first', 'rescue', 'fail'));
  const reads = await painted('reads:aside->second');

  console.log(`first -> second : ${JSON.stringify(flow)}`);
  console.log(`first =X> rescue: ${JSON.stringify(failure)}`);
  console.log(`aside ..> second: ${JSON.stringify(reads)}`);

  record(flow !== null, 'the flow line is on the canvas');
  record(failure !== null, 'the failure line is on the canvas');
  record(reads !== null, 'the dashed dependency line is on the canvas to be held against them');

  if (flow !== null && failure !== null && reads !== null) {
    /* ---- it points, and it points one way ---- */
    record(flow.end !== '' && flow.end !== 'none', `the flow line carries an arrowhead (${flow.end})`);
    record(flow.defined, 'the definition it names is really in the document, not a dangling url');
    record(
      flow.start === '' || flow.start === 'none',
      `and nothing at the other end, so the arrow says which way (marker-start: ${JSON.stringify(flow.start)})`,
    );
    record(
      flow.size[0] > 0 && flow.size[1] > 0,
      `the arrowhead has a size to be seen at (${flow.size.join('x')})`,
    );
    record(
      (flow.orient ?? '').startsWith('auto'),
      `it turns with the line rather than pointing one fixed way (orient: ${flow.orient})`,
    );

    /* ---- the failure line points too, in its own colour ---- */
    record(failure.end !== '' && failure.end !== 'none', 'the failure line carries one as well');
    record(failure.defined, "the failure line's arrowhead is really defined");
    record(
      failure.headFill !== null && failure.headFill === failure.stroke,
      `and it is the colour of the line it ends (${failure.headFill} against ${failure.stroke})`,
    );
    record(
      failure.stroke !== flow.stroke && failure.end !== flow.end,
      `the two are still told apart: ${failure.stroke} against ${flow.stroke}`,
    );
    record(
      flow.headFill !== null && flow.headFill === flow.stroke,
      `the flow arrow is the colour of its own line (${flow.headFill} against ${flow.stroke})`,
    );

    /* ---- and a dependency still does not point ---- */
    record(
      reads.end === '' || reads.end === 'none',
      `the dashed dependency has none, because it is not a step (${JSON.stringify(reads.end)})`,
    );
    record(/\d/.test(reads.dash), `and is still the dashed line it was (${reads.dash})`);
  }

  await page.screenshot({ path: shot('flow-arrow.png') });
}

/* -------------------------------------------------- and the fixture is gone */

await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: WORKFLOW }).catch(() => undefined);
console.log(`swept workflow ${WORKFLOW_NAME} (#${WORKFLOW})`);

await finish(browser);
