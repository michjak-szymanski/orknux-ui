/**
 * Issue #250: switching workspace from a chat leaves you in the chat.
 *
 * It did not. The chat names no workspace in its address, so
 * `workspaceSwitchPath` fell through to "a page belonging to no workspace goes
 * to the workspace's front page" — and the front page is Workflows, in the Flow
 * section. Somebody comparing two workspaces' conversations was thrown out of
 * the conversation on every switch.
 *
 * Staying put is only half of it, and the half that would pass on a fix that
 * did nothing: a chat that stays exactly as it was has not switched workspace.
 * So this asserts the other half too — that the conversations listed on the
 * left are now the other workspace's — which is what makes the first assertion
 * mean something.
 *
 * The third is the corner itself. The shell works out which workspace a page
 * with none in its address is about, and it read that once when it mounted; a
 * fix that stayed on the chat and left the selector naming the workspace it had
 * just left is a fix that reads as having done nothing.
 *
 * And the fourth is the rule this did not change. Switching from a workspace
 * page still lands on the same page of the new workspace, because that rule was
 * right and is what the chat has now joined rather than replaced.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

const STAMP = Date.now();
const ELSEWHERE = `zz suite - somewhere else to chat ${STAMP}`;
const SAID_THERE = `zz only in the other workspace ${STAMP}`;

const { createWorkspace } = await graphql(
  `mutation ($input: CreateWorkspaceInput!) { createWorkspace(input: $input) { id name } }`,
  { input: { name: ELSEWHERE } },
);
const other = String(createWorkspace.id);
await graphql(`mutation ($input: StartChatInput!) { startChat(input: $input) { id } }`, {
  input: { workspaceId: other, title: SAID_THERE },
});

const { chatSessions } = await graphql(`query ($w: ID!) { chatSessions(workspaceId: $w) { id title } }`, {
  w: WORKSPACE,
});
record(chatSessions.length > 0, `workspace ${WORKSPACE} has chats of its own to be taken away from`);

/* The workspace this starts in is the one the corner last recorded, so it is
   recorded the way the application records it: by being on one of its pages. */
await page.goto(`${BASE}/workspace/${WORKSPACE}/issues`, { waitUntil: 'domcontentloaded' });
await drawn(page, 'the issue list');

const picker = page.locator('select[aria-label="Selected workspace"]');

/* ------------------------------------- the rule that was already right */

await picker.selectOption(other);
await page.waitForTimeout(1200);
record(
  new URL(page.url()).pathname === `/workspace/${other}/issues`,
  `switching from a list page still lands on the same list in the new workspace (${new URL(page.url()).pathname})`,
);

/* ------------------------------------------------------- and the chat */

await page.goto(`${BASE}/workspace/${WORKSPACE}/issues`, { waitUntil: 'domcontentloaded' });
await drawn(page, 'the issue list');
await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the chat')) {
  await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(500);

  const before = await page.locator('[class*="_sessionTitle"]').allTextContents();
  record(
    before.some((title) => chatSessions.some((chat) => chat.title === title)),
    `the chats listed are this workspace's (${before.length} of them)`,
  );

  await picker.selectOption(other);
  /*
   * Waited for rather than slept through.
   *
   * The corner and the conversation list do not change in the same frame: the
   * page reads the chosen workspace from a store, and the fetch that was
   * already in flight for the workspace being left lands first - so for a beat
   * the list is the old one and the address bar names a chat in it, and then
   * the second fetch replaces both. A fixed wait passed on a developer's
   * machine and failed in CI, which is the wait being wrong rather than the
   * page: what is being asserted is where it settles, not how many frames it
   * took to get there.
   */
  await page
    .locator('[class*="_sessionTitle"]', { hasText: SAID_THERE })
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(300);

  const where = new URL(page.url()).pathname;
  record(where === '/chat' || where.startsWith('/chat/'), `switching workspace leaves you in the chat (${where})`);

  const lit = await page.evaluate(() => {
    const current = document.querySelector('nav[aria-label="Sections"] [aria-current="page"]');
    return current === null ? null : (current.textContent ?? '').trim();
  });
  record(lit === 'Chat', `and Chat is still the section that is lit (${lit})`);

  record(
    (await picker.inputValue()) === other,
    `the corner names the workspace that was chosen (${await picker.inputValue()}, wanted ${other})`,
  );

  const after = await page.locator('[class*="_sessionTitle"]').allTextContents();
  record(
    after.includes(SAID_THERE),
    `and the conversations listed are the other workspace's (${JSON.stringify(after)})`,
  );
  record(
    !after.some((title) => chatSessions.some((chat) => chat.title === title)),
    'with none of the ones it was showing a moment ago still in the list',
  );
}

/* What this check made, it takes away. */
await graphql(`mutation ($id: ID!) { deleteWorkspace(id: $id) }`, { id: other }).catch(() => undefined);

await finish(browser);
