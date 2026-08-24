/**
 * Issue #249: the picker above a chat offers agents first.
 *
 * It opened on Models, always, whatever the chat was talking to. Two things
 * were wrong with that and only one of them is the issue. The issue is the
 * order: what somebody chats to here is nearly always an agent — it brings its
 * instructions, its skills and its tools with it and supplies a model anyway —
 * so opening on the bare models offered the raw material ahead of the thing
 * made out of it. The other is that a chat already handed to an agent opened on
 * the half its own choice was not in, so the one entry worth seeing — the
 * ticked one — was a tab away.
 *
 * So there are two assertions and they are not the same assertion. The tabs are
 * in a fixed order, Agents then Models, whatever the chat holds; which of them
 * *opens* follows the chat, and defaults to Agents. A fix that only reordered
 * the tabs would pass the first and fail the second.
 *
 * The chat with an agent in it is made here rather than seeded: what it points
 * at is the whole of what this measures, and a check that reads whichever chat
 * happened to be first is a check that measures whatever somebody last left
 * open.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

const { workspaceAgents } = await graphql(
  `query ($w: ID!) { workspaceAgents(workspaceId: $w, page: 0, size: 50) { content { id name enabled modelId } } }`,
  { w: WORKSPACE },
);
const agent = workspaceAgents.content.find((one) => one.enabled && one.modelId !== null);
const { models } = await graphql(`query ($w: ID!) { models(workspaceId: $w) { id name enabled kind } }`, {
  w: WORKSPACE,
});
const model = models.find((one) => one.enabled && one.kind === 'CHAT');

if (agent === undefined || model === undefined) {
  record(false, `workspace ${WORKSPACE} has both an active agent with a model and a chat model to pick`);
  await finish(browser);
}

/** A chat of this check's own, so what it is pointed at is not somebody else's doing. */
async function chatOn(what) {
  const { startChat } = await graphql(
    `mutation ($input: StartChatInput!) { startChat(input: $input) { id } }`,
    { input: { workspaceId: WORKSPACE, title: `zz agents-first ${Date.now()}`, modelId: model.id } },
  );
  if (what === 'agent') {
    await graphql(`mutation ($id: ID!, $a: ID!) { chooseChatAgent(id: $id, agentId: $a) { id } }`, {
      id: startChat.id,
      a: agent.id,
    });
  }
  return startChat.id;
}

const made = [];

/** Opens the picker on a chat and says what it is showing. */
async function pickerOn(chatId) {
  await page.goto(`${BASE}/chat/${chatId}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the chat'))) return null;
  await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });

  const button = page.locator('h1').first().locator('..').locator('button[aria-expanded]').first();
  await button.click();
  await page.waitForTimeout(400);

  return page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
      label: (tab.textContent ?? '').trim(),
      chosen: tab.getAttribute('aria-selected') === 'true',
    }));
    const entries = [...document.querySelectorAll('[class*="_pickerEntry"]')].map((entry) =>
      (entry.textContent ?? '').trim(),
    );
    return { tabs, entries };
  });
}

/* ----------------------------------------------- a chat handed to an agent */

const onAgent = await chatOn('agent');
made.push(onAgent);
const withAgent = await pickerOn(onAgent);

if (withAgent !== null) {
  record(
    withAgent.tabs[0]?.label === 'Agents',
    `Agents is the first tab (the tabs read ${withAgent.tabs.map((tab) => tab.label).join(', ')})`,
  );
  record(
    withAgent.tabs.find((tab) => tab.chosen)?.label === 'Agents',
    `and the picker opens on it (it opened on ${withAgent.tabs.find((tab) => tab.chosen)?.label})`,
  );
  record(
    withAgent.entries.some((entry) => entry.startsWith(agent.name)),
    `the agent this chat is handed to is in the list that opened (looking for ${JSON.stringify(agent.name)})`,
  );
}

/* -------------------------------------------- and one on a bare model */

const onModel = await chatOn('model');
made.push(onModel);
const withModel = await pickerOn(onModel);

if (withModel !== null) {
  record(
    withModel.tabs[0]?.label === 'Agents',
    'Agents is still the first tab on a chat talking to a bare model',
  );
  /*
   * The exception, and the reason this is two assertions rather than one:
   * a chat pointed at a model opens on the half its own choice is in, or the
   * ticked entry is somewhere nobody is looking.
   */
  record(
    withModel.tabs.find((tab) => tab.chosen)?.label === 'Models',
    `but the one that opens is Models, where the ticked entry is (it opened on ${
      withModel.tabs.find((tab) => tab.chosen)?.label
    })`,
  );
  record(
    withModel.entries.some((entry) => entry.startsWith(model.name)),
    `the model this chat is talking to is in the list that opened (looking for ${JSON.stringify(model.name)})`,
  );
}

/* Nothing this check made is left behind for the next one to read. */
for (const id of made) {
  await graphql(`mutation ($id: ID!) { deleteChat(id: $id) }`, { id }).catch(() => undefined);
}

await finish(browser);
