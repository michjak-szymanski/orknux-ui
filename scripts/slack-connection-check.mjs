/**
 * The two faults on a connection's own page, driven as a person would hit them.
 *
 * One: the App-Level Token field was gated on `SLACK` here and on
 * `SLACK_SOCKET_MODE` in the form that creates a connection - opposite values,
 * so the one kind that needs the token was the one kind that could never be
 * shown the field. A token could be set at creation and never corrected.
 *
 * Two: the kind was read-only, though the server has always accepted a change.
 *
 * It makes its own connection and removes it again.
 *
 * Temporary: delete once it has been looked at.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';

const results = [];
const record = (ok, message) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: 'alice', password: 'password' },
});
if (!signedIn.ok()) {
  console.error('sign-in failed', signedIn.status());
  process.exit(1);
}

const ask = async (query, variables) => {
  const answer = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await answer.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data;
};

// Its own connection, so nothing anybody made is touched.
const named = `zz scratch slack ${Date.now()}`;
const made = await ask(
  `mutation ($input: CreateWorkspaceConnectionInput!) {
     createWorkspaceConnection(input: $input) { id type appTokenSet }
   }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: named,
      type: 'SLACK_SOCKET_MODE',
      url: 'https://slack.com/api',
      authType: 'BEARER_TOKEN',
      secret: 'xoxb-scratch-not-a-real-token',
      appToken: 'xapp-scratch-not-a-real-token',
    },
  },
);
const id = made.createWorkspaceConnection.id;
console.log(`made ${named} (${id}) as ${made.createWorkspaceConnection.type}, app token set: ${made.createWorkspaceConnection.appTokenSet}`);

try {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations/connections/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // The regression itself: a Socket Mode connection could not show its own token.
  const appToken = page.locator('#connection-app-token');
  record((await appToken.count()) === 1, 'a Socket Mode connection offers its App-Level Token');
  record((await page.locator('#connection-secret').count()) === 1, 'and the API Token beside it');

  const chooser = page.locator('#connection-type');
  record((await chooser.count()) === 1, 'the kind can be chosen rather than only read');

  // Change the kind, and check the fields follow the choice before any save.
  await chooser.selectOption('SMTP');
  await page.waitForTimeout(400);
  record((await appToken.count()) === 0, 'choosing a kind with no app token takes the field away at once');

  await chooser.selectOption('SLACK');
  await page.waitForTimeout(400);
  record((await appToken.count()) === 1, 'plain Slack is offered the field too, as the listener already reads both');

  // And that it survives being saved.
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(1500);
  const after = await ask(`query ($id: ID!) { workspaceConnection(id: $id) { type appTokenSet } }`, { id });
  record(after.workspaceConnection.type === 'SLACK', `the change was saved (server says ${after.workspaceConnection.type})`);
  record(after.workspaceConnection.appTokenSet === true, 'and the stored app token was left alone');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const shown = await page.locator('#connection-type').inputValue();
  record(shown === 'SLACK', `the page comes back on the saved kind (${shown})`);
} finally {
  await ask(`mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }`, { id });
  console.log('scratch connection removed');
}

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
