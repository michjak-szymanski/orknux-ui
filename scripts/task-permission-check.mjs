/**
 * A task stopping for permission, saying so, and carrying on once it is given.
 *
 * The half of issue #229 that cannot be proved without a model that answers, and
 * that is why it is a check of its own rather than more assertions on
 * `task-check`: three things CI can prove should not be lost to a fourth it
 * never can. What it needs is a model that will look at a job it has not been
 * given the means to do and call `task_request_permission` rather than making
 * something up - which is a judgement, and only a real one makes it.
 *
 * The prompt asks for something that can only be done on a machine, and the
 * agent it is given has not been granted the shells. So the honest move, and the
 * one the briefing tells it to make, is to stop and ask.
 *
 * What is checked is the whole of the mechanism the issue asked for:
 *
 *   - it stops rather than inventing an answer, and the page says what it wants
 *   - whoever asked for the task is told, on the bell
 *   - approving hands it that one capability, records who gave it, and the task
 *     is working again
 *   - the grant is on the *task*: the agent's own page is unchanged
 *
 * It builds its own agent and removes it, so it says the same thing on every
 * installation. It borrows whichever model the workspace already has, because a
 * model that answers is the one thing it cannot make.
 */
import { BASE, WORKSPACE, open, check, record, shot, finish } from './suite/harness.mjs';

const stamp = Date.now();
const AGENT = `zzScratchTaskAgent${stamp}`;
const PROMPT =
  `zz Scratch Task ${stamp} - run "uname -a" on one of this installation's machines ` +
  `and tell me exactly what it printed.`;

const { browser, context, page } = await open({ viewport: { width: 1440, height: 900 } });

async function gql(query, variables = {}) {
  const response = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await response.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

// Anything an earlier run left behind.
const before = await gql(
  `query($workspaceId: ID!) {
     workspaceTasks(workspaceId: $workspaceId, page: 0, size: 200) { content { id title status } }
     workspaceAgents(workspaceId: $workspaceId, page: 0, size: 200) { content { id name } }
     models(workspaceId: $workspaceId) { id name enabled kind }
   }`,
  { workspaceId: WORKSPACE },
);
for (const old of before.workspaceTasks.content.filter((row) => row.title.startsWith('zz Scratch Task'))) {
  if (!['DONE', 'FAILED', 'STOPPED'].includes(old.status)) {
    await gql(`mutation($id: ID!) { stopTask(id: $id) { id } }`, { id: old.id }).catch(() => undefined);
  }
  await gql(`mutation($id: ID!) { deleteTask(id: $id) }`, { id: old.id }).catch(() => undefined);
}
for (const old of before.workspaceAgents.content.filter((row) => row.name.startsWith('zzScratchTaskAgent'))) {
  await gql(`mutation($id: ID!) { deleteAgent(id: $id) }`, { id: old.id }).catch(() => undefined);
}

const model = before.models.find((one) => one.enabled && one.kind === 'CHAT');
if (model === undefined) {
  record(false, 'this workspace has no model that answers, and this check cannot be run without one');
  await finish(browser);
}

/*
 * An agent granted nothing at all.
 *
 * That is the point: what it is asked to do needs the shells, it has not been
 * given them, and the only way through is to ask.
 */
const agent = (
  await gql(`mutation($input: CreateAgentInput!) { createAgent(input: $input) { id } }`, {
    input: { workspaceId: WORKSPACE, name: AGENT, type: 'LLM' },
  })
).createAgent;
await gql(`mutation($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }`, {
  id: agent.id,
  input: { name: AGENT, modelId: model.id, shellAccess: false },
});

// --- start it, and wait for it to stop --------------------------------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/tasks`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:text("Tasks")', { timeout: 20_000 });
await page.locator('#task-prompt').fill(PROMPT);
/*
 * The agent, by its own id. It used to be `agent:${id}`, because the picker
 * offered agents and models together and the prefix said which half an option
 * came from; issue #295 took the models out of it, so what is left is an agent
 * list and an option is an agent.
 */
await page.locator('#task-worker').selectOption(String(agent.id));
await page.locator('button:text("Start")').click();
await page.waitForURL(/\/tasks\/\d+$/, { timeout: 20_000 });
const taskId = page.url().split('/').pop();

let parked = null;
for (let look = 0; look < 60 && parked === null; look += 1) {
  const found = await gql(
    `query($id: ID!) { task(id: $id) { status requests { id kind capability subject asks decision } } }`,
    { id: taskId },
  );
  if (found.task.status === 'WAITING') parked = found.task;
  else if (['DONE', 'FAILED', 'STOPPED'].includes(found.task.status)) break;
  else await page.waitForTimeout(1000);
}

check(
  parked !== null,
  'the task stopped rather than inventing an answer it had no way to get',
  'the task never stopped for permission - it either finished or failed instead',
);

if (parked !== null) {
  const asked = parked.requests.find((one) => one.decision === null);
  check(
    asked !== undefined && asked.kind === 'PERMISSION' && asked.capability === 'SHELLS',
    `it asked for ${asked?.capability} and said why: ${asked?.asks}`,
    `it stopped, but for ${asked?.kind} ${asked?.capability} rather than for the shells`,
  );

  // --- the page says so -----------------------------------------------------

  await page.reload({ waitUntil: 'domcontentloaded' });
  const waiting = page.locator('[data-testid="task-waiting"]');
  await waiting.waitFor({ timeout: 20_000 });
  const said = await waiting.innerText();
  check(
    said.includes('the shells'),
    'the page says what it is waiting for',
    `the page said "${said.replace(/\s+/g, ' ').slice(0, 120)}"`,
  );

  // --- and so does the bell -------------------------------------------------

  const news = await gql(`query { myNotifications(limit: 20) { kind taskId says } }`);
  check(
    news.myNotifications.some((one) => one.kind === 'TASK_WAITING' && String(one.taskId) === String(taskId)),
    'whoever asked for the task was told it needs them',
    'nothing rang: a parked task nobody is told about is a task that has silently stopped',
  );

  await page.screenshot({ path: shot('task-permission-waiting.png'), fullPage: true });

  // --- approving hands it that one thing, and it carries on -----------------

  await page.locator('button:text("Approve")').click();
  await page.waitForSelector('[data-testid="task-waiting"]', { state: 'detached', timeout: 20_000 });

  const after = await gql(
    `query($id: ID!, $agentId: ID!) {
       task(id: $id) { status grants { capability subject grantedBy } }
       agent(id: $agentId) { shellAccess }
     }`,
    { id: taskId, agentId: agent.id },
  );
  check(
    after.task.grants.length === 1 && after.task.grants[0].capability === 'SHELLS',
    `the task was granted ${after.task.grants[0]?.capability} by ${after.task.grants[0]?.grantedBy}`,
    `the task holds ${after.task.grants.length} grant(s) rather than the one that was asked for`,
  );
  check(
    after.agent.shellAccess === false,
    'the agent itself was not changed: the grant is the task’s and ends with it',
    'approving armed the agent everywhere, which is the one thing this must not do',
  );
  check(
    after.task.status !== 'WAITING',
    `the task is working again (${after.task.status})`,
    'the task is still waiting after it was approved',
  );
}

// --- put it back the way it was ---------------------------------------------

await gql(`mutation($id: ID!) { stopTask(id: $id) { id } }`, { id: taskId }).catch(() => undefined);
await gql(`mutation($id: ID!) { deleteTask(id: $id) }`, { id: taskId }).catch(() => undefined);
await gql(`mutation($id: ID!) { deleteAgent(id: $id) }`, { id: agent.id }).catch(() => undefined);

await finish(browser);
