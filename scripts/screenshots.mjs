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
 *   docker exec -e ORKNUX_DEMO_ENDPOINT=http://a.model.that/answers \
 *     orknux-ui-dev-1 node scripts/seed-demo.mjs
 *   docker exec orknux-ui-dev-1 node scripts/screenshots.mjs
 *
 * The first line is needed once per container: the browser and the system
 * libraries it needs live in the container's own filesystem, not in the
 * node_modules volume, so recreating the container takes them with it.
 *
 * The endpoint on the second matters more than it looks. Half a dozen of these
 * pictures are of a product talking to a model - a chat with an answer in it, a
 * run with an agent step, a provider with a green light - and pointed at
 * nothing they are pictures of a 404. Whatever it is pointed at, its address is
 * replaced in every image before the shutter: see `hideEverywhere` below, which
 * does the same for the address of whoever is taking the pictures.
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
const WORKSPACE_NAME = process.env.ORKNUX_DEMO_WORKSPACE ?? 'Northwind Support';
/*
 * The colleague the seed makes, and the only account whose page is photographed.
 *
 * By name, and deliberately. This used to be "the first internal user", which
 * on the machine that takes these pictures is the account an AI assistant signs
 * in with: the manual's page about what a user is showed an account named after
 * a vendor's assistant, holding Administrators and Developer, with three live
 * tokens named after the tool that holds them. None of that is a user page — it
 * is somebody's automation, photographed by accident because it happened to
 * sort first. Must match `COLLEAGUE.username` in seed-demo.mjs.
 */
const COLLEAGUE = process.env.ORKNUX_DEMO_COLLEAGUE ?? 'dana';

/**
 * What a provider's address is shown as.
 *
 * A working demonstration needs a model that answers, and the one that answers
 * on the machine these are taken on is a server on the owner's home network.
 * Its address is drawn wherever a provider is: the models list, the provider's
 * own page, the message a check leaves behind, a chat that could not reach it.
 *
 * So it is replaced on every page rather than on the two somebody remembered.
 * What it really is comes from the provider itself further down, not from an
 * environment variable this script would have to be told about separately - the
 * seed already stored it, and a redaction that has to be configured twice is
 * one that will one day be configured once.
 */
const SHOWN_ENDPOINT = process.env.ORKNUX_DEMO_ENDPOINT_SHOWN ?? 'http://ollama.northwind.internal:11434';
/**
 * What the other workspaces on this installation are called instead.
 *
 * Up here rather than inside the admin list's redaction, because the same names
 * are needed in two places now. The corner of every screen carries a workspace
 * picker, and on the admin pages it shows whichever workspace was last open -
 * which on the machine these are taken on is a real one, sitting above a list
 * whose rows have just been given invented names. One picture, two names for
 * the same thing, and one of them somebody's own.
 *
 * Applied by sorted position of the real name rather than by the order the rows
 * happen to be in, so the list and the picker agree on which workspace is which
 * without either of them knowing about the other.
 */
const INVENTED_WORKSPACES = [
  ['Billing Operations', 'The nightly export, and who hears about it when it stops.'],
  ['Onboarding', 'What a new customer is walked through in their first week.'],
  ['Field Engineering', 'The questions that arrive from site, and what answers them.'],
];

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
  conditions: workspaceConditions(workspaceId: "${ws}", page: 0, size: 100) { content { id name } }
  sessions: llmSessions(workspaceId: "${ws}", size: 100) { content { id key eventCount } }
  catalogs: memoryCatalogs(workspaceId: "${ws}") { id name memoryCount }
  providers: modelProviders(workspaceId: "${ws}") { id name endpoint }
  issues: workspaceIssues(workspaceId: "${ws}", size: 100) {
    content { number title attachments { id } comments { id } }
  }
  users { id username type email }
}`);

const byName = (list, name) => list.find((item) => item.name === name) ?? list[0];
const flagship = byName(found.workflows.content, 'Answer a question asked in Slack');
const responder = byName(found.agents.content, 'Support responder');
const fn = byName(found.functions.content, 'escalationNote');
const tool = byName(found.tools.content, 'lookupCustomer');
const skill = byName(found.skills.content, 'When to escalate');
const condition = byName(found.conditions.content, 'Mentions an outage');
const run = found.executions.content[0];
const provider = found.providers[0];
/*
 * The conversation the transcript is photographed from, chosen by how many
 * times somebody put something to it rather than by name.
 *
 * A session is not made by anybody - it exists because a run computed its key -
 * so there is no name to hard-code that would still be right after the seed is
 * changed. What the picture has to show is a conversation somebody came back
 * to: two questions about one ticket with the answers between them, which is
 * the whole reason the feature is not just the run's own log.
 *
 * By User lines rather than by lines, which is not the same thing and was the
 * first version of this. An agent that answers one question by calling five
 * tools leaves a longer transcript than one that answered two questions with
 * one call each - so "the busiest session" picked a single question with a
 * tool loop under it, which is a picture of a model working rather than of a
 * conversation being kept.
 *
 * And by *different* User lines, which is not that either. A step that failed
 * and was retried puts the same question in the transcript again, so a session
 * with one question asked three times counts three - and the picture became the
 * same sentence three times over, which reads as a product stuck in a loop. So
 * what is counted is how many different things were put to it.
 *
 * Asked per session because a list of sessions carries neither number; there
 * are a handful of them, and this runs once.
 */
const returnedTo = await Promise.all(
  found.sessions.content.map(async (session) => {
    const { llmSessionEvents } = await gql(
      `{ llmSessionEvents(sessionId: "${session.id}", kinds: [USER], size: 100) { content { content } } }`,
    );
    const asked = new Set(llmSessionEvents.content.map((line) => line.content));
    return { ...session, asked: asked.size };
  }),
);
/*
 * Ties broken by the shorter transcript rather than the longer one: between two
 * conversations somebody came back to, the one with less tool traffic between
 * the questions is the one a reader can follow.
 */
const transcript = returnedTo.sort((a, b) => b.asked - a.asked || a.eventCount - b.eventCount)[0];
/*
 * And the memory catalog worth opening, by the same rule.
 *
 * The Memory page opens on whichever catalog sorts first by name, which is a
 * sensible thing for it to do and a poor thing to photograph: the seed's
 * fullest catalog is not its alphabetically first, so the picture was two
 * memories in a page with room for six. Chosen by what is in it rather than by
 * name, so renaming a catalog in the seed cannot quietly empty the picture.
 */
const fullest = [...found.catalogs].sort((a, b) => b.memoryCount - a.memoryCount)[0];
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
/*
 * The colleague, by name.
 *
 * Not "the first internal user": see the comment on COLLEAGUE above for what
 * that photographed. If she is not there the capture stops rather than falling
 * back to whoever is, because the fallback is exactly the account that must not
 * be published - and a shot that quietly does not happen leaves the previous,
 * wrong picture on disk under the same name.
 */
const internal = found.users.find((user) => user.username === COLLEAGUE);
if (!internal) {
  console.error(
    `No user called "${COLLEAGUE}", whose page is what /admin/users/:id is photographed from.\n` +
      '  Run scripts/seed-demo.mjs, which makes her.',
  );
  process.exit(1);
}

/*
 * What the provider's address really is, so it can be replaced with what the
 * pictures say it is. Empty when there is no provider, which is a workspace
 * nobody seeded rather than a workspace with nothing to hide.
 */
const REAL_ENDPOINT = provider?.endpoint ?? '';

/*
 * And the address of whoever is taking the pictures.
 *
 * The account these are photographed as is an external one: its address comes
 * from the directory this installation signs in against, and on the machine
 * these are taken on that is somebody's own mailbox. It is drawn in at least
 * two places - the Users table has a column of them, and the Preferences page
 * puts the signed-in person's in an editable field under "Email Address" - and
 * both of those shipped it into a public manual.
 *
 * Taken from the data rather than from an environment variable, for the same
 * reason the endpoint above is: a redaction that has to be configured is one
 * that will one day not be. What it is replaced with is the same address the
 * rest of the cast has, so the users page reads as one company's directory
 * rather than as three people from three different places.
 */
const owner = found.users.find((user) => user.username === USER);
const REAL_EMAIL = owner?.email ?? '';
const SHOWN_EMAIL = process.env.ORKNUX_DEMO_EMAIL_SHOWN ?? `${USER}@northwind.example`;

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
  /*
   * The same issue, on its other tab.
   *
   * The same issue on purpose rather than whichever one has the busiest
   * history: a reader who has just met this page above recognises it, and what
   * the picture is about is the second tab, not the issue underneath it.
   *
   * The history is fetched when the tab is opened and not before, so the panel
   * is on screen a moment before anything is in it. What is waited for is the
   * line every history has - the issue being opened - because a shot taken on
   * the spinner is a picture of a tab that appears to do nothing.
   */
  illustrated && {
    name: 'issue-history',
    path: `/workspace/${ws}/issues/${illustrated.number}`,
    waitFor: 'textarea[aria-label="Add a comment"]',
    prepare: async (page) => {
      await page.click('button[role="tab"]:has-text("History")');
      await page.waitForSelector('text=opened this issue', { timeout: 15_000 });
      await page.waitForTimeout(300);
    },
  },
  { name: 'agents', path: `/workspace/${ws}/agents` },
  responder && { name: 'agent-settings', path: `/workspace/${ws}/agents/${responder.id}/settings` },
  { name: 'models', path: `/workspace/${ws}/models` },
  provider && { name: 'model-provider', path: `/workspace/${ws}/models/providers/${provider.id}` },
  {
    name: 'functions',
    path: `/workspace/${ws}/functions`,
    /*
     * A workspace page that lists installation-wide things, which is why it
     * needs the same treatment the Admin plugins page gets.
     *
     * A plugin's functions are offered to every workspace - one row in the
     * database with no workspace on it at all - and they are listed here beside
     * the workspace's own under `<plugin key>_<function>`. So this page was
     * showing `teammates_isTeammate` and `tsdemo_isTeammate`: the scratch
     * uploads on the developer's machine, turning up inside the demonstration
     * workspace where nobody put them.
     *
     * The choice was between hiding them and getting them out of the workspace,
     * and getting them out is not a thing that exists: they are not in the
     * workspace to be removed from it. The only way to stop them appearing here
     * is to delete the plugins from the installation, and those are somebody's
     * uploads - deleting them to tidy a screenshot is the capture script
     * editing the machine it is photographing, which is the one thing the seed
     * beside it refuses to do. So they are renamed, with the same names the
     * plugins page gives them, because a reader who turns from one page to the
     * other has to find the same plugin there.
     */
    redact: () => {
      // Keyed by what a plugin is called in the database, valued by what the
      // plugins page above calls it. Prefixes, not whole names: what follows
      // the underscore is the function's own name, and that part is true as it
      // stands.
      const instead = new Map([
        ['teammates', 'zendesk'],
        ['template', 'pagerduty'],
        ['tsdemo', 'statuspage'],
      ]);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.nodeValue?.trim() ?? '';
        const underscore = text.indexOf('_');
        if (underscore <= 0) continue;
        const given = instead.get(text.slice(0, underscore));
        if (given !== undefined) node.nodeValue = `${given}${text.slice(underscore)}`;
      }
    },
  },
  /*
   * The three editors, each waiting for something only a loaded one has.
   *
   * These pages draw their whole frame - heading, empty name, empty code pane,
   * a greyed Save - before the thing being edited has arrived, and they say
   * nothing while they wait. The default wait here is "does `main` have text in
   * it", which that empty frame satisfies immediately, so a run where the dev
   * server was still compiling the route photographed the frame: `tool-editor`
   * shipped as a blank form with "Tool" for a heading and `…` for a name, which
   * reads as a feature that does not work.
   *
   * So each waits for a control that only exists once there is something to
   * edit - the Active badge, whose title says which kind of thing it is, and a
   * parameter row on the function editor, which is drawn from the loaded
   * function's own parameters.
   */
  fn && {
    name: 'function-editor',
    path: `/workspace/${ws}/functions/${fn.id}`,
    waitFor: 'input[aria-label="Parameter 1 name"]',
  },
  { name: 'tools', path: `/workspace/${ws}/tools` },
  tool && {
    name: 'tool-editor',
    path: `/workspace/${ws}/tools/${tool.id}`,
    waitFor: 'button[title$="this tool"]',
  },
  { name: 'skills', path: `/workspace/${ws}/skills` },
  skill && {
    name: 'skill-editor',
    path: `/workspace/${ws}/skills/${skill.id}`,
    waitFor: 'button[title$="this skill"]',
  },
  /*
   * What a workspace has written down, and what its agents have said. Both are
   * in the AI menu after the skills above, and both are photographed in that
   * order for the same reason the rest of this list is: a reader following the
   * menu down the side should meet the pictures in the order the menu names
   * them.
   *
   * Nothing on either page is this installation's. A memory is what the seed
   * wrote; a session key is what the seeded graph computed from the event it
   * was handed. That is worth saying because every other page here that lists
   * something had to be argued with first - these two are the workspace's own
   * content and nothing else's.
   */
  {
    name: 'memory',
    path: `/workspace/${ws}/memory`,
    /*
     * A memory's own edit control, which exists only once the catalog's page of
     * memories has arrived. The page draws its catalog list, its heading, its
     * search box and its sort before any of that - so the default wait, and any
     * wait on the frame, photographs a chosen catalog with a spinner in it.
     * `Rename` and `Delete` belong to the catalog and are drawn with the
     * heading, which is why the wait is on `Edit`.
     *
     * A link rather than a button: editing a memory is going to its own page,
     * so the control is an anchor and `button[aria-label^="Edit "]` matches
     * nothing at all - fifteen seconds, then a page with no picture.
     */
    waitFor: 'a[aria-label^="Edit "]',
    prepare: async (page) => {
      if (fullest === undefined) return;
      await page.click(`button:has-text("${fullest.name}")`);
      // The heading is the catalog's name, so it says which one is open; the
      // memories under it are fetched when it is chosen, not before.
      await page.waitForSelector(`h1:has-text("${fullest.name}")`, { timeout: 10_000 });
      await page.waitForSelector('a[aria-label^="Edit "]', { timeout: 10_000 });
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'sessions',
    path: `/workspace/${ws}/sessions`,
    // A row, because this page says something quite different with none: an
    // empty list explains what a session is and how one appears, which is a
    // reasonable page and a useless picture of the feature.
    waitFor: 'a[href*="/sessions/"]',
  },
  transcript && {
    name: 'session',
    path: `/workspace/${ws}/sessions/${transcript.id}`,
    /*
     * One line of the transcript. The heading, the two buttons and the filters
     * are all drawn from the session itself, which arrives before its lines do,
     * so waiting for any of them photographs an empty scroller under a full
     * header - the same trap the three editors above document.
     */
    waitFor: 'article',
    /*
     * Narrowed to what was said, and that is a decision worth defending.
     *
     * Unfiltered, the top of this page is a question and then four tool calls -
     * `memory_search`, `skill_list`, `lookupCustomer` - because that is what an
     * agent with memory, skills and tools does before it answers. Every one of
     * those lines is real and the prose beside this picture explains them, but
     * the picture that resulted showed a question nobody answered, which is the
     * opposite of what the page is for.
     *
     * So the two kinds that make up the conversation are ticked, the same way
     * the issues shot above opens on All rather than on Open: the state chosen
     * is the one that teaches, and the filter doing it is on screen and clearly
     * pressed, so the picture says of itself what it is showing.
     */
    prepare: async (page) => {
      const chips = 'div[role="group"][aria-label="Which kinds to show"] button';
      await page.locator(chips, { hasText: /^User$/ }).click();
      await page.locator(chips, { hasText: /^Agent$/ }).click();
      // The transcript is re-fetched on each press, so the last one has to land
      // before the shutter.
      await page.waitForFunction(
        () => document.querySelectorAll('article').length > 0,
        undefined,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(600);
    },
  },
  { name: 'actions', path: `/workspace/${ws}/actions` },
  { name: 'conditions', path: `/workspace/${ws}/conditions` },
  /*
   * One condition, open at its own address.
   *
   * Worth a picture of its own because the change it documents is exactly that
   * there is an address: this used to be a dialog over the list, and a picture
   * of the list alone cannot show that a row now opens as a page. It waits for
   * the name field, which the page draws only once the condition has arrived -
   * before that it is a spinner in a card.
   */
  condition && {
    name: 'condition',
    path: `/workspace/${ws}/conditions/${condition.id}`,
    waitFor: '#condition-name',
  },
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
      /*
       * A question this page can actually answer. It used to ask which run
       * failed - written when the demonstration's model was unreachable and
       * every run of the flagship workflow died on it, so there was always one.
       * With a model that answers there is nothing failed to point at, and the
       * panel replied "None of the recent runs have failed", which is correct
       * and teaches nothing. What the panel is for is reading what is on the
       * screen, so it is asked something only the screen knows.
       */
      const asked = 'Which of these runs took the longest, and which workflow was it?';
      await page.fill('textarea[aria-label="Ask about this page"]', asked);
      await page.click('section[aria-label="Quick chat"] button[type="submit"]');
      const held = () => document.querySelector('section[aria-label="Quick chat"]')?.innerText ?? '';
      try {
        /*
         * Two waits, because the panel gets *shorter* before it gets longer.
         *
         * An unused panel holds a paragraph explaining what it is for, and
         * sending the first question replaces that paragraph with the
         * conversation - so measuring before the question and waiting to grow
         * past it waits for something that never happens: 174 characters of
         * explanation became 100 of question, then 195 with the answer, and a
         * margin of any size over 174 was a guaranteed timeout. It warned about
         * an answer that was sitting in the picture.
         *
         * So the baseline is taken once the question is in the panel, and what
         * is waited for is anything after it. A real model answers this, so the
         * second wait takes as long as it takes.
         */
        await page.waitForFunction(
          (question) =>
            (document.querySelector('section[aria-label="Quick chat"]')?.innerText ?? '').includes(question),
          asked,
          { timeout: 15_000 },
        );
        const echoed = await page.evaluate(held);
        await page.waitForFunction(
          (base) =>
            (document.querySelector('section[aria-label="Quick chat"]')?.innerText.length ?? 0) > base + 20,
          echoed.length,
          { timeout: 90_000 },
        );
      } catch {
        // Answer never came: the question and the panel are still worth showing,
        // but a picture of a question nobody answered is not what this page is
        // for, so it is said out loud rather than quietly published.
        console.warn('  quick-chat: no answer arrived — check the model provider');
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
      const box = 'input[aria-label="Search or create"]';
      await page.click(box);
      await page.type(box, 's', { delay: 40 });
      await page.waitForSelector('ul[role="listbox"]', { timeout: 10_000 });
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'admin-workspaces',
    path: '/admin',
    /*
     * The other page whose text is changed before it is photographed.
     *
     * Every other picture is of one workspace, and the seed decides what is in
     * it. This one is a list of all of them, and the machine that takes these
     * pictures is somebody's own: the workspaces beside the demonstration one
     * are real work, and their names and descriptions would ship in a public
     * manual. So the demonstration workspace keeps its name and the rest are
     * given invented ones, in the order they happen to appear.
     *
     * The page is still honest about what it is — a list of several workspaces,
     * each with a description and a way into its settings. Only whose they are
     * is hidden.
     */
    redactWith: { invented: INVENTED_WORKSPACES, keep: WORKSPACE_NAME },
    redact: ({ invented, keep }) => {
      const main = document.querySelector('main');
      if (main === null) return;
      const links = [...main.querySelectorAll('a[href^="/workspace/"]')];
      // By sorted name, which is what the corner's picker uses too.
      const others = links
        .map((link) => link.textContent?.trim() ?? '')
        .filter((name) => name !== keep)
        .sort();
      for (const link of links) {
        const was = link.textContent?.trim() ?? '';
        if (was === keep) continue;
        const [name, description] = invented[others.indexOf(was)] ?? ['Another workspace', '—'];
        link.textContent = name;
        // The row is `name cell`, `description cell`, `settings link`; the
        // link sits inside the first of those.
        const row = link.parentElement?.parentElement;
        if (row?.children[1] !== undefined) row.children[1].textContent = description;
        const settings = row?.querySelector('a[aria-label^="Settings for"]');
        settings?.setAttribute('aria-label', `Settings for ${name}`);
        settings?.setAttribute('title', `Settings for ${name}`);
      }
    },
  },
  {
    name: 'users',
    path: '/admin/users',
    /*
     * Installation-wide, like the workspaces and plugins lists above, so it
     * shows whoever this machine happens to know - and a development machine
     * knows accounts that were never meant to be in a manual.
     *
     * Written as a rule rather than as a list of names to paint over, which is
     * the difference between this and the two redactions above it. Those know
     * what is on this particular machine; a list like that is wrong the moment
     * somebody else runs the capture, and worse, it has to write down the very
     * names it exists to keep out of the picture. So the cast the seed makes is
     * kept and everybody else is given an invented colleague's name, in the
     * order they appear.
     *
     * The reason is not privacy. A reader who meets an unexplained account in
     * the users table of a product that also has agents in it draws conclusions
     * about what the product is or ships with, and an accident of whose machine
     * took the picture gets read as a statement about the software. What the
     * page is - three accounts, two kinds, one of them holding two roles - is
     * unchanged. Only whose accounts they are stops being visible.
     */
    redactWith: { keep: [USER, COLLEAGUE] },
    redact: ({ keep }) => {
      const invented = [
        ['Priya Raman', 'PR', 'priya'],
        ['Tomas Lindqvist', 'TL', 'tomas'],
        ['Ruth Adeyemi', 'RA', 'ruth'],
      ];
      let next = 0;
      const main = document.querySelector('main');
      if (main === null) return;
      for (const link of main.querySelectorAll('a[href^="/admin/users/"]')) {
        const row = link.parentElement?.parentElement;
        const cell = row?.children[0];
        if (cell === undefined) continue;
        // The cell reads as initials, then the display name, then the username
        // where there is one: `ALalice`, `DWDana Whitfielddana`.
        const text = cell.textContent ?? '';
        if (keep.some((username) => text.endsWith(username))) continue;
        const [name, initials, username] = invented[next] ?? ['A colleague', 'AC', 'colleague'];
        next += 1;
        const nodes = [];
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node);
        if (nodes[0] !== undefined) nodes[0].nodeValue = initials;
        if (nodes[1] !== undefined) nodes[1].nodeValue = name;
        if (nodes[2] !== undefined) nodes[2].nodeValue = username;
        /*
         * And the address beside them, which is the next cell along.
         *
         * A renamed row with somebody's real mailbox still in it is a row that
         * was not renamed. Only rewritten where there is an address to rewrite:
         * an account the directory gave no address to shows a dash, and turning
         * that dash into a mailbox would invent a fact rather than hide one.
         */
        const address = row?.children[1];
        if (address?.textContent?.includes('@')) address.textContent = `${username}@northwind.example`;
      }
    },
  },
  /*
   * The colleague's own page, and nothing is painted over on it.
   *
   * It used to be whichever internal account sorted first, with its three live
   * token names replaced by invented ones after the fact. The account is now
   * chosen by name and the tokens on it were made by the seed, so what is in
   * the picture is what is in the database: three tokens called after jobs a
   * support desk would actually run, two of them used. Nothing here is a
   * redaction, which is the version of this page worth having.
   */
  { name: 'user', path: `/admin/users/${internal.id}` },
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
  {
    name: 'plugins',
    path: '/admin/plugins',
    /*
     * Installation-wide, so it lists whatever this machine holds - which on a
     * developer's is a row of scratch uploads called `template` and `tsdemo`.
     * They give nothing away, but a manual whose plugin page is somebody's
     * workbench teaches the reader that a plugin is a thing you test with
     * rather than a thing you ship. Named for what a plugin is actually for,
     * the same way the workspaces page above is.
     */
    redact: () => {
      /*
       * By the text rather than by the shape of the page, the way the doctor
       * page's redaction is: this list is spans with hashed class names, and a
       * selector written against them is one that breaks the next time the
       * stylesheet is touched.
       *
       * All three rows, not two. The map used to cover `template` and `tsdemo`
       * and miss the row above them - `orknux-plugin (2)`, a scratch upload
       * still carrying a browser's duplicate-download suffix, at the top of the
       * manual's picture of what a plugin is.
       *
       * The signatures are left alone now. Rewriting them is what made this
       * page disagree with a workspace's Functions page, where the same plugins
       * appear again: a plugin's function is listed there as `<key>_<name>`, so
       * a signature invented here would have had to be invented identically
       * there or the manual contradicts itself two pages apart. What they
       * really declare - `isTeammate(email)` - is a plausible thing for a
       * support desk to ask, and a true signature needs no second copy kept in
       * step with it.
       */
      const instead = new Map([
        ['orknux-plugin (2)', 'zendesk'],
        ['template', 'pagerduty'],
        ['tsdemo', 'statuspage'],
      ]);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const given = instead.get(node.nodeValue?.trim() ?? '');
        if (given !== undefined) node.nodeValue = given;
      }
    },
  },
  { name: 'roles', path: '/admin/roles' },
  /*
   * Both installation-wide, and both photographed from what the seed puts
   * there: `seed-demo.mjs` adds two machines and three proxy rules, because a
   * page with nothing in it is a picture of an empty box rather than of what
   * the page is for.
   *
   * Neither is redacted, and that is a decision rather than an oversight. The
   * seed adds and never replaces, so anything this installation already held
   * is still in the list and will be in the picture - somebody's real proxy,
   * with its real address on it. Look at both before publishing.
   */
  {
    name: 'networking',
    path: '/admin/networking',
    /*
     * The tester, used rather than empty.
     *
     * Nothing is redacted here: the address is typed in and the button is
     * pressed, which is what a reader would do, and the answer under it is the
     * product's own. It is worth the two lines because an unused tester is a
     * box with a placeholder in it - and the placeholder is a Microsoft sign-in
     * URL, which on a page whose every other row says `northwind.example` reads
     * as a stray from a different manual.
     *
     * The address is a real one that matches none of the rules, and both halves
     * of that are deliberate. A `northwind.example` address is what the rules
     * are written against, and it was tried first - but the tester answers with
     * what a real request would do, and the first thing a real request does is
     * resolve the host. `northwind.example` is a reserved name that resolves
     * nowhere, so the card answered "Goes through Vendor APIs" and then, in
     * red, that the address is refused before any rule is consulted. Both
     * sentences are true and the pair is a picture of something being wrong.
     *
     * So it asks about somewhere this installation really does call, and gets
     * the answer most addresses get: no rule matched, so it goes out directly.
     * That is the sentence a reader most needs to recognise.
     */
    prepare: async (page) => {
      const box = 'input[aria-label="An address to test against the rules"]';
      await page.fill(box, 'https://slack.com/api/chat.postMessage');
      await page.click('button:has-text("Check")');
      await page.waitForTimeout(1500);
    },
  },
  { name: 'shell', path: '/admin/shell' },
  { name: 'monitoring', path: '/admin/monitoring' },
  { name: 'admin-settings', path: '/admin/settings' },
  // By a setting rather than by the page having text in it: this one lays its
  // content out beside `main` rather than inside it, so the default wait never
  // sees anything and times out on a page that was ready immediately.
  { name: 'preferences', path: '/preferences', waitFor: '#palette-shortcut' },
].filter(Boolean);

/**
 * One string, gone, on whatever page happens to be showing it.
 *
 * Run before *every* screenshot rather than before one, for the two things this
 * installation knows that the manual must not: the provider's real address and
 * the address of whoever took the pictures. The `redact` hooks above each know
 * which page they are for; this cannot, because both of these turn up in places
 * nobody would go looking - a chat that says which provider answered, a check's
 * message on the doctor page, a profile field on a preferences screen, an error
 * a page kept from an earlier attempt. A per-page list would have to be right
 * about all of them forever, and being wrong once means publishing somebody's
 * home network or somebody's mailbox.
 *
 * Text nodes and field values both. The models list draws the endpoint as text;
 * the provider's own page draws it in an input, where a text-node walk finds
 * nothing at all - which is exactly the sort of half-done job this replaces.
 */
function hideEverywhere({ real, shown }) {
  if (real === '' || real === shown) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeValue?.includes(real)) node.nodeValue = node.nodeValue.split(real).join(shown);
  }
  for (const field of document.querySelectorAll('input, textarea')) {
    if (field.value?.includes(real)) field.value = field.value.split(real).join(shown);
    const placeholder = field.getAttribute('placeholder');
    if (placeholder?.includes(real)) field.setAttribute('placeholder', placeholder.split(real).join(shown));
  }
}

/**
 * Everybody else's workspaces, renamed in the corner's picker.
 *
 * The second thing that runs before every screenshot, and for the same reason
 * the first one does: the picker is on every screen, including the admin
 * section and the docs, and it names whichever workspace was last open. On the
 * machine these are taken on that is somebody's real work, and it sat above an
 * admin list whose rows had just been given invented names - so the one
 * picture contradicted itself and leaked what the redaction underneath it was
 * hiding.
 *
 * The whole list is renamed rather than only the selected option: the select is
 * a real one, and its options are in the page whether or not it is open.
 */
function hideOtherWorkspaces({ keep, invented }) {
  const picker = document.querySelector('select[aria-label="Selected workspace"]');
  if (picker === null) return;
  const options = [...picker.options];
  const others = options
    .map((option) => option.textContent?.trim() ?? '')
    .filter((name) => name !== keep)
    .sort();
  for (const option of options) {
    const was = option.textContent?.trim() ?? '';
    if (was === keep) continue;
    option.textContent = invented[others.indexOf(was)]?.[0] ?? 'Another workspace';
  }
}

/*
 * `ORKNUX_ONLY=doctor,chat` takes just those, for when one page has changed and
 * rewriting thirty other files would be noise in the diff.
 */
const only = (process.env.ORKNUX_ONLY ?? '').split(',').map((name) => name.trim()).filter(Boolean);
const CHOSEN = only.length === 0 ? SHOTS : SHOTS.filter((shot) => only.includes(shot.name));
/*
 * Two shots are not in the list: `sign-in`, which is taken before anybody is
 * signed in, and `notifications`, which is taken as somebody else. Both are
 * still nameable here.
 */
const APART = ['sign-in', 'notifications'];
if (only.length > 0 && CHOSEN.length === 0 && !only.some((name) => APART.includes(name))) {
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

    /*
     * The two things in the frame that arrive after the page does.
     *
     * The workspace picker in the corner is drawn only once the list of
     * workspaces has been fetched - it is a select with nothing to select until
     * then, so it renders as nothing at all. The AI button is the same: it
     * appears once the workspace's settings say a model has been chosen for it.
     * Neither is part of the page being photographed, which is exactly why they
     * were missed: every `waitFor` above asks about the content, and the
     * chrome around it filled in a moment later. Half the set shipped without a
     * picker while the manual's prose described one.
     *
     * Warned about rather than failed on. Some workspace pages legitimately
     * have no AI button - a workspace with no quick chat model - and losing a
     * good picture of a page over a missing corner is the wrong trade.
     */
    if (shot.path.startsWith('/workspace/')) {
      for (const corner of ['select[aria-label="Selected workspace"]', 'button[aria-label="Ask about this page"]']) {
        try {
          await page.waitForSelector(corner, { timeout: 10_000 });
        } catch {
          console.warn(`  ${shot.name}: ${corner} never arrived`);
        }
      }
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
    if (shot.redact) await page.evaluate(shot.redact, shot.redactWith);
    await page.evaluate(hideEverywhere, { real: REAL_ENDPOINT, shown: SHOWN_ENDPOINT });
    await page.evaluate(hideEverywhere, { real: REAL_EMAIL, shown: SHOWN_EMAIL });
    await page.evaluate(hideOtherWorkspaces, { keep: WORKSPACE_NAME, invented: INVENTED_WORKSPACES });
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

/*
 * The bell, photographed as the colleague rather than as the owner of this
 * machine (issue #114 made this necessary).
 *
 * The panel shows what happened rather than only what is unread, which is the
 * whole point of it - and on a development installation what happened includes
 * the real tracker somebody keeps here. The guard below still refuses anything
 * from outside the demonstration workspace; signing in as the colleague is what
 * makes that guard pass honestly instead of by emptying somebody's bell.
 */
if (only.length === 0 || only.includes('notifications')) {
  const colleagueContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const signedInAs = await colleagueContext.request.post(`${BASE}/api/session`, {
    data: { username: COLLEAGUE, password: process.env.ORKNUX_DEMO_COLLEAGUE_PASSWORD ?? 'demo-password' },
  });
  if (!signedInAs.ok()) {
    console.warn(`  notifications: could not sign in as ${COLLEAGUE}, so the bell was not photographed`);
    failures += 1;
  } else {
    const bell = await colleagueContext.newPage();
    await bell.goto(`${BASE}/workspace/${ws}/issues`, { waitUntil: 'domcontentloaded' });
    await bell.waitForSelector('main', { timeout: 15_000 });
    await bell.waitForTimeout(600);
    try {
      await bell.route('**/graphql', async (route) => {
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
      await bell.click('button[aria-label^="Notifications"]');
      // The panel appears before its contents do, so the wait is for a row.
      const rows = 'div[role="dialog"][aria-label="Notifications"] a';
      try {
        await bell.waitForSelector(rows, { timeout: 10_000 });
      } catch {
        /*
         * Nothing waiting. Not a failure - the panel is still the panel - but
         * it is a picture of an empty box, so it is said out loud rather than
         * quietly shipped as documentation of the feature.
         */
        console.warn('  notifications: nothing is waiting, so the panel is empty');
      }
      await bell.waitForTimeout(400);

      /*
       * And the one check in this file that stops a picture being taken.
       *
       * The bell is not a workspace's. It lists what is waiting for whoever is
       * signed in, across every workspace they can see - so on the machine that
       * takes these pictures it can hold the titles of somebody's real issues,
       * from a tracker that has nothing to do with the demonstration. Every
       * other page here is reached by a path with the demo workspace's id in
       * it; this one is the exception, and it is the exception on the page most
       * likely to be full of sentences somebody wrote about their own work.
       *
       * Each row links to the issue it is about, so the workspace it belongs to
       * is in the link. If any of them is from somewhere else the shot fails
       * and is reported, rather than being written and looked at later.
       */
      const strays = await bell.evaluate((prefix) => {
        const links = [...document.querySelectorAll('div[role="dialog"][aria-label="Notifications"] a')];
        return links.map((link) => link.getAttribute('href') ?? '').filter((href) => !href.startsWith(prefix));
      }, `/workspace/${ws}/`);
      if (strays.length > 0) {
        throw new Error(
          `the bell is holding ${strays.length} notification(s) from outside ${WORKSPACE_NAME} — ` +
              'they belong to whoever uses this installation, so this is not a picture that can be published',
        );
      }
      await bell.evaluate(hideEverywhere, { real: REAL_ENDPOINT, shown: SHOWN_ENDPOINT });
      await bell.evaluate(hideEverywhere, { real: REAL_EMAIL, shown: SHOWN_EMAIL });
      await bell.screenshot({ path: `${OUT}notifications.png` });
      console.log('notifications');
      taken += 1;
    } catch (refused) {
      console.warn(`  notifications: ${refused.message}`);
      failures += 1;
    }
  }
  await colleagueContext.close();
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} could not be taken; ${taken} written.`);
  process.exit(1);
}
console.log(`\n${taken} written to public/screens/`);
