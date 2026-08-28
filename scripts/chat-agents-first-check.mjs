/**
 * Issue #295: the picker above a chat offers agents, and nothing else.
 *
 * This file used to be issue #249's, which put agents *first* — the tabs read
 * Agents then Models, and which of the two opened followed what the chat was
 * already pointed at. The argument for that ordering was that what somebody
 * chats to is nearly always an agent: it brings its instructions, its skills and
 * its tools with it and supplies a model anyway, so opening on the bare models
 * offered the raw material ahead of the thing made out of it.
 *
 * #295 finished that argument. A bare model is an agent with the instructions,
 * the skills, the grants and the memory taken off, and putting it in a tab
 * beside the agents said it was the other half of a choice. There was no choice.
 * So the Models tab is gone, and with it the two mutations that moved a chat
 * back onto a bare model.
 *
 * What is measured here is therefore the absence of a control, which is a thing
 * worth measuring carefully: a check that only looked for the agents would have
 * passed for the whole time the Models tab was there beside them. So the
 * assertions are that the agents are offered, that there is no tab strip at all,
 * and — read off the schema rather than the screen, because that is where a
 * removal either happened or did not — that neither `chooseChatModel` nor a null
 * `chooseChatAgent` is still a call anybody can make.
 *
 * The chat it reads is made by this check and deleted again. What a chat is
 * pointed at is the whole of what this measures, and reading whichever chat
 * happened to be first would measure whatever somebody last left open.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

const { workspaceAgents } = await graphql(
  `query ($w: ID!) { workspaceAgents(workspaceId: $w, page: 0, size: 50) { content { id name enabled modelId } } }`,
  { w: WORKSPACE },
);
const agent = workspaceAgents.content.find((one) => one.enabled && one.modelId !== null);

if (agent === undefined) {
  record(false, `workspace ${WORKSPACE} has an active agent with a model to chat to`);
  await finish(browser);
}

/* ------------------------------------------------------- what is on screen */

const { startChat } = await graphql(
  `mutation ($input: StartChatInput!) { startChat(input: $input) { id } }`,
  { input: { workspaceId: WORKSPACE, title: `zz agents-only ${Date.now()}`, agentId: agent.id } },
);

await page.goto(`${BASE}/chat/${startChat.id}`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the chat')) {
  await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });

  const button = page.locator('h1').first().locator('..').locator('button[aria-expanded]').first();
  await button.click();
  await page.waitForTimeout(400);

  const picker = await page.evaluate(() => {
    const box = document.querySelector('[class*="_picker"]');
    return {
      tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => (tab.textContent ?? '').trim()),
      entries: [...document.querySelectorAll('[class*="_pickerEntry"]')].map((entry) =>
        (entry.textContent ?? '').trim(),
      ),
      opened: box !== null,
    };
  });

  record(picker.opened, 'the picker opens');
  record(
    picker.entries.some((entry) => entry.startsWith(agent.name)),
    `the agent this chat is on is in the list (looking for ${JSON.stringify(agent.name)})`,
  );
  /*
   * No tab strip at all, rather than one tab. A picker showing a lone "Agents"
   * tab would pass an assertion that Agents is first and would still be drawing
   * a choice between one thing and nothing.
   */
  record(
    picker.tabs.length === 0,
    `there are no tabs to choose a half with (found ${picker.tabs.length}: ${picker.tabs.join(', ')})`,
  );
}

/* ------------------------------------------------- and what the API refuses */

/** Whether the server rejected a document, and with a message naming what. */
async function refused(document, variables) {
  try {
    await graphql(document, variables);
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

const modelDoor = await refused(`mutation ($id: ID!) { chooseChatModel(id: $id, modelId: null) { id } }`, {
  id: startChat.id,
});
record(
  modelDoor !== null && modelDoor.includes('chooseChatModel'),
  `chooseChatModel is not a mutation any more (the server said ${JSON.stringify(modelDoor)})`,
);

const nullDoor = await refused(`mutation ($id: ID!) { chooseChatAgent(id: $id, agentId: null) { id } }`, {
  id: startChat.id,
});
record(
  nullDoor !== null,
  `and a chat cannot be handed back to a bare model (the server said ${JSON.stringify(nullDoor)})`,
);

/* Nothing this check made is left behind for the next one to read. */
await graphql(`mutation ($id: ID!) { deleteChat(id: $id) }`, { id: startChat.id }).catch(() => undefined);

await finish(browser);
