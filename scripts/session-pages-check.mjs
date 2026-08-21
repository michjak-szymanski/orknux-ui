/**
 * The Sessions list and one session's transcript - issue #158.
 *
 * #119 built both pages and nothing in `suite.mjs` opened either of them.
 * `screenshots.mjs` photographs them for the manual, which is why they looked
 * covered: a picture says a page rendered on somebody's machine once, not that
 * the search still searches. Every control on these two screens is of the kind
 * that breaks quietly - a filter that has stopped filtering still draws a list,
 * and a sort that has stopped sorting still draws it in some order.
 *
 * So what is measured is narrowing and reordering rather than presence:
 *
 *   the list, searched      - the rows go down, they are the right rows, and
 *                             clearing the box brings the others back. A search
 *                             matching nothing says so rather than showing all
 *   the four-way kind chip  - each of User / Agent / Tool / System leaves only
 *                             lines of that kind, and the kinds this transcript
 *                             has none of leave none
 *   the transcript searched - matched against who spoke as well as what was said
 *   Time and Kind           - the drawn order changes, and each order is the one
 *                             the server was asked for rather than merely
 *                             different
 *   two presses to remove   - see below
 *
 * The delete is the assertion this check exists for, so it is not read off the
 * screen. A page that navigated away, drew an empty list and left the row in the
 * database would satisfy anything read from the browser. Between the first press
 * and the second the *server* is asked whether the session is still there, over
 * the check's own login rather than the page's - which is also why the question
 * cannot be asked by clicking anything: the button disarms on blur, so touching
 * the page between the two presses is the one thing that would turn the second
 * press into a first press and make this drill a pantomime.
 *
 * ---------------------------------------------------------------------------
 * Why the fixture is a workflow run
 *
 * There is no mutation that makes a session and there should not be: a session
 * exists because an agent node carrying a `sessionKey` ran, and the page says so
 * in its own empty state. So this builds one the only way there is - a scratch
 * workflow of a session node wired to an agent, run twice under one key and once
 * under another - and removes the sessions and the workflow afterwards.
 *
 * It does not need a model that answers. The question is written into the
 * session before the model is asked, and an answer that never comes is recorded
 * as a system note, so the transcript holds two kinds either way: USER and AGENT
 * where a model answered, USER and SYSTEM where none could be reached. Nothing
 * below is written against which of the two it got - the kinds are read back off
 * the server and every assertion is made against what is actually there, which
 * is what lets one check say the same thing on a developer's machine and in CI.
 *
 * What it cannot sweep is the three executions the runs leave. There is no
 * mutation that removes one and `removeWorkflow` leaves them behind, so they
 * stay: runs of a workflow that no longer exists, on no list of it.
 * ---------------------------------------------------------------------------
 */
import { BASE, WORKSPACE, open, record, drawn, shot, finish } from './suite/harness.mjs';
import { anyOf } from './suite/named.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const STAMP = Date.now();
const PREFIX = 'zzSession158';

/** What the transcript's questions are asked under, and so what searching finds. */
const ASKED_BY = `${PREFIX} asks`;

/** What each kind is called in the badge, which is all the page ever draws. */
const KIND_LABEL = { AGENT: 'Agent', TOOL: 'Tool', USER: 'User', SYSTEM: 'System' };

/** The server's word for a badge, which is what the page has to be held against. */
const kindOf = (label) => Object.keys(KIND_LABEL).find((one) => KIND_LABEL[one] === label);

/*
 * Anything a run that died halfway through left behind. Swept at the start
 * rather than only at the end, because the sweep also cleans up after the runs
 * the suite's timeout killed, which no `finally` can.
 */
async function sweep() {
  const left = await graphql(
    `query($id: ID!) {
       llmSessions(workspaceId: $id, page: 0, size: 200) { content { id key } }
       workspaceWorkflows(workspaceId: $id, page: 0, size: 200) { content { id name } }
     }`,
    { id: WORKSPACE },
  );
  for (const old of left.llmSessions.content.filter((one) => one.key.includes(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeLlmSession(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept session ${old.key} (#${old.id})`);
  }
  for (const old of left.workspaceWorkflows.content.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept workflow ${old.name} (#${old.id})`);
  }
}

await sweep();

/*
 * Any agent that is switched on and has a model chosen.
 *
 * There is no particular agent this check is about: it never opens one and never
 * edits one, it only points a node at whichever the workspace has - because an
 * agent node with no model fails before it ever opens the session. So it names
 * none and takes the first that fits, which is what `anyOf` is for, and it asks
 * for it by that rather than by an id so a workspace built from nothing works
 * the same as the one this was written on.
 */
const AGENT = await anyOf(graphql, 'agent', WORKSPACE, null, {
  override: process.env.ORKNUX_AGENT,
  fits: async (row) => {
    const found = await graphql(`query($id: ID!) { agent(id: $id) { enabled modelId } }`, { id: row.id });
    return found.agent?.enabled === true && found.agent?.modelId !== null;
  },
});
if (AGENT === null) {
  record(false, 'no agent here is switched on with a model chosen, so no run can open a session');
  await finish(browser);
}

const WORKFLOW_NAME = `${PREFIX} ${STAMP}`;
const made = await graphql(`mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id name } }`, {
  input: {
    workspaceId: WORKSPACE,
    name: WORKFLOW_NAME,
    description: 'Made by scripts/session-pages-check.mjs to open a session, and removed again after.',
  },
});
const WORKFLOW = made.createWorkflow.id;
console.log(`made workflow ${WORKFLOW_NAME} (#${WORKFLOW}) around agent #${AGENT}`);

/*
 * A session node wired to an agent, and nothing else in the graph.
 *
 * The key is a reference rather than a literal so that one workflow can open two
 * conversations: what is handed to `startExecution` decides which. The validator
 * warns that the agent has nothing before it - correct advice about a *triggered*
 * run, and deliberately so; a run started by hand begins at every root, which is
 * why this one reaches it. Printed rather than ignored, so that a graph refused
 * for some other reason one day says so here instead of further down.
 */
const graph = await graphql(
  `mutation($ws: ID!, $id: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $ws, workflowId: $id, input: $input) { workflowId problems { message } }
   }`,
  {
    ws: WORKSPACE,
    id: WORKFLOW,
    input: {
      nodes: [
        {
          key: 'session',
          kind: 'SESSION',
          name: 'the conversation this belongs to',
          x: 40,
          y: 40,
          mappings: [
            { name: 'sessionKeyPrefix', expression: PREFIX, mode: 'VALUE' },
            { name: 'sessionKey', expression: 'trigger.about', mode: 'REFERENCE' },
          ],
        },
        {
          key: 'agent',
          kind: 'AGENT',
          /*
           * The node's name is what every question in the transcript is recorded
           * under, and the agent's own name is what every answer is recorded
           * under - which is what makes searching the transcript for this find
           * the questions and nothing else, whether the answers came from a model
           * or from the note left when none could be reached.
           */
          name: ASKED_BY,
          agentId: AGENT,
          outputName: 'said',
          x: 420,
          y: 40,
          mappings: [{ name: 'prompt', expression: 'Say hello.', mode: 'VALUE' }],
        },
      ],
      edges: [{ source: 'session', target: 'agent' }],
    },
  },
);
console.log(`graph: ${graph.saveWorkflowGraph.problems.map((one) => one.message).join('; ') || 'no problems'}`);
await graphql(`mutation($ws: ID!, $id: ID!) { publishWorkflow(workspaceId: $ws, workflowId: $id) { status } }`, {
  ws: WORKSPACE,
  id: WORKFLOW,
});

/** One run, waited out. Hands back how it ended, so a fixture that failed says so. */
async function runIt(about, patience = 120_000) {
  const { startExecution } = await graphql(
    `mutation($ws: ID!, $id: ID!, $input: String) {
       startExecution(workspaceId: $ws, workflowId: $id, input: $input) { id status }
     }`,
    { ws: WORKSPACE, id: WORKFLOW, input: JSON.stringify({ about }) },
  );
  const upTo = Date.now() + patience;
  let status = startExecution.status;
  while (status === 'RUNNING' && Date.now() < upTo) {
    await page.waitForTimeout(1000);
    const asked = await graphql(`query($id: ID!) { execution(id: $id) { status } }`, { id: startExecution.id }).catch(
      () => null,
    );
    if (asked !== null) status = asked.execution.status;
  }
  return status;
}

/*
 * Two conversations, so that searching the list has something to narrow away
 * from, and two turns in the first, so that Kind and Time are two different
 * orders rather than one order asked for twice.
 */
const KEY_READ = `read-${STAMP}`;
const KEY_GONE = `gone-${STAMP}`;
console.log(`run 1 of ${KEY_READ}: ${await runIt(KEY_READ)}`);
console.log(`run 2 of ${KEY_READ}: ${await runIt(KEY_READ)}`);
console.log(`run 1 of ${KEY_GONE}: ${await runIt(KEY_GONE)}`);

const { llmSessions } = await graphql(
  `query($id: ID!) { llmSessions(workspaceId: $id, page: 0, size: 200) { content { id key eventCount } } }`,
  { id: WORKSPACE },
);
const read = llmSessions.content.find((one) => one.key.endsWith(KEY_READ)) ?? null;
const gone = llmSessions.content.find((one) => one.key.endsWith(KEY_GONE)) ?? null;

if (read === null || gone === null) {
  record(
    false,
    'the runs opened no session, so there is nothing to read. The workspace holds: ' +
      `${llmSessions.content.map((one) => one.key).join(', ') || '(nothing)'}`,
  );
  await graphql(`mutation($id: ID!) { removeWorkflow(id: $id) }`, { id: WORKFLOW }).catch(() => undefined);
  await finish(browser);
}
console.log(`opened ${read.key} (#${read.id}, ${read.eventCount} lines) and ${gone.key} (#${gone.id}, ${gone.eventCount} lines)`);

/* --------------------------------------------------- what the server holds */

/** One transcript, as the server orders it. The ruler every drawn order is held to. */
async function transcript(ordering = '') {
  const answered = await graphql(
    `query($id: ID!) {
       llmSessionEvents(sessionId: $id, page: 0, size: 200${ordering}) {
         totalElements
         content { id kind actor at }
       }
     }`,
    { id: read.id },
  );
  return answered.llmSessionEvents;
}

const whole = await transcript();
const byTime = await transcript(', order: AT, ascending: true');
const byKind = await transcript(', order: KIND, ascending: true');

/** How many lines of each kind this transcript actually holds. */
const heldOf = (kind) => whole.content.filter((one) => one.kind === kind).length;

/** One order written the way the page draws it, so that the two can be compared. */
const asDrawn = (rows) => rows.map((one) => `${KIND_LABEL[one.kind]}@${one.at}`);

const timeOrder = asDrawn(byTime.content);
const kindOrder = asDrawn(byKind.content);

console.log(
  `transcript: ${whole.totalElements} lines - ` +
    Object.keys(KIND_LABEL)
      .map((kind) => `${heldOf(kind)} ${kind}`)
      .join(', '),
);

/*
 * A transcript whose two orders are one order cannot show that sorting works,
 * and a check that passed on one would be measuring nothing. That is a fixture
 * that came out wrong rather than a page that is broken, and it is said as such
 * rather than left to fail as a comparison further down.
 */
record(whole.totalElements >= 2, `the fixture opened a transcript with something in it (${whole.totalElements} lines)`);
record(
  timeOrder.join('|') !== kindOrder.join('|'),
  'the fixture\'s two orders differ, so reordering is something this run can measure',
);

/* -------------------------------------------------------------- the rulers */

/** The keys drawn on the sessions list, top to bottom. */
const listedKeys = () =>
  page.$$eval(`a[href^="/workspace/${WORKSPACE}/sessions/"]`, (rows) =>
    rows.map((row) => row.querySelector('span')?.textContent?.trim() ?? ''),
  );

/** Every line the transcript is drawing: its kind, who spoke, and when. */
const drawnLines = () =>
  page.$$eval('article[class*="_event_"]', (lines) =>
    lines.map((line) => ({
      kind: line.querySelector('[class*="_kindBadge_"]')?.textContent?.trim() ?? '',
      actor: line.querySelector('[class*="_actor_"]')?.textContent?.trim() ?? '',
      /* The exact moment, which the page carries as the title of the clock. */
      at: line.querySelector('span[title]')?.getAttribute('title') ?? '',
    })),
  );

/** The drawn order, in the same words the server's answer was written in. */
const drawnOrder = async () => (await drawnLines()).map((line) => `${line.kind}@${line.at}`);

/**
 * Wait for a reading to settle on what it should be, and hand back what it
 * settled on either way.
 *
 * Polled rather than slept through: the search is debounced by three hundred
 * milliseconds and then goes to the server, so a fixed pause is either longer
 * than every run needs or shorter than one run in ten does. When the reading
 * never arrives the caller still gets the last one and fails on *that*, which is
 * a sentence about the screen rather than a timeout with nothing in it.
 *
 * Fifteen seconds, and not longer. Against the development server every request
 * here goes through vite's proxy, and a few in a thousand of those hang for
 * about thirty-five seconds - issue #163, and the note at the top of
 * `suite/run.mjs`. A window wide enough to ride one out is also a window this
 * waits out seventeen times over on a page that really is broken, and the runner
 * kills the check at four minutes and reports a hang instead of the seventeen
 * sentences. So one lone failure here is worth running again before it is
 * believed, and a failure that repeats is the page.
 */
async function settlesOn(reading, wanted, within = 15_000) {
  const upTo = Date.now() + within;
  let held = await reading();
  while (JSON.stringify(held) !== JSON.stringify(wanted) && Date.now() < upTo) {
    await page.waitForTimeout(200);
    held = await reading();
  }
  return held;
}

/* ================================================== the list, and its search */

await page.goto(`${BASE}/workspace/${WORKSPACE}/sessions`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the sessions list')) {
  const search = page.locator('input[aria-label="Search sessions"]');

  /*
   * There is nothing to settle *on* here: how many sessions this workspace holds
   * is not this check's to know, and it is different on every installation. What
   * it waits for is both of its own being drawn, and what it keeps is however
   * many rows there were when they were.
   */
  const before = await settlesOn(
    async () => {
      const rows = await listedKeys();
      return rows.includes(read.key) && rows.includes(gone.key);
    },
    true,
  ).then(listedKeys);
  record(
    before.includes(read.key) && before.includes(gone.key),
    `unsearched, the list draws both of this check's sessions (${before.length} rows: ${before.join(', ')})`,
  );

  /* ----------------------------------------------- searched down to one row */

  await search.fill(KEY_READ);
  const narrowed = await settlesOn(listedKeys, [read.key]);
  record(
    narrowed.length === 1 && narrowed[0] === read.key,
    `searched ${JSON.stringify(KEY_READ)}: one row, and it is the right one (${narrowed.join(', ') || 'nothing'})`,
  );
  record(
    narrowed.length < before.length,
    `searching narrowed the list rather than leaving it where it was (${before.length} rows to ${narrowed.length})`,
  );

  /* ------------------------- a search matching nothing empties it, and says so */

  await search.fill(`${PREFIX}-matches-nothing-${STAMP}`);
  const none = await settlesOn(listedKeys, []);
  record(none.length === 0, `a search matching nothing draws no rows (${none.length})`);
  record(
    (await page.locator('body').innerText()).includes("No session's key or prefix matches that."),
    'and says the search matched nothing, rather than that the workspace has no sessions',
  );

  /* -------------------------------------- cleared, and the others come back */

  await search.fill('');
  const again = await settlesOn(listedKeys, before);
  record(
    again.includes(read.key) && again.includes(gone.key),
    `clearing the search brings the rest back (${again.length} rows)`,
  );

  await page.screenshot({ path: shot('session-list-search.png') });

  /* -------------------------------------------- and a row leads to its session */

  await search.fill(KEY_READ);
  await settlesOn(listedKeys, [read.key]);
  await page.locator(`a[href="/workspace/${WORKSPACE}/sessions/${read.id}"]`).click();
  await page.waitForTimeout(1200);
  record(page.url().endsWith(`/sessions/${read.id}`), `pressing a row opens that session (${page.url()})`);
}

/* =========================================== the transcript, and its filter */

await page.goto(`${BASE}/workspace/${WORKSPACE}/sessions/${read.id}`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the session transcript')) {
  const all = await settlesOn(async () => (await drawnLines()).length, whole.totalElements);
  record(
    all === whole.totalElements,
    `unfiltered, every line of the transcript is drawn (${all} of ${whole.totalElements})`,
  );

  /* ---------------------------------------------------- the four-way filter */

  /*
   * All four, including the kinds this transcript has none of. A filter that has
   * stopped filtering draws the whole transcript under every chip, and only the
   * absent kinds catch that: asking for Tool and being handed the questions back
   * is unmistakable, where asking for User and being handed them back looks
   * exactly like a filter that worked.
   */
  // Asked for inside the group the filter draws itself as, rather than anywhere
  // on the page: "Agent" and "User" are words the shell around this uses too.
  const chips = page.getByRole('group', { name: 'Which kinds to show' });
  for (const label of ['User', 'Agent', 'Tool', 'System']) {
    const chip = chips.getByRole('button', { name: label, exact: true });
    const held = heldOf(kindOf(label));

    await chip.click();
    const shown = await settlesOn(async () => (await drawnLines()).length, held);
    const lines = await drawnLines();

    record(shown === held, `filtered to ${label}: ${shown} lines drawn, and the session holds ${held}`);
    record(
      lines.every((line) => line.kind === label),
      `filtered to ${label}: nothing of another kind is left ` +
        `(${[...new Set(lines.map((one) => one.kind))].join(', ') || 'nothing drawn'})`,
    );
    record((await chip.getAttribute('aria-pressed')) === 'true', `filtered to ${label}: the chip says it is on`);
    if (held === 0) {
      record(
        (await page.locator('body').innerText()).includes('Nothing in this session matches that.'),
        `filtered to ${label}, which this session has none of: it says so`,
      );
    }
    if (label === 'User') await page.screenshot({ path: shot('session-kind-filter.png') });

    // Off again, so the next kind is asked on its own rather than beside this one.
    await chip.click();
    const back = await settlesOn(async () => (await drawnLines()).length, whole.totalElements);
    record(
      (await chip.getAttribute('aria-pressed')) === 'false' && back === whole.totalElements,
      `${label} switched off again: the chip says so, and the whole transcript is back (${back} lines)`,
    );
  }

  /* ------------------------------------- searched, on who spoke as well as what */

  const asked = whole.content.filter((one) => one.actor === ASKED_BY).length;
  const transcriptSearch = page.locator('input[aria-label="Search this transcript"]');
  await transcriptSearch.fill(ASKED_BY);
  const matched = await settlesOn(async () => (await drawnLines()).length, asked);
  const matchedLines = await drawnLines();
  record(
    asked > 0 && matched === asked,
    `searching the transcript for who asked leaves the ${asked} lines it asked (${matched} drawn)`,
  );
  record(
    matched < whole.totalElements && matchedLines.every((line) => line.actor === ASKED_BY),
    'and nothing said by anybody else ' +
      `(${[...new Set(matchedLines.map((one) => one.actor))].join(', ') || 'nothing drawn'})`,
  );
  await transcriptSearch.fill('');
  await settlesOn(async () => (await drawnLines()).length, whole.totalElements);

  /* ------------------------------------------------------ Time, and then Kind */

  const order = page.locator('select#event-order');

  await order.selectOption('AT');
  const inTime = await settlesOn(drawnOrder, timeOrder);
  record(
    JSON.stringify(inTime) === JSON.stringify(timeOrder),
    `sorted by Time: drawn in the order the server was asked for (${inTime.join(' ')})`,
  );

  await order.selectOption('KIND');
  const inKind = await settlesOn(drawnOrder, kindOrder);
  record(
    JSON.stringify(inKind) === JSON.stringify(kindOrder),
    `sorted by Kind: the same (${inKind.join(' ')})`,
  );
  record(
    JSON.stringify(inKind) !== JSON.stringify(inTime),
    'and the two are not one order, so choosing between them does something',
  );

  /* -------------------------------------- and the direction switch reverses it */

  await order.selectOption('AT');
  await settlesOn(drawnOrder, timeOrder);
  const backwards = [...timeOrder].reverse();
  await page.locator('button[aria-label="Oldest first"]').click();
  const reversed = await settlesOn(drawnOrder, backwards);
  record(
    JSON.stringify(reversed) === JSON.stringify(backwards),
    `pressing the direction turns Time round (${reversed.join(' ')})`,
  );
}

/* ======================================== two presses, and only two, to remove */

/*
 * On the other session, so that what the second press removed can be told apart
 * from a page that emptied: the one this check has been reading is asked for by
 * name afterwards and is still there.
 */
await page.goto(`${BASE}/workspace/${WORKSPACE}/sessions/${gone.id}`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the session to remove')) {
  /** What the server says about a session, asked over this check's own login. */
  const onTheServer = async (id) =>
    (await graphql(`query($id: ID!) { llmSession(id: $id) { id key } }`, { id }).catch(() => ({ llmSession: null })))
      .llmSession;

  const remove = page.getByRole('button', { name: 'Remove session', exact: true });
  record((await remove.count()) === 1, 'the session offers one Remove session button');

  /* ----------------------------------------------------------- one press */

  await remove.click();
  const armed = page.getByRole('button', { name: 'Remove it, and everything said in it', exact: true });
  const asks = await armed
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  /*
   * Asserted before the one under it, and not as a nicety. "One press removed
   * nothing" is also true of a press that missed the button entirely, so a check
   * that asked only the second question would report a working confirm on a page
   * whose button had been renamed out from under it.
   */
  record(asks, 'one press arms the button rather than removing anything');

  await page.screenshot({ path: shot('session-remove-armed.png') });

  /*
   * The load-bearing line, and the reason it is a GraphQL call rather than a
   * look at the screen: a page that navigated away and drew an empty list would
   * satisfy anything read from the browser while the row sat in the database.
   *
   * Asked over `context.request`, which shares the cookie and touches nothing on
   * the page. That part is not incidental either - the button disarms on blur,
   * so anything that clicked into the page here would turn the second press into
   * a first press and this whole drill into a pantomime.
   */
  const afterOne = await onTheServer(gone.id);
  record(
    afterOne !== null && String(afterOne.id) === String(gone.id),
    `after one press the server still has ${gone.key} (${afterOne === null ? 'it is gone' : afterOne.key})`,
  );
  record(
    page.url().endsWith(`/sessions/${gone.id}`),
    `after one press the page has not gone anywhere either (${page.url()})`,
  );

  /* ---------------------------------------------------------- and a second */

  await armed.click();
  const left = await page
    .waitForURL(new RegExp(`/workspace/${WORKSPACE}/sessions$`), { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  record(left, `the second press goes back to the list (${page.url()})`);

  const afterTwo = await onTheServer(gone.id);
  record(
    afterTwo === null,
    `after two presses the server no longer has it (${afterTwo === null ? 'gone' : afterTwo.key})`,
  );

  const survived = await onTheServer(read.id);
  record(
    survived !== null,
    `and it removed that session rather than the workspace's sessions ` +
      `(${read.key} ${survived === null ? 'went with it' : 'is still there'})`,
  );
}

/* ------------------------------------------------------------------ tidy up */

await sweep();

await finish(browser);
