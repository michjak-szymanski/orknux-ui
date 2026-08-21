/**
 * Where the copy control sits, and how it is revealed, on both voices.
 *
 * The button was the first child of `.userRow`, before the bubble's own
 * wrapper - so on a right-aligned sent message it was drawn in the empty gutter
 * to the *left* of the bubble, level with its first line. It was the one place
 * it could sit and not look like it belonged to anything. Measured on the seed's
 * chat: the button's right edge 766, the bubble's left edge 774.
 *
 * Two assertions, because "under it" alone would pass with the button under the
 * column rather than under the message: its top must be below the bubble's
 * bottom, and its right edge must be the bubble's right edge and not the log's.
 *
 * The third is the other half of issue #188. A sent message hid its button with
 * `visibility` and revealed it on `:hover`; an answer faded a row in on
 * `:hover` or `:focus-within`. Same control, two mechanisms, and only one of
 * them reachable from a keyboard. This asserts they now resolve to the same
 * computed opacity in the same state, which is what a shared class buys.
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
  await page.waitForSelector('button[aria-label="Copy this message"]', { timeout: 20_000 });

  const sent = page.locator('button[aria-label="Copy this message"]').first();
  await sent.hover();
  await page.waitForTimeout(300);

  const placed = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Copy this message"]');
    const bubble = [...document.querySelectorAll('div')].find((one) =>
      one.className.includes('userBubble'),
    );
    const b = button.getBoundingClientRect();
    const u = bubble.getBoundingClientRect();
    return {
      top: Math.round(b.top),
      right: Math.round(b.right),
      bubbleBottom: Math.round(u.bottom),
      bubbleRight: Math.round(u.right),
      bubbleLeft: Math.round(u.left),
      // What it is revealed by, rather than whether it happens to be visible.
      opacity: getComputedStyle(button.parentElement).opacity,
    };
  });

  record(
    placed.top >= placed.bubbleBottom,
    `the copy control's box starts at ${placed.top}, at or below the bubble's bottom edge ${placed.bubbleBottom}`,
  );
  record(
    placed.right === placed.bubbleRight,
    `it shares the bubble's right edge: control ${placed.right}, bubble ${placed.bubbleRight} ` +
      `(the bubble's left edge is ${placed.bubbleLeft}, so a control aligned to the column would not match)`,
  );
  record(
    placed.opacity === '1',
    `hovering the sent message reveals it: opacity ${placed.opacity}`,
  );

  // The same gesture on the other voice, read the same way.
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
    `and the two voices hide and show by the same rule: with the answer hovered, ` +
      `answer ${both.answer}, sent ${both.sent}`,
  );
}

await finish(browser);
