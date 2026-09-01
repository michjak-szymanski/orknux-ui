/**
 * The Check button on an MCP server, and whether it says anything worth reading.
 *
 * Issue #315. There was no way to ask an MCP server whether it was there. The
 * only way to find out that an address was wrong or a token had expired was to
 * grant the server to an agent and watch a conversation quietly lose a
 * capability — the handshake failed, the tools list came back empty, and
 * nothing anywhere said so.
 *
 * What is measured is the sentence, not the colour. A red dot is worth very
 * little on its own: every way a handshake can fail used to arrive as the same
 * eight words, so a check that only asserted "it went red" would have passed
 * against the behaviour this replaces. So the server is pointed at a port
 * nothing is listening on, and what has to appear is a specific reason naming
 * that address.
 *
 * The fixture is built and swept here. It needs no model, no workflow and no
 * agent: an MCP server row is created over GraphQL, the page is opened, the
 * button is pressed, and the row is removed again.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/* ----------------------------------------------------------------- fixture */

const PREFIX = 'zzMcpCheck';
const NAME = `${PREFIX} ${Date.now()}`;

/*
 * A port on this machine that nothing answers on. 9 is discard - reserved, and
 * not something a developer's laptop runs - so the connection is refused rather
 * than hanging until a timeout somebody has to sit through.
 */
const ADDRESS = 'http://127.0.0.1:9/rpc';

/** Anything a run that died halfway through left behind, and this run's own. */
async function sweep() {
  const { mcpServers } = await graphql(
    `query($id: ID!) { mcpServers(workspaceId: $id) { id name } }`,
    { id: WORKSPACE },
  );
  for (const old of mcpServers.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeMcpServer(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept MCP server ${old.name} (#${old.id})`);
  }
}

await sweep();

const { createMcpServer } = await graphql(
  `mutation($input: CreateMcpServerInput!) { createMcpServer(input: $input) { id } }`,
  { input: { workspaceId: WORKSPACE, name: NAME, address: ADDRESS } },
);
const serverId = createMcpServer.id;
console.log(`MCP server ${NAME} (#${serverId}) at ${ADDRESS}`);

/* ------------------------------------------------------------- measurement */

try {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations/servers/${serverId}`, {
    waitUntil: 'domcontentloaded',
  });
  await drawn(page, 'the MCP server form', { within: 30_000 });

  const button = page.getByRole('button', { name: /^Check$/ });
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  record(true, 'the server page offers a Check button');

  // Before anything is asked, the row says so rather than claiming a verdict it
  // has not got. A remembered green from an hour ago would be worse than none.
  const before = await page.locator('[class*="statusLabel"]').first().innerText();
  record(before.trim() === 'Not checked', `before pressing it the row reads "${before.trim()}"`);

  await button.click();

  const label = page.locator('[class*="statusLabel"]').first();
  await label.filter({ hasText: 'Failed' }).waitFor({ timeout: 60_000 });
  record(true, 'a server nothing answers on comes back Failed');

  const detail = (await page.locator('[class*="statusDetail"]').first().innerText()).trim();
  /*
   * The whole point of the issue. "did not complete the MCP handshake" was the
   * old sentence and is what this must not be: the reason has to name what
   * actually went wrong.
   */
  record(
    detail.includes('could not be reached') && detail.includes('127.0.0.1'),
    `the reason names the address that failed: "${detail}"`,
  );
} finally {
  await graphql(`mutation($id: ID!) { removeMcpServer(id: $id) }`, { id: serverId }).catch(() => undefined);
}

await finish(browser);
