/**
 * Tasks: starting one from the page, and its event log filling up.
 *
 * Issue #229. What a task is, is an agent given a problem and left to work at
 * it, so what this walks is the path a person walks: open Tasks, say what you
 * want, choose who is to do it, press Start, and land on the page that shows
 * what it is doing.
 *
 * **It needs no model that answers, and that is deliberate.** The prompt is
 * written into the task's log before the model is asked, and a model that never
 * answers is recorded as a note saying so - so the log holds lines either way,
 * and every assertion here is about the machinery around the model rather than
 * about anything a model said. That is what lets this run unattended, where the
 * two checks about stopping for permission cannot. The model it makes is pointed
 * at `.invalid`, which by definition cannot resolve, so nothing here touches a
 * network.
 *
 * It builds its own model and cleans up after itself: the seeded fixture has no
 * model on a database built from nothing, and a check that borrows whatever
 * happens to be there says a different thing on every installation.
 */
import { BASE, WORKSPACE, open, check, shot, finish } from './suite/harness.mjs';

const stamp = Date.now();
const PROVIDER = `zzScratchTaskProvider${stamp}`;
const MODEL = `zzScratchTaskModel${stamp}`;
const PROMPT = `zz Scratch Task ${stamp} - write a note and put it somewhere`;

const { browser, context, page } = await open({ viewport: { width: 1440, height: 900 } });

/** The API this app talks: one endpoint, queries by name. */
async function gql(query, variables = {}) {
  const response = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await response.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

/*
 * Anything an earlier run left behind. Swept at the start rather than guarded
 * at the end, because a `finally` cannot clean up after the suite's own timeout.
 */
const before = await gql(
  `query($workspaceId: ID!) {
     workspaceTasks(workspaceId: $workspaceId, page: 0, size: 200) { content { id title status } }
     modelProviders(workspaceId: $workspaceId) { id name }
   }`,
  { workspaceId: WORKSPACE },
);
for (const old of before.workspaceTasks.content.filter((row) => row.title.startsWith('zz Scratch Task'))) {
  if (!['DONE', 'FAILED', 'STOPPED'].includes(old.status)) {
    await gql(`mutation($id: ID!) { stopTask(id: $id) { id } }`, { id: old.id }).catch(() => undefined);
  }
  await gql(`mutation($id: ID!) { deleteTask(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept task ${old.title} (#${old.id}) from an earlier run`);
}
for (const old of before.modelProviders.filter((row) => row.name.startsWith('zzScratchTaskProvider'))) {
  await gql(`mutation($id: ID!) { removeModelProvider(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept provider ${old.name} (#${old.id}) from an earlier run`);
}

// A model that cannot answer, which is all this check needs one to be.
const provider = (
  await gql(
    `mutation($input: CreateModelProviderInput!) { createModelProvider(input: $input) { id } }`,
    {
      input: {
        workspaceId: WORKSPACE,
        name: PROVIDER,
        endpoint: 'http://nowhere.invalid',
        secret: 'sk-scratch',
      },
    },
  )
).createModelProvider;
const model = (
  await gql(`mutation($input: CreateModelInput!) { createModel(input: $input) { id } }`, {
    input: { providerId: provider.id, name: MODEL, modelId: 'scratch', kind: 'CHAT' },
  })
).createModel;
console.log(`made ${MODEL} (#${model.id}) for the task to be given`);

// --- the page, and the one control it exists for ----------------------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/tasks`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:text("Tasks")', { timeout: 20_000 });

const start = page.locator('button:text("Start")');
check(
  await start.isDisabled(),
  'Start is refused while there is nothing to work on',
  'Start was offered with an empty prompt',
);

await page.locator('#task-prompt').fill(PROMPT);
await page.locator('#task-worker').selectOption(`model:${model.id}`);
check(
  await start.isEnabled(),
  'Start is offered once there is a prompt and somebody to do it',
  'Start stayed refused with a prompt and a model chosen',
);

await start.click();
await page.waitForURL(/\/tasks\/\d+$/, { timeout: 20_000 });
const taskId = page.url().split('/').pop();
console.log(`started task #${taskId}`);

// --- what was asked, and what it has done -----------------------------------

await page.waitForSelector('[data-testid="task-log"]', { timeout: 20_000 });
const prompt = await page.locator('h1').innerText();
check(
  prompt.includes('zz Scratch Task'),
  'the task page is named after what was asked',
  `the task page was called "${prompt}"`,
);

/*
 * The log, which is the task's LLM session and not a second transcript.
 *
 * The prompt is in it before the model is asked, so this line is there whether
 * or not anything ever answers - which is the whole reason this check can run
 * where nothing answers.
 */
const log = page.locator('[data-testid="task-log"]');
await log.locator(`text=${PROMPT}`).first().waitFor({ timeout: 20_000 });
const lines = await log.locator('[data-kind]').count();
check(lines >= 1, `the event log shows ${lines} line(s)`, 'the event log drew nothing');

/*
 * And it reaches an end that says why.
 *
 * A model that cannot be reached is the ordinary way this ends here, and the
 * point of the assertion is that the task stops and writes down a reason rather
 * than sitting at RUNNING for ever - which is what a loop with nothing watching
 * it does when nobody has thought about the ending.
 */
let ended = null;
for (let look = 0; look < 20 && ended === null; look += 1) {
  const found = await gql(`query($id: ID!) { task(id: $id) { status endedBecause } }`, { id: taskId });
  if (['DONE', 'FAILED', 'STOPPED'].includes(found.task.status)) ended = found.task;
  else await page.waitForTimeout(500);
}
check(
  ended !== null && typeof ended.endedBecause === 'string' && ended.endedBecause.length > 0,
  `the task ended and said why: ${ended?.endedBecause}`,
  'the task never reached an end, or reached one without saying why',
);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="task-state"]', { timeout: 20_000 });
const state = await page.locator('[data-testid="task-state"]').innerText();
check(
  ['Failed', 'Done', 'Stopped'].includes(state.trim()),
  `the page reads the ending back as "${state.trim()}"`,
  `the page still reads "${state.trim()}" after the task ended`,
);

// --- and it is on the list, where somebody would look for it ----------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/tasks`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:text("Tasks")', { timeout: 20_000 });
const row = page.locator(`a[href$="/tasks/${taskId}"]`);
check(await row.count() > 0, 'the task is on the list', 'the task was not on the list it was started from');

await page.screenshot({ path: shot('task-check.png'), fullPage: true });

// --- put it back the way it was ---------------------------------------------

await gql(`mutation($id: ID!) { deleteTask(id: $id) }`, { id: taskId }).catch(() => undefined);
await gql(`mutation($id: ID!) { removeModelProvider(id: $id) }`, { id: provider.id }).catch(() => undefined);

await finish(browser);
