/**
 * The fixture's names, and the one way to turn one into an id.
 *
 * Half of this suite's false alarms came from the same sentence written in nine
 * places: `process.env.ORKNUX_FUNCTION ?? '28'`. Twenty-eight is a function in
 * one developer's database. Point the same check at a workspace built by
 * `seed-demo.mjs` and there is no 28, so the editor answers with the honest
 * "That function does not exist" card - about ninety characters of <main>,
 * under whatever the check was waiting for - and the check reports a page that
 * drew nothing. Nothing was broken. The check was looking somewhere else.
 *
 * `scripts/suite/fixture.mjs` already works the right way round: the *names*
 * are the fixture and the numbers are whatever the database handed out. This is
 * that rule made available to a check at the moment it runs, so a check no
 * longer has to be told the numbers through the environment to be pointed at
 * the right thing - and, when the name is not there, says which name it wanted
 * and what the workspace did hold, rather than photographing a refusal.
 *
 *   import { NAMES, idOf } from './suite/named.mjs';
 *   const fn = await idOf(graphql, 'function', WORKSPACE, NAMES.FUNCTION);
 *
 * The environment still wins where it is set, so a run can be pointed at
 * something else without editing a check:
 *
 *   const fn = await idOf(graphql, 'function', WORKSPACE, NAMES.FUNCTION, process.env.ORKNUX_FUNCTION);
 */

/**
 * What the seed calls the things the checks drive. One copy, imported by
 * `fixture.mjs` as well, so the two cannot drift apart.
 */
export const NAMES = {
  /** The workspace the suite is written against. */
  WORKSPACE: process.env.ORKNUX_DEMO_WORKSPACE ?? 'Northwind Support',
  /*
   * The workflow the editor checks drive. It is the one with an agent in it -
   * retries, the doubling wait and the second handle all hang off an agent node
   * - and the one that carries the object field `editor-check` types into.
   */
  WORKFLOW: 'Answer a question asked in Slack',
  /** The function `definition-jump-check` gives an object parameter to. */
  FUNCTION: 'ticketReference',
  /** The one `param-panel-check` and `split-check` open. */
  PANEL_FUNCTION: 'minutesUntilBreach',
  /** The tool `tool-wand-check` edits, when it is run at all. */
  TOOL: 'lookupCustomer',
  /**
   * The two `fixture.mjs` makes rather than seeds: one with more than a page of
   * workflows to switch away from, and one holding none of what a workflow
   * runs, so that "Not here" is what the import dialog actually says.
   */
  BIGGER_WORKSPACE: 'zz Suite - a second page of workflows',
  BARE_WORKSPACE: 'zz Suite - nothing in it',
};

/** Which query lists each kind, and what the answer is called. */
const LISTS = {
  workflow: ['workspaceWorkflows', 'workspaceWorkflows(workspaceId: $w, page: 0, size: 200) { content { id name } }'],
  function: ['workspaceFunctions', 'workspaceFunctions(workspaceId: $w, page: 0, size: 200) { content { id name } }'],
  tool: ['workspaceTools', 'workspaceTools(workspaceId: $w, page: 0, size: 200) { content { id name } }'],
  trigger: ['workspaceTriggers', 'workspaceTriggers(workspaceId: $w, page: 0, size: 200) { content { id name } }'],
  condition: ['workspaceConditions', 'workspaceConditions(workspaceId: $w, page: 0, size: 200) { content { id name } }'],
  agent: ['workspaceAgents', 'workspaceAgents(workspaceId: $w, page: 0, size: 200) { content { id name } }'],
};

/**
 * The id of the thing of that kind called that, in that workspace.
 *
 * Refuses rather than guesses, and refuses out loud: a check pointed at an id
 * that belongs to nothing does not fail, it passes vacuously on the page that
 * says so, which is the whole failure mode this exists to remove.
 *
 * `override` is whatever the environment said, and wins when it is set.
 */
export async function idOf(graphql, kind, workspaceId, name, override = undefined) {
  if (override !== undefined && override !== null && override !== '') return String(override);

  const [field, selection] = LISTS[kind] ?? [];
  if (field === undefined) throw new Error(`named.mjs knows nothing about a ${kind}`);

  const answered = await graphql(`query($w: ID!) { ${selection} }`, { w: workspaceId });
  const rows = answered[field]?.content ?? [];
  const found = rows.find((row) => row.name === name);
  if (found !== undefined) return String(found.id);

  console.log(`FAIL: no ${kind} called ${JSON.stringify(name)} in workspace ${workspaceId}.`);
  console.log(`      There is: ${rows.map((row) => row.name).join(', ') || '(nothing)'}`);
  console.log('      Has scripts/seed-demo.mjs been run against this server?');
  return null;
}

/**
 * The named one if it is there, and otherwise whichever of that kind the
 * workspace has - reporting which it took.
 *
 * For the checks that want *a* workflow rather than *the* workflow: the import
 * checks export something and import it again, and any workflow does. Writing
 * a number in for those was what pointed them at a developer's `/workflows/118`
 * and, on a seeded workspace, at nothing at all. A name is better than a
 * number and "the first one here" is better than either, because it is true of
 * every installation.
 *
 * `fits` narrows it where the check needs more than a row: pass a predicate and
 * only the rows it accepts are considered.
 */
export async function anyOf(graphql, kind, workspaceId, name, options = {}) {
  const { override = undefined, fits = () => true } = options;
  if (override !== undefined && override !== null && override !== '') return String(override);

  const [field, selection] = LISTS[kind] ?? [];
  if (field === undefined) throw new Error(`named.mjs knows nothing about a ${kind}`);

  const answered = await graphql(`query($w: ID!) { ${selection} }`, { w: workspaceId });
  const rows = answered[field]?.content ?? [];

  const named = rows.find((row) => row.name === name);
  if (named !== undefined && (await fits(named))) {
    console.log(`using the ${kind} called ${JSON.stringify(name)} (#${named.id})`);
    return String(named.id);
  }
  for (const row of rows) {
    if (await fits(row)) {
      console.log(`no ${kind} called ${JSON.stringify(name)} here; using ${JSON.stringify(row.name)} (#${row.id})`);
      return String(row.id);
    }
  }
  console.log(`FAIL: workspace ${workspaceId} has no ${kind} this check can use.`);
  console.log(`      There is: ${rows.map((row) => row.name).join(', ') || '(nothing)'}`);
  return null;
}

/** The same, for a workspace, which is named rather than held inside one. */
export async function workspaceIdOf(graphql, name, override = undefined) {
  if (override !== undefined && override !== null && override !== '') return String(override);

  const { workspaces } = await graphql('{ workspaces(page: 0, size: 200) { content { id name } } }');
  const found = workspaces.content.find((row) => row.name === name);
  if (found !== undefined) return String(found.id);

  console.log(`FAIL: no workspace called ${JSON.stringify(name)}.`);
  console.log(`      There is: ${workspaces.content.map((row) => row.name).join(', ') || '(nothing)'}`);
  console.log('      Has scripts/suite/fixture.mjs been run against this server?');
  return null;
}

/** What a workspace is called, which the workspace switcher is driven by. */
export async function workspaceNameOf(graphql, workspaceId, override = undefined) {
  if (override !== undefined && override !== null && override !== '') return String(override);

  const { workspaces } = await graphql('{ workspaces(page: 0, size: 200) { content { id name } } }');
  return workspaces.content.find((row) => String(row.id) === String(workspaceId))?.name ?? null;
}
