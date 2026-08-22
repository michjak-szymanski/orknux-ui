/**
 * The two voices hide and show their copy control by the same rule.
 *
 * The other half of issue #188. A sent message hid its button with
 * `visibility` and revealed it on `:hover`; an answer faded a row in on
 * `:hover` or `:focus-within`. Same control, two mechanisms, and only one of
 * them reachable from a keyboard. This asserts they now resolve to the same
 * computed opacity in the same state, which is what a shared class buys.
 *
 * Split out of `chat-copy-check` because it needs something that check does
 * not: an answer. A seeded installation has no model it can reach, so its
 * chats are a question with nothing after it, and this waited thirty seconds
 * on `Copy this answer` before reporting the *sent* control as broken. Three
 * good assertions were being lost to a fourth that could never run there.
 *
 * So it declares `needs: ['model']` and CI does not run it. That is a real gap
 * and worth naming rather than hiding: nothing unattended proves the answer
 * side of this. Closing it needs a fixture with a stored answer in it, which
 * needs either a model CI can reach or a way to write a turn without one.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

// The seed builds this one; found by name rather than by id because a database
// built from nothing does not hand out the same ids twice.
const { chatSessions } = await graphql(
  `query ($w: ID!) { chatSessions(workspaceId: $w) { id title } }`,
  { w: WORKSPACE },
);
const wanted = 'First checks for a login failure';
const chat = chatSessions.find((one) => one.title === wanted);

if (chat === undefined) {
  record(false, `no chat called ${JSON.stringify(wanted)} in workspace ${WORKSPACE}; the seed builds it`);
  await finish(browser);
}

await page.goto(`${BASE}/chat/${chat.id}`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the chat log')) {
  /*
   * Said plainly rather than left to a timeout. Without an answer there is
   * nothing here to measure, and a thirty-second wait that ends in a stack
   * trace does not tell anybody that.
   */
  const answers = await page.locator('button[aria-label="Copy this answer"]').count();
  record(answers > 0, `the conversation has an answer in it to measure (${answers} found)`);

  if (answers > 0) {
    await page.locator('button[aria-label="Copy this answer"]').first().hover();
    await page.waitForTimeout(300);
    const both = await page.evaluate(() => ({
      sent: getComputedStyle(
        document.querySelector('button[aria-label="Copy this message"]').parentElement,
      ).opacity,
      answer: getComputedStyle(
        document.querySelector('button[aria-label="Copy this answer"]').parentElement,
      ).opacity,
    }));
    record(
      both.answer === '1' && both.sent === '0',
      `the two voices hide and show by the same rule: with the answer hovered, ` +
        `answer ${both.answer}, sent ${both.sent}`,
    );
  }
}

await finish(browser);
