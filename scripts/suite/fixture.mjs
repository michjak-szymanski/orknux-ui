/**
 * Works out which ids the checks should be pointed at, and makes the two spare
 * workspaces two of them need.
 *
 * The checks were written against a developer's database, where the workspace
 * happened to be 9 and the workflow happened to be 9. A database built from
 * nothing hands out different numbers for the same things, so the numbers are
 * not the fixture - the *names* are, and `seed-demo.mjs` puts those names there.
 * This looks them up and prints the environment that points the suite at them:
 *
 *   node scripts/suite/fixture.mjs
 *   ORKNUX_WORKSPACE=31
 *   ORKNUX_WORKFLOW=140
 *   ...
 *
 * In CI that output goes straight into $GITHUB_ENV. By hand, `eval $(...)` or
 * read it and decide.
 *
 * It refuses rather than guesses. A missing workflow prints what it did find
 * and exits non-zero, because a suite pointed at the wrong workspace does not
 * fail - it passes vacuously on empty pages, which is the failure mode this
 * whole exercise exists to remove.
 */
import { BASE, USER, PASSWORD } from './harness.mjs';

const WORKSPACE_NAME = process.env.ORKNUX_DEMO_WORKSPACE ?? 'Northwind Support';

/*
 * The workflow the editor checks drive. It is the one with an agent in it -
 * retries, the doubling wait and the second handle all hang off an agent node -
 * and the one that carries the object field `editor-check` types into.
 */
const WORKFLOW_NAME = 'Answer a question asked in Slack';

/** The function `definition-jump-check` gives an object parameter to. */
const FUNCTION_NAME = 'ticketReference';

/** The one `param-panel-check` and `split-check` open. */
const PANEL_FUNCTION_NAME = 'minutesUntilBreach';

/** The tool `tool-wand-check` edits, when it is run at all. */
const TOOL_NAME = 'lookupCustomer';

/*
 * `import-refresh-check` switches out of a page that has ended, so it needs a
 * workspace with more than one page of workflows - four to a page - and
 * `import-leave-out-check` needs one with none of what a workflow runs, so that
 * "Not here" is what the dialog actually says. Neither is content anybody would
 * photograph, so they are made here rather than seeded.
 */
const BIGGER_NAME = 'zz Suite - a second page of workflows';
const BARE_NAME = 'zz Suite - nothing in it';
const PAGE_SIZE = 4;

const response = await fetch(`${BASE}/api/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASSWORD }),
});
if (!response.ok) {
  console.error(`Could not sign in as ${USER} at ${BASE}: ${response.status}`);
  process.exit(1);
}
const cookie = response.headers.get('set-cookie').split(';')[0];

async function gql(query, variables = {}) {
  const answer = await fetch(`${BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query, variables }),
  });
  const body = await answer.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

/** What was looked for, what was there, and no guess in between. */
function pick(what, wanted, had) {
  const found = had.find((row) => row.name === wanted);
  if (found === undefined) {
    console.error(`No ${what} called ${JSON.stringify(wanted)}. There is: ${had.map((row) => row.name).join(', ') || '(nothing)'}`);
    console.error('Has scripts/seed-demo.mjs been run against this server?');
    process.exit(1);
  }
  return found.id;
}

const { workspaces } = await gql('{ workspaces(page: 0, size: 200) { content { id name } } }');
const workspace = pick('workspace', WORKSPACE_NAME, workspaces.content);

const { workspaceWorkflows } = await gql(
  'query($w: ID!) { workspaceWorkflows(workspaceId: $w, page: 0, size: 100) { content { id name } } }',
  { w: workspace },
);
const workflow = pick('workflow', WORKFLOW_NAME, workspaceWorkflows.content);

const { workspaceFunctions } = await gql(
  'query($w: ID!) { workspaceFunctions(workspaceId: $w, page: 0, size: 100) { content { id name } } }',
  { w: workspace },
);
const fn = pick('function', FUNCTION_NAME, workspaceFunctions.content);
const panelFn = pick('function', PANEL_FUNCTION_NAME, workspaceFunctions.content);

const { workspaceTools } = await gql(
  'query($w: ID!) { workspaceTools(workspaceId: $w, page: 0, size: 100) { content { id name } } }',
  { w: workspace },
);
const tool = pick('tool', TOOL_NAME, workspaceTools.content);

/** A workspace of that name, made if it is not there yet. */
async function workspaceCalled(name, description) {
  const held = workspaces.content.find((row) => row.name === name);
  if (held !== undefined) return held.id;
  const made = await gql(
    'mutation($input: CreateWorkspaceInput!) { createWorkspace(input: $input) { id } }',
    { input: { name, description } },
  );
  return made.createWorkspace.id;
}

const bare = await workspaceCalled(BARE_NAME, 'Made by scripts/suite/fixture.mjs. Deliberately empty.');
const bigger = await workspaceCalled(BIGGER_NAME, 'Made by scripts/suite/fixture.mjs. Enough workflows for a second page.');

const { workspaceWorkflows: inBigger } = await gql(
  'query($w: ID!) { workspaceWorkflows(workspaceId: $w, page: 0, size: 100) { content { id name } } }',
  { w: bigger },
);
// One more than a page, so Next is offered and page two has something on it.
for (let n = inBigger.content.length; n <= PAGE_SIZE; n += 1) {
  await gql('mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id } }', {
    input: { workspaceId: bigger, name: `zz Suite filler ${n + 1}`, description: 'Made by fixture.mjs.' },
  });
}

for (const [key, value] of [
  ['ORKNUX_WORKSPACE', workspace],
  ['ORKNUX_WORKSPACE_NAME', WORKSPACE_NAME],
  ['ORKNUX_WORKFLOW', workflow],
  ['ORKNUX_FUNCTION', fn],
  ['ORKNUX_PANEL_FUNCTION', panelFn],
  ['ORKNUX_TOOL', tool],
  ['ORKNUX_BARE_WORKSPACE', bare],
  ['ORKNUX_BIGGER_WORKSPACE', bigger],
]) {
  console.log(`${key}=${value}`);
}
