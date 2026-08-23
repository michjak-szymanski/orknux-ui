/**
 * What a Slack connection can see, said beside the field as it is typed.
 *
 * Issue #176's checking half. `slackTarget` answers a question about a user or
 * a channel with one of three outcomes and a sentence ready to show, and this
 * drives the interface that shows it. The three are not three shades of the
 * same thing, and every claim here is about keeping them apart:
 *
 *   1. The sentence arrives unaltered. Every outcome is asserted as an exact
 *      string against what came back on the wire, because the server's wording
 *      is the feature - it says which connection was asked, what it could not
 *      see, and, when the question could not be put at all, which scope to add
 *      and why sending never needed it. An interface that trimmed it to a line
 *      would be throwing away the half that says what to do.
 *   2. `NOT_FOUND` is advice and not a refusal. It is not painted the colour a
 *      refused save is painted - measured, per channel, against an element
 *      painted `--color-danger` on the same page - and, the assertion that
 *      matters most, Save stays live and the action saves as typed. The server
 *      has a test pinning exactly that; this is the same claim from the other
 *      side of the wire.
 *   3. `UNCHECKED` is not a judgement on the typing either. It keeps the
 *      ordinary hint grey, and its long sentence is printed whole.
 *   4. The answer never lags the field. A reply to text that has since been
 *      edited must not be drawn, and neither must the previous answer sit under
 *      new text while the new one is in flight - both are the same lie as a
 *      description a keystroke behind, and the second is the one a `current`
 *      flag alone does not stop.
 *   5. It does not move the form. Measured as the top of the Create Action
 *      button, across the shortest and longest answers there are - a hint that
 *      grows and shrinks under the pointer is what makes a live one feel broken.
 *   6. It is not a request per keystroke, and it is not asked at all about a
 *      connection that is not Slack or a field with nothing in it.
 *
 * The first leg runs against the real server with no interception at all: a
 * Slack connection with no bot token stored, which is answered `UNCHECKED` in
 * one sentence without anything having to reach slack.com. That is the leg that
 * proves the query, the variables and the schema agree with the server the
 * suite is running against. The three outcomes are then forced by answering the
 * query in the browser, because `FOUND` needs a Slack workspace to be found in
 * and `NOT_FOUND` needs one to be absent from, and neither is a thing CI has.
 *
 * It makes its own connections and its own action, and removes all three.
 */
import { BASE, WORKSPACE, drawn, finish, open, record, shot } from './suite/harness.mjs';

const { browser, context, page } = await open({ viewport: { width: 1440, height: 1000 } });

const call = async (query, variables) => {
  const answer = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await answer.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors).slice(0, 400));
  return body.data;
};

const stamp = Date.now();
const SLACK = `zz scratch slack target ${stamp}`;
const MAIL = `zz scratch mail target ${stamp}`;
const ACTION = `zz scratch slack action ${stamp}`;

/**
 * The answers the browser is given for the three outcomes.
 *
 * The wording is the server's own, copied from `SlackDirectory`, so that what
 * is asserted below is a real sentence of the length a real one is - the
 * `UNCHECKED` one is four sentences and eight lines in this dialog, which is
 * the whole reason the layout claim exists. Nothing here pins the wording: the
 * assertions compare the screen against whatever came back, so the server may
 * reword any of it without this check going red. What it may not do is arrive
 * on screen as anything other than itself.
 */
const ANSWERS = {
  general: {
    outcome: 'FOUND',
    message: `#general is a channel ${SLACK} can see.`,
    id: 'C0123456789',
    label: '#general',
  },
  // A found thing whose sentence does not open with what Slack calls it. The
  // label is the half that says which thing matched - `alice` typed, `Alice
  // Adams` found - so it has to be on screen either way.
  alice: {
    outcome: 'FOUND',
    message: `A member of ${SLACK} answers to that.`,
    id: 'U0123456789',
    label: 'Alice Adams',
  },
  nowhere: {
    outcome: 'NOT_FOUND',
    message:
      `No channel ${SLACK} can see is called #nowhere. A private channel this bot was never ` +
      'invited to looks the same from here, so this is advice rather than a verdict.',
  },
  scopeless: {
    outcome: 'UNCHECKED',
    message:
      `Slack was not asked whether scopeless exists, because the bot token on ${SLACK} does not ` +
      'carry channels:read or groups:read. Nothing is wrong with the connection and nothing is ' +
      'wrong with what is typed here: sending a message needs no such scope, so a token that ' +
      'posts perfectly well can still be unable to look anything up, and this has not been ' +
      'checked rather than found to be wrong. Add channels:read or groups:read to the Slack app ' +
      'and reinstall it to have channel names checked here.',
  },
};

const FALLBACK = { outcome: 'NOT_FOUND', message: 'Nothing here answers to that.', id: null, label: null };

/** Every question that actually reached the wire, in order. */
let asked = [];
/** A name whose answer is deliberately slow, and how slow. */
let slow = null;
const HELD = 1500;

const box = () => page.locator('#action-target-answer');
const said = async () => ((await box().count()) === 0 ? '' : (await box().innerText()).trim());
const outcomeOf = () => box().getAttribute('data-outcome');
const saveButton = () => page.locator('dialog[open] button[type="submit"]');

/** What one colour is, as the browser paints it. */
const colourOf = (locator) => locator.evaluate((node) => getComputedStyle(node).color);

/** The same for a token, read off an element painted with it on this very page. */
const tokenColour = (token) =>
  page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const painted = getComputedStyle(probe).color;
    probe.remove();
    return painted;
  }, token);

/** How far apart two painted colours are, per channel. See UI-DESIGN-RULES.md. */
function apart(one, other) {
  const channels = (colour) => (colour.match(/\d+/g) ?? []).map(Number).slice(0, 3);
  const a = channels(one);
  const b = channels(other);
  return Math.max(...a.map((value, at) => Math.abs(value - b[at])));
}

/** Type into the target field one character at a time, as somebody would. */
async function type(text) {
  await page.fill('#action-target-name', '');
  await page.locator('#action-target-name').pressSequentially(text, { delay: 30 });
}

/**
 * Wait until the box is answering about what is in the field now.
 *
 * Waits rather than asserts, and gives up quietly: what is on screen is
 * asserted by the `record` that follows, so an answer that never arrives - or
 * arrives reworded - is reported as the sentence that was wrong rather than as
 * a check that hung.
 */
async function settled(expected) {
  await page
    .waitForFunction(
      (wanted) => document.querySelector('#action-target-answer')?.innerText.trim() === wanted,
      expected,
      { timeout: 10_000 },
    )
    .catch(() => {});
}

let slackId = null;
let mailId = null;
let actionId = null;

try {
  /* ---------------------------------------------------------------- fixture */

  slackId = (
    await call(
      `mutation ($input: CreateWorkspaceConnectionInput!) {
         createWorkspaceConnection(input: $input) { id }
       }`,
      { input: { workspaceId: WORKSPACE, name: SLACK, type: 'SLACK' } },
    )
  ).createWorkspaceConnection.id;

  // Something that is not Slack, to prove nothing is asked about one.
  mailId = (
    await call(
      `mutation ($input: CreateWorkspaceConnectionInput!) {
         createWorkspaceConnection(input: $input) { id }
       }`,
      {
        input: {
          workspaceId: WORKSPACE,
          name: MAIL,
          type: 'SMTP',
          url: 'smtp.example.com',
          smtpFrom: 'orknux@example.com',
          smtpSecurity: 'STARTTLS',
        },
      },
    )
  ).createWorkspaceConnection.id;

  /* ------------------------------------------ the dialog, and the two fields */

  await page.goto(`${BASE}/workspace/${WORKSPACE}/actions`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the actions page'))) await finish(browser, false);

  await page.locator('button', { hasText: /^\+ Create Action$/ }).click();
  await page.waitForSelector('#action-name', { timeout: 20_000 });
  await page.waitForTimeout(1200);

  await page.fill('#action-name', ACTION);

  /** Takes the row named, out of the picker with this id. */
  const choose = async (id, label) => {
    await page.locator(`#${id}`).click();
    await page.waitForTimeout(300);
    await page.locator('[role="option"]', { hasText: new RegExp(`^${label}`) }).first().click();
    await page.waitForTimeout(300);
  };

  /* ------------------------------ nothing is asked about a connection that is
                                    not Slack, or about an empty field       */

  await choose('action-connection', MAIL);
  await type('general');
  await page.waitForTimeout(900);
  record((await box().count()) === 0, 'nothing is said under the field about a connection that is not Slack');

  await choose('action-connection', SLACK);
  await page.fill('#action-target-name', '');
  await page.waitForTimeout(900);
  record((await box().count()) === 1, 'a Slack connection gets the answer box, before anything is typed');
  record((await said()) === '', 'and it says nothing, because nothing has been typed');
  record((await outcomeOf()) === 'nothing', 'the box knows it is holding no answer');

  /* ------------------------------------------- the real server, uninterrupted */

  /*
   * No interception at all here. A connection with no bot token stored is
   * answered in one sentence without anything having to reach slack.com, so
   * this leg is deterministic offline - and it is the only leg that proves the
   * query, its variables and the schema agree with the server the suite is
   * actually running against.
   */
  const truly = (
    await call(
      `query ($c: ID!, $t: MessageTarget!, $n: String!) {
         slackTarget(connectionId: $c, target: $t, name: $n) { outcome message }
       }`,
      { c: slackId, t: 'CHANNEL', n: 'general' },
    )
  ).slackTarget;

  await type('general');
  await settled(truly.message);
  record(
    (await said()) === truly.message,
    `the real server's own sentence, printed as it arrived: ${JSON.stringify(await said())}`,
  );
  record((await outcomeOf()) === truly.outcome, `and drawn as ${truly.outcome}`);

  /* ------------------------------------------------------- the three, forced */

  await page.route('**/graphql', async (route) => {
    const body = route.request().postDataJSON() ?? {};
    if (!String(body.query ?? '').includes('slackTarget')) {
      await route.continue();
      return;
    }
    const name = body.variables?.name ?? '';
    asked.push(name);
    if (slow === name) await new Promise((wake) => setTimeout(wake, HELD));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { slackTarget: { id: null, label: null, ...(ANSWERS[name] ?? FALLBACK) } } }),
    });
  });

  const hintColour = await tokenColour('--color-text-muted');
  const dangerColour = await tokenColour('--color-danger');

  // ---- FOUND

  await type('general');
  await settled(ANSWERS.general.message);
  const foundColour = await colourOf(box());
  record((await said()) === ANSWERS.general.message, 'FOUND: the sentence, verbatim');
  record((await outcomeOf()) === 'FOUND', 'FOUND: drawn as itself');
  record(
    apart(foundColour, hintColour) >= 40,
    `FOUND: painted as a confirmation (${foundColour} against ${hintColour})`,
  );
  await page.screenshot({ path: shot('slack-target-found.png') });

  // The label, when the sentence does not lead with it.
  await type('alice');
  await settled([ANSWERS.alice.label, ANSWERS.alice.message].join(' '));
  const withLabel = await said();
  record(
    withLabel.includes(ANSWERS.alice.message),
    'FOUND: the sentence is still whole when a label is shown beside it',
  );
  record(withLabel.includes(ANSWERS.alice.label), `FOUND: and says which thing matched (${JSON.stringify(withLabel)})`);

  // ---- NOT_FOUND

  await type('nowhere');
  await settled(ANSWERS.nowhere.message);
  const adviceColour = await colourOf(box());
  record((await said()) === ANSWERS.nowhere.message, 'NOT_FOUND: the sentence, verbatim, advice and all');
  record((await outcomeOf()) === 'NOT_FOUND', 'NOT_FOUND: drawn as itself');
  record(
    apart(adviceColour, dangerColour) >= 40,
    `NOT_FOUND: not painted the colour a refusal is painted (${adviceColour} against ${dangerColour})`,
  );
  record(apart(adviceColour, foundColour) >= 40, `NOT_FOUND: and not the colour a confirmation is (${adviceColour})`);
  record(await saveButton().isEnabled(), 'NOT_FOUND: Save stays live');
  await page.screenshot({ path: shot('slack-target-not-found.png') });

  // ---- UNCHECKED

  await type('scopeless');
  await settled(ANSWERS.scopeless.message);
  const uncheckedColour = await colourOf(box());
  record((await said()) === ANSWERS.scopeless.message, 'UNCHECKED: the whole sentence, unsummarised and unclipped');
  record((await outcomeOf()) === 'UNCHECKED', 'UNCHECKED: drawn as itself');
  record(
    apart(uncheckedColour, hintColour) === 0,
    `UNCHECKED: kept the ordinary hint grey, being no judgement at all (${uncheckedColour})`,
  );
  record(apart(uncheckedColour, dangerColour) >= 40, 'UNCHECKED: and nothing like a refusal');
  await page.screenshot({ path: shot('slack-target-unchecked.png') });

  /*
   * The long one does not fit in the room the box takes, and that is the whole
   * point of the box taking the same room whatever it says. What must not
   * happen is the rest being unreachable: it scrolls, so the sentence that says
   * which scope to add can actually be read.
   */
  const reach = await box().evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    return { taller: node.scrollHeight > node.clientHeight + 4, scrolled: node.scrollTop > 0 };
  });
  record(reach.taller, 'UNCHECKED: the sentence is longer than the room kept for it');
  record(reach.scrolled, 'and the rest of it can be reached rather than being cut off');

  /* ----------------------------------------------- it does not move the form */

  /*
   * The Create Action button is the thing under all of this, and the thing
   * somebody is reaching for while they read. Where its top edge is, is where
   * everything below the answer is.
   */
  const tops = [];
  const heights = [];
  for (const typed of ['', 'general', 'nowhere', 'scopeless', '']) {
    if (typed === '') {
      await page.fill('#action-target-name', '');
      await page.waitForTimeout(600);
    } else {
      await type(typed);
      await settled(ANSWERS[typed].message);
    }
    tops.push(Math.round((await saveButton().boundingBox()).y));
    heights.push(Math.round((await box().boundingBox()).height));
  }
  console.log(`Create Action sat at y = ${tops.join(', ')}`);
  console.log(`the answer was ${heights.join(', ')} tall`);
  record(new Set(tops).size === 1, 'nothing below the answer moves as the answer changes');
  record(new Set(heights).size === 1, 'because the room it takes is the same whatever it says, and empty');

  /* ---------------------------------------------- and does not lag the field */

  /*
   * `nowhere` is answered slowly on purpose, and the field is walked through
   * three texts across that one slow reply. Two things must hold and they fail
   * separately: while an answer is being fetched the box must not still be
   * showing the answer to the text before it, and when the slow reply finally
   * lands it must not be drawn over text that has moved on again.
   */
  slow = 'nowhere';
  await type('general');
  await settled(ANSWERS.general.message);

  await page.locator('#action-target-name').fill('nowhere');
  await page.waitForTimeout(900);
  const whileWaiting = await said();
  record(
    whileWaiting !== ANSWERS.general.message,
    `the answer to the last text is not left standing under new text (${JSON.stringify(whileWaiting)})`,
  );
  record(await outcomeOf() === 'asking', 'the box says it is asking rather than answering');

  // Edited again while that slow answer is still on its way.
  await page.locator('#action-target-name').fill('scopeless');
  await settled(ANSWERS.scopeless.message);
  await page.waitForTimeout(HELD + 1200);
  const afterward = await said();
  record(afterward !== ANSWERS.nowhere.message, 'a reply about text that has since been edited is never printed');
  record(
    afterward === ANSWERS.scopeless.message,
    `and what is on screen is about what is in the field (${JSON.stringify(afterward.slice(0, 60))}...)`,
  );
  slow = null;

  /* ------------------------------------------------ one question, not twelve */

  asked = [];
  await type('engineering');
  await page.waitForTimeout(1500);
  console.log(`eleven keystrokes asked: ${JSON.stringify(asked)}`);
  record(asked.length <= 2, `typing a name is one question and not one per keystroke (${asked.length})`);
  record(asked.length >= 1, 'and it is asked');
  record(asked.at(-1) === 'engineering', 'about the whole of what was typed');

  /* ----------------------------------------- and none of it refuses the save */

  /*
   * The claim the server keeps its own test for, from this side of the wire:
   * the field is free text, so an action naming something Slack cannot see is
   * saved exactly as it was typed.
   */
  await type('nowhere');
  await settled(ANSWERS.nowhere.message);
  record(await saveButton().isEnabled(), 'Save is live over a NOT_FOUND');
  await saveButton().click();
  await page.waitForTimeout(2500);

  const saved = (
    await call(
      `query ($w: ID!) {
         workspaceActions(workspaceId: $w, page: 0, size: 200) { content { id name targetName } }
       }`,
      { w: WORKSPACE },
    )
  ).workspaceActions.content.find((one) => one.name === ACTION);
  actionId = saved?.id ?? null;
  record(saved !== undefined, 'and the action saved');
  record(saved?.targetName === 'nowhere', `with the target as typed (${JSON.stringify(saved?.targetName ?? null)})`);
} finally {
  await page.unroute('**/graphql').catch(() => {});
  for (const [query, variables] of [
    ['mutation ($id: ID!) { deleteAction(id: $id) }', { id: actionId }],
    // A connection the workspace added itself has nothing to fall back on, so
    // disconnecting it is how one goes - there is no delete for it.
    ['mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }', { id: slackId }],
    ['mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }', { id: mailId }],
  ]) {
    if (variables.id === null) continue;
    await call(query, variables).catch(() => {});
  }
}

await finish(browser);
