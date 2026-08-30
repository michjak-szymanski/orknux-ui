/**
 * The task page's refresh interval, and what it must not disturb.
 *
 * The page is a session view: steps arrive on a stream as they are recorded, and
 * for as long as that stream is up nothing here needs a timer. What it cannot
 * survive is the stream stopping without saying so — a proxy that idles a
 * connection out, a laptop that slept — because from the reader's side that
 * looks exactly like a model thinking for four minutes. So the same interval
 * control the run and audit screens carry is offered here, defaulting to Off.
 *
 * Three things, and the third is the one this check exists for:
 *
 *   - **Off is off.** A control that defaults to a number is a query every five
 *     seconds for every task page anybody leaves open, forever.
 *   - **A chosen interval actually asks.** Counted at the wire, not inferred
 *     from the control having changed.
 *   - **And it does not reopen the stream.** The obvious wiring — point the
 *     timer at the page's own loader — raises the loading flag, and the effect
 *     that follows the task is keyed on that flag: so every tick tears the
 *     connection down and opens another, which is the one shape worse than
 *     polling. Nothing on screen shows it. The only way to see it is to count
 *     the requests to `/api/tasks/{id}/stream`, which is what happens below.
 *
 * The task is fabricated in the browser, as `task-picture-check` fabricates its
 * own and for the same reason: a task that is genuinely running needs a model
 * that answers, and what is being checked here is one screen's behaviour given
 * one answer. The stream is answered too, with a single `end` frame, so the
 * page opens exactly one and a second one can only come from a reconnect.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

/** The task the page is given, and the session it is told to follow. */
const TASK = '99999903';
const SESSION = '99999904';

/** Long enough for two ticks at five seconds, with room for a slow one. */
const WATCH_MS = 13_000;

/** A task in the one state that has anything left to refresh. */
const task = {
  id: TASK,
  workspaceId: WORKSPACE,
  title: 'Reconcile the ledger',
  prompt: 'Work through the ledger and report what does not add up.',
  agentId: null,
  agentName: 'Bookkeeper',
  modelId: null,
  status: 'RUNNING',
  sessionId: SESSION,
  issueId: null,
  createdBy: 'alice',
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  finishedAt: null,
  turnsSpent: 3,
  turnsAllowed: 40,
  workedSeconds: 91,
  secondsAllowed: 7200,
  waitingUntil: null,
  outcome: null,
  endedBecause: null,
  requests: [],
  grants: [],
  // Never null: the page counts what has not been read without asking first.
  messages: [],
};

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

/** How often the page has asked for the task, and how often it has opened a stream. */
let asked = 0;
let streams = 0;

await page.route('**/graphql', async (route) => {
  const body = route.request().postData() ?? '';
  if (body.includes('task(id: $id)')) {
    asked += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { task } }),
    });
  }
  if (body.includes('llmSessionEvents')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { llmSessionEvents: { content: [], page: 0, size: 200, totalElements: 0, totalPages: 0 } },
      }),
    });
  }
  // Everything else on the page - who is signed in, the workspace, the sidebar
  // - is the real installation's answer.
  return route.continue();
});

/*
 * One frame and a close. A stream that stayed open would answer the third
 * assertion by accident: the page would never have reason to open a second one
 * whatever the timer did to the loading flag.
 */
await page.route('**/api/tasks/*/stream*', async (route) => {
  streams += 1;
  return route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: 'event: end\ndata: {}\n\n',
  });
});

await page.goto(`${BASE}/workspace/${WORKSPACE}/tasks/${TASK}`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the task page'))) await finish(browser);

const control = page.locator('select[aria-label="Refresh automatically"]');
await control.waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(1200);

record(await control.isVisible(), 'a task still being worked on offers an interval to refresh at');
record(
  (await control.inputValue()) === '0',
  `and it is Off until somebody chooses otherwise (it reads "${await control.inputValue()}")`,
);

/* ------------------------------------------------------------------ off is off */

const settled = asked;
const opened = streams;
await page.waitForTimeout(6000);
record(
  asked === settled,
  `left at Off it asks for nothing on a timer (${asked - settled} queries in six seconds)`,
);

/* ------------------------------------------------------- and a chosen one asks */

await control.selectOption('5');
await page.waitForTimeout(WATCH_MS);

const ticks = asked - settled;
record(ticks >= 2, `at five seconds it asks again on the clock (${ticks} queries in ${WATCH_MS / 1000}s)`);

/*
 * The assertion this file is for. One stream was opened when the page loaded and
 * one is all there should ever be: the timer asks the page's two queries beside
 * the connection rather than through the loader that owns it.
 */
record(
  streams === opened,
  `and refreshing does not tear the stream down and open another (${streams - opened} extra, ${streams} in total)`,
);

await page.screenshot({ path: shot('task-refresh.png') });

/* ------------------------------------------------- and not on a finished task */

/*
 * A task that is over cannot change again, so offering to ask about it every
 * five seconds is a control that only costs. The same page, the same interval
 * still chosen - so what is measured is the status and nothing else.
 */
task.status = 'DONE';
task.finishedAt = new Date().toISOString();
task.outcome = 'The ledger balances; two entries were dated a month out.';

await page.reload({ waitUntil: 'domcontentloaded' });
await drawn(page, 'the finished task page');
await page.waitForTimeout(1500);

record(
  (await control.count()) === 0,
  'a task that has finished is not offered an interval, having nothing left to say',
);

const afterwards = asked;
await page.waitForTimeout(6000);
record(
  asked === afterwards,
  `and is not asked about on the timer either (${asked - afterwards} queries in six seconds)`,
);

// Off again. The choice is kept in the browser and shared by every screen that
// offers it, so a check that leaves it set has changed the next one's world.
await page.evaluate(() => window.localStorage.removeItem('orknux.refreshSeconds'));

await finish(browser);
