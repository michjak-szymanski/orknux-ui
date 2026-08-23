/**
 * What a Slack connection can see, said beside the field as it is typed.
 *
 * Issue #176's checking half. `slackTarget` answers a question about a user or
 * a channel with one of three outcomes and a sentence ready to show, and this
 * drives the two interfaces that show it: the action form, where a send is
 * defined, and the workflow editor's node panel, where one step of a workflow
 * binds its own target. The second is where the report came from - the form had
 * been given the answer and the panel had not - and both are driven here rather
 * than in two files, because the whole reason the box is one component is that
 * the two must not drift, and a shared piece of code only one check reads
 * proves nothing about the other.
 *
 * The three outcomes are not three shades of the same thing, and every claim
 * here is about keeping them apart:
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
 *   7. The panel asks about the one parameter that is a Slack target, and only
 *      when it is one. Not `threadTs`, which is a timestamp sitting two boxes
 *      away under the same connection; not a target on the Reference tab, whose
 *      value arrives at run time from elsewhere in the graph, so there is
 *      nothing to check before the run and the name being read is not a channel
 *      name; and not a target on a node whose action sends through a mail
 *      server, because a node binds where a message goes but never which
 *      connection it goes through. Each of those is silence rather than an
 *      empty box, and none of them is a question put to the server.
 *
 * ---------------------------------------------------------------------------
 * And the suggesting half, which is the rest of #176
 *
 * `slackSuggestions` is the same two endpoints read the other way round: what
 * the connection can see that matches what has been typed so far. It is offered
 * under the field, on both surfaces, by the same component - and the claims
 * about it are the claims about the check with one more running through all of
 * them, which is that a picker here may never become a gate:
 *
 *   8. It fills the field and it never fences it. Something in no list is typed,
 *      kept and saved; a name taken off the list is put in the field and nothing
 *      else happens to it. The list is dismissed with Escape and what was typed
 *      survives being dismissed.
 *   9. A partial list says so. `complete: false` arrives with the server's line
 *      about it and that line is on screen, verbatim, at the head of the list it
 *      is about - because a list that quietly leaves things out teaches somebody
 *      it is the whole of what exists, and the first channel it does not hold
 *      costs them the thing the picker was for.
 *  10. `UNCHECKED` draws the reason and no list. Not an empty list, which reads
 *      as "there is nothing there" - the one thing an unchecked answer is not -
 *      and not a list at all where there is neither a row nor a reason.
 *  11. The two answers about one field are not two paragraphs under it. What is
 *      known about the typing stays in the answer box; what is known about the
 *      list is drawn inside the list; and a name taken from the list silences
 *      the check, which is asked nothing about it at all.
 *  12. It can be driven from the keyboard - down, up, Enter to take, Escape to
 *      give up - and the arrows are the same cursor the pointer moves. The list
 *      opens on no row on purpose: this field stands in a form where Enter
 *      saves, so Enter takes a row only once the arrows have put it on one.
 *      And, as with the answer: debounced, never stale, and it moves nothing.
 *
 * The first leg runs against the real server with no interception at all, and
 * puts both questions to it: a Slack connection with no bot token stored, which
 * is answered `UNCHECKED` in one sentence without anything having to reach
 * slack.com. That is the leg that
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
const MAIL_ACTION = `zz scratch mail action ${stamp}`;
const WORKFLOW_NAME = `zz scratch target workflow ${stamp}`;

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

/**
 * The lists the browser is given, keyed by what was typed to ask for them.
 *
 * The same arrangement as `ANSWERS` above and for the same reason: a real Slack
 * workspace is not a thing CI has, so the shapes the server can answer with are
 * put on the wire here. Nothing pins the wording - every assertion compares the
 * screen against what came back - and nothing pins the rows either. What is
 * pinned is that a list of 25 with more behind it says so, that no list at all
 * is drawn where there is nothing to draw, and that a reason arrives where a
 * list cannot.
 *
 * The lines are the length the server's are: it holds them to one line and
 * under 120 characters, and an interface that reworded or wrapped one would be
 * the four-sentence paragraph this whole feature was reported for.
 */
const TRUNCATED = 'Showing the first 25 that match - keep typing to narrow it down.';
const NOTHING_LIKE_IT = 'No channel here answers to that; a private one this bot was never invited to looks the same.';
const NO_SCOPE = 'No suggestions: the bot token on this connection does not carry channels:read.';

/** Rows in the shape the server sends them, with an id apiece to key them by. */
const rowsOf = (names) => names.map((name, at) => ({ id: `C01234567${at}`, name, realName: null }));

/** More than the twenty-five that come back, which is what `complete: false` is for. */
const MANY = Array.from({ length: 25 }, (_, at) => `#team-${at + 1}`);

const SUGGESTED = {
  // Nothing typed: the first few of everything, which is what a picker shows
  // when it opens rather than an empty box waiting to be earned.
  '': { outcome: 'FOUND', message: '', complete: true, matches: rowsOf(['#general', '#general-chat', '#engineering', '#design', '#random']) },
  gen: { outcome: 'FOUND', message: '', complete: true, matches: rowsOf(['#general', '#general-chat']) },
  general: { outcome: 'FOUND', message: '', complete: true, matches: rowsOf(['#general']) },
  alice: {
    outcome: 'FOUND',
    message: '',
    complete: true,
    matches: [{ id: 'U0123456789', name: '@alice', realName: 'Alice Adams' }],
  },
  e: { outcome: 'FOUND', message: TRUNCATED, complete: false, matches: rowsOf(MANY) },
  nowhere: { outcome: 'NOT_FOUND', message: NOTHING_LIKE_IT, complete: true, matches: [] },
  scopeless: { outcome: 'UNCHECKED', message: NO_SCOPE, complete: false, matches: [] },
};

/** Nothing matched and nothing to say about it, which is no list at all. */
const NO_LIST = { outcome: 'NOT_FOUND', message: '', complete: true, matches: [] };

/** Every question that actually reached the wire, in order. */
let asked = [];
/** Every list asked for, in order, by what was typed to ask for it. */
let suggested = [];
/** A name whose answer is deliberately slow, and how slow. */
let slow = null;
/** The same, for a list: the typing whose list is held back. */
let slowList = null;
const HELD = 1500;

/**
 * Which answer box the assertions are about.
 *
 * Two surfaces ask the same question now - the action form, where a send is
 * defined, and the workflow editor's node panel, where one step binds its own
 * target - and every claim below is a claim about both. So the box is named
 * once and pointed at each in turn, rather than the whole file being written
 * twice with one selector changed.
 */
let ANSWER = 'action-target-answer';
const box = () => page.locator(`#${ANSWER}`);
const said = async () => ((await box().count()) === 0 ? '' : (await box().innerText()).trim());
const outcomeOf = () => box().getAttribute('data-outcome');
const saveButton = () => page.locator('dialog[open] button[type="submit"]');

/**
 * The list under whichever field is being read, and what is in it.
 *
 * Named off the field rather than written out per surface, for the reason the
 * answer box is: the two surfaces are the same feature and every claim below is
 * a claim about both.
 */
const list = () => page.locator(`${FIELD}-suggestions`);
const options = () => page.locator(`${FIELD}-suggestions [role="option"]`);
/** The names on the rows - the first line of each, the second being a real name. */
const offers = async () => (await options().allInnerTexts()).map((one) => one.trim().split('\n')[0].trim());
/** The server's line about the list, which is drawn inside it and nowhere else. */
const listNote = async () => {
  const line = page.locator(`${FIELD}-suggestions > p`);
  return (await line.count()) === 0 ? '' : (await line.innerText()).trim();
};

/** Wait until the list holds this many rows. Waits rather than asserts; see `settled`. */
async function listed(count) {
  await page
    .waitForFunction(
      ([selector, wanted]) => document.querySelectorAll(`${selector} [role="option"]`).length === wanted,
      [`${FIELD}-suggestions`, count],
      { timeout: 10_000 },
    )
    .catch(() => {});
}

/** The same, for a list whose whole content is the server's line. */
async function noted(expected) {
  await page
    .waitForFunction(
      ([selector, wanted]) => document.querySelector(`${selector} > p`)?.innerText.trim() === wanted,
      [`${FIELD}-suggestions`, expected],
      { timeout: 10_000 },
    )
    .catch(() => {});
}

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

/** The field the target is typed into, on whichever surface is being read. */
let FIELD = '#action-target-name';

/** Type into the target field one character at a time, as somebody would. */
async function type(text) {
  await page.fill(FIELD, '');
  await page.locator(FIELD).pressSequentially(text, { delay: 30 });
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
      ([id, wanted]) => document.querySelector(`#${id}`)?.innerText.trim() === wanted,
      [ANSWER, expected],
      { timeout: 10_000 },
    )
    .catch(() => {});
}

let slackId = null;
let mailId = null;
let actionId = null;
/** A send through the mail server, which has a `target` and cannot be asked about. */
let mailActionId = null;
/** Somewhere to put a node, made here and taken away again. */
let workflowId = null;

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

  /*
   * The same leg for the other endpoint, in the same breath. It is the only
   * place the suggestion query, its variables and the schema are put in front
   * of the server the suite is running against; everything below this answers
   * itself in the browser.
   */
  const trulyOffered = (
    await call(
      `query ($c: ID!, $t: MessageTarget!, $typed: String) {
         slackSuggestions(connectionId: $c, target: $t, typed: $typed) {
           outcome message complete matches { id name realName }
         }
       }`,
      { c: slackId, t: 'CHANNEL', typed: 'general' },
    )
  ).slackSuggestions;

  await type('general');
  await settled(truly.message);
  record(
    (await said()) === truly.message,
    `the real server's own sentence, printed as it arrived: ${JSON.stringify(await said())}`,
  );
  record((await outcomeOf()) === truly.outcome, `and drawn as ${truly.outcome}`);

  record(
    ['FOUND', 'NOT_FOUND', 'UNCHECKED'].includes(trulyOffered.outcome),
    `the real server answers the list in the check's own vocabulary (${trulyOffered.outcome})`,
  );
  await noted(trulyOffered.message);
  record(
    (await listNote()) === trulyOffered.message,
    `and its line about the list is printed as it arrived: ${JSON.stringify(await listNote())}`,
  );
  record(
    (await options().count()) === trulyOffered.matches.length,
    `with the rows it actually sent, and no others (${trulyOffered.matches.length})`,
  );
  /*
   * A connection with no token can suggest nothing, and this is the shape that
   * matters most: the reason is drawn and the list is not. An empty list under a
   * field says "there is nothing there", which is precisely what an unchecked
   * answer does not know.
   */
  record(
    trulyOffered.outcome !== 'UNCHECKED' || (await options().count()) === 0,
    'a list that could not be read is a reason and not an empty list',
  );

  /* ------------------------------------------------------- the three, forced */

  await page.route('**/graphql', async (route) => {
    const body = route.request().postDataJSON() ?? {};
    const query = String(body.query ?? '');

    if (query.includes('slackSuggestions')) {
      const typed = body.variables?.typed ?? '';
      suggested.push(typed);
      if (slowList === typed) await new Promise((wake) => setTimeout(wake, HELD));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { slackSuggestions: SUGGESTED[typed] ?? NO_LIST } }),
      });
      return;
    }

    if (!query.includes('slackTarget')) {
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

  /* ------------------------------------------------ what it has to offer */

  /*
   * The suggesting half, under the same field the checking half answers about.
   *
   * Everything from here to the save is about the list: that it opens with
   * something in it, narrows as somebody types, can be driven without a mouse,
   * puts what is taken into the field and nothing more, admits when it is
   * partial, and says why when there can be no list at all. And that none of it
   * ever stands between somebody and what they meant to type.
   */

  /** Which row the arrows are on, as the field itself reports it. */
  const cursor = () => page.locator(FIELD).getAttribute('aria-activedescendant');
  const rowId = (index) => `${FIELD.slice(1)}-suggestion-${index}`;
  /** What a row is painted, which is how the cursor on it is seen at all. */
  const paint = (locator) =>
    locator.evaluate((node) => {
      const seen = getComputedStyle(node);
      return { background: seen.backgroundColor, outline: seen.outlineWidth };
    });

  // ---- it opens with the first few of everything

  suggested = [];
  await page.fill(FIELD, '');
  await page.locator(FIELD).click();
  await listed(5);
  record((await list().count()) === 1, 'the field offers a list as soon as it is asked to');
  record(
    JSON.stringify(await offers()) === JSON.stringify(SUGGESTED[''].matches.map((one) => one.name)),
    `and it opens on the first few of everything (${JSON.stringify(await offers())})`,
  );
  record(suggested.includes(''), 'which is a list asked for with nothing typed, and not an empty box waiting');

  // ---- and narrows, saying which letters answered

  await type('gen');
  await listed(2);
  record(
    JSON.stringify(await offers()) === JSON.stringify(['#general', '#general-chat']),
    `typing narrows it to what matches (${JSON.stringify(await offers())})`,
  );
  const marks = await page.locator(`${FIELD}-suggestions mark`).allInnerTexts();
  record(
    marks.length === 2 && marks.every((one) => one === 'gen'),
    `and marks the letters that answered, by the matcher the rest of the interface marks with (${JSON.stringify(marks)})`,
  );
  await page.screenshot({ path: shot('slack-suggest-list.png') });

  // ---- one question per pause, and never a stale list

  suggested = [];
  await type('general');
  await listed(1);
  console.log(`seven keystrokes asked for: ${JSON.stringify(suggested)}`);
  record(suggested.length <= 2, `a list is asked for on the pause, not on the keystroke (${suggested.length})`);
  record(suggested.at(-1) === 'general', 'and for the whole of what was typed');

  /*
   * The same guard the answer keeps, and it fails the same way without it: rows
   * that match the text before this one are an offer to pick something nobody
   * searched for.
   */
  slowList = 'gen';
  await page.fill(FIELD, 'gen');
  await page.waitForTimeout(900);
  record((await options().count()) === 0, 'the list for the last text is not left standing under new text');
  await page.fill(FIELD, 'scopeless');
  await noted(NO_SCOPE);
  await page.waitForTimeout(HELD + 1200);
  record((await options().count()) === 0, 'and a list that arrives about text since edited is never drawn');
  record((await listNote()) === NO_SCOPE, 'what is offered is about what is in the field');
  slowList = null;

  // ---- driven from the keyboard

  await type('gen');
  await listed(2);
  record((await cursor()) === null, 'the list opens on no row, so Enter still belongs to the form');

  await page.locator(FIELD).press('ArrowDown');
  record((await cursor()) === rowId(0), `down puts the cursor on the first row (${await cursor()})`);
  const atRow = await paint(options().nth(0));
  const plainRow = await paint(options().nth(1));
  record(
    apart(atRow.background, plainRow.background) >= 8,
    `and the row it is on is painted differently (${atRow.background} against ${plainRow.background})`,
  );
  record(atRow.outline !== '0px', `and outlined as well as filled (${atRow.outline})`);

  await page.locator(FIELD).press('ArrowDown');
  record((await cursor()) === rowId(1), 'down again moves on');
  await page.locator(FIELD).press('ArrowUp');
  record((await cursor()) === rowId(0), 'and up comes back');

  await page.locator(FIELD).press('Enter');
  record(
    (await page.inputValue(FIELD)) === '#general',
    `Enter puts the row in the field (${await page.inputValue(FIELD)})`,
  );
  record((await list().count()) === 0, 'and puts the list away');

  /*
   * The one place the two answers overlap. A name taken off the list is a name
   * Slack has just named, so the question "does this exist" has been answered
   * already - putting it a second time is a round trip to print a sentence
   * under a field that says what the row above it said a moment ago.
   */
  asked = [];
  await page.waitForTimeout(900);
  record(asked.length === 0, `nothing is asked about a name that came off the list (${JSON.stringify(asked)})`);
  record((await said()) === '', `and nothing is said about it either (${JSON.stringify(await said())})`);
  record((await outcomeOf()) === 'picked', 'the box says why it is quiet rather than looking unanswered');

  // Edited again, and it is typing again.
  await page.locator(FIELD).press('End');
  await page.locator(FIELD).press('Backspace');
  await settled(FALLBACK.message);
  record((await said()) === FALLBACK.message, 'editing what was taken puts the question back');
  record(asked.at(-1) === '#genera', `and it is asked about what is in the field now (${JSON.stringify(asked)})`);

  // The same by hand, because a picker a pointer cannot use is half a picker.
  await type('gen');
  await listed(2);
  await options().nth(1).click();
  record(
    (await page.inputValue(FIELD)) === '#general-chat',
    `a row takes a click too (${await page.inputValue(FIELD)})`,
  );

  // ---- a partial list says so

  await type('e');
  await listed(25);
  record((await options().count()) === 25, 'a truncated list draws what came back');
  record(
    (await listNote()) === TRUNCATED,
    `and the server's line about it, verbatim: ${JSON.stringify(await listNote())}`,
  );
  record((await list().getAttribute('data-complete')) === 'false', 'and it knows it is not the whole of what matched');
  /*
   * The line about the list is drawn in the list. Under the field is the answer
   * about what was *typed*, and it is still that - two paragraphs under one text
   * box is what the first round of this was rejected for.
   */
  record(
    (await said()) !== TRUNCATED && (await said()) === FALLBACK.message,
    `the two answers are not two paragraphs under the field (${JSON.stringify(await said())})`,
  );
  await page.screenshot({ path: shot('slack-suggest-truncated.png') });

  // ---- and it moves nothing

  const withList = Math.round((await saveButton().boundingBox()).y);
  await page.locator(FIELD).press('Escape');
  await page.waitForTimeout(400);
  record((await list().count()) === 0, 'Escape gives up on the list');
  record((await page.inputValue(FIELD)) === 'e', 'and keeps what was typed');
  record((await page.locator('dialog[open]').count()) === 1, 'and does not take the dialog with it');
  const withoutList = Math.round((await saveButton().boundingBox()).y);
  console.log(`Create Action sat at y = ${withList} with the list open, ${withoutList} without it`);
  record(withList === withoutList, 'the longest list there is moves nothing below the field');

  await page.locator(FIELD).press('ArrowDown');
  await listed(25);
  record((await list().count()) === 1, 'and down asks for it back without retyping');
  await page.locator(FIELD).press('Escape');

  // ---- UNCHECKED: the reason, and no list

  await type('scopeless');
  await noted(NO_SCOPE);
  record((await listNote()) === NO_SCOPE, 'UNCHECKED: the one-line reason there is nothing to offer');
  record((await options().count()) === 0, 'and not one row, an empty list being a claim this cannot make');
  record((await list().getAttribute('data-outcome')) === 'UNCHECKED', 'drawn as the outcome it is');
  record((await page.inputValue(FIELD)) === 'scopeless', 'and the field carries on as plain text');
  record(await saveButton().isEnabled(), 'with Save live over it');
  await page.screenshot({ path: shot('slack-suggest-unchecked.png') });

  // ---- and nothing at all is drawn where there is nothing to say

  await type('engineering');
  await page.waitForTimeout(1200);
  record((await list().count()) === 0, 'nothing matched and nothing to say is no box at all');

  /* ----------------------------------------- and none of it refuses the save */

  /*
   * The claim the server keeps its own test for, from this side of the wire:
   * the field is free text, so an action naming something Slack cannot see is
   * saved exactly as it was typed.
   */
  await type('nowhere');
  await settled(ANSWERS.nowhere.message);
  await noted(NOTHING_LIKE_IT);

  /*
   * The claim the whole picker has to survive: a name in no list is typed,
   * kept, and saved. Every correct value the list will never hold looks exactly
   * like this from here - an id pasted out of somebody else's message, a member
   * who joined a minute ago, a private channel this bot was never invited to.
   */
  record((await options().count()) === 0, 'nothing in the list is anything like what was typed');
  record((await listNote()) === NOTHING_LIKE_IT, 'and the list says so rather than emptying itself in silence');
  record((await page.inputValue(FIELD)) === 'nowhere', 'the field keeps it all the same');
  record(await saveButton().isEnabled(), 'Save is live over a NOT_FOUND');

  // The list put away by hand first, which is what somebody reaching for Save
  // past an open list does.
  await page.locator(FIELD).press('Escape');
  await page.waitForTimeout(300);
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

  /* ------------------------------------------ the same answer, in the editor */

  /*
   * Where issue #176 was actually reported from.
   *
   * The action form defines a send; a node in a workflow binds the `target` of
   * one step of it, which is where somebody typing a channel name most often
   * is, and until now that panel said nothing at all. Everything asserted above
   * is asserted again here, against the same interception, because the point of
   * lifting the box out of the dialog is that the two cannot drift - and a
   * shared component nothing reads on the second surface would prove nothing.
   *
   * Two things are this surface's own and are asserted only here: a parameter
   * on the Reference tab is read out of the run and so has nothing to check
   * before the run, and a `target` is only a Slack channel when the action
   * behind the node sends through a Slack connection.
   */

  /*
   * A send with the same `target` parameter, through the mail server. Nothing
   * about a node says which connection it goes through - it binds where the
   * message goes and what it says, and the connection stays the definition's -
   * so this is how a panel that read the parameter's name and nothing else
   * would be caught.
   */
  mailActionId = (
    await call(`mutation ($input: CreateActionInput!) { createAction(input: $input) { id } }`, {
      input: {
        workspaceId: WORKSPACE,
        name: MAIL_ACTION,
        type: 'EXECUTE',
        subtype: 'OUTGOING_CONNECTION',
        connectionId: mailId,
        connectionAction: 'SEND_MESSAGE',
        content: 'Something to say.',
        target: 'CHANNEL',
        targetName: 'general',
      },
    })
  ).createAction.id;

  workflowId = (
    await call(`mutation ($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id } }`, {
      input: { workspaceId: WORKSPACE, name: WORKFLOW_NAME, description: 'Scratch, for the target check.' },
    })
  ).createWorkflow.id;

  await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${workflowId}/editor`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: /^Add node/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  // An Action node on the canvas, through the Add menu - the same way the
  // editor check puts an Object one there.
  await page.getByRole('button', { name: /^Add node/ }).click();
  await page.getByRole('menuitem', { name: 'Action', exact: true }).click();
  await page.waitForTimeout(1200);

  /** Points the node at a definition, and waits for the parameters it seeds. */
  async function bind(named) {
    await page.locator('#node-action').click();
    await page.waitForTimeout(400);
    await page.locator('[role="option"]', { hasText: new RegExp(`^${named}`) }).first().click();
    await page.waitForSelector('#node-mapping-target', { timeout: 20_000 });
    await page.waitForTimeout(800);
  }

  await bind(ACTION);

  ANSWER = 'node-mapping-target-answer';
  FIELD = '#node-mapping-target';

  record((await box().count()) === 1, 'the node panel answers about the target it binds, which is the whole report');

  /*
   * A parameter that is not the target, on the same node and the same Slack
   * connection. `threadTs` is the message a reply threads onto and is a
   * timestamp; a panel that asked about every box whose name it did not
   * recognise would be asking Slack whether a timestamp is a channel.
   */
  record(
    (await page.locator('#node-mapping-threadTs-answer').count()) === 0,
    'and about that parameter only - nothing is said under threadTs',
  );
  asked = [];
  suggested = [];
  await page.fill('#node-mapping-threadTs', '');
  await page.locator('#node-mapping-threadTs').pressSequentially('general', { delay: 30 });
  await page.waitForTimeout(1200);
  record(asked.length === 0, `nor asked about it (${JSON.stringify(asked)})`);
  record(
    (await page.locator('#node-mapping-threadTs-suggestions').count()) === 0,
    'and nothing is offered under it - a timestamp has no channels to choose from',
  );
  record(suggested.length === 0, `nor any list asked for (${JSON.stringify(suggested)})`);

  /* --------------------------------------- the three, under the node's field */

  await type('general');
  await settled(ANSWERS.general.message);
  const nodeFound = await colourOf(box());
  record((await said()) === ANSWERS.general.message, 'node panel FOUND: the sentence, verbatim');
  record((await outcomeOf()) === 'FOUND', 'node panel FOUND: drawn as itself');
  record(
    apart(nodeFound, hintColour) >= 40,
    `node panel FOUND: painted as a confirmation (${nodeFound} against ${hintColour})`,
  );
  await page.screenshot({ path: shot('slack-target-node-found.png') });

  await type('nowhere');
  await settled(ANSWERS.nowhere.message);
  const nodeAdvice = await colourOf(box());
  record((await said()) === ANSWERS.nowhere.message, 'node panel NOT_FOUND: the sentence, verbatim, advice and all');
  record((await outcomeOf()) === 'NOT_FOUND', 'node panel NOT_FOUND: drawn as itself');
  record(
    apart(nodeAdvice, dangerColour) >= 40,
    `node panel NOT_FOUND: not the colour a refusal is painted (${nodeAdvice} against ${dangerColour})`,
  );
  record(apart(nodeAdvice, nodeFound) >= 40, 'node panel NOT_FOUND: and not the colour a confirmation is');
  await page.screenshot({ path: shot('slack-target-node-not-found.png') });

  await type('scopeless');
  await settled(ANSWERS.scopeless.message);
  const nodeUnchecked = await colourOf(box());
  record((await said()) === ANSWERS.scopeless.message, 'node panel UNCHECKED: the whole sentence, unsummarised');
  record((await outcomeOf()) === 'UNCHECKED', 'node panel UNCHECKED: drawn as itself');
  record(apart(nodeUnchecked, hintColour) === 0, `node panel UNCHECKED: kept the ordinary hint grey (${nodeUnchecked})`);
  await page.screenshot({ path: shot('slack-target-node-unchecked.png') });

  /* ------------------------------------------- and the list, under the panel */

  /*
   * The same list, in the panel, by the same component. Written out again
   * rather than taken on trust for the reason the three outcomes are: the whole
   * value of one piece of code is that the two surfaces cannot drift, and a
   * shared component only one check reads proves nothing about the other.
   */

  suggested = [];
  await type('gen');
  await listed(2);
  record((await list().count()) === 1, 'the node panel offers the list too');
  record(
    JSON.stringify(await offers()) === JSON.stringify(['#general', '#general-chat']),
    `narrowed by what was typed into the node (${JSON.stringify(await offers())})`,
  );
  await page.screenshot({ path: shot('slack-suggest-node-list.png') });

  record((await cursor()) === null, 'on no row, so Enter is still the panel\'s');
  await page.locator(FIELD).press('ArrowDown');
  record((await cursor()) === rowId(0), 'the arrows drive it here as well');
  await page.locator(FIELD).press('Enter');
  record((await page.inputValue(FIELD)) === '#general', `and Enter binds the parameter to it (${await page.inputValue(FIELD)})`);

  asked = [];
  await page.waitForTimeout(900);
  record(asked.length === 0, 'a name off the list is not then asked about here either');
  record((await outcomeOf()) === 'picked', 'and the answer box is quiet for the same stated reason');

  const panelWithout = Math.round((await page.locator('#node-mapping-threadTs').boundingBox()).y);
  await type('e');
  await listed(25);
  record((await listNote()) === TRUNCATED, 'a cut list says so in the panel, in the server\'s words');
  record((await list().getAttribute('data-complete')) === 'false', 'and knows it is not the whole of what matched');
  const panelWith = Math.round((await page.locator('#node-mapping-threadTs').boundingBox()).y);
  console.log(`threadTs sat at y = ${panelWith} under the longest list, ${panelWithout} without it`);
  record(panelWith === panelWithout, 'and the parameters under it do not move to make room');

  await type('scopeless');
  await noted(NO_SCOPE);
  record((await listNote()) === NO_SCOPE, 'UNCHECKED in the panel: the reason, one line of it');
  record((await options().count()) === 0, 'and no empty list beneath it');
  await page.screenshot({ path: shot('slack-suggest-node-unchecked.png') });

  /* ---------------------------------------------- it does not move the panel */

  /*
   * The same claim as the Create Action button above, made against what the
   * panel puts under the answer: the next parameter's own box. A hint that
   * grows and shrinks pushes the rest of the node's parameters around under the
   * pointer, which is what makes a live answer feel broken.
   */
  const nodeTops = [];
  const nodeHeights = [];
  for (const typed of ['', 'general', 'scopeless', '']) {
    if (typed === '') {
      await page.fill(FIELD, '');
      await page.waitForTimeout(700);
    } else {
      await type(typed);
      await settled(ANSWERS[typed].message);
    }
    nodeTops.push(Math.round((await page.locator('#node-mapping-threadTs').boundingBox()).y));
    nodeHeights.push(Math.round((await box().boundingBox()).height));
  }
  console.log(`threadTs sat at y = ${nodeTops.join(', ')}`);
  console.log(`the panel's answer was ${nodeHeights.join(', ')} tall`);
  record(new Set(nodeTops).size === 1, 'nothing below the answer moves as the answer changes, in the panel too');
  record(new Set(nodeHeights).size === 1, 'because the room it takes there is the same whatever it says, and empty');

  /* -------------------------------------------- a reference is not a channel */

  /*
   * On the Reference tab the value arrives at run time from somewhere else in
   * the graph - a trigger's event, an agent's answer - so there is nothing here
   * to ask Slack about before the run, and the name of the field being read is
   * not the name of a channel. Saying a channel could not be found about it
   * would be both wrong and alarming, so nothing is said: not an empty box, no
   * box at all.
   */
  await type('general');
  await settled(ANSWERS.general.message);
  asked = [];
  suggested = [];
  const targetSource = page.locator('div[role="group"][aria-label="target source"]');
  await targetSource.getByRole('button', { name: 'Reference' }).click();
  await page.waitForTimeout(1200);
  record((await box().count()) === 0, 'a referenced target is not answered about at all');
  record(asked.length === 0, `and nothing is asked about it (${JSON.stringify(asked)})`);
  record((await list().count()) === 0, 'nor offered a channel to pick, the field being the name of a field');
  record(suggested.length === 0, `and no list is asked for either (${JSON.stringify(suggested)})`);
  await page.screenshot({ path: shot('slack-target-node-reference.png') });

  // Back again: the tab is a switch and not a one-way door.
  await targetSource.getByRole('button', { name: 'Value' }).click();
  await page.waitForTimeout(600);
  await type('nowhere');
  await settled(ANSWERS.nowhere.message);
  record((await said()) === ANSWERS.nowhere.message, 'and it answers again on the Value tab');

  /* ------------------------------ a target that is not a Slack target */

  /*
   * The same parameter, called the same thing, on a node whose action sends
   * through the mail server. The panel has to read the action behind the node
   * to know whether there is anybody to ask, and here there is not: nothing is
   * said and nothing is asked, because a sentence about some other connection
   * under this field would be worse than silence.
   */
  asked = [];
  suggested = [];
  await bind(MAIL_ACTION);
  await page.fill(FIELD, '');
  await page.locator(FIELD).pressSequentially('general', { delay: 30 });
  await page.waitForTimeout(1200);
  record((await box().count()) === 0, 'a send through a connection that is not Slack is not answered about');
  record(asked.length === 0, `and nothing is asked about it either (${JSON.stringify(asked)})`);
  record((await list().count()) === 0, 'and offered nothing - there is no Slack here to offer anything from');
  record(suggested.length === 0, `nor asked for a list (${JSON.stringify(suggested)})`);
} finally {
  await page.unroute('**/graphql').catch(() => {});
  for (const [query, variables] of [
    ['mutation ($id: ID!) { removeWorkflow(id: $id) }', { id: workflowId }],
    ['mutation ($id: ID!) { deleteAction(id: $id) }', { id: actionId }],
    ['mutation ($id: ID!) { deleteAction(id: $id) }', { id: mailActionId }],
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
