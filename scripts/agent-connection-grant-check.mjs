/**
 * A connection is granted to an agent by name, picked for a plugin by name,
 * and a Slack connection has a user token field of its own.
 *
 * Three surfaces, one idea: a connection is referenced by which one it is,
 * never by a number somebody read off another page's URL.
 *
 *   the agent form   a Connections grant list beside Tools; ticking a row
 *                    stores the id, and the briefing tells the agent to use
 *                    one only when explicitly told to
 *   the plugins page a `connection` parameter draws a picker of the
 *                    workspace's connections, with Reference disabled -
 *                    the server refuses a variable for one
 *   the connection   a Slack connection's settings offer a User Token field,
 *                    which is what search runs on
 *
 * Everything this makes is scratch and swept: a connection under a name
 * nobody would pick, a plugin under a key nobody would pick, and the grant is
 * taken back before the connection goes.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const CONNECTION = 'grantscratch-http';
const SLACK_CONNECTION = 'grantscratch-slack';
const KEY = 'connparamscratch';

const SOURCE = `export default class Scratch extends OrknuxPlugin {
  id() { return '${KEY}'; }
  apiVersion() { return 1; }
  parameters() {
    return [{
      name: 'door',
      description: 'Which connection this scratch plugin would use.',
      type: 'connection',
      connectionType: 'HTTP',
      required: false,
    }];
  }
}
`;

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/** Sweeps anything an earlier killed run left behind, by name and key. */
const sweep = async () => {
  const { workspaceConnections } = await graphql(
    `query ($workspaceId: ID!) { workspaceConnections(workspaceId: $workspaceId) { id name } }`,
    { workspaceId: WORKSPACE },
  );
  for (const name of [CONNECTION, SLACK_CONNECTION]) {
    const held = workspaceConnections.find((one) => one.name === name);
    if (held !== undefined) {
      await graphql(`mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }`, { id: held.id });
      console.log(`NOTE: swept ${name} from an earlier run`);
    }
  }
  const { plugins } = await graphql(`query { plugins { id key } }`);
  const mine = plugins.find((one) => one.key === KEY);
  if (mine !== undefined) {
    await graphql(`mutation ($id: ID!) { unloadPlugin(id: $id) }`, { id: mine.id });
    console.log('NOTE: swept a scratch plugin from an earlier run');
  }
};
await sweep();

const { createWorkspaceConnection } = await graphql(
  `mutation ($input: CreateWorkspaceConnectionInput!) {
    createWorkspaceConnection(input: $input) { id name }
  }`,
  { input: { workspaceId: WORKSPACE, name: CONNECTION, type: 'HTTP', url: 'https://example.invalid' } },
);
const connectionId = createWorkspaceConnection.id;
record(connectionId !== undefined, 'the scratch connection exists');

/*
 * The agent form: a Connections grant list, rows by name, the tick stored as
 * the id.
 */
const { workspaceAgents } = await graphql(
  `query ($workspaceId: ID!) { workspaceAgents(workspaceId: $workspaceId, page: 0, size: 5) { content { id } } }`,
  { workspaceId: WORKSPACE },
);
if (workspaceAgents.content.length === 0) {
  record(false, 'no agents in the workspace to open');
  await sweep();
  await finish(browser);
}
const agentId = workspaceAgents.content[0].id;

await page.goto(`${BASE}/workspace/${WORKSPACE}/agents/${agentId}/settings`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-grants="connections"] [data-grant-rows]', { timeout: 20_000 });
await page.waitForTimeout(500);

const row = page.locator(`[data-grants="connections"] [data-grant-name="${CONNECTION}"]`);
record((await row.count()) === 1, 'the grant list offers the connection by name');
record((await row.innerText()).includes('http'), 'the row wears its kind');
record(
  (await row.locator('a').getAttribute('href')) === `/workspace/${WORKSPACE}/integrations/connections/${connectionId}`,
  "and jumps to the connection's own page",
);

await row.locator('input[type=checkbox]').check();
await page.getByRole('button', { name: 'Save Changes' }).click();
await page.waitForTimeout(1200);

const granted = await graphql(
  `query ($id: ID!) { agent(id: $id) { connectionIds } }`,
  { id: agentId },
);
record(
  granted.agent.connectionIds.includes(String(connectionId)),
  `the tick is stored as the id (${JSON.stringify(granted.agent.connectionIds)})`,
);

// Taken back the same way, so the scratch connection leaves nothing behind.
await row.locator('input[type=checkbox]').uncheck();
await page.getByRole('button', { name: 'Save Changes' }).click();
await page.waitForTimeout(1200);
const revoked = await graphql(`query ($id: ID!) { agent(id: $id) { connectionIds } }`, { id: agentId });
record(!revoked.agent.connectionIds.includes(String(connectionId)), 'and unticking takes it back');

/*
 * The plugins page: a connection parameter is a picker of the workspace's
 * connections, never a typed number, and never a variable.
 */
const loaded = await page.request.post(`${BASE}/api/plugins`, {
  multipart: {
    file: { name: `${KEY}.js`, mimeType: 'text/javascript', buffer: Buffer.from(SOURCE, 'utf8') },
  },
});
record(loaded.ok(), `the scratch plugin loads (${loaded.status()})`);

await page.goto(`${BASE}/workspace/${WORKSPACE}/plugins`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(`button:has-text("${KEY}")`, { timeout: 20_000 });
await page.click(`button:has-text("${KEY}")`);
await page.waitForTimeout(500);

const picker = page.locator(`select[id^="plugin-parameter-"]`);
record((await picker.count()) >= 1, 'a connection parameter draws a picker, not a box');

const options = await picker.first().locator('option').allInnerTexts();
record(
  options.some((one) => one === CONNECTION),
  `the picker offers the workspace's connections by name (${JSON.stringify(options)})`,
);

const reference = page
  .locator('[role=group][aria-label="door source"]')
  .getByRole('button', { name: 'Reference' });
record(await reference.isDisabled(), 'and Reference cannot be pressed for one');

await picker.first().selectOption({ label: CONNECTION });
await page.waitForTimeout(1200);
const { workspacePlugins } = await graphql(
  `query ($workspaceId: ID!) {
    workspacePlugins(workspaceId: $workspaceId) { plugin { key } parameters { name literal } }
  }`,
  { workspaceId: WORKSPACE },
);
const scratch = workspacePlugins.find((one) => one.plugin.key === KEY);
record(
  scratch?.parameters.find((one) => one.name === 'door')?.literal === String(connectionId),
  'picking stores the id the server validates',
);

/*
 * The Slack connection settings: a User Token field beside the app-level one,
 * because search answers only for a user.
 */
const slack = await graphql(
  `mutation ($input: CreateWorkspaceConnectionInput!) {
    createWorkspaceConnection(input: $input) { id }
  }`,
  { input: { workspaceId: WORKSPACE, name: SLACK_CONNECTION, type: 'SLACK' } },
);
await page.goto(
  `${BASE}/workspace/${WORKSPACE}/integrations/connections/${slack.createWorkspaceConnection.id}`,
  { waitUntil: 'domcontentloaded' },
);
await page.waitForSelector('#connection-app-token', { timeout: 20_000 });
const userToken = page.locator('#connection-user-token');
record((await userToken.count()) === 1, 'a Slack connection offers a User Token field');
record(
  (await userToken.getAttribute('placeholder')) === 'xoxp-...',
  'and it asks for the token search runs on',
);

// Swept: the parameter's connection goes with the plugin, the grant is
// already taken back, and both connections leave.
const { plugins } = await graphql(`query { plugins { id key } }`);
const mine = plugins.find((one) => one.key === KEY);
if (mine !== undefined) await graphql(`mutation ($id: ID!) { unloadPlugin(id: $id) }`, { id: mine.id });
await graphql(`mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }`, { id: connectionId });
await graphql(
  `mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }`,
  { id: slack.createWorkspaceConnection.id },
);
record(true, 'the scratch rows are swept');

await finish(browser);
