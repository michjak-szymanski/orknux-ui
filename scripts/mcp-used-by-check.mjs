/**
 * An MCP server's page says which agents hold it.
 *
 * Issue #318. An MCP server was one of the kinds nothing was allowed to ask
 * about, on the grounds that nothing points at one - and that was never true.
 * An agent names a server in its grants, and removing the server takes the
 * capability away from every agent holding it, silently, because the removal
 * un-grants rather than refusing. The one page that could have warned about
 * that had no Used by panel at all.
 *
 * Four things this is here to catch:
 *
 *   the panel      the page has a Used by panel, which it did not have
 *   the naming     the agent granted the server is named in it, and the agent
 *                  that was not is absent. Two agents exist for that reason:
 *                  a panel listing every agent in the workspace would satisfy
 *                  a check that only looked for the right one
 *   the link       the row opens that agent's own page, so being told a name is
 *                  not where this ends
 *   the empty      a server nobody holds says so in words. That is the whole
 *                  difference from before, where the question came back refused
 *                  - and an empty box is indistinguishable from a panel that
 *                  failed to load, which is why the words matter
 *
 * Files two agents and two servers, and deletes them.
 */
import { BASE, WORKSPACE, open, drawn, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const MARK = 'zzMcpUsedBy';
const SERVER = `${MARK}-held`;
const UNHELD = `${MARK}-unheld`;
const HOLDER = `${MARK} Searcher`;
const OTHER = `${MARK} Writer`;

/** Nothing is ever called: the panel is about the grant, not about the server. */
const ADDRESS = 'http://127.0.0.1:9/rpc';

const sweep = async () => {
  const { mcpServers } = await graphql(`query($w: ID!) { mcpServers(workspaceId: $w) { id name } }`, {
    w: WORKSPACE,
  });
  for (const old of mcpServers.filter((one) => one.name.startsWith(MARK))) {
    await graphql(`mutation($id: ID!) { removeMcpServer(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept server ${old.name} (#${old.id})`);
  }

  const { workspaceAgents } = await graphql(
    `query($w: ID!) { workspaceAgents(workspaceId: $w, size: 200) { content { id name } } }`,
    { w: WORKSPACE },
  );
  for (const old of workspaceAgents.content.filter((one) => one.name.startsWith(MARK))) {
    await graphql(`mutation($id: ID!) { deleteAgent(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept agent ${old.name} (#${old.id})`);
  }
};

await sweep();

async function server(name) {
  const made = await graphql(
    `mutation($input: CreateMcpServerInput!) { createMcpServer(input: $input) { id name } }`,
    { input: { workspaceId: WORKSPACE, name, address: ADDRESS } },
  );
  console.log(`made server ${made.createMcpServer.name} (#${made.createMcpServer.id})`);
  return made.createMcpServer;
}

async function agent(name, servers) {
  const made = await graphql(`mutation($input: CreateAgentInput!) { createAgent(input: $input) { id name } }`, {
    input: { workspaceId: WORKSPACE, name, type: 'LLM' },
  });
  if (servers.length > 0) {
    await graphql(`mutation($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }`, {
      id: made.createAgent.id,
      input: { name, mcpServers: servers },
    });
  }
  console.log(`made agent ${made.createAgent.name} (#${made.createAgent.id})`);
  return made.createAgent;
}

const held = await server(SERVER);
const unheld = await server(UNHELD);
const holder = await agent(HOLDER, [SERVER]);
await agent(OTHER, []);

/* ------------------------------------------------------------------ reading */

/** What the Used by panel is showing, or null if the page has not got one. */
const panel = () =>
  page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Used by"]');
    if (section === null) return null;
    return {
      rows: [...section.querySelectorAll('[data-dependant-name]')].map((one) => ({
        name: one.getAttribute('data-dependant-name'),
        kind: one.getAttribute('data-dependant-kind'),
        to: one.getAttribute('href'),
      })),
      says: section.textContent ?? '',
      // Drawn when the question came back refused, which is what this page did
      // before the server was taught to answer it. Read apart from the text
      // because the refusal and the empty state both end up in `says`, and a
      // check that matched on words alone would pass on the refusal.
      wrong: section.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
    };
  });

/** Waits for the panel to have finished loading, whichever way it landed. */
async function settled(ms = 20_000) {
  const stop = Date.now() + ms;
  for (;;) {
    const now = await panel().catch(() => null);
    // A panel still loading has neither rows nor a sentence about having none.
    if (now !== null && (now.rows.length > 0 || now.wrong !== null || /Nothing uses this yet/i.test(now.says))) {
      return now;
    }
    if (Date.now() > stop) return now;
    await page.waitForTimeout(150);
  }
}

const clean = async () => {
  await sweep();
  await finish(browser);
};

/* -------------------------------------------------------------------- drive */

await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations/servers/${held.id}`, {
  waitUntil: 'domcontentloaded',
});
if (!(await drawn(page, "the MCP server's page"))) await clean();

const shown = await settled();
record(shown !== null, 'the MCP server page has a Used by panel');
record(
  shown !== null && shown.wrong === null,
  `and the question is one the server answers rather than refuses (${JSON.stringify(shown?.wrong ?? null)})`,
);

if (shown === null) await clean();

record(
  shown.rows.some((one) => one.name === HOLDER && one.kind === 'AGENT'),
  `the agent granted the server is named in it (${JSON.stringify(shown.rows.map((one) => one.name))})`,
);
record(
  !shown.rows.some((one) => one.name === OTHER),
  'and the agent that was not granted it is absent, so this is the grant and not the workspace',
);

const row = shown.rows.find((one) => one.name === HOLDER);
record(
  row?.to === `/workspace/${WORKSPACE}/agents/${holder.id}/settings`,
  `the row opens that agent's own page (${JSON.stringify(row?.to ?? null)})`,
);

/* ---- and a server nobody holds ---- */

await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations/servers/${unheld.id}`, {
  waitUntil: 'domcontentloaded',
});
const empty = await settled();
record(
  empty !== null && empty.wrong === null && empty.rows.length === 0 && /Nothing uses this yet/i.test(empty.says),
  `a server nobody holds says so in words rather than being refused the question ` +
    `(${JSON.stringify(empty?.wrong ?? empty?.says.trim().slice(0, 60) ?? null)})`,
);

await clean();
