/**
 * A trigger Slack can never deliver anything to, said where somebody is looking.
 *
 * The report behind this is the aftermath of #269. Somebody built a message
 * trigger, it never fired, and he had to ask why - while the product already
 * knew: `slackBotUsers` had answered `receives=False` for that connection and
 * one sentence saying the bot token carries no `channels:history`. Slack does
 * not deliver a `message` event to a token without it, so the trigger could
 * never fire, and the only place that sentence was drawn was a Replies To row -
 * under a checkbox, on a field only a reply opens, on a form nobody opens unless
 * they have already guessed. Every other surface said Enabled, a connection, an
 * action.
 *
 * So three surfaces are driven here, in the order somebody meets them: the row
 * in the trigger list, the form both the settings page and the create dialog
 * mount, and the connection's own page.
 *
 * ---------------------------------------------------------------------------
 * Two legs, and why the second one is intercepted
 *
 * `receives` is read off the `x-oauth-scopes` header of a real `auth.test` from
 * a real Slack. A seeded installation has a fixture token Slack has never seen,
 * so it answers `UNCHECKED` and `receives` comes back null - which is not a
 * defect and is itself half of what has to be checked.
 *
 * **The real leg** runs against the server with nothing intercepted, and it is
 * the one that keeps the query, its variables and the schema honest: it asks
 * for `receives` and asserts that a connection nothing was reported about is
 * *not* marked. Null is not false - a response that carried no scope header has
 * reported no absence, and a warning drawn on it sends somebody to fix a token
 * that is fine. That is the false alarm this whole change is one step away
 * from, and it is the assertion worth having most.
 *
 * **The forced leg** rewrites one query's answer so that the seeded Slack
 * connection reports `receives: false`, carrying the server's own sentence
 * verbatim, and asks what the three surfaces then draw. The precedent is
 * `slack-target-check`, which forces its three outcomes the same way and for
 * the same reason: being unable to receive needs a real Slack workspace to be
 * unable to receive in, and a page cannot conjure one.
 *
 * What is deliberately not asserted here is that the *server* computes
 * `receives` correctly. `SlackBotUsersTest` reads the header and the four
 * history scopes end to end; nothing here recomputes any of it, which is the
 * point - the interface draws the sentence the server composed rather than
 * writing a second one that would drift from it.
 *
 * ---------------------------------------------------------------------------
 * The claim that earns it its place
 *
 * A message trigger and a mention trigger, on the *same* connection, in the
 * same list. One is marked and the other is not. A check that only proved the
 * mark appears would pass a version that marked every incoming trigger on a
 * token with no history scope - which would be a worse bug than the silence it
 * replaced, because it would send somebody to widen a credential that is
 * exactly right for what it is doing.
 *
 * And the economy, counted on the wire: `slackBotUsers` is a workspace query,
 * so a list of any length asks it once. A row that asked for itself would be a
 * Slack round trip per row.
 *
 * Its fixture is its own and it takes it away again: one scratch trigger, named
 * for this run, deleted at the end.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/*
 * A name no other run holds, for the reason `trigger-switch-check` gives: a
 * trigger name is unique per workspace, and a fixed one fails as "already
 * exists" the moment a run dies before its cleanup. `zz` so it sorts to the end
 * of the first page rather than pushing a seeded row off it.
 */
const NAME = `zz silent trigger check ${Date.now()}`;

/**
 * The server's own sentence, which is what the interface has to be drawing.
 *
 * Written here only so the forced answer carries something real; nothing in the
 * product composes it a second time. `SlackBotUsers.historyLine` is where it
 * lives, and if it is ever reworded this check fails loudly rather than passing
 * on a screen that says something else.
 */
const SENTENCE = 'Messages will not arrive - the bot token carries no channels:history.';

/** How many times the whole page asked Slack about this workspace's connections. */
let asked = 0;

let made = null;

try {
  /* ------------------------------------------------- the real leg: null is not false */

  const connections = (
    await graphql(`query($w: ID!) { workspaceConnections(workspaceId: $w) { id name type } }`, {
      w: WORKSPACE,
    })
  ).workspaceConnections;

  const before = (
    await graphql(
      `query($w: ID!) { workspaceTriggers(workspaceId: $w, page: 0, size: 200) { content { id name type action connectionId } } }`,
      { w: WORKSPACE },
    )
  ).workspaceTriggers.content;

  /*
   * The connection is chosen by the mention that is already on it, not by being
   * the first Slack row in the list. The pair is the whole claim - one event
   * marked and another not, on the *same* token - so the two triggers have to
   * be on the same connection or the comparison says nothing.
   */
  const mention = before.find(
    (row) =>
      row.action === 'MENTION' &&
      connections.some((held) => held.id === row.connectionId && held.type === 'SLACK'),
  );
  if (mention === undefined) {
    record(false, `no mention trigger on a Slack connection in workspace ${WORKSPACE}; seed-demo.mjs makes one`);
    throw new Error('nothing to compare against');
  }
  const slack = connections.find((held) => held.id === mention.connectionId);

  const bots = (
    await graphql(
      `query($w: ID!) { slackBotUsers(workspaceId: $w) { connectionId name outcome message receives } }`,
      { w: WORKSPACE },
    )
  ).slackBotUsers;
  record(Array.isArray(bots), `slackBotUsers answers for ${bots.length} connections`);
  record(
    bots.every((bot) => bot.receives === null || typeof bot.receives === 'boolean'),
    `receives comes back three ways and this fixture says ${JSON.stringify(bots.map((bot) => bot.receives))}`,
  );
  record(
    bots.every((bot) => bot.message.length < 120),
    'and whatever a connection has to say for itself is one line',
  );

  /* ------------------------------------------------------------ the fixture trigger */

  const scratch = (
    await graphql(`mutation($input: CreateTriggerInput!) { createTrigger(input: $input) { id name } }`, {
      input: {
        workspaceId: WORKSPACE,
        name: NAME,
        type: 'INCOMING_CONNECTION',
        connectionId: slack.id,
        action: 'MESSAGE',
        icon: 'slack',
      },
    })
  ).createTrigger;
  made = scratch.id;

  record(
    true,
    `a message and a mention on the same connection: #${made} and #${mention.id} both on ${slack.name}`,
  );

  const marked = (id) => page.locator(`#trigger-cannot-fire-${id}`);

  await page.goto(`${BASE}/workspace/${WORKSPACE}/triggers`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the trigger list'))) throw new Error('the trigger list never drew');
  await page.waitForSelector(`text=${NAME}`, { timeout: 15_000 });
  await page.waitForTimeout(600);

  /*
   * Nothing reported, nothing drawn. This is the claim about null, made against
   * a real answer from a real server rather than against one written here - so
   * an interface that started reading `!receives` fails on the fixture every
   * installation of this product has.
   */
  const reported = bots.filter((bot) => bot.receives === false);
  if (reported.length === 0) {
    record(
      (await marked(made).count()) === 0 && (await marked(mention.id).count()) === 0,
      'nothing is marked while Slack has reported no missing scope: null is not false',
    );
  } else {
    record(
      true,
      `NOTE: ${reported.length} connection(s) in this fixture really do report receives=false, ` +
        'so the null leg had nothing to stand on. It is the ordinary state of a seeded installation.',
    );
  }
  await page.screenshot({ path: shot('silent-trigger-unreported.png') });

  /* ---------------------------------------------------- the forced leg: receives=false */

  await page.route('**/graphql', async (route) => {
    const body = route.request().postDataJSON() ?? {};
    const query = String(body.query ?? '');
    if (!query.includes('slackBotUsers')) {
      await route.continue();
      return;
    }
    asked += 1;
    /*
     * The whole workspace's answer, and only this connection's altered: the
     * other rows are left as the server drew them, so a surface that marked
     * everything with a Slack connection on it has nowhere to hide.
     */
    const answer = bots.map((bot) =>
      bot.connectionId === slack.id
        ? { ...bot, outcome: 'FOUND', receives: false, message: SENTENCE, userId: 'U0SILENT', handle: '@orknux' }
        : bot,
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { slackBotUsers: answer } }),
    });
  });

  await page.goto(`${BASE}/workspace/${WORKSPACE}/triggers`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the trigger list, forced'))) throw new Error('the trigger list never drew');
  await page.waitForSelector(`#trigger-cannot-fire-${made}`, { state: 'visible', timeout: 15_000 });

  record(true, 'the message trigger is marked in the list');
  record(
    (await marked(mention.id).count()) === 0,
    'and the mention trigger on the same connection is not - a mention needs no history scope',
  );

  const badge = (await marked(made).textContent()) ?? '';
  record(badge.trim().length > 0 && badge.trim().length <= 24, `the mark is one short line: ${JSON.stringify(badge.trim())}`);

  /*
   * The colour, not merely a class. A mark painted the same grey as the row
   * around it is a mark nobody reads, and "assert how far, not whether" is the
   * rules file's own answer to a change nobody can see.
   */
  const [markPaint, rowPaint] = await page.evaluate((id) => {
    const mark = document.querySelector(`#trigger-cannot-fire-${id}`);
    // The badge itself, and the event's name beside it in the same cell.
    const words = mark.querySelector('span');
    const beside = mark.parentElement.querySelector('span');
    return [getComputedStyle(words).color, getComputedStyle(beside).color];
  }, made);
  const apart = (one, two) => {
    const nums = (colour) => (colour.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    const [a, b] = [nums(one), nums(two)];
    return a.length < 3 || b.length < 3 ? 0 : Math.max(...a.map((channel, i) => Math.abs(channel - b[i])));
  };
  record(apart(markPaint, rowPaint) >= 40, `and painted apart from the row it is in (${markPaint} against ${rowPaint})`);

  // The sentence itself, behind the (?) beside the mark, verbatim.
  await marked(made).locator('[data-hint]').hover();
  await page.waitForTimeout(400);
  const note = ((await page.locator('[role="note"]').first().textContent()) ?? '').replace(/\s+/g, ' ');
  record(note.includes(SENTENCE), `the (?) beside it holds the server's sentence: ${JSON.stringify(note.slice(0, 110))}`);
  await page.mouse.move(20, 960);

  await page.screenshot({ path: shot('silent-trigger-list.png') });

  /*
   * One question for the whole list. A surface that asked per row would be a
   * Slack round trip per row on a cold cache, which is the thing the server's
   * ten-minute cache exists to stop and which no cache should have to.
   */
  record(asked === 1, `a list of ${before.length + 1} triggers asked slackBotUsers ${asked} time(s)`);

  /* ------------------------------------------------------------- the trigger's page */

  await page.goto(`${BASE}/workspace/${WORKSPACE}/triggers/${made}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the trigger settings page'))) throw new Error('the settings page never drew');
  await page.waitForSelector('#trigger-action-receives', { state: 'visible', timeout: 15_000 });
  const onPage = ((await page.locator('#trigger-action-receives').textContent()) ?? '').trim();
  record(onPage === SENTENCE, `its own page says it under the Action picker: ${JSON.stringify(onPage)}`);
  record(onPage.length < 120, 'and says it in one line');
  await page.screenshot({ path: shot('silent-trigger-page.png') });

  /*
   * Switched to a mention, the warning goes. The same claim the list makes,
   * made against the form: the scope bites the event, not the connection, and a
   * form that kept the line would be teaching the opposite.
   */
  await page.selectOption('#trigger-action', 'MENTION');
  await page.waitForTimeout(400);
  record(
    (await page.locator('#trigger-action-receives').count()) === 0,
    'choosing Mention takes it away, because a mention arrives without that scope',
  );
  await page.selectOption('#trigger-action', 'REPLY');
  await page.waitForTimeout(400);
  record(
    (await page.locator('#trigger-action-receives').count()) === 1,
    'and a reply brings it back, because a reply is a message event too',
  );

  /* ---------------------------------------------------------- the connection's page */

  await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations/connections/${slack.id}`, {
    waitUntil: 'domcontentloaded',
  });
  if (!(await drawn(page, 'the connection page'))) throw new Error('the connection page never drew');
  await page.waitForSelector('#connection-receives', { state: 'visible', timeout: 15_000 });
  const onConnection = ((await page.locator('#connection-receives').textContent()) ?? '').trim();
  record(onConnection === SENTENCE, `the connection says what its token cannot do: ${JSON.stringify(onConnection)}`);
  await page.screenshot({ path: shot('silent-trigger-connection.png') });
} catch (cause) {
  record(false, `the check stopped: ${cause instanceof Error ? cause.message : String(cause)}`);
  await page.screenshot({ path: shot('silent-trigger-failed.png') }).catch(() => {});
} finally {
  await page.unroute('**/graphql').catch(() => {});
  // Nothing instances it, so it deletes. Left behind it would keep its name.
  if (made !== null) {
    await graphql(`mutation($id: ID!) { deleteTrigger(id: $id) }`, { id: made }).catch((cause) =>
      console.log(`could not remove the scratch trigger #${made}: ${cause.message}`),
    );
  }
}

await finish(browser);
