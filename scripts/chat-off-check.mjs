/**
 * An installation with chat switched off stops offering chat's settings.
 *
 * Issue #201. The switch is on the admin's settings screen and it already did
 * most of its job: the Chat tab goes, Go to stops listing it, and the page
 * itself says an administrator turned it off. What stayed behind was the
 * workspace's own Chat card - a model for naming chats, a model for the
 * microphone in a chat, a model to read an answer in a chat aloud - three
 * settings for a screen nobody in that installation can open, sitting on the
 * page an administrator goes to next.
 *
 * The Quick Chat model is deliberately not among them and is asserted to stay.
 * The AI button is a different feature under the same word: the server's flag
 * governs `ChatAPI` and `ChatStreamAPI` and nothing else, the manual says the
 * switch "takes the tab away and refuses new messages", and what decides
 * whether the button is offered is the workspace's own "None - the AI button is
 * not offered". Hiding its model with chat's would take away the only way to
 * turn off something that still works.
 *
 * The switch is flipped over GraphQL and put back in a `finally`, whatever
 * happens in between: this runs against a real installation, and a check that
 * leaves chat off is a check that broke the thing it was measuring.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const FIELDS = 'chatEnabled chatConfigurable';

/** What the chat's own settings are called on the workspace's settings page. */
const CHATS_OWN = ['Companion Model', 'Speech-to-text Model', 'Text-to-speech Model'];

async function settingsPage() {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/settings`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the workspace settings'))) return null;
  // The models arrive after the workspace does, and the fields are drawn with them.
  await page.waitForTimeout(1500);
  return page.evaluate(() => ({
    text: document.querySelector('main')?.innerText ?? '',
    headings: [...document.querySelectorAll('main h2')].map((one) => one.textContent?.trim() ?? ''),
  }));
}

/** Whether the top bar offers the Chat section, and whether Go to lists it. */
async function chatOffered() {
  await page.goto(`${BASE}/workspace/${WORKSPACE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[aria-label="Go to a page"]', { timeout: 20_000 });
  await page.waitForTimeout(1200);
  const inBar = await page.locator('nav[aria-label="Sections"] a', { hasText: 'Chat' }).count();
  await page.click('input[aria-label="Go to a page"]');
  await page.fill('input[aria-label="Go to a page"]', 'chat');
  await page.waitForTimeout(400);
  const rows = await page.$$eval('ul[role="listbox"] [role="option"]', (all) =>
    all.map((one) => [...one.querySelectorAll('span')][1]?.textContent?.trim() ?? ''),
  );
  return { inBar, rows };
}

const before = await graphql(`{ installationSettings { ${FIELDS} } }`);
console.log(`chat was: ${JSON.stringify(before.installationSettings)}`);
record(
  before.installationSettings.chatConfigurable,
  'this installation lets chat be switched at all, so there is something to measure',
);

try {
  /* ---- with chat on, which is what the rest of the suite runs against ---- */

  await graphql(`mutation { setChatEnabled(enabled: true) { ${FIELDS} } }`);
  const on = await settingsPage();
  record(
    on !== null && CHATS_OWN.every((field) => on.text.includes(field)),
    `with chat on, the workspace offers chat's own settings (${CHATS_OWN.join(', ')})`,
  );
  record(on !== null && on.text.includes('Quick Chat Model'), 'and the Quick Chat model beside them');

  /* ---- and with it off ---- */

  await graphql(`mutation { setChatEnabled(enabled: false) { ${FIELDS} } }`);
  const off = await settingsPage();

  const left = off === null ? CHATS_OWN : CHATS_OWN.filter((field) => off.text.includes(field));
  record(left.length === 0, `with chat off, none of them is still offered (left: ${left.join(', ') || 'none'})`);
  record(
    off !== null && !off.headings.includes('Chat'),
    `and the card they sat in is gone with them (headings: ${off?.headings.join(' / ') ?? 'none'})`,
  );

  /*
   * The AI button's model stays, on purpose. The flag governs the chat screen -
   * what turns the button off is the None this field already has.
   */
  record(
    off !== null && off.text.includes('Quick Chat Model'),
    'the Quick Chat model stays, because the AI button is not what this switch turns off',
  );

  /* ---- and the halves that already worked keep working ---- */

  const offered = await chatOffered();
  record(offered.inBar === 0, `the top bar offers no Chat link (${offered.inBar} found)`);
  record(
    !offered.rows.includes('Chat'),
    `and Go to does not list it either (${offered.rows.join(', ') || 'nothing'})`,
  );

  await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const said = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
  record(/turned off/i.test(said), 'and the address itself says who turned it off');

  /* ---- put back, and the settings come back with it ---- */

  await graphql(`mutation { setChatEnabled(enabled: true) { ${FIELDS} } }`);
  const again = await settingsPage();
  record(
    again !== null && CHATS_OWN.every((field) => again.text.includes(field)),
    'switching it back on brings the settings back, so it is the flag doing this and not a broken page',
  );
} finally {
  const put = await graphql(`mutation($on: Boolean!) { setChatEnabled(enabled: $on) { ${FIELDS} } }`, {
    on: before.installationSettings.chatEnabled,
  }).catch(() => null);
  console.log(`chat put back to: ${JSON.stringify(put?.setChatEnabled ?? 'FAILED - set it by hand')}`);
  record(put !== null, 'the switch was left as it was found');
}

await finish(browser);
