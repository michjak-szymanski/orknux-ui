/**
 * A task watched while it runs, and the page keeping up with it on its own.
 *
 * The point of this check is the word *while*. Reading a finished task's log
 * proves nothing about a live view - the old page did that perfectly, one
 * refresh at a time - so what is asserted here is that lines the page did not
 * have when it was drawn were on it afterwards, with nothing having reloaded and
 * nothing having polled.
 *
 * **How it can prove that without a model.** Three things make it airtight:
 *
 *   1. There is no refresh control on the page any more, and this asserts that
 *      too. If a poll comes back, this check starts lying, so it also checks
 *      that it cannot.
 *   2. A marker is put on `window` after the page settles. A reload would take
 *      it away, so its survival is proof that nothing navigated.
 *   3. The count of lines the page had drawn is read *before* the task ends and
 *      compared with what it holds afterwards. Only the stream can have put the
 *      difference there.
 *
 * One thing is retried, and it is the fixture rather than an assertion: a model
 * pointed at `.invalid` can fail before the page has finished drawing, and a
 * task that was already over is a task there was nothing live to see. So it
 * starts another, up to four times, and fails saying so if it never catches one
 * running. Every assertion below is made once, on the task that was.
 *
 * And it does not need a model that answers, for the reason `task-check` gives:
 * the prompt is written into the task's log before the model is asked, and a
 * model that never answers is recorded as a note saying so. So the session gets
 * lines either way - a question, a note about the model, a note about the ending
 * - and they arrive over the stream one at a time exactly as an agent's would.
 * The model it makes points at `.invalid`, which by definition cannot resolve,
 * so nothing here touches a network.
 *
 * The second half opens the finished task in a *new* page, which is the other
 * half of the promise: somebody arriving after the fact must get the same
 * account without the streaming. Same lines, same order, from the same record.
 */
import { BASE, WORKSPACE, open, check, record, shot, finish } from './suite/harness.mjs';

const stamp = Date.now();
const PROVIDER = `zzScratchLiveProvider${stamp}`;
const MODEL = `zzScratchLiveModel${stamp}`;
const PROMPT = `zz Scratch Live Task ${stamp} - look at something and report back`;

const { browser, context, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/*
 * Anything an earlier run left behind. Swept at the start rather than guarded at
 * the end, because a `finally` cannot clean up after the suite's own timeout.
 */
const before = await graphql(
  `query ($workspaceId: ID!) {
     workspaceTasks(workspaceId: $workspaceId, page: 0, size: 200) { content { id title status } }
     modelProviders(workspaceId: $workspaceId) { id name }
   }`,
  { workspaceId: WORKSPACE },
);
for (const old of before.workspaceTasks.content.filter((row) => row.title.startsWith('zz Scratch Live Task'))) {
  if (!['DONE', 'FAILED', 'STOPPED'].includes(old.status)) {
    await graphql(`mutation ($id: ID!) { stopTask(id: $id) { id } }`, { id: old.id }).catch(() => undefined);
  }
  await graphql(`mutation ($id: ID!) { deleteTask(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept task ${old.title} (#${old.id}) from an earlier run`);
}
for (const old of before.modelProviders.filter((row) => row.name.startsWith('zzScratchLiveProvider'))) {
  await graphql(`mutation ($id: ID!) { removeModelProvider(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept provider ${old.name} (#${old.id}) from an earlier run`);
}

// A model that cannot answer, which is all this check needs one to be.
const provider = (
  await graphql(`mutation ($input: CreateModelProviderInput!) { createModelProvider(input: $input) { id } }`, {
    input: {
      workspaceId: WORKSPACE,
      name: PROVIDER,
      endpoint: 'http://nowhere.invalid',
      secret: 'sk-scratch',
    },
  })
).createModelProvider;
const model = (
  await graphql(`mutation ($input: CreateModelInput!) { createModel(input: $input) { id } }`, {
    input: { providerId: provider.id, name: MODEL, modelId: 'scratch', kind: 'CHAT' },
  })
).createModel;
console.log(`made ${MODEL} (#${model.id}) for the task to be given`);

// --- start it from the page, so the page is open while it works -------------

const OVER = ['Done', 'Failed', 'Stopped'];
const lines = () => page.locator('[data-testid="task-log"] [data-kind]').count();
const stateNow = () => page.locator('[data-testid="task-state"]').innerText();

/** Starts one from the page and lands on it, the way a person does. */
async function startFromThePage() {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1:text("Tasks")', { timeout: 20_000 });
  await page.locator('#task-prompt').fill(PROMPT);
  await page.locator('#task-worker').selectOption(`model:${model.id}`);
  await page.locator('button:text("Start")').click();
  await page.waitForURL(/\/tasks\/\d+$/, { timeout: 20_000 });
  const id = page.url().split('/').pop();
  await page.waitForSelector('[data-testid="task-log"]', { timeout: 20_000 });
  return id;
}

/*
 * Catching it while it is still going, which is a race against the fixture and
 * not against the feature.
 *
 * A model pointed at `.invalid` fails as fast as the machine can decide that
 * `.invalid` does not resolve, and on a fast one that can be sooner than a React
 * route change and two queries. So the task may already be over by the time the
 * page draws - which says nothing about whether the page is live, only that
 * there was nothing left to be live about.
 *
 * Retried rather than slept through, and retried in the *setup* rather than in
 * any assertion: what is being repeated is "make me a task that is still
 * running", and every assertion below is made exactly once, on the task that
 * was. A check that retried its assertions would be a check that passes on the
 * third try, which is worse than one that fails.
 */
const ATTEMPTS = 4;
let taskId = null;
let drawnWhileGoing = 0;
let stateWhileGoing = '';

/**
 * What the page held the moment it was drawn, and never touched again.
 *
 * The growth assertion used to be made against `drawnWhileGoing`, which the
 * watching loop overwrites every quarter second - so what it actually asserted
 * was that a line landed in the last 250ms before the ending, which is a
 * quarter-second window this check has no way to aim at. It passes or fails on
 * where the ending happened to fall between two polls of the browser, and both
 * outcomes say nothing about the stream.
 *
 * This one is the reading taken before any of it, so the comparison is "the
 * page has more on it than it was drawn with" - which is the claim, and is not
 * a race.
 */
let drawnAtFirst = 0;

/**
 * Whether a line landed while the task was still going, seen while it still
 * was.
 *
 * The assertion actually worth having, and the one the brief for this page
 * asks for: reading a finished task's log proves nothing, and even growth
 * measured after the ending could in principle be the last frames of a task
 * that had already stopped. This is set inside the loop, on a page whose state
 * still reads as running, so it can only have been put there by the stream
 * mid-task.
 */
let grewWhileGoing = false;

for (let attempt = 1; attempt <= ATTEMPTS && taskId === null; attempt += 1) {
  const started = await startFromThePage();
  const state = (await stateNow()).trim();

  if (OVER.includes(state)) {
    console.log(`task #${started} was already "${state}" when the page drew; starting another`);
    await graphql(`mutation ($id: ID!) { deleteTask(id: $id) }`, { id: started }).catch(() => undefined);
    continue;
  }

  taskId = started;
  stateWhileGoing = state;
  drawnWhileGoing = await lines();
  drawnAtFirst = drawnWhileGoing;
  console.log(`watching task #${taskId}, which reads "${state}" with ${drawnWhileGoing} line(s) drawn`);
}

check(
  taskId !== null,
  `the page was open on a task that was still going: "${stateWhileGoing}"`,
  `every one of ${ATTEMPTS} tasks was already over by the time the page drew, so nothing here watched one run`,
);
if (taskId === null) await finish(browser);

/*
 * The marker. Anything that navigates takes it with it, so every assertion after
 * this one is also an assertion that the page never reloaded.
 */
await page.evaluate(() => {
  window.__orknuxNeverReloaded = true;
});

// --- there is no refresh control, and that matters ---------------------------

/*
 * Asserted rather than assumed. If an AutoRefresh came back, the growth this
 * check measures below could be a poll rather than the stream, and the check
 * would go on passing while testing nothing - which is the failure mode the
 * whole suite is written against.
 */
const refreshers = await page.locator('select[aria-label="Refresh automatically"]').count();
check(
  refreshers === 0,
  'the page has no refresh control, so nothing on it can be arriving by poll',
  'a refresh control is on the page, and anything arriving could be a poll rather than the stream',
);

/*
 * Keep looking until it is over, and keep the last reading taken while it was
 * not. Reading the browser only - no reload, no navigation, no GraphQL - so the
 * only thing that can move these numbers is the stream.
 */
let ended = null;
for (let look = 0; look < 120 && ended === null; look += 1) {
  const state = (await stateNow()).trim();
  if (OVER.includes(state)) {
    ended = state;
    break;
  }
  stateWhileGoing = state;
  drawnWhileGoing = await lines();
  /*
   * Noted here, inside the branch where the state still reads as running. That
   * is what makes it "while": the page says the task has not finished and the
   * page already holds more than it was drawn with, so a line arrived mid-task
   * over the stream.
   */
  if (drawnWhileGoing > drawnAtFirst) grewWhileGoing = true;
  await page.waitForTimeout(250);
}

check(
  ended !== null,
  `the page reached the ending on its own: "${ended}"`,
  'the page never showed the task ending, having neither been reloaded nor polled',
);

const drawnAtEnd = await lines();

/*
 * The assertion this check exists for.
 *
 * Not "the page ended up with more lines than it started with", which a task
 * that delivered everything in its dying moment would also satisfy - but that
 * a line was on the page at a moment when the page still said the task was
 * running. Read from the browser only, on a page that has not reloaded and has
 * no refresh control, so the stream is the only thing that can have put it
 * there.
 */
check(
  grewWhileGoing,
  `a line arrived on the open page while the task was still running: ${drawnAtFirst} drawn, then more before it ended`,
  `nothing arrived while the task was running: the page held ${drawnAtFirst} lines throughout and only changed once it was over`,
);

check(
  drawnAtEnd > drawnAtFirst,
  `and the page grew without being touched: ${drawnAtFirst} when drawn, ${drawnAtEnd} at the end`,
  `the page never grew: it held ${drawnAtFirst} lines when drawn and ${drawnAtEnd} at the end`,
);

/*
 * And none of it was a reload. This is the assertion the three above lean on:
 * without it "the page changed" could always have been "the page was rebuilt".
 */
const marker = await page.evaluate(() => window.__orknuxNeverReloaded === true);
check(
  marker,
  'the page never reloaded, so what appeared on it was streamed onto it',
  'the page reloaded at some point, so nothing above says anything about streaming',
);

/*
 * The page says so, too. A screen that promises what is on it is what is
 * happening has to be honest about having stopped, and a finished task is the
 * one case where "live" would be a lie for ever.
 */
const watching = (await page.locator('[data-testid="task-watching"]').innerText()).trim();
check(
  watching === 'Finished',
  'a finished task says it is finished rather than going on claiming to be live',
  `the page still says "${watching}" on a task that has ended`,
);

await page.screenshot({ path: shot('task-live-check.png'), fullPage: true });

// --- and it reads the same after the fact ------------------------------------

/*
 * A page that never saw any of it happen. Everything the first one was handed a
 * line at a time is in the session, so this must hold the same account - which
 * is the whole reason the stream relays a durable log rather than carrying the
 * work itself.
 */
const later = await context.newPage();
await later.goto(`${BASE}/workspace/${WORKSPACE}/tasks/${taskId}`, { waitUntil: 'domcontentloaded' });
await later.waitForSelector('[data-testid="task-log"]', { timeout: 20_000 });
const drawnLater = await later.locator('[data-testid="task-log"] [data-kind]').count();

check(
  drawnLater === drawnAtEnd,
  `a page opened after the fact shows the same ${drawnLater} lines, without having streamed any of them`,
  `the page that watched it holds ${drawnAtEnd} lines and one opened afterwards holds ${drawnLater}`,
);

const laterHasPrompt = (await later.locator(`[data-testid="task-log"] :text("${PROMPT}")`).count()) > 0;
record(laterHasPrompt, 'and it is the same account: what was asked is on it');

const laterState = (await later.locator('[data-testid="task-state"]').innerText()).trim();
check(
  laterState === ended,
  `and the same ending: "${laterState}"`,
  `the ending reads "${laterState}" after the fact and read "${ended}" live`,
);

await later.close();

// --- put it back the way it was ---------------------------------------------

await graphql(`mutation ($id: ID!) { deleteTask(id: $id) }`, { id: taskId }).catch(() => undefined);
await graphql(`mutation ($id: ID!) { removeModelProvider(id: $id) }`, { id: provider.id }).catch(() => undefined);

await finish(browser);
