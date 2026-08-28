/**
 * Issue #245: asking the last answer again, and not losing the one it replaced.
 *
 * Regenerating is easy to build in a way that passes a screenshot and loses
 * work: take the answer off the thread, put a new one there, and the answer
 * somebody was about to keep is gone with no way back. So the assertions here
 * are mostly about the old answer rather than the new one — that it is still
 * readable, that stepping back reaches it, and that it survives a reload, which
 * is what tells a take kept on the server from one kept in a tab.
 *
 * The counting matters too. Only the answer a conversation ends on can be asked
 * again: anything earlier has been answered on top of, and a different answer
 * three turns back would rewrite what those turns were replying to. So the
 * check says something else afterwards and asserts the button has left the
 * answer it was on.
 *
 * `needs: ['model']`, because there is no way to put an answer into a chat
 * without one: the thread is Spring AI's store and nothing in the API writes a
 * turn to it. CI has no model, so CI does not run this — the same gap
 * `chat-copy-answer-check` names, and the same reason.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

/*
 * An agent to answer with, rather than a model. Issue #295 took `modelId` off
 * `StartChatInput`: a chat is opened on an agent or it is not opened, and the
 * model behind that agent is what answers. So the precondition is the same
 * precondition in the new shape — something switched on, with a model — and
 * which agent it is does not matter here, because nothing below reads who
 * answered, only that something did and that it can be asked again.
 */
const { workspaceAgents } = await graphql(
  `query ($w: ID!) { workspaceAgents(workspaceId: $w, page: 0, size: 50) { content { id name enabled modelId } } }`,
  { w: WORKSPACE },
);
const agent = workspaceAgents.content.find((one) => one.enabled && one.modelId !== null);
if (agent === undefined) {
  record(false, `workspace ${WORKSPACE} has an active agent with a model to answer with`);
  await finish(browser);
}

const { startChat } = await graphql(`mutation ($input: StartChatInput!) { startChat(input: $input) { id } }`, {
  input: { workspaceId: WORKSPACE, title: `zz regenerate ${Date.now()}`, agentId: agent.id },
});
const chat = String(startChat.id);

await page.goto(`${BASE}/chat/${chat}`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the chat'))) await finish(browser);
await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });

/** What every answer in the log currently reads, in order. */
const answers = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[class*="_assistantBody"]')].map((body) => (body.innerText ?? '').trim()),
  );

/** Says something and waits for it to be answered. */
async function say(text) {
  const before = (await answers()).length;
  await page.locator('#chat-composer').fill(text);
  await page.locator('#chat-composer').press('Enter');
  await page.waitForFunction(
    (was) => {
      const bodies = [...document.querySelectorAll('[class*="_assistantBody"]')];
      return bodies.length > was && /\S/.test(bodies[bodies.length - 1].innerText ?? '');
    },
    before,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(600);
}

/** The stub numbers its answers, which is the only way to tell two of them apart. */
const takeNumber = (text) => Number(/Take (\d+)/.exec(text ?? '')?.[1] ?? -1);

const stepper = () => page.locator('[class*="_takeCount"]');

await say('What is the first thing to check?');
const first = (await answers()).at(-1);
record(takeNumber(first) > 0, `the model answered (${JSON.stringify((first ?? '').slice(0, 60))})`);
record((await stepper().count()) === 0, 'an answer given once says nothing about takes');

/* ------------------------------------------------------------- ask again */

const again = page.locator('button[aria-label="Answer again"]');
record((await again.count()) === 1, 'the last answer offers to be given again');
await again.click();
await page.waitForFunction(
  (was) => {
    const bodies = [...document.querySelectorAll('[class*="_assistantBody"]')];
    const held = bodies[bodies.length - 1]?.innerText ?? '';
    return /Take \d+/.test(held) && Number(/Take (\d+)/.exec(held)[1]) !== was;
  },
  takeNumber(first),
  { timeout: 60_000 },
);
await page.waitForTimeout(600);

const second = (await answers()).at(-1);
record(
  takeNumber(second) !== takeNumber(first),
  `asking again gives a different answer (take ${takeNumber(first)} became take ${takeNumber(second)})`,
);
record(
  (await stepper().textContent()) === '2 of 2',
  `and the answer says which take is being read (${await stepper().textContent()})`,
);

/* ---------------------------------------------- the one it replaced, back */

await page.locator('button[aria-label="The answer before this one"]').click();
await page.waitForTimeout(400);
record(
  takeNumber((await answers()).at(-1)) === takeNumber(first),
  'stepping back reads the answer that was replaced, word for word',
);
record((await stepper().textContent()) === '1 of 2', `and says so (${await stepper().textContent()})`);

await page.locator('button[aria-label="The answer after this one"]').click();
await page.waitForTimeout(400);
record(
  takeNumber((await answers()).at(-1)) === takeNumber(second),
  'and stepping forward comes back to the one that stands',
);

/* --------------------------------------------- kept, not held in a tab */

await page.reload({ waitUntil: 'domcontentloaded' });
await drawn(page, 'the chat, reloaded');
await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(600);

record(
  (await stepper().textContent()) === '2 of 2',
  `the earlier take survives a reload, so it was kept rather than remembered (${await stepper().textContent()})`,
);
record(
  takeNumber((await answers()).at(-1)) === takeNumber(second),
  'and the answer that stands after a reload is the newest one',
);
await page.locator('button[aria-label="The answer before this one"]').click();
await page.waitForTimeout(400);
record(
  takeNumber((await answers()).at(-1)) === takeNumber(first),
  'with the replaced answer still one press away',
);

/* ------------------------------------------ and only the last one at that */

await say('And after that?');
const offered = await page.evaluate(() =>
  [...document.querySelectorAll('[class*="_assistantBody"]')].map(
    (body) => body.querySelectorAll('button[aria-label="Answer again"]').length,
  ),
);
record(
  offered.length > 1 && offered.slice(0, -1).every((count) => count === 0) && offered.at(-1) === 1,
  `only the answer the conversation ends on can be asked again (${JSON.stringify(offered)})`,
);
/*
 * The record does not go away when the conversation moves on. It is still that
 * answer's history — and still on whichever take was being read, because
 * saying something else is not a reason to move somebody off the paragraph they
 * had chosen to look at.
 */
const held = await page.locator('[class*="_takeCount"]').first().textContent();
record(
  /^\d+ of 2$/.test(held ?? ''),
  `and the answer that was asked twice still says so, now that it is no longer last (${held})`,
);

await graphql(`mutation ($id: ID!) { deleteChat(id: $id) }`, { id: chat }).catch(() => undefined);

await finish(browser);
