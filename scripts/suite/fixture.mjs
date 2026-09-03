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
 *
 * **It is also a function**, because the runner asks the same question of one
 * copy of the fixture per worker when it is running several checks at once —
 * see [SHARD][./named.mjs]. Printing and exiting is what the command does with
 * the answer; `fixtureEnv` is the answer, and the two cannot drift because
 * there is only one of them.
 */
import { BASE, USER, PASSWORD } from './harness.mjs';
/*
 * The names live in `named.mjs` now, because the checks look them up for
 * themselves at the moment they run rather than being handed numbers through
 * the environment. Two copies of a fixture's names is two fixtures; this file
 * and every check read the one list.
 */
import { NAMES, copy } from './named.mjs';

/*
 * `import-refresh-check` switches out of a page that has ended, so it needs a
 * workspace with more than one page of workflows, and `import-leave-out-check`
 * needs one with none of what a workflow runs, so that "Not here" is what the
 * dialog actually says. Neither is content anybody would photograph, so they
 * are made here rather than seeded.
 */
const PAGE_SIZE = 4;

/** What went wrong, as a thrown sentence rather than an exit from a library. */
class FixtureTrouble extends Error {}

/**
 * The environment that points a run at one copy of the fixture.
 *
 * [shard] is empty for the only copy there has ever been and a number for the
 * others, and it decides nothing here beyond what the names are: a second copy
 * is looked up, and its spare workspaces made, in exactly the way the first is.
 */
export async function fixtureEnv(shard = '') {
  const names = shard === '' ? NAMES : shardedNames(shard);

  const response = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!response.ok) throw new FixtureTrouble(`Could not sign in as ${USER} at ${BASE}: ${response.status}`);
  const cookie = response.headers.get('set-cookie').split(';')[0];

  async function gql(query, variables = {}) {
    const answer = await fetch(`${BASE}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ query, variables }),
    });
    const body = await answer.json();
    if (body.errors?.length) throw new FixtureTrouble(body.errors[0].message);
    return body.data;
  }

  /** What was looked for, what was there, and no guess in between. */
  function pick(what, wanted, had) {
    const found = had.find((row) => row.name === wanted);
    if (found === undefined) {
      throw new FixtureTrouble(
        `No ${what} called ${JSON.stringify(wanted)}. There is: ` +
          `${had.map((row) => row.name).join(', ') || '(nothing)'}\n` +
          `Has ${shard === '' ? '' : `ORKNUX_SUITE_SHARD=${shard} `}scripts/seed-demo.mjs been run against this server?`,
      );
    }
    return found.id;
  }

  const { workspaces } = await gql('{ workspaces(page: 0, size: 200) { content { id name } } }');
  const workspace = pick('workspace', names.WORKSPACE, workspaces.content);

  const { workspaceWorkflows } = await gql(
    'query($w: ID!) { workspaceWorkflows(workspaceId: $w, page: 0, size: 100) { content { id name } } }',
    { w: workspace },
  );
  const workflow = pick('workflow', names.WORKFLOW, workspaceWorkflows.content);

  const { workspaceFunctions } = await gql(
    'query($w: ID!) { workspaceFunctions(workspaceId: $w, page: 0, size: 100) { content { id name } } }',
    { w: workspace },
  );
  const fn = pick('function', names.FUNCTION, workspaceFunctions.content);
  const panelFn = pick('function', names.PANEL_FUNCTION, workspaceFunctions.content);

  const { workspaceTools } = await gql(
    'query($w: ID!) { workspaceTools(workspaceId: $w, page: 0, size: 100) { content { id name } } }',
    { w: workspace },
  );
  const tool = pick('tool', names.TOOL, workspaceTools.content);

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

  const bare = await workspaceCalled(names.BARE_WORKSPACE, 'Made by scripts/suite/fixture.mjs. Deliberately empty.');
  const bigger = await workspaceCalled(
    names.BIGGER_WORKSPACE,
    'Made by scripts/suite/fixture.mjs. Enough workflows for a second page.',
  );

  const { workspaceWorkflows: inBigger } = await gql(
    'query($w: ID!) { workspaceWorkflows(workspaceId: $w, page: 0, size: 100) { content { id name } } }',
    { w: bigger },
  );
  // One more than a page, so Next is offered and page two has something on it.
  for (let n = inBigger.content.length; n <= PAGE_SIZE; n += 1) {
    await gql('mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id } }', {
      input: {
        workspaceId: bigger,
        // Unique across the installation, so a second copy of the fixture needs
        // its own - the same reason the seeded workflow carries the suffix.
        name: copy(`zz Suite filler ${n + 1}`, shard),
        description: 'Made by fixture.mjs.',
      },
    });
  }

  return {
    ORKNUX_WORKSPACE: String(workspace),
    ORKNUX_WORKSPACE_NAME: names.WORKSPACE,
    ORKNUX_WORKFLOW: String(workflow),
    ORKNUX_FUNCTION: String(fn),
    ORKNUX_PANEL_FUNCTION: String(panelFn),
    ORKNUX_TOOL: String(tool),
    ORKNUX_BARE_WORKSPACE: String(bare),
    ORKNUX_BIGGER_WORKSPACE: String(bigger),
  };
}

/**
 * The names of one copy, worked out for a shard this process is not itself in.
 *
 * The runner resolves every worker's fixture before spawning any of them, and
 * `NAMES` was fixed when this module loaded - from *this* process's environment,
 * which is shard-less. So the suffix is applied here rather than by re-reading
 * the environment, and `copy` is the same function that put it there.
 */
function shardedNames(shard) {
  return {
    ...NAMES,
    WORKSPACE: copy(process.env.ORKNUX_DEMO_WORKSPACE ?? 'Northwind Support', shard),
    WORKFLOW: copy('Answer a question asked in Slack', shard),
    BIGGER_WORKSPACE: copy('zz Suite - a second page of workflows', shard),
    BARE_WORKSPACE: copy('zz Suite - nothing in it', shard),
  };
}

/* --------------------------------------------------------------- the command */

// Only when run as the command, so importing this to ask the question does not
// print an environment nobody asked for.
if (process.argv[1]?.endsWith('fixture.mjs')) {
  try {
    const held = await fixtureEnv(process.env.ORKNUX_SUITE_SHARD ?? '');
    for (const [key, value] of Object.entries(held)) console.log(`${key}=${value}`);
  } catch (trouble) {
    console.error(trouble.message);
    process.exit(1);
  }
}
