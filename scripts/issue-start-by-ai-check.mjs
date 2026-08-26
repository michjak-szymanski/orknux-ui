/**
 * "Start by AI" on an issue, and the link it leaves behind.
 *
 * Issue #230. What it walks is the whole of the feature as a person meets it:
 * an issue assigned to an agent offers the control, an issue assigned to
 * nobody does not, pressing it moves the issue to In progress, and what stands
 * in the button's place afterwards is a link that leads to the task - which is
 * followed, because a link that goes nowhere is the failure this exists to
 * catch.
 *
 * **No model that answers is needed, for the reason `task-check` gives.** The
 * prompt is written into the task's log before the model is asked, so the task
 * page has something to show whether or not anything ever replies. The model
 * this makes is pointed at `.invalid`, which by definition cannot resolve, so
 * nothing here touches a network.
 *
 * It builds its own agent, model and issue and takes all three away again: a
 * seeded installation has no model, and a check that borrows whichever agent
 * happens to be there says a different thing on every machine.
 */
import { BASE, WORKSPACE, open, check, shot, finish } from './suite/harness.mjs';

const stamp = Date.now();
const PROVIDER = `zzScratchAIProvider${stamp}`;
const MODEL = `zzScratchAIModel${stamp}`;
const AGENT = `zzScratchAIAgent${stamp}`;
const TITLE = `zz Scratch AI issue ${stamp}`;
const DESCRIPTION = `The replies arrive twice ${stamp}.`;

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
     workspaceIssues(workspaceId: $workspaceId, search: "zz Scratch AI issue", size: 100) {
       content { id }
     }
     workspaceTasks(workspaceId: $workspaceId, page: 0, size: 200) { content { id title status } }
     workspaceAgents(workspaceId: $workspaceId, size: 200) { content { id name } }
     modelProviders(workspaceId: $workspaceId) { id name }
   }`,
  { workspaceId: WORKSPACE },
);
for (const old of before.workspaceTasks.content.filter((row) => row.title.includes('zz Scratch AI issue'))) {
  if (!['DONE', 'FAILED', 'STOPPED'].includes(old.status)) {
    await gql(`mutation($id: ID!) { stopTask(id: $id) { id } }`, { id: old.id }).catch(() => undefined);
  }
  await gql(`mutation($id: ID!) { deleteTask(id: $id) }`, { id: old.id }).catch(() => undefined);
}
for (const old of before.workspaceIssues.content) {
  await gql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: old.id }).catch(() => undefined);
}
for (const old of before.workspaceAgents.content.filter((row) => row.name.startsWith('zzScratchAIAgent'))) {
  await gql(`mutation($id: ID!) { deleteAgent(id: $id) }`, { id: old.id }).catch(() => undefined);
}
for (const old of before.modelProviders.filter((row) => row.name.startsWith('zzScratchAIProvider'))) {
  await gql(`mutation($id: ID!) { removeModelProvider(id: $id) }`, { id: old.id }).catch(() => undefined);
}

// --- an agent to hand the issue to -----------------------------------------

const provider = (
  await gql(`mutation($input: CreateModelProviderInput!) { createModelProvider(input: $input) { id } }`, {
    input: {
      workspaceId: WORKSPACE,
      name: PROVIDER,
      endpoint: 'http://nowhere.invalid',
      secret: 'sk-scratch',
    },
  })
).createModelProvider;
const model = (
  await gql(`mutation($input: CreateModelInput!) { createModel(input: $input) { id } }`, {
    input: { providerId: provider.id, name: MODEL, modelId: 'scratch', kind: 'CHAT' },
  })
).createModel;
const agent = (
  await gql(`mutation($input: CreateAgentInput!) { createAgent(input: $input) { id } }`, {
    input: { workspaceId: WORKSPACE, name: AGENT, type: 'LLM' },
  })
).createAgent;
await gql(`mutation($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }`, {
  id: agent.id,
  input: { name: AGENT, modelId: model.id },
});
console.log(`made ${AGENT} (#${agent.id}) with a model that cannot answer`);

// --- two issues: one nobody has, one the agent has ---------------------------

const unassigned = (
  await gql(`mutation($input: IssueInput!) { createIssue(input: $input) { id number } }`, {
    input: { workspaceId: WORKSPACE, title: `${TITLE} (nobody)`, description: DESCRIPTION },
  })
).createIssue;
const assigned = (
  await gql(`mutation($input: IssueInput!) { createIssue(input: $input) { id number } }`, {
    input: {
      workspaceId: WORKSPACE,
      title: TITLE,
      description: DESCRIPTION,
      assigneeKind: 'AGENT',
      assigneeId: agent.id,
    },
  })
).createIssue;
console.log(`filed #${assigned.number} to the agent and #${unassigned.number} to nobody`);

// --- it appears where it should, and only there ------------------------------

await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/${unassigned.number}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForSelector('input[aria-label="Title"]', { timeout: 20_000 });
check(
  (await page.locator('[data-testid="issue-ai"]').count()) === 0,
  'an issue nobody has is not offered Start by AI',
  'Start by AI was offered on an issue with no assignee',
);

await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/${assigned.number}`, {
  waitUntil: 'domcontentloaded',
});
const start = page.locator('[data-testid="issue-start-ai"]');
await start.waitFor({ timeout: 20_000 });
check(
  await start.isEnabled(),
  'an issue assigned to an agent offers Start by AI',
  'Start by AI was not offered on an agent-assigned issue',
);

// --- pressing it ------------------------------------------------------------

await start.click();
const link = page.locator('[data-testid="issue-task-link"]').first();
await link.waitFor({ timeout: 30_000 });
const said = (await link.innerText()).trim();
check(
  said.length > 0,
  `pressing it leaves a link where the button was: "${said}"`,
  'pressing it left no link to the task',
);

const side = await page.locator('[data-testid="issue-ai"]').locator('xpath=..').innerText();
check(
  side.includes('In progress'),
  'the issue reads as In progress once the agent has been set on it',
  `the issue still read: ${side.replace(/\s+/g, ' ').slice(0, 120)}`,
);

/*
 * The button is gone while something is going: two people looking at the same
 * stalled issue must not put two agents on it.
 *
 * Asked only while the task really is going. The agent here is given a model
 * that cannot answer, so the task fails - and on a machine quick enough it has
 * already failed by the time this line runs, which is when the button is
 * *supposed* to be back: a task that ended leaves the issue where it is, and
 * starting another is the reader's to do. So the link says which of the two
 * happened and the assertion follows it, rather than reading a correct page as
 * a failure because the run was fast.
 */
if (said.startsWith('Working on it')) {
  check(
    (await page.locator('[data-testid="issue-start-ai"]').count()) === 0,
    'the button is not offered a second time while a task is going',
    'Start by AI was still offered while a task was already working on the issue',
  );
} else {
  check(
    (await page.locator('[data-testid="issue-start-ai"]').count()) === 1,
    `the task ended before this line, and the button is back for another go ("${said}")`,
    `the task ended ("${said}") and Start by AI did not come back`,
  );
}

await page.screenshot({ path: shot('issue-start-by-ai-check.png'), fullPage: true });

// --- and the link goes where it says ----------------------------------------

await link.click();
await page.waitForURL(/\/tasks\/\d+$/, { timeout: 20_000 });
const taskId = page.url().split('/').pop();
await page.waitForSelector('[data-testid="task-log"]', { timeout: 20_000 });

const heading = await page.locator('h1').innerText();
check(
  heading.includes(TITLE),
  'the task is named after the issue it came from',
  `the task page was called "${heading}"`,
);

// What the agent was handed is the issue, and the page shows it.
const prompt = await page.locator('body').innerText();
check(
  prompt.includes(`Issue #${assigned.number}: ${TITLE}`) && prompt.includes(DESCRIPTION),
  'the prompt is the issue: its number, its title and what it says',
  'the task prompt did not carry the issue',
);

const carried = await gql(`query($id: ID!) { task(id: $id) { issueId agentId } }`, { id: taskId });
check(
  carried.task.issueId === assigned.id && carried.task.agentId === agent.id,
  'the task carries the issue and the agent it was assigned to',
  `the task carried issue ${carried.task.issueId} and agent ${carried.task.agentId}`,
);

// --- put it back the way it was ---------------------------------------------

await gql(`mutation($id: ID!) { stopTask(id: $id) { id } }`, { id: taskId }).catch(() => undefined);
await gql(`mutation($id: ID!) { deleteTask(id: $id) }`, { id: taskId }).catch(() => undefined);
await gql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: assigned.id }).catch(() => undefined);
await gql(`mutation($id: ID!) { deleteIssue(id: $id) }`, { id: unassigned.id }).catch(() => undefined);
await gql(`mutation($id: ID!) { deleteAgent(id: $id) }`, { id: agent.id }).catch(() => undefined);
await gql(`mutation($id: ID!) { removeModelProvider(id: $id) }`, { id: provider.id }).catch(() => undefined);

await finish(browser);
