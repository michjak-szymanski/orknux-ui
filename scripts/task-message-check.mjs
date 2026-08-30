/**
 * Saying something to a task while it is still working, and the work changing.
 *
 * Issue #280. Until now the only way to reach a task was to answer a question it
 * had stopped to ask; anything else meant stopping it and starting a new one
 * with a better prompt. This walks the path a person walks instead: start a
 * task, watch it work, decide part-way through that the report should be a table
 * rather than prose, type that into the box on its page, and watch the agent
 * read it and finish differently.
 *
 * **The word doing the work here is *while*.** A message typed at a task that
 * has already ended proves nothing at all, so what is asserted is a claim about
 * one moment: the box was on the page, and the page said the task was working,
 * read in the same evaluate. `task-live-check` learnt that the hard way and its
 * comment is worth reading; the same reasoning is why the readings below are one
 * round trip each rather than five.
 *
 * ## Why it needs a model, and is therefore not in CI
 *
 * The same reason `task-live-check` does. A model pointed at `.invalid` fails a
 * task in forty milliseconds, so a check written against one would be typing
 * into a page that finished before it loaded - there would be no *while* to
 * aim at. `scripts/suite/message-stub.py` is a model that spends twenty-four
 * seconds on its first round and calls `task_done` on the round the message
 * reaches it, which is a window somebody can act inside. It cannot be stubbed in
 * the browser: what is being checked is that words typed into a page reach a
 * model the *server* is talking to, and a stub in the page would be a check of
 * the stub. Run it by hand:
 *
 *   python scripts/suite/message-stub.py 8199
 *   node scripts/suite/run.mjs --only task-message-check
 *
 * Where the stub is, as the *server* reaches it, goes in ORKNUX_MESSAGE_STUB.
 *
 * ## What it proves, in order
 *
 *   1. The box is on the page of a task that is working, and is not on the page
 *      of one that has ended - a box that took words nothing would ever read
 *      would be worse than no box.
 *   2. What was sent is drawn as not read yet, because it has not been: the
 *      agent reads it at the top of its next turn, and telling somebody their
 *      correction had landed when it had not is the one thing this must not do.
 *   3. It stops being drawn as unread without anything reloading, which is the
 *      live half - the state a page follows had to learn about messages, and
 *      this is what says it did.
 *   4. The words are in the task's log, under the name of whoever typed them.
 *   5. The task finishes having done what was asked in the message rather than
 *      what was asked in the prompt, which is the whole point of the feature and
 *      the only assertion here about the *work* rather than about the machinery.
 */
import { BASE, WORKSPACE, open, check, shot, finish } from './suite/harness.mjs';

/** Where a model that works slowly is, as the *server* sees it. */
const STUB = process.env.ORKNUX_MESSAGE_STUB ?? 'http://localhost:8199';

const stamp = Date.now();
const PROVIDER = `zzScratchSayProvider${stamp}`;
const MODEL = `zzScratchSayModel${stamp}`;
const PROMPT = `zz Scratch Say Task ${stamp} - write up last week's failed runs`;

/** What is typed into the box. The stub knows this phrase; see its own note. */
const MESSAGE = 'Make it a table rather than prose.';

const OVER = ['Done', 'Failed', 'Stopped'];

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/*
 * Anything an earlier run left behind. Swept at the start rather than guarded at
 * the end, because a `finally` cannot clean up after the suite's own timeout.
 */
const before = await graphql(
  `query ($workspaceId: ID!) {
     workspaceTasks(workspaceId: $workspaceId, page: 0, size: 200) { content { id title status } }
     modelProviders(workspaceId: $workspaceId) { id name }
     workspaceAgents(workspaceId: $workspaceId, page: 0, size: 200) { content { id name } }
   }`,
  { workspaceId: WORKSPACE },
);
for (const old of before.workspaceTasks.content.filter((row) => row.title.startsWith('zz Scratch Say Task'))) {
  if (!['DONE', 'FAILED', 'STOPPED'].includes(old.status)) {
    await graphql(`mutation ($id: ID!) { stopTask(id: $id) { id } }`, { id: old.id }).catch(() => undefined);
  }
  await graphql(`mutation ($id: ID!) { deleteTask(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept task ${old.title} (#${old.id}) from an earlier run`);
}
for (const old of before.modelProviders.filter((row) => row.name.startsWith('zzScratchSayProvider'))) {
  await graphql(`mutation ($id: ID!) { removeModelProvider(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept provider ${old.name} (#${old.id}) from an earlier run`);
}
/*
 * And the agent, which is named after the model it was made from and so carries
 * the model's prefix rather than a prefix of its own. Taking the provider away
 * does not take it with it, and an agent standing on a model that is gone is
 * exactly the debris the picker would then be offering.
 */
for (const old of before.workspaceAgents.content.filter((row) => row.name.startsWith('zzScratchSayModel'))) {
  await graphql(`mutation ($id: ID!) { deleteAgent(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept agent ${old.name} (#${old.id}) from an earlier run`);
}

// A model that takes its time, which is what this check needs one to be. It
// makes its own and takes it away again: a seeded installation has none, and one
// that borrowed whatever was there would say a different thing on every machine.
const provider = (
  await graphql(`mutation ($input: CreateModelProviderInput!) { createModelProvider(input: $input) { id } }`, {
    input: { workspaceId: WORKSPACE, name: PROVIDER, endpoint: STUB, secret: 'sk-scratch' },
  })
).createModelProvider;
const model = (
  await graphql(`mutation ($input: CreateModelInput!) { createModel(input: $input) { id } }`, {
    input: { providerId: provider.id, name: MODEL, modelId: 'stub-message', kind: 'CHAT' },
  })
).createModel;
console.log(`made ${MODEL} (#${model.id}) pointed at ${STUB}`);

/*
 * And an agent standing on it, because that is what a task is given now. Issue
 * #295 made `agentId` required and took the bare model out of the picker, so
 * the option chosen below is an agent rather than a model.
 * `createAgentForModel` makes one named after the model and granted nothing,
 * which is what this wants: the stub decides how long the first round lasts and
 * an agent carrying tools would put rounds of its own in front of it.
 */
const worker = (
  await graphql(`mutation ($m: ID!) { createAgentForModel(modelId: $m) { id name } }`, { m: model.id })
).createAgentForModel;
console.log(`made agent ${worker.name} (#${worker.id}) to be given the task`);

/**
 * Everything this check reads off the page, in one evaluate.
 *
 * One round trip rather than four, for the reason `task-live-check` spells out:
 * "the box was there while the page said the task was working" is a claim about
 * one moment, and two round trips are two moments a tenth of a second apart.
 */
const readPage = () =>
  page.evaluate(() => {
    const box = document.querySelector('[data-testid="task-message"]');
    const pending = document.querySelector('[data-testid="task-message-pending"]');
    return {
      state: document.querySelector('[data-testid="task-state"]')?.textContent?.trim() ?? '',
      box: box !== null,
      typing: box?.querySelector('input') !== null && box?.querySelector('input') !== undefined,
      pending: pending?.querySelectorAll('li').length ?? 0,
      said: pending?.textContent ?? '',
      log: document.querySelector('[data-testid="task-log"]')?.textContent ?? '',
      outcome: document.querySelector('[data-testid="task-outcome"]')?.textContent ?? '',
    };
  });

// --- start it from the page, so the page is open while it works -------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/tasks`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:text("Tasks")', { timeout: 20_000 });
await page.locator('#task-prompt').fill(PROMPT);
await page.locator('#task-worker').selectOption(String(worker.id));
await page.locator('button:text("Start")').click();
await page.waitForURL(/\/tasks\/\d+$/, { timeout: 20_000 });
const taskId = page.url().split('/').pop();
await page.waitForSelector('[data-testid="task-log"]', { timeout: 20_000 });
console.log(`started task #${taskId}`);

// --- 1. the box is there, on a task that is still working -------------------

const working = await readPage();
check(
  working.box && working.typing && !OVER.includes(working.state),
  `there is a box to say something in while the task reads "${working.state}"`,
  working.box
    ? `the box is on a task reading "${working.state}", which is over`
    : `no box on a task reading "${working.state}". Is ${STUB} answering? ` +
      '(python scripts/suite/message-stub.py 8199)',
);
if (!working.box || OVER.includes(working.state)) await finish(browser);

/*
 * The marker. Anything that navigates takes it with it, so the "without
 * reloading" assertion further down is a fact rather than a hope.
 */
await page.evaluate(() => {
  window.__orknuxNeverReloaded = true;
});

// --- 2. it is sent, and drawn as something the agent has not read yet -------

await page.locator('[data-testid="task-message-box"]').fill(MESSAGE);
await page.locator('[data-testid="task-message"] button:text("Send")').click();

let sent = null;
for (let look = 0; look < 40 && sent === null; look += 1) {
  const read = await readPage();
  if (read.pending > 0) sent = read;
  else await page.waitForTimeout(250);
}
check(
  sent !== null && sent.said.includes(MESSAGE) && !OVER.includes(sent.state),
  `what was sent is on the page as not read yet, while the task still reads "${sent?.state}"`,
  'the message was sent and the page never showed it waiting to be read',
);
await page.screenshot({ path: shot('task-message-sent.png'), fullPage: true });

// --- 3. it stops being unread, and nothing reloaded to notice ---------------

/*
 * The live half. Neither sending a message nor reading one moves the task's
 * status, so a page that only redrew on a status change would leave "not read
 * yet" under a message the agent read minutes ago - until somebody reloaded,
 * which is the thing this page exists not to need.
 */
let cleared = null;
for (let look = 0; look < 160 && cleared === null; look += 1) {
  const read = await readPage();
  if (read.pending === 0) cleared = read;
  else await page.waitForTimeout(500);
}
const marker = await page.evaluate(() => window.__orknuxNeverReloaded === true);
check(
  cleared !== null && marker,
  'the page stopped drawing it as unread once the agent read it, without anything reloading',
  cleared === null
    ? 'the message was still drawn as unread after eighty seconds'
    : 'the page reloaded, so nothing here says the live view noticed anything',
);

// --- 4. and it is in the account of the work, under a name ------------------

const inLog = page.locator(`[data-testid="task-log"] :text("${MESSAGE}")`);
await inLog.first().waitFor({ timeout: 30_000 }).catch(() => undefined);
const withMessage = await readPage();
check(
  withMessage.log.includes(MESSAGE) && withMessage.log.includes('alice'),
  'the message is in the task log, under the name of whoever said it',
  'the message never appeared in the task log',
);

// --- 5. the work took the shape that was asked for --------------------------

/*
 * The only assertion here about what the agent *did*. Everything above it would
 * pass on a build that recorded the message beautifully and never put it in
 * front of the model; this is the one that would not. The stub calls `task_done`
 * only on a round that carries the message, and says so in its summary.
 */
let ended = null;
for (let look = 0; look < 120 && ended === null; look += 1) {
  const found = await graphql(`query ($id: ID!) { task(id: $id) { status outcome } }`, { id: taskId });
  if (['DONE', 'FAILED', 'STOPPED'].includes(found.task.status)) ended = found.task;
  else await page.waitForTimeout(500);
}
check(
  ended?.status === 'DONE' && (ended.outcome ?? '').includes('table'),
  `the task finished having done what the message asked: "${ended?.outcome}"`,
  `the task ended "${ended?.status}" with "${ended?.outcome}", which is not what was asked mid-run`,
);

// --- 6. and the box is gone, because nothing would read it now --------------

await page.waitForSelector('[data-testid="task-outcome"]', { timeout: 30_000 }).catch(() => undefined);
const over = await readPage();
check(
  !over.typing && !over.box,
  'the box is not offered on a task that has ended',
  'the box is still offered on a task that has ended, where nothing would ever read what is typed',
);
/*
 * Both, because they are two rules now. The input goes when the task is over -
 * nothing would read it - while the card itself stays for as long as it has
 * something unread to show, which on a task that ended normally is never: the
 * loop reads what is waiting before it lets task_done through. A build where
 * that guard had gone would leave a message on this screen, and `over.box`
 * alone would be what noticed.
 */
await page.screenshot({ path: shot('task-message-done.png'), fullPage: true });

// --- put it back the way it was ---------------------------------------------

await graphql(`mutation ($id: ID!) { stopTask(id: $id) { id } }`, { id: taskId }).catch(() => undefined);
await graphql(`mutation ($id: ID!) { deleteTask(id: $id) }`, { id: taskId }).catch(() => undefined);
await graphql(`mutation ($id: ID!) { deleteAgent(id: $id) }`, { id: worker.id }).catch(() => undefined);
await graphql(`mutation ($id: ID!) { removeModelProvider(id: $id) }`, { id: provider.id }).catch(() => undefined);

await finish(browser);
