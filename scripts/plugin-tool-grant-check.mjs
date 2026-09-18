/**
 * The Tools grant list offers what a plugin's `tools()` declares, and only that.
 *
 * A plugin declares two surfaces: `functions()` for workflows, `tools()` for
 * agents. The agent form's Tools group draws the second beside the workspace's
 * own tools - each row naming the plugin that offers it, a proxy tool jumping
 * to the page of the function it fronts - and a function no tool fronts stays
 * off the menu, because its description was written for a different reader.
 *
 * The plugin is this check's own, under a key nobody would mistake for real,
 * and it is unloaded at the end; a row an earlier killed run left behind is
 * swept at the start.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

/** Nobody's plugin is called this. The sweep is by key. */
const KEY = 'toolgrantscratch';

const SOURCE = `export default class Scratch extends OrknuxPlugin {
  id() { return '${KEY}'; }
  apiVersion() { return 1; }
  functions() {
    return [
      new OrknuxFunction({
        name: 'fronted',
        description: 'A function a tool fronts.',
        params: [{ name: 'name', type: 'string' }],
        returnType: 'string',
        run: (name) => 'hello, ' + name,
      }),
      new OrknuxFunction({
        name: 'workflowOnly',
        description: 'A function no tool fronts.',
        returnType: 'string',
        run: () => 'hidden',
      }),
    ];
  }
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'fronted' }),
      new OrknuxTool({
        name: 'standalone',
        description: 'A tool with a run of its own.',
        returnType: 'string',
        run: () => 'alone',
      }),
    ];
  }
}
`;

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const unloadMine = async () => {
  const { plugins } = await graphql(`query { plugins { id key } }`);
  const mine = plugins.find((one) => one.key === KEY);
  if (mine === undefined) return false;
  await graphql(`mutation ($id: ID!) { unloadPlugin(id: $id) }`, { id: mine.id });
  return true;
};

if (await unloadMine()) console.log('NOTE: swept a scratch plugin from an earlier run');

// Loaded through the endpoint the screen uses, no acceptance needed: it asks
// for nothing.
const answer = await page.request.post(`${BASE}/api/plugins`, {
  multipart: {
    file: { name: `${KEY}.js`, mimeType: 'text/javascript', buffer: Buffer.from(SOURCE, 'utf8') },
  },
});
record(answer.ok(), `the scratch plugin loads (${answer.status()})`);

const { workspaceAgents } = await graphql(
  `query ($workspaceId: ID!) { workspaceAgents(workspaceId: $workspaceId, page: 0, size: 5) { content { id } } }`,
  { workspaceId: WORKSPACE },
);
if (workspaceAgents.content.length === 0) {
  record(false, 'no agents in the workspace to open');
  await unloadMine();
  await finish(browser);
}

await page.goto(
  `${BASE}/workspace/${WORKSPACE}/agents/${workspaceAgents.content[0].id}/settings`,
  { waitUntil: 'domcontentloaded' },
);
await page.waitForSelector('[data-grants="tools"] [data-grant-rows]', { timeout: 20_000 });
await page.waitForTimeout(500);

const rows = await page.locator('[data-grants="tools"] [data-grant-rows] > [data-grant-name]').evaluateAll(
  (all) => all.map((row) => ({
    name: row.getAttribute('data-grant-name'),
    text: row.innerText.trim().replace(/\n/g, ' · '),
    href: row.querySelector('a')?.getAttribute('href') ?? null,
  })),
);

const proxy = rows.find((one) => one.name === `${KEY}_fronted`);
record(proxy !== undefined, 'the proxy tool is offered under its granted name');
if (proxy !== undefined) {
  record(proxy.text.includes(KEY), `its row names the plugin that offers it: "${proxy.text}"`);
  record(
    proxy.href !== null && /\/functions\/\d+$/.test(proxy.href),
    `and jumps to the function it fronts: ${proxy.href}`,
  );
}

const alone = rows.find((one) => one.name === `${KEY}_standalone`);
record(alone !== undefined, 'the standalone tool is offered too');
if (alone !== undefined) {
  record(alone.href === null, 'with no jump link, because a run of its own has no page');
}

record(
  rows.every((one) => one.name !== `${KEY}_workflowOnly`),
  'a function no tool fronts is not on the menu',
);

record(await unloadMine(), 'the scratch plugin is unloaded again');

await finish(browser);
