/**
 * Issues #271 and #272: a chat shows what the model thought and what it looked
 * up, and keeps neither of them inside the answer.
 *
 * ## What this is actually watching for
 *
 * An agent answering in a chat used to be a spinner for a minute and then a
 * paragraph. The lookups were being recorded the whole time — the transcript
 * had them and a task's page drew them live off that same record — but the chat
 * had no way to be told, so a minute of work reached the person as a minute of
 * nothing. And a reasoning model's thinking arrived as *part of* the answer,
 * tags and all, which meant the copy control copied it and the speech model read
 * it out.
 *
 * So the assertions come in two kinds and the second kind matters more. That the
 * thinking and the lookup are **drawn** is the feature. That the answer
 * **does not contain** the thinking is the bug: it is the one thing that cannot
 * be seen by looking at a screenshot, and the one that a later change could undo
 * without anything else noticing.
 *
 * ## Why it needs a model, and what kind
 *
 * `needs: ['model']`, because there is nothing to watch without one. It does not
 * need a *good* model — it needs one that emits reasoning and asks for a tool,
 * which is what the provider the check is pointed at has to do. CI has no model
 * and neither does an ordinary developer machine, which is why this is
 * `ci: false` like the three checks beside it.
 *
 * Run against an installation of your own with a provider that answers the
 * OpenAI-compatible shape with `reasoning_content` and a tool call. What it
 * asserts about the text is deliberately weak — that something was drawn, and
 * that it is not in the answer — so any such provider will do rather than one
 * exact stub.
 */
import { BASE, WORKSPACE, open, record, drawn, shot, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const { workspaceAgents } = await graphql(
  `query ($w: ID!) { workspaceAgents(workspaceId: $w, page: 0, size: 50) {
     content { id name enabled modelId orknuxAccess shellAccess tools skillCatalogs memoryCatalogs }
   } }`,
  { w: WORKSPACE },
);

/*
 * An agent that has been granted something to call.
 *
 * Half of this check is about a lookup being drawn, and an agent offered no
 * tools makes none — `AgentConversation` answers it in one round without a loop
 * at all. Picking one by name and hoping would be a check that passes vacuously
 * on an installation where the grants happen to be empty, which is exactly the
 * failure the seeded fixture would produce.
 */
const armed = (one) =>
  one.orknuxAccess === true ||
  one.shellAccess === true ||
  (one.tools ?? []).length > 0 ||
  (one.skillCatalogs ?? []).length > 0 ||
  (one.memoryCatalogs ?? []).length > 0;

const agent = workspaceAgents.content.find((one) => one.enabled && one.modelId !== null && armed(one));

if (agent === undefined) {
  record(
    false,
    `workspace ${WORKSPACE} has an active agent with a model and something granted to call ` +
      `(the agents here are ${workspaceAgents.content.map((one) => one.name).join(', ') || 'none'})`,
  );
  await finish(browser);
}

/**
 * A chat of this check's own, handed to that agent.
 *
 * Made here rather than taken from the sidebar: what it is pointed at is the
 * whole of what this measures, and reading whichever chat happened to be first
 * is reading whatever somebody last left open.
 */
const { startChat } = await graphql(
  `mutation ($input: StartChatInput!) { startChat(input: $input) { id } }`,
  { input: { workspaceId: WORKSPACE, title: `zz working ${Date.now()}` } },
);
const chatId = startChat.id;
await graphql(`mutation ($id: ID!, $a: ID!) { chooseChatAgent(id: $id, agentId: $a) { id } }`, {
  id: chatId,
  a: agent.id,
});

await page.goto(`${BASE}/chat/${chatId}`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the chat'))) await finish(browser);
await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });

await page.locator('#chat-composer').fill('How many tickets are open?');
await page.keyboard.press('Enter');

/*
 * The lookup, and it has to arrive before the answer does.
 *
 * That ordering is the whole of the live view: a call is recorded before its
 * tool runs, so a lookup that is running is a state the chat draws rather than
 * an absence it hides. Waited for on its own, rather than after the answer has
 * landed, because a check that only looked once the turn was over would pass
 * just as well on a chat that drew every call at the end.
 */
const call = page.locator('[data-testid="call-line"]').first();
let sawCall = false;
try {
  await call.waitFor({ state: 'visible', timeout: 60_000 });
  sawCall = true;
} catch {
  sawCall = false;
}
record(sawCall, 'a lookup the agent made is drawn in the chat');

// And what came back lands on the same line rather than on a second one.
let filledIn = false;
if (sawCall) {
  try {
    await page.locator('[data-testid="call-line"][data-running="false"]').first().waitFor({ timeout: 60_000 });
    filledIn = true;
  } catch {
    filledIn = false;
  }
}
record(filledIn, 'and fills in with what the tool returned');

// The thinking, folded.
const thinking = page.locator('[data-testid="thinking"]').first();
let sawThinking = false;
try {
  await thinking.waitFor({ state: 'visible', timeout: 60_000 });
  sawThinking = true;
} catch {
  sawThinking = false;
}
record(sawThinking, 'what the model thought is drawn');

// Wait for the turn to finish, so the answer below is the whole answer.
await page.locator('[class*="_waiting"]').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => undefined);
await page.waitForTimeout(1500);

const read = await page.evaluate(() => {
  const block = document.querySelector('[data-testid="thinking"]');
  const button = block?.querySelector('button');
  const rows = [...document.querySelectorAll('[class*="_assistantBody"]')];
  const last = rows[rows.length - 1];
  const answer = last?.querySelector('[class*="_markdown"], [class*="_answer"]');
  return {
    folded: button?.getAttribute('aria-expanded') === 'false',
    // Everything the answer element itself holds, which is what the copy
    // control copies and what the speech model is handed.
    said: (answer ?? last)?.textContent?.trim() ?? '',
    /* Whether the thinking block sits inside the answer element or beside it. */
    inside: answer !== null && answer !== undefined && block !== null && answer.contains(block),
  };
});

/*
 * Folded is the default, and it is not merely about length. Thinking is the
 * model talking to itself; it belongs where a footnote belongs, and somebody
 * working out why an answer went the way it did is the one who opens it.
 */
record(sawThinking && read.folded === true, 'and it is folded until somebody opens it');

/*
 * The assertion that is really about the bug.
 *
 * Nothing downstream has to remember to leave the thinking out, because the
 * string those three read - the copy control, the speech model, the next turn's
 * prompt - does not hold it. If this ever goes red, a reasoning model is being
 * read aloud again.
 */
record(!read.inside, 'the thinking is outside the answer, not at the top of it');
record(
  read.said !== '' && !read.said.includes('<think>') && !read.said.includes('</think>'),
  `the answer carries no thinking tags (it reads ${JSON.stringify(read.said.slice(0, 60))})`,
);

/* ------------------------------------------------------------- issue #273 */

/*
 * And a new chat opens on what was just used.
 *
 * Here rather than in a check of its own because the fixture is the same one
 * and it is one line: the chat above has now been spoken to on an agent, which
 * is exactly the state the next chat is supposed to inherit. It used to inherit
 * whichever model sorted first.
 */
const { startChat: next } = await graphql(
  `mutation ($input: StartChatInput!) { startChat(input: $input) { id agentId modelId } }`,
  { input: { workspaceId: WORKSPACE, title: `zz working next ${Date.now()}` } },
);
record(
  next.agentId === agent.id,
  `a new chat opens on the agent the last one used (it opened on ${next.agentId}, wanted ${agent.id})`,
);

await page.goto(`${BASE}/chat/${next.id}`, { waitUntil: 'domcontentloaded' });
await drawn(page, 'the new chat');
const named = await page
  .locator('h1')
  .first()
  .locator('..')
  .locator('button[aria-expanded]')
  .first()
  .textContent();
record(
  (named ?? '').includes(agent.name),
  `and says so above the composer (it says ${JSON.stringify((named ?? '').trim())})`,
);

await page.screenshot({ path: shot('chat-working.png'), fullPage: false });

/* Nothing this check made is left behind for the next one to read. */
for (const id of [chatId, next.id]) {
  await graphql(`mutation ($id: ID!) { deleteChat(id: $id) }`, { id }).catch(() => undefined);
}

await finish(browser);
