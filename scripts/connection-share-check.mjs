/**
 * The connection page offers no way to make a connection everybody's.
 *
 * There used to be a Share card here, admin-only, whose button promoted the
 * connection to an admin default so that new workspaces were provisioned with
 * it. It was called "Export as default" and it was not an export: nothing was
 * downloaded, nothing left the installation, and what it actually did - write a
 * row into the catalogue every future workspace is built from - is not what
 * anybody pressing a button called Export expects. It is gone.
 *
 * This is the check that it stays gone, and it is written as a negative, which
 * is the shape that needs the most care to be worth anything:
 *
 *   - It signs in as an administrator and asserts that it did. The card was
 *     behind `session.admin`, so a run as an ordinary member would find no
 *     Share card whether or not the feature was removed, and would pass while
 *     testing nothing at all.
 *   - It waits for the page to draw before reading a word off it. A negative
 *     read against a page that has not rendered is true of every page.
 *   - It asserts the Danger Zone is still there. Two cards sat below the form;
 *     one was to go and one was to stay, and a check that only counted the
 *     absence of the first would pass just as well if the whole tail of the
 *     page had been deleted.
 *
 * It makes its own connection and removes it again, so nothing anybody set up
 * is read or touched.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, context, page } = await open({ viewport: { width: 1440, height: 1000 } });

const ask = async (query, variables) => {
  const answer = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await answer.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data;
};

const named = `zz scratch share ${Date.now()}`;
let id = null;

try {
  /* --------------------------------------- the run has to be able to see the card */

  const session = await (await context.request.get(`${BASE}/api/session`)).json();
  record(
    session.admin === true,
    `signed in as an administrator (${session.username}), so a missing Share card means it is gone ` +
      'and not merely hidden',
  );

  /* ------------------------------------------------------- a connection of its own */

  const made = await ask(
    `mutation ($ws: ID!, $name: String!) {
       createWorkspaceConnection(input: { workspaceId: $ws, name: $name, type: WEBHOOK, url: "https://example.test" }) {
         id
       }
     }`,
    { ws: WORKSPACE, name: named },
  );
  id = made.createWorkspaceConnection.id;

  await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations/connections/${id}`, {
    waitUntil: 'domcontentloaded',
  });
  if (!(await drawn(page, 'the connection settings page'))) throw new Error('the page never drew');
  // The form's own first field, rather than the clock: everything below is a
  // negative and a negative is free on a page that has not finished.
  await page.locator('#connection-name').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(400);

  const held = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  // The text three of the assertions below search for their absence in. Read
  // once and proved non-empty here, so that "the words are not present" cannot
  // quietly mean "there are no words".
  record(
    held.includes('Danger Zone') && held.includes(named),
    `the page's text was read and holds this connection (${held.length} characters)`,
  );

  /* ------------------------------------------------------------- what is not there */

  record(
    (await page.getByRole('heading', { name: 'Share' }).count()) === 0,
    'no Share card',
  );
  record(!held.includes('Export as default'), 'nothing offers to Export as default');
  record(
    (await page.locator('button', { hasText: /Export as default/ }).count()) === 0,
    'and no button by that name',
  );
  record(
    !held.includes('admin default') && !held.includes('new workspaces are provisioned'),
    'and the page no longer talks about provisioning new workspaces',
  );

  /* ---------------------------------------------------------------- what still is */

  record(
    (await page.getByRole('heading', { name: 'Danger Zone' }).count()) === 1,
    'the Danger Zone below it is untouched, so the tail of the page still draws',
  );
  record(
    (await page.locator('button', { hasText: /^Disconnect$/ }).count()) === 1,
    'and Disconnect is still offered',
  );
  record(
    (await page.locator('button', { hasText: /^Test Connection$/ }).count()) === 1,
    'and the form above it still tests the connection',
  );
} finally {
  if (id !== null) {
    await ask(`mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }`, { id });
    console.log('scratch connection removed');
  }
}

await finish(browser);
