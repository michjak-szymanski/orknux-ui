/**
 * Whether the suite is pointed at the fixture, asked before anything runs.
 *
 * Issue #308. `harness.mjs` falls back to `ORKNUX_WORKSPACE=9` - the number the
 * checks were first written against - and a database built from nothing hands
 * out different numbers for the same names. A full run against that default
 * pointed every check at a workspace that does not hold the fixture, and the
 * checks did not fail honestly: they drew empty pages and reported thirty-two
 * failures that were nothing of the sort, which then had to be triaged by hand
 * before the real run could start. Forty minutes to be told nothing.
 *
 * `fixture.mjs` already refuses rather than guesses, and says why in its own
 * header: a suite pointed at the wrong workspace "does not fail - it passes
 * vacuously on empty pages, which is the failure mode this whole exercise
 * exists to remove." This is that same rule, asked by the runner, so nothing
 * has to be run to find out.
 *
 * Two questions, and only two. Is the named workspace there at all, and is it
 * the one `ORKNUX_WORKSPACE` points at. Everything past that a check asks for
 * itself through `named.mjs` at the moment it runs, and a deeper check here
 * would be a second copy of a fixture drifting from the first.
 */
import { BASE, PASSWORD, USER, WORKSPACE } from './harness.mjs';
import { NAMES } from './named.mjs';

/** What the runner is told: whether to go on, and what to print if not. */
export async function fixtureTrouble() {
  let cookie;
  try {
    const signedIn = await fetch(`${BASE}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASSWORD }),
    });
    if (!signedIn.ok) {
      return [`Could not sign in as ${USER} at ${BASE}: ${signedIn.status}.`];
    }
    cookie = signedIn.headers.get('set-cookie')?.split(';')[0];
  } catch (cause) {
    /*
     * Not a fixture problem, and said as one would be a misleading answer to
     * the wrong question. A server that is not up is worth stopping for all the
     * same: every check would fail on it, one at a time, for four minutes each.
     */
    return [`Nothing answered at ${BASE}: ${cause instanceof Error ? cause.message : String(cause)}.`];
  }

  const answered = await fetch(`${BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query: '{ workspaces(page: 0, size: 200) { content { id name } } }' }),
  });
  const body = await answered.json();
  if (body.errors?.length) return [`Could not list the workspaces: ${body.errors[0].message}`];

  const held = body.data?.workspaces?.content ?? [];
  const wanted = held.find((row) => row.name === NAMES.WORKSPACE);

  if (wanted === undefined) {
    return [
      `No workspace called ${JSON.stringify(NAMES.WORKSPACE)} on this server.`,
      `There is: ${held.map((row) => row.name).join(', ') || '(nothing)'}`,
      'Has scripts/seed-demo.mjs been run against it?',
    ];
  }

  if (String(wanted.id) !== String(WORKSPACE)) {
    const standing = held.find((row) => String(row.id) === String(WORKSPACE));
    return [
      `The suite is pointed at workspace ${WORKSPACE}` +
        `${standing === undefined ? ', which is not a workspace here' : ` (${standing.name})`}, ` +
        `but the fixture ${JSON.stringify(NAMES.WORKSPACE)} is workspace ${wanted.id}.`,
      'Every check would draw an empty page and report a failure that is nothing of the sort.',
      'Point it at the fixture:  eval $(node scripts/suite/fixture.mjs)',
    ];
  }

  return null;
}
