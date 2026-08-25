/**
 * What a whole chat has spent, still there when somebody comes back to it.
 *
 * The arithmetic is the server's and `ChatCostTest` pins it - added up across
 * turns, both takes of a regenerate counted, a refused turn adding nothing, an
 * agent's lookups in, a picture counted as a picture. What that cannot see is
 * the only thing the owner actually asked for: that the number is *kept*. A
 * total held in the tab would pass every one of those tests and still be gone
 * on reload, which is exactly what the line under the composer used to be.
 *
 * So this asserts the two things a test on the server cannot:
 *
 * **It grows rather than replacing itself.** Two turns, and the second total is
 * larger than the first. `lastSpend` was the same shape on the same line and
 * would have replaced it with whatever the newest answer cost - a number that
 * goes up and down as the conversation goes on, which reads as a running total
 * and is not one. Larger rather than exactly twice, because the model here is
 * whatever the installation has and a second turn carries the first in its
 * context; what is being asserted is addition, not the model's arithmetic.
 *
 * **It survives a reload.** The page is loaded again from nothing and the same
 * figure is read back off it. This is the whole of the change and the one
 * assertion worth the browser: everything up to it is equally true of a number
 * held in React state.
 *
 * And one silence, because #227 got this right and it had to stay right: a chat
 * nobody has spoken in draws no line at all rather than `0 tokens`. Nought here
 * means "not recorded" - a fresh chat, a provider that reported no counts, and
 * every chat older than the column - and a conversation claiming to have cost
 * nothing is worse than one that says nothing.
 *
 * The switch is alice's own and off by default, so this turns it on and puts it
 * back off at the end, the way `chat-cost-check` does with the same column.
 *
 * `needs: ['model']`, for the reason `chat-regenerate-check` gives: nothing in
 * the API writes a turn into Spring AI's store, so there is no way to put an
 * answer into a chat without a model that answers. CI has none.
 */
import { BASE, WORKSPACE, open, record, drawn, shot, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

const { models } = await graphql(`query ($w: ID!) { models(workspaceId: $w) { id name enabled kind } }`, {
  w: WORKSPACE,
});
const model = models.find((one) => one.enabled && one.kind === 'CHAT');
if (model === undefined) {
  record(false, `workspace ${WORKSPACE} has an active chat model to answer with`);
  await finish(browser);
}

const start = async (title) => {
  const { startChat } = await graphql(`mutation ($input: StartChatInput!) { startChat(input: $input) { id } }`, {
    input: { workspaceId: WORKSPACE, title, modelId: model.id },
  });
  return String(startChat.id);
};

// On, because it is off until somebody asks for it - which is a claim
// `chat-cost-check` makes and this one depends on.
await graphql(`mutation { setChatCostShown(shown: true) { chatCostShown } }`);

const spoken = await start(`zz total ${Date.now()}`);
const silent = await start(`zz total silent ${Date.now()}`);

/** The line under the corner of the composer, or null where none is drawn. */
const line = () =>
  page.evaluate(() => {
    const found = document.querySelector('[class*="_spent"]');
    return found === null ? null : (found.textContent ?? '').trim();
  });

/** The number out of it: "12,340 tokens and 2 pictures" -> 12340. */
const tokensIn = (said) => Number((said ?? '').replace(/,/g, '').match(/(\d+)\s+tokens/)?.[1] ?? -1);

async function openChat(id) {
  await page.goto(`${BASE}/chat/${id}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the chat'))) await finish(browser);
  await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });
}

/** Says something and waits for it to be answered. */
async function say(text) {
  const before = await page.evaluate(
    () => document.querySelectorAll('[class*="_assistantBody"]').length,
  );
  await page.locator('#chat-composer').fill(text);
  await page.locator('#chat-composer').press('Enter');
  await page.waitForFunction(
    (was) => {
      const bodies = [...document.querySelectorAll('[class*="_assistantBody"]')];
      return bodies.length > was && /\S/.test(bodies[bodies.length - 1].innerText ?? '');
    },
    before,
    { timeout: 120_000 },
  );
  // The total is read back off the chat at the end of the turn rather than
  // added up here, so it lands a moment after the last word of the answer.
  await page.waitForFunction(() => document.querySelector('[class*="_spent"]') !== null, null, {
    timeout: 30_000,
  });
}

/* ------------------------------------------------ a chat nobody has spoken in */

await openChat(silent);
record(
  (await line()) === null,
  'a chat nobody has spoken in says nothing about what it cost, rather than nought',
);

/* -------------------------------------------------------- one turn, then two */

await openChat(spoken);
record((await line()) === null, 'and neither does the one about to be spoken in, before it is');

await say('Name one thing worth checking in a code review.');
const first = tokensIn(await line());
record(first > 0, `one turn puts a total under the composer (${JSON.stringify(await line())})`);

await say('And a second thing?');
const second = tokensIn(await line());
record(
  second > first,
  `a second turn adds to it rather than replacing it (${first} became ${second})`,
);

/* ------------------------------------------------------------ and it is kept */

await page.screenshot({ path: shot('chat-total.png') });

await openChat(spoken);
const reloaded = tokensIn(await line());
record(
  reloaded === second,
  `the total is still there after a reload, to the token (${second} -> ${reloaded})`,
);

/* ------------------------------------------------------------------ tidy up */

await graphql(`mutation { setChatCostShown(shown: false) { chatCostShown } }`);
for (const id of [spoken, silent]) {
  await graphql(`mutation ($id: ID!) { deleteChat(id: $id) }`, { id });
}

await finish(browser);
