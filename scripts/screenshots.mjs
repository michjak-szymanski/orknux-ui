/**
 * Takes the screenshots the manual uses.
 *
 * A script rather than a folder of images somebody once made by hand, because
 * documentation screenshots rot faster than the prose around them: a button
 * moves, a column is renamed, and the picture goes on showing last year's
 * product while the paragraph beside it is correct. Regenerating has to be one
 * command or it never happens.
 *
 *   docker exec orknux-ui-dev-1 npx playwright install --with-deps chromium
 *   docker exec orknux-ui-dev-1 node scripts/seed-demo.mjs
 *   docker exec orknux-ui-dev-1 node scripts/screenshots.mjs
 *
 * The first line is needed once per container: the browser and the system
 * libraries it needs live in the container's own filesystem, not in the
 * node_modules volume, so recreating the container takes them with it.
 *
 * The seed comes first and is not optional. These pictures used to be taken of
 * whatever was in the developer's database, which is how the manual ended up
 * showing a workflow called `dgd`; now the content is built on purpose and this
 * finds it by name.
 *
 * The credentials are the ones seeded into the development directory in
 * orknux-server's `docker/ldap/bootstrap.ldif` — they are in that repository in
 * plain text on purpose, and they are of no use anywhere else.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

/*
 * localhost, because this runs inside the container that serves the interface.
 * Reaching it as `host.docker.internal` instead is refused by the dev server —
 * vite checks the Host header against `server.allowedHosts` — and the refusal
 * arrives as a sign-in failure, which points at the wrong thing entirely.
 */
const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const USER = process.env.ORKNUX_USER ?? 'alice';
const PASSWORD = process.env.ORKNUX_PASSWORD ?? 'password';
/** The workspace the seed builds. Must match `WORKSPACE_NAME` in seed-demo.mjs. */
const WORKSPACE_NAME = process.env.ORKNUX_DEMO_WORKSPACE ?? 'Acme Support';
/*
 * `screens` rather than `docs`, which would put the files under the same path
 * as the documentation's own route. A static file wins that race today; a
 * change to how the built app is served could quietly turn every picture into
 * the docs page rendered as an image request.
 */
const OUT = new URL('../public/screens/', import.meta.url).pathname;

const browser = await chromium.launch();
const context = await browser.newContext({
  // A laptop's worth of page, at twice the pixels so the result is still sharp
  // on the screen somebody reads the manual on.
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await mkdir(OUT, { recursive: true });

// Signing in through the API rather than the form: this is a screenshot script,
// and driving a login screen is one more thing that can break for reasons that
// have nothing to do with the picture being taken.
const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: USER, password: PASSWORD },
});
if (!signedIn.ok()) {
  console.error(`Could not sign in as ${USER}: ${signedIn.status()} ${await signedIn.text()}`);
  process.exit(1);
}

async function gql(query) {
  const response = await context.request.post(`${BASE}/graphql`, { data: { query } });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

/*
 * Everything is found by name, never by id. The seed rebuilds its workspace on
 * every run, so the ids move; a path with a number in it would photograph the
 * wrong page a week later, or none at all.
 */
const { workspaces } = await gql('{ workspaces(size: 100) { content { id name } } }');
const workspace = workspaces.content.find((w) => w.name === WORKSPACE_NAME);
if (!workspace) {
  console.error(`No workspace called "${WORKSPACE_NAME}". Run scripts/seed-demo.mjs first.`);
  process.exit(1);
}
const ws = workspace.id;

const found = await gql(`{
  workflows: workspaceWorkflows(workspaceId: "${ws}") { content { id name } }
  executions: workspaceExecutions(workspaceId: "${ws}") { content { id } }
  agents: workspaceAgents(workspaceId: "${ws}") { content { id name } }
  functions: workspaceFunctions(workspaceId: "${ws}") { content { id name } }
  tools: workspaceTools(workspaceId: "${ws}") { content { id name } }
  skills: workspaceSkills(workspaceId: "${ws}") { content { id name } }
  providers: modelProviders(workspaceId: "${ws}") { id name }
  issues: workspaceIssues(workspaceId: "${ws}", size: 100) {
    content { number title attachments { id } comments { id } }
  }
  users { id username type }
}`);

const byName = (list, name) => list.find((item) => item.name === name) ?? list[0];
const flagship = byName(found.workflows.content, 'Azure Agent reply for Slack');
const responder = byName(found.agents.content, 'Support responder');
const fn = byName(found.functions.content, 'escalationNote');
const tool = byName(found.tools.content, 'lookupCustomer');
const skill = byName(found.skills.content, 'When to escalate');
const run = found.executions.content[0];
const provider = found.providers[0];
/*
 * An issue is chosen by what it can show rather than by its number: the page
 * the manual points at is the one about comments and attachments, so it has to
 * be an issue that has both. Numbers move as a tracker is used, and a hard
 * number would eventually photograph whatever happened to land on it.
 */
const illustrated =
  found.issues.content.find((issue) => issue.attachments.length > 0 && issue.comments.length > 0) ??
  found.issues.content.find((issue) => issue.comments.length > 0) ??
  found.issues.content[0];
/* The one kind of user whose page has a password and tokens on it. */
const internal = found.users.find((user) => user.type === 'INTERNAL') ?? found.users[0];

/**
 * What to photograph.
 *
 * `waitFor` is a selector that only exists once the data has arrived. Without
 * one every screenshot is a race, and the ones that lose show an empty table.
 * Where no selector is given, the wait is for the page to have some content in
 * it at all, which is enough for a list that renders its heading with its rows.
 */
const SHOTS = [
  { name: 'workflows', path: `/workspace/${ws}` },
  /*
   * The graph, which is the one picture that shows what this product is. It
   * waits for a node to be on the canvas rather than for the page: React Flow
   * mounts the canvas empty and fills it a frame later, so a screenshot of the
   * page alone is a screenshot of a grid. Then it fits the graph in the frame
   * and selects a node, because an editor photographed with nothing selected
   * shows an empty properties panel next to it — which is what it looked like
   * when the manual undersold the product.
   */
  { name: 'editor', path: `/workspace/${ws}/workflows/${flagship.id}/editor`, waitFor: '.react-flow__node', editor: true },
  { name: 'executions', path: `/workspace/${ws}/executions` },
  run && { name: 'execution-detail', path: `/workspace/${ws}/executions/${run.id}` },
  /*
   * The builder, open beside the graph rather than over it, which is the whole
   * point of it. Nothing is created and nothing is saved: the form is opened,
   * photographed and left, and the next shot navigates away from it.
   */
  {
    name: 'node-builder',
    path: `/workspace/${ws}/workflows/${flagship.id}/editor`,
    waitFor: '.react-flow__node',
    editor: true,
    prepare: async (page) => {
      // `New` beside whichever picker the selected node has, which is the one
      // control that opens a builder. Exact text, or it matches "New Issue".
      await page.locator('button', { hasText: /^New$/ }).first().click();
      await page.waitForSelector('dialog[open]', { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
  },
  { name: 'triggers', path: `/workspace/${ws}/triggers` },
  /*
   * All rather than Open, which is what the page opens on: a tracker being read
   * for the first time should show what the three states look like beside each
   * other, and a picture of an empty Open list teaches nothing.
   */
  {
    name: 'issues',
    path: `/workspace/${ws}/issues?status=all`,
    waitFor: 'a[href*="/issues/"]',
  },
  illustrated && {
    name: 'issue',
    path: `/workspace/${ws}/issues/${illustrated.number}`,
    waitFor: 'textarea[aria-label="Add a comment"]',
  },
  { name: 'agents', path: `/workspace/${ws}/agents` },
  responder && { name: 'agent-settings', path: `/workspace/${ws}/agents/${responder.id}/settings` },
  { name: 'models', path: `/workspace/${ws}/models` },
  provider && { name: 'model-provider', path: `/workspace/${ws}/models/providers/${provider.id}` },
  { name: 'functions', path: `/workspace/${ws}/functions` },
  fn && { name: 'function-editor', path: `/workspace/${ws}/functions/${fn.id}` },
  { name: 'tools', path: `/workspace/${ws}/tools` },
  tool && { name: 'tool-editor', path: `/workspace/${ws}/tools/${tool.id}` },
  { name: 'skills', path: `/workspace/${ws}/skills` },
  skill && { name: 'skill-editor', path: `/workspace/${ws}/skills/${skill.id}` },
  { name: 'actions', path: `/workspace/${ws}/actions` },
  { name: 'conditions', path: `/workspace/${ws}/conditions` },
  { name: 'objects', path: `/workspace/${ws}/objects` },
  { name: 'variables', path: `/workspace/${ws}/variables` },
  { name: 'integrations', path: `/workspace/${ws}/integrations` },
  { name: 'audit', path: `/workspace/${ws}/audit` },
  { name: 'workspace-settings', path: `/workspace/${ws}/settings` },
  // The composer, by its label rather than its placeholder: `text=` matches
  // content, and a placeholder is an attribute, so it never matched at all.
  { name: 'chat', path: '/chat', waitFor: 'textarea[aria-label="Message"]' },
  {
    name: 'quick-chat',
    /*
     * Photographed over the executions list rather than an empty page: the
     * panel answers about whatever is on screen, so what is behind it is part
     * of what it is. And opened with a question already answered, because a
     * picture of the closed launcher is a picture of a button.
     */
    path: `/workspace/${ws}/executions`,
    prepare: async (page) => {
      await page.click('button[aria-label="Ask about this page"]');
      await page.waitForSelector('section[aria-label="Quick chat"]', { timeout: 10_000 });
      await page.fill('textarea[aria-label="Ask about this page"]', 'Which run failed, and what stopped it?');
      /*
       * How much text the panel holds before the answer, so the wait is for it
       * to grow rather than for a length picked in advance — a short answer is
       * still an answer, and the first version of this called one a timeout.
       */
      const before = await page.evaluate(
        () => document.querySelector('section[aria-label="Quick chat"]')?.innerText.length ?? 0,
      );
      await page.click('section[aria-label="Quick chat"] button[type="submit"]');
      try {
        // A real model answers this, so it takes as long as it takes.
        await page.waitForFunction(
          (base) => (document.querySelector('section[aria-label="Quick chat"]')?.innerText.length ?? 0) > base + 40,
          before,
          { timeout: 90_000 },
        );
      } catch {
        // Answer never came: the question and the panel are still worth showing.
        // Usually not a failure: the panel keeps its conversation, so a second
        // run finds this question already answered and nothing grows.
        console.warn('  quick-chat: the panel did not grow — it may already hold this answer');
      }
    },
  },
  {
    name: 'command-palette',
    /*
     * Open, with something typed into it. Closed it is a box in the top bar
     * that the reader has already seen in every other picture here; what the
     * page is about is the list underneath.
     */
    path: `/workspace/${ws}`,
    prepare: async (page) => {
      const box = 'input[aria-label="Go to a page"]';
      await page.click(box);
      await page.type(box, 's', { delay: 40 });
      await page.waitForSelector('ul[role="listbox"]', { timeout: 10_000 });
      await page.waitForTimeout(300);
    },
  },
  { name: 'admin-workspaces', path: '/admin' },
  { name: 'users', path: '/admin/users' },
  internal && { name: 'user', path: `/admin/users/${internal.id}` },
  {
    name: 'doctor',
    path: '/admin/doctor',
    /*
     * The one page whose text is changed before it is photographed.
     *
     * The attachments check prints the absolute path it resolved, which is the
     * whole point of the check — and on the machine that takes these pictures
     * that path is somebody's home directory, which then ships in a public
     * manual. So the picture shows a placeholder instead.
     *
     * It is written down here rather than done by hand to an image afterwards:
     * a manual that quietly differs from the product is a trap, and this way
     * the difference is one commented function in the open. Nothing else in
     * this file changes what a page says.
     */
    redact: () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      // The configured value, which is what this installation actually holds —
      // `orknux.attachments.location` is `data/attachments`. Only where the
      // working directory happens to be is hidden, and the sentence keeps its
      // "relative to the working directory" clause honest, which an absolute
      // placeholder would have contradicted.
      const placeholder = 'data/attachments';
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.nodeValue === null) continue;
        // Windows or POSIX, as far as the end of the path.
        node.nodeValue = node.nodeValue.replace(/(?:[A-Za-z]:\\|\/)[^\s,;]*attachments/g, placeholder);
      }
    },
  },
  { name: 'plugins', path: '/admin/plugins' },
  { name: 'roles', path: '/admin/roles' },
  { name: 'monitoring', path: '/admin/monitoring' },
  { name: 'admin-settings', path: '/admin/settings' },
  // By a setting rather than by the page having text in it: this one lays its
  // content out beside `main` rather than inside it, so the default wait never
  // sees anything and times out on a page that was ready immediately.
  { name: 'preferences', path: '/preferences', waitFor: '#palette-shortcut' },
  /*
   * Last, and not by accident.
   *
   * Opening the bell is what marks its notifications seen, and the panel only
   * ever lists the ones still waiting - so a capture that let that mutation
   * through would empty the thing it had just photographed, and every run after
   * this one would take a picture of "Nothing waiting". The refusal is a route
   * on this page, which is why this shot goes at the end: nothing after it has
   * to reason about a request being intercepted.
   *
   * This is the second and last place where the capture does not simply look at
   * the product. The other is `doctor`, above.
   */
  {
    name: 'notifications',
    path: `/workspace/${ws}/issues`,
    prepare: async (page) => {
      await page.route('**/graphql', async (route) => {
        if ((route.request().postData() ?? '').includes('readMyNotifications')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: { readMyNotifications: 0 } }),
          });
          return;
        }
        await route.continue();
      });
      await page.click('button[aria-label^="Notifications"]');
      // The panel appears before its contents do, so the wait is for a row.
      const rows = 'div[role="dialog"][aria-label="Notifications"] a';
      try {
        await page.waitForSelector(rows, { timeout: 10_000 });
      } catch {
        /*
         * Nothing waiting. Not a failure - the panel is still the panel - but
         * it is a picture of an empty box, so it is said out loud rather than
         * quietly shipped as documentation of the feature.
         */
        console.warn('  notifications: nothing is waiting, so the panel is empty');
      }
      await page.waitForTimeout(400);
    },
  },
].filter(Boolean);

/*
 * `ORKNUX_ONLY=doctor,chat` takes just those, for when one page has changed and
 * rewriting thirty other files would be noise in the diff.
 */
const only = (process.env.ORKNUX_ONLY ?? '').split(',').map((name) => name.trim()).filter(Boolean);
const CHOSEN = only.length === 0 ? SHOTS : SHOTS.filter((shot) => only.includes(shot.name));
if (only.length > 0 && CHOSEN.length === 0) {
  console.error(`Nothing called ${only.join(', ')}. Names come from the list above.`);
  process.exit(1);
}

// The sign-in screen itself, before the session is used — the one page a reader
// meets before they are anybody.
let taken = 0;
if (only.length === 0 || only.includes('sign-in')) {
  const anonymous = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const loginPage = await anonymous.newPage();
  await loginPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await loginPage.screenshot({ path: `${OUT}sign-in.png` });
  console.log('sign-in');
  await anonymous.close();
  taken += 1;
}

/*
 * `domcontentloaded` and then the selector, rather than `networkidle`.
 *
 * Several of these pages never go idle — the executions list polls, the quick
 * chat asks about its workspace, an auto-refresh ticks — so waiting for silence
 * waits for something that does not happen and fails after thirty seconds on a
 * page that was ready in one. What the picture actually needs is the content,
 * and the selector is what says the content arrived.
 */
let failures = 0;
for (const shot of CHOSEN) {
  try {
    await page.goto(`${BASE}${shot.path}`, { waitUntil: 'domcontentloaded' });
    if (shot.waitFor) {
      await page.waitForSelector(shot.waitFor, { timeout: 15_000 });
    } else {
      await page.waitForFunction(
        () => (document.querySelector('main')?.innerText.trim().length ?? 0) > 40,
        undefined,
        { timeout: 15_000 },
      );
    }

    if (shot.editor) {
      // Fit the graph to the frame, then select a node so the properties panel
      // has something in it.
      const fit = page.locator('.react-flow__controls-fitview');
      if (await fit.count()) await fit.first().click();
      await page.waitForTimeout(400);
      const agentNode = page.locator('.react-flow__node', { hasText: 'Support responder' });
      const target = (await agentNode.count()) ? agentNode.first() : page.locator('.react-flow__node').first();
      await target.click();
    }

    // Animations settle, and a refresh already in flight lands.
    await page.waitForTimeout(700);
    if (shot.prepare) await shot.prepare(page);
    if (shot.redact) await page.evaluate(shot.redact);
    await page.screenshot({ path: `${OUT}${shot.name}.png` });
    taken += 1;
    console.log(shot.name);
  } catch (failure) {
    // One page that will not settle should not cost the others. It is reported
    // and counted, so a run that half worked cannot look like one that worked.
    failures += 1;
    console.warn(`  ${shot.name}: ${failure.message.split('\n')[0]}`);
  }
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} could not be taken; ${taken} written.`);
  process.exit(1);
}
console.log(`\n${taken} written to public/screens/`);
