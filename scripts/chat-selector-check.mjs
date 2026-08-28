/**
 * Issue #219: the chat's model/agent selector, drawn at a seventh of its width,
 * and the way out to whatever is answering.
 *
 * **Cropped.** The picker is 560px wide and it was drawn 92px wide - the width
 * of the words "Gemma 31B". It used to be a bar across the screen and kept
 * `max-width: 100%` when it moved into the title row, where 100% stopped
 * meaning the screen and started meaning the name it hangs under. A max-width
 * beats a width, so the search box, both tabs and every model in the workspace
 * were squeezed into 90px and clipped; "Agents" was drawn 49px outside the
 * panel it belongs to.
 *
 * This is the shape of bug a screenshot argues about and a measurement settles,
 * so the check walks the open picker and asserts of every box in it that its
 * content fits it (`scrollWidth` against `clientWidth`) and that it lies inside
 * the panel's own edges. Either one alone would have passed at some point in
 * this bug's life: a clipped child is not narrow, and a narrow child is not
 * outside anything.
 *
 * It also asserts the panel is on the screen. The fix anchors it to its right
 * edge rather than its left, which matters because the name sits about a
 * hundred pixels from the window's edge - 560px opening the other way is a
 * panel half of which cannot be read.
 *
 * **And the link.** The same report asked for a way through to the agent or
 * model from here, with an icon. The name was the only place the chat said who
 * was answering and there was nothing to press: finding the agent behind an
 * answer meant leaving the conversation for the workspace's agent list. The
 * check asserts the mark is there, that it is to the right of the name, that it
 * opens in a tab of its own, and - the part worth having - that what it points
 * at is a page that names the same thing the selector does. A link that is
 * present and goes to the wrong row is the bug this would otherwise miss.
 */
import { BASE, WORKSPACE, open, record, finish, shot, drawn } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 900 } });

const { chatSessions } = await graphql(
  `query ($w: ID!) { chatSessions(workspaceId: $w) { id title modelId modelName agentId agentName } }`,
  { w: WORKSPACE },
);
const chat = chatSessions[0];
if (chat === undefined) {
  record(false, 'there is a chat in this workspace to open');
  await finish(browser);
}

await page.goto(`${BASE}/chat/${chat.id}`, { waitUntil: 'domcontentloaded' });
await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(600);

/* ------------------------------------------------------- the picker, opened */

const titleBar = page.locator('h1').first().locator('..');
const button = titleBar.locator('button[aria-expanded]').first();
const named = ((await button.textContent()) ?? '').trim();
record(named !== '', `the selector names who is answering ("${named}")`);

await button.click();
await page.waitForTimeout(400);

const measured = await page.evaluate(() => {
  const picker = document.querySelector('[class*="_picker_"]');
  if (picker === null) return null;
  const panel = picker.getBoundingClientRect();
  const outside = [];
  const clipped = [];
  for (const el of picker.querySelectorAll('*')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const what = `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}"`;
    if (box.right > panel.right + 1 || box.left < panel.left - 1) {
      outside.push(`${what} spans ${Math.round(box.left)}-${Math.round(box.right)}`);
    }
    if (el.scrollWidth > el.clientWidth + 1) {
      clipped.push(`${what} needs ${el.scrollWidth}px in ${el.clientWidth}px`);
    }
  }
  return {
    width: Math.round(panel.width),
    left: Math.round(panel.left),
    right: Math.round(panel.right),
    viewport: window.innerWidth,
    outside,
    clipped,
  };
});

record(measured !== null, 'pressing the name opens the picker');

if (measured !== null) {
  /*
   * 560 is what the stylesheet asks for; the assertion is against something
   * well clear of the button it hangs under, because pinning the number would
   * make this a check about a design decision rather than about the bug.
   */
  record(
    measured.width >= 400,
    `the picker is drawn ${measured.width}px wide, wanted 400 or more (it was 92)`,
  );
  record(
    measured.clipped.length === 0,
    `nothing in the picker is clipped${measured.clipped.length === 0 ? '' : `: ${measured.clipped.join('; ')}`}`,
  );
  record(
    measured.outside.length === 0,
    `nothing in the picker is drawn outside it${measured.outside.length === 0 ? '' : `: ${measured.outside.join('; ')}`}`,
  );
  record(
    measured.left >= 0 && measured.right <= measured.viewport,
    `the picker is on the screen (${measured.left}-${measured.right} of ${measured.viewport})`,
  );
}

await page.screenshot({ path: shot('chat-selector.png'), clip: { x: 0, y: 0, width: 1440, height: 420 } });

/*
 * The entries, because they hold the longer names. A workspace has dozens of
 * agents and an agent is called whatever somebody called it, so if a name is
 * going to run out of the panel it is one of these.
 *
 * There was a tab to press to reach them: the picker had Agents beside Models
 * and opened on whichever half the chat's own choice was in. Issue #295 took
 * the bare model away and the tab strip went with it - the picker lists agents
 * and nothing else - so this measures the list that is already open. What is
 * asserted about it has not changed.
 */
const agents = await page.evaluate(() => {
  const picker = document.querySelector('[class*="_picker_"]');
  const panel = picker.getBoundingClientRect();
  const wrong = [];
  let listed = 0;
  for (const entry of picker.querySelectorAll('[class*="_pickerEntry"]')) {
    listed += 1;
    const box = entry.getBoundingClientRect();
    if (box.right > panel.right + 1 || entry.scrollWidth > entry.clientWidth + 1) {
      wrong.push(`"${(entry.textContent ?? '').trim().slice(0, 30)}"`);
    }
  }
  return { listed, wrong };
});
record(
  agents.listed > 0 && agents.wrong.length === 0,
  `all ${agents.listed} agents are drawn inside the panel${agents.wrong.length === 0 ? '' : `: ${agents.wrong.join(', ')} are not`}`,
);

await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* --------------------------------------------------- the way out, and where */

const jump = titleBar.locator('a[target="_blank"]').first();
record((await jump.count()) === 1, 'there is a link out to whatever is answering');

if ((await jump.count()) === 1) {
  const icon = await jump.locator('svg').count();
  record(icon === 1, `the link is drawn as an icon (${icon} svg in it)`);

  const nameBox = await button.boundingBox();
  const jumpBox = await jump.boundingBox();
  record(
    jumpBox.x >= nameBox.x + nameBox.width - 1,
    `it sits to the right of the name (name ends ${Math.round(nameBox.x + nameBox.width)}, link starts ${Math.round(jumpBox.x)})`,
  );

  const href = await jump.getAttribute('href');
  const wanted =
    chat.agentId === null
      ? `/workspace/${WORKSPACE}/models/${chat.modelId}`
      : `/workspace/${WORKSPACE}/agents/${chat.agentId}/settings`;
  record(href === wanted, `it points at what the selector names (${href}, wanted ${wanted})`);

  /*
   * Followed rather than trusted. `target="_blank"` is deliberate - the
   * conversation is not thrown away to go and look - so the check reads the
   * address and goes there itself instead of chasing a second tab.
   */
  await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
  if (await drawn(page, 'the page the link opens')) {
    const held = await page.locator('body').innerText();
    const expected = chat.agentName ?? chat.modelName;
    record(
      held.includes(expected),
      `the page it opens is the one for "${expected}"`,
    );
  }
}

await finish(browser);
