/**
 * Where the copy control sits on a sent message.
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
 * The third asserts it is revealed by hovering rather than merely happening to
 * be on screen, since a control that is always drawn would pass the two above
 * without anything having been fixed.
 *
 * The other half of issue #188 - that the two voices hide and show by the same
 * rule - is `chat-copy-answer-check`, which needs a model to have answered.
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

  /*
   * The two-voice rule moved to `chat-copy-answer-check`, because it needs an
   * answer and this check does not.
   *
   * A seeded installation has no model it can reach, so its chats are a
   * question with nothing after it. This waited on `Copy this answer`, timed
   * out after thirty seconds and reported the placement of the sent control as
   * broken - three good assertions lost to a fourth that could never run.
   *
   * The suite already has a word for this: `needs: ['model']`. What it did not
   * have was a way to say that of half a check, so the half became its own.
   */
}

await finish(browser);
