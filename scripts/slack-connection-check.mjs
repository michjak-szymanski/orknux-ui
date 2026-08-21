/**
 * One Slack connection type, driven the way a person makes one.
 *
 * There used to be two - `SLACK` and `SLACK_SOCKET_MODE` - and the form that
 * created a connection and the page that edited one disagreed about which of
 * them was allowed an app-level token, so the kind that needed the token was
 * the kind that could never be shown the field. They are one kind now: a bot
 * token is required, an app-level token is optional, and supplying one is what
 * turns a connection that only sends into one that also listens.
 *
 * So this walks the whole of that. Make a Slack connection through the dialog
 * with nothing but a name and a bot token - no URL asked for, no auth type, no
 * custom headers, because the server writes all three itself - then add the
 * app-level token on the connection's own page and check it stayed.
 *
 * It also holds the two screens to the same story. The dialog stopped asking
 * for a URL, an auth type and custom headers; the connection's own page went on
 * asking for an auth type and a webhook override, both of which Slack settles
 * on its own. Neither screen asks now, and a webhook still gets both.
 *
 * It makes its own connection and removes it again.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, context, page } = await open({ viewport: { width: 1440, height: 1000 } });

const ask = async (query, variables) => {
  const answer = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await answer.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data;
};

// Its own connection, so nothing anybody made is touched.
const named = `zz scratch slack ${Date.now()}`;
let id = null;

try {
  /* ------------------------------------------------- making one, in the dialog */

  await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations`, { waitUntil: 'domcontentloaded' });
  await page.locator('button', { hasText: /^\+ Add Connection$/ }).click();
  await page.waitForSelector('#workspace-connection-name', { timeout: 20_000 });
  await page.waitForTimeout(600);

  // One Slack, and it is called Slack: no choosing between two spellings of the
  // same service before you have looked at which token you hold.
  const offered = await page.locator('#workspace-connection-type option').allTextContents();
  const slacks = offered.filter((label) => label.includes('Slack'));
  record(slacks.length === 1 && slacks[0] === 'Slack', `one Slack in the type list (${slacks.join(', ')})`);

  await page.fill('#workspace-connection-name', named);
  await page.selectOption('#workspace-connection-type', 'SLACK');
  await page.waitForTimeout(500);

  // The complaint that started this: a form demanding a URL that nothing reads.
  record((await page.locator('#workspace-connection-url').count()) === 0, 'no URL is asked for');
  record((await page.locator('#workspace-connection-auth').count()) === 0, 'no Auth Type is asked for');
  record(
    // Scoped to the dialog that is actually open: the page holds more than one
    // <dialog>, and the first in document order is not necessarily this one.
    !(await page.evaluate(() => document.querySelector('dialog[open]')?.innerText ?? '')).includes('Custom Headers'),
    'and no Custom Headers',
  );

  const labels = await page.locator('dialog[open] label').allTextContents();
  record(labels.includes('Bot token'), `the credential is called Bot token (${labels.join(', ')})`);
  record(labels.includes('App-Level Token'), 'and the app-level token is offered beside it');

  // Both (?) say which of Slack's tokens they mean.
  const botHint = page.locator('[data-hint="Bot token"]');
  record((await botHint.count()) === 1, 'the bot token offers a (?)');
  await botHint.hover();
  await page.waitForTimeout(400);
  const botSaid = (await page.locator('[role="note"]').first().innerText()).replace(/\s+/g, ' ');
  record(
    botSaid.includes('xoxb-') && botSaid.includes('OAuth & Permissions') && botSaid.includes('xapp-'),
    `and it names xoxb-, where it comes from, and what it is not (${botSaid.slice(0, 70)}…)`,
  );
  await page.mouse.move(20, 980);
  await page.waitForTimeout(300);

  const appHint = page.locator('[data-hint="App-Level Token"]');
  await appHint.hover();
  await page.waitForTimeout(400);
  const appSaid = (await page.locator('[role="note"]').first().innerText()).replace(/\s+/g, ' ');
  record(
    appSaid.includes('Optional') && appSaid.includes('mentions'),
    `the app token says it is optional and what it buys (${appSaid.slice(0, 70)}…)`,
  );
  await page.mouse.move(20, 980);
  await page.waitForTimeout(300);

  // The bot token alone is enough now; it used to want both.
  const submit = page.locator('dialog[open] button[type="submit"]');
  await page.fill('#workspace-connection-bot-token', 'xoxb-scratch-not-a-real-token');
  await page.waitForTimeout(400);
  record(await submit.isEnabled(), 'a bot token on its own is enough to add the connection');

  await submit.click();
  await page.waitForTimeout(2000);

  const listed = await ask(
    `query ($ws: ID!) { workspaceConnections(workspaceId: $ws) { id name type url authType appTokenSet secretSet } }`,
    { ws: WORKSPACE },
  );
  const made = listed.workspaceConnections.find((candidate) => candidate.name === named);
  record(made !== undefined, 'the dialog saved it');
  if (made === undefined) throw new Error('nothing was created; the rest cannot run');
  id = made.id;

  record(made.type === 'SLACK', `and it is a SLACK connection (${made.type})`);
  record(made.secretSet === true, 'the bot token was stored');
  record(made.appTokenSet === false, 'and no app token, which is send-only');
  // Sent as neither, filled in by the server.
  record(made.url === 'https://slack.com/api', `the server addressed it itself (${made.url})`);
  record(made.authType === 'BEARER_TOKEN', `and chose the auth type itself (${made.authType})`);

  /* ------------------------------------------ adding the app token, on its page */

  await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations/connections/${id}`, {
    waitUntil: 'domcontentloaded',
  });
  /*
   * Waited for, not slept through. Half of what follows is a negative - *no
   * Auth Type*, *no Webhook URL Override* - and a negative read a second and a
   * half after a navigation is true of a page that has not drawn yet, which the
   * loader keeps deliberately blank for its first three seconds. The form's own
   * first field is the thing that says the form is there.
   */
  const secretBox = page.locator('#connection-secret');
  await secretBox.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(400);

  record((await secretBox.count()) === 1, 'the connection page offers the bot token');
  const secretLabel = await page.locator('label[for="connection-secret"]').innerText();
  record(secretLabel.trim() === 'Bot token', `named the same as the dialog names it (${secretLabel.trim()})`);
  record((await page.locator('[data-hint="Bot token"]').count()) === 1, 'and the (?) beside it agrees');

  // The same complaint as the dialog, one screen over: this page went on asking
  // for an auth type the server overwrites on every save, and for a webhook
  // override that means nothing for a connection whose only endpoint is Slack.
  record((await page.locator('#connection-auth').count()) === 0, 'the page asks for no Auth Type either');
  record(
    (await page.locator('#connection-url-override').count()) === 0,
    'and no Webhook URL Override',
  );

  const appToken = page.locator('#connection-app-token');
  record((await appToken.count()) === 1, 'a plain Slack connection is offered its App-Level Token');
  record((await appToken.inputValue()) === '', 'empty, because nothing was given at creation');

  await appToken.fill('xapp-scratch-not-a-real-token');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2000);

  const after = await ask(`query ($id: ID!) { workspaceConnection(id: $id) { type appTokenSet secretSet url } }`, {
    id,
  });
  record(after.workspaceConnection.appTokenSet === true, 'the app token was saved');
  record(after.workspaceConnection.secretSet === true, 'and the bot token beside it was left alone');
  record(after.workspaceConnection.type === 'SLACK', `still a SLACK connection (${after.workspaceConnection.type})`);

  // Read it back the way somebody checking a rotation would.
  await page.reload({ waitUntil: 'domcontentloaded' });
  // The same again: the form, not the clock.
  await page.locator('#connection-app-token').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  const reveal = page.locator('#connection-app-token').locator('xpath=../button');
  record((await reveal.count()) > 0, 'and it can be revealed again');
  await reveal.first().click();
  await page.waitForTimeout(900);
  const bare = await page.locator('#connection-app-token').inputValue();
  record(bare === 'xapp-scratch-not-a-real-token', `Reveal shows what was stored (${bare.slice(0, 12)}…)`);

  // The kind can still be changed, and Socket Mode is not among the choices.
  const chooser = page.locator('#connection-type');
  record((await chooser.count()) === 1, 'the kind can still be chosen');
  const kinds = await chooser.locator('option').allTextContents();
  record(!kinds.some((label) => label.includes('Socket')), `and Socket Mode is gone (${kinds.join(', ')})`);

  await chooser.selectOption('SMTP');
  await page.waitForTimeout(400);
  record((await appToken.count()) === 0, 'choosing a kind with no app token takes the field away at once');
  await chooser.selectOption('SLACK');
  await page.waitForTimeout(400);
  record((await appToken.count()) === 1, 'and choosing Slack brings it back');

  // Hidden because Slack decides both of them, not because the page stopped
  // offering them: the kind that has a use for either still gets both.
  await chooser.selectOption('HTTP');
  await page.waitForTimeout(400);
  record((await page.locator('#connection-auth').count()) === 1, 'an HTTP endpoint is still offered an Auth Type');
  record(
    (await page.locator('#connection-url-override').count()) === 1,
    'and still offered its URL Override',
  );
  await chooser.selectOption('SLACK');
  await page.waitForTimeout(400);
} finally {
  if (id !== null) {
    await ask(`mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }`, { id });
    console.log('scratch connection removed');
  }
}

await finish(browser);
