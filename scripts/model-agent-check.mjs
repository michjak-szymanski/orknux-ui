/**
 * Issue #295: a model on the Models screen can be made into an agent, in one
 * press.
 *
 * The other half of taking the bare model away. Before it, "I have just added a
 * model — does it work?" was a chat, a picker and a sentence typed. After it,
 * with nothing else, it would have been: go to Agents, add one, name it, open
 * its settings, choose the model, save, go to Chat, pick it, type, and then
 * decide what to do with the agent you did not want. This is that path put back
 * to one press, and what it leaves behind is a real agent rather than something
 * to throw away.
 *
 * ## What is measured, and why each of these and not fewer
 *
 * **The button is on a chat model's row and not on any other's.** An agent
 * pointed at a transcription model fails on its first message, and the server
 * refuses to make one — a button that is there to be refused is worse than no
 * button. Both halves are asserted because a fix that put the button on every
 * row would pass the first alone.
 *
 * **Pressing it lands on the new agent's settings page.** Not on a chat: what
 * was made is an agent, its name was derived rather than chosen, and it has been
 * granted nothing, which are three things to look at before talking to it. And a
 * chat would mean a conversation in the sidebar every time anybody checked a
 * model.
 *
 * **The agent is on that model, and named after it.** The name is the part
 * somebody sees first and the part most likely to be quietly wrong.
 *
 * **It is granted nothing.** Read off the API rather than the page, because
 * this is the assertion that matters most and the settings page draws several of
 * these grants as absences that look the same as a page that has not loaded.
 * Granting is a deliberate act; an action that handed out tools because it was
 * being helpful would be the worst possible place in this product to be
 * generous.
 *
 * Everything this check makes is deleted again.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

const { models } = await graphql(
  `query ($w: ID!) { models(workspaceId: $w) { id name kind enabled } }`,
  { w: WORKSPACE },
);
const chatModel = models.find((one) => one.kind === 'CHAT');
const otherModel = models.find((one) => one.kind !== 'CHAT');

if (chatModel === undefined) {
  record(false, `workspace ${WORKSPACE} has a chat model to make an agent on`);
  await finish(browser);
}

/** Every agent this check made, so none of them is left for the next one to read. */
const made = [];

/* ------------------------------------------- the button, and where it is not */

await page.goto(`${BASE}/workspace/${WORKSPACE}/models`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the models screen'))) await finish(browser);

const onChatModel = page.locator(`button[aria-label="Make an agent on ${chatModel.name}"]`);
record(await onChatModel.isVisible(), `the button is on ${JSON.stringify(chatModel.name)}, which answers questions`);

if (otherModel !== undefined) {
  record(
    (await page.locator(`button[aria-label="Make an agent on ${otherModel.name}"]`).count()) === 0,
    `and not on ${JSON.stringify(otherModel.name)}, which is a ${otherModel.kind} model`,
  );
} else {
  /*
   * Reported rather than skipped silently. The fixture having only chat models
   * is a perfectly ordinary state, but a run where half this check did not
   * happen should say so rather than read as a clean pass.
   */
  record(true, 'no non-chat model in the fixture, so the half about where the button is not was not measured');
}

/* --------------------------------------------------- what one press does */

const before = await graphql(
  `query ($w: ID!) { workspaceAgents(workspaceId: $w, page: 0, size: 200) { content { id } } }`,
  { w: WORKSPACE },
);
const had = new Set(before.workspaceAgents.content.map((one) => one.id));

await onChatModel.click();
await page.waitForURL(/\/agents\/\d+\/settings/, { timeout: 20_000 }).catch(() => undefined);

const landed = new URL(page.url()).pathname;
record(
  /\/workspace\/\d+\/agents\/\d+\/settings$/.test(landed),
  `it lands on the new agent's settings page (it went to ${landed})`,
);

const after = await graphql(
  `query ($w: ID!) {
     workspaceAgents(workspaceId: $w, page: 0, size: 200) {
       content { id name enabled modelId modelName systemPrompt description tools skillCatalogs memoryCatalogs mcpServers orknuxAccess shellAccess }
     }
   }`,
  { w: WORKSPACE },
);
const fresh = after.workspaceAgents.content.filter((one) => !had.has(one.id));
made.push(...fresh.map((one) => one.id));

if (record(fresh.length === 1, `exactly one agent was made (${fresh.length} appeared)`)) {
  const agent = fresh[0];
  record(agent.modelId === chatModel.id, `it is on the model the row was for (${agent.modelName})`);
  record(
    agent.name === chatModel.name || agent.name.startsWith(`${chatModel.name} `),
    `it is named after the model (it is called ${JSON.stringify(agent.name)})`,
  );
  record(agent.enabled, 'it is switched on, so it can be talked to without a second press');
  record(
    agent.systemPrompt === null &&
      agent.description === null &&
      agent.tools.length === 0 &&
      agent.skillCatalogs.length === 0 &&
      agent.memoryCatalogs.length === 0 &&
      agent.mcpServers.length === 0 &&
      agent.orknuxAccess === false &&
      agent.shellAccess === false,
    'and it is granted nothing at all, which is what makes it something to dress rather than a surprise',
  );
  record(landed.endsWith(`/agents/${agent.id}/settings`), 'and the page it landed on is that agent');
}

/* ------------------------------------------------------ pressing it twice */

const { createAgentForModel } = await graphql(
  `mutation ($m: ID!) { createAgentForModel(modelId: $m) { id name } }`,
  { m: chatModel.id },
);
made.push(createAgentForModel.id);
record(
  createAgentForModel.name !== fresh[0]?.name,
  `a second press does not collide on the name (the first is ${JSON.stringify(fresh[0]?.name)}, the second ${JSON.stringify(createAgentForModel.name)})`,
);

/* Nothing this check made is left behind. */
for (const id of made) {
  await graphql(`mutation ($id: ID!) { deleteAgent(id: $id) }`, { id }).catch(() => undefined);
}

await finish(browser);
