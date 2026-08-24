/**
 * A connection's two credentials, each choosing for itself.
 *
 * Issue #244. #232 gave a model provider's key the choice between its own copy
 * and a workspace secret, and a provider has exactly one secret column - so
 * "this card reads a workspace secret" and "this field reads a workspace
 * secret" were the same sentence and it was impossible to tell which had been
 * built. A Slack connection is where they come apart: a bot token and an
 * app-level token on one card, and no single switch can say that one of them is
 * a workspace secret while the other is the connection's own.
 *
 * So that is what is driven here, and read back off the server rather than off
 * the screen: the bot token pointed at a secret while the app-level token stays
 * typed in, then the pair swapped over. The dangerous half is the old field
 * rather than the new one - "a token is stored, leave it alone" is a null
 * secret behind a row of dots, and every way of offering a variable instead has
 * a way of turning that into "clear the token" - so an edit that touches
 * neither credential is asserted to leave both, byte for byte.
 *
 * Two tablists, named after the two fields and not after the card, is the
 * structural claim. A control called "Credential" belongs to whatever is around
 * it and has no answer to "which of the two is this about"; one called after
 * the Bot token can only be the bot token's.
 *
 * It writes nothing it does not remove: its own catalog, its own variables and
 * its own connection, all under a name nobody would mistake for real, swept at
 * the end and swept again by prefix at the start in case a run was killed.
 */
import { BASE, WORKSPACE, open, record, shot, finish } from './suite/harness.mjs';

/** Nobody's catalog is called this. The sweep is by prefix. */
const SCRATCH = 'connectionCredentialCheck';

/** What `SecretField` draws in place of a stored credential. */
const MASK = '••••••••••••••••';

const BOT = 'xoxb-its-own-0001';
const APP = 'xapp-its-own-0001';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const integrations = `${BASE}/workspace/${WORKSPACE}/integrations`;

// ---------------------------------------------------------------- the fixture

const listCatalogs = async () =>
  (await graphql(`query ($w: ID!) { variableCatalogs(workspaceId: $w) { id name } }`, { w: WORKSPACE }))
    .variableCatalogs;

const listVariables = async () =>
  (
    await graphql(
      `query ($w: ID!) { workspaceVariables(workspaceId: $w, page: 0, size: 200) { content { id name kind catalogName } } }`,
      { w: WORKSPACE },
    )
  ).workspaceVariables.content;

const listConnections = async () =>
  (
    await graphql(
      `query ($w: ID!) {
         workspaceConnections(workspaceId: $w) {
           id name type
           secretSet secretVariableId secretVariableName secretVariableCatalog secretVariableMissing
           appTokenSet appTokenVariableId appTokenVariableName appTokenVariableCatalog appTokenVariableMissing
         }
       }`,
      { w: WORKSPACE },
    )
  ).workspaceConnections;

const deleteCatalog = (id) => graphql(`mutation ($id: ID!) { deleteVariableCatalog(id: $id) }`, { id });
const deleteVariable = (id) => graphql(`mutation ($id: ID!) { deleteVariable(id: $id) }`, { id });
const disconnect = (id) => graphql(`mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }`, { id });

const revealSecret = async (id) =>
  (await graphql(`mutation ($id: ID!) { revealWorkspaceConnectionSecret(id: $id) }`, { id }))
    .revealWorkspaceConnectionSecret;

const revealAppToken = async (id) =>
  (await graphql(`mutation ($id: ID!) { revealWorkspaceConnectionAppToken(id: $id) }`, { id }))
    .revealWorkspaceConnectionAppToken;

/**
 * Everything under the scratch name, gone. In that order and no other: a
 * variable a connection reads cannot be removed, and a catalog holding anything
 * cannot be either.
 */
async function sweep() {
  for (const one of (await listConnections()).filter((row) => row.name.startsWith(SCRATCH))) {
    await disconnect(one.id).catch(() => {});
  }
  for (const one of (await listVariables()).filter((row) => row.name.startsWith(SCRATCH))) {
    await deleteVariable(one.id).catch(() => {});
  }
  for (const one of (await listCatalogs()).filter((row) => row.name.startsWith(SCRATCH))) {
    await deleteCatalog(one.id).catch(() => {});
  }
}

await sweep();

const stamp = Date.now();
const catalog = (
  await graphql(`mutation ($w: ID!, $n: String!) { createVariableCatalog(workspaceId: $w, name: $n) { id name } }`, {
    w: WORKSPACE,
    n: `${SCRATCH}_${stamp}`,
  })
).createVariableCatalog;

const makeVariable = async (what, kind, value) =>
  (
    await graphql(`mutation ($i: CreateVariableInput!) { createVariable(input: $i) { id name kind catalogName } }`, {
      i: {
        workspaceId: WORKSPACE,
        catalogId: catalog.id,
        name: `${SCRATCH}_${what}_${stamp}`,
        type: 'STRING',
        kind,
        value,
      },
    })
  ).createVariable;

/** One secret per credential, so "which field reads which" has an answer. */
const forBot = await makeVariable('bot', 'SECRET', 'xoxb-from-the-workspace');
const forApp = await makeVariable('app', 'SECRET', 'xapp-from-the-workspace');
/** Not offerable: a value is read with the listing, so no credential may read one. */
const plain = await makeVariable('plain', 'VALUE', 'not-a-secret');

/** The connection this check drives. Made over the API: the dialog has its own check. */
const connection = (
  await graphql(
    `mutation ($i: CreateWorkspaceConnectionInput!) { createWorkspaceConnection(input: $i) { id name } }`,
    { i: { workspaceId: WORKSPACE, name: `${SCRATCH} slack ${stamp}`, type: 'SLACK', secret: BOT, appToken: APP } },
  )
).createWorkspaceConnection;

const settings = `${integrations}/connections/${connection.id}`;
const stored = async () => (await listConnections()).find((one) => one.id === connection.id) ?? null;

// ------------------------------------------------------------- reading a form

const tablist = (label) => page.locator(`[role="tablist"][aria-label="Where the ${label} comes from"]`);

/** Which of a field's tabs is on. Read off ARIA, not off a class. */
async function tabs(label) {
  const list = tablist(label);
  if ((await list.count()) === 0) return null;
  return list.evaluate((node) => {
    const all = Array.from(node.querySelectorAll('[role="tab"]'));
    return {
      names: all.map((tab) => tab.textContent?.trim() ?? ''),
      on: all
        .filter((tab) => tab.getAttribute('aria-selected') === 'true')
        .map((tab) => tab.textContent?.trim() ?? ''),
    };
  });
}

/** Chooses one of the two, on the field named, and lets the form redraw. */
async function choose(label, which) {
  await tablist(label).getByRole('tab', { name: which, exact: true }).click();
  await page.waitForTimeout(200);
}

/** Opens one field's picker, narrows it, and reads every row it offers. */
async function offered(label, controlId, typed = '') {
  if ((await page.locator('[role="listbox"]').count()) === 0) await page.locator(`#${controlId}`).click();
  const search = page.locator(`input[aria-label="Search workspace secrets for the ${label}"]`);
  await search.waitFor({ state: 'visible', timeout: 10_000 });
  if (typed !== '') await search.fill(typed);
  await page.waitForTimeout(200);
  return page.locator('[role="listbox"]').evaluate((node) =>
    Array.from(node.querySelectorAll('[role="option"]')).map((row) => ({
      label: row.children[0]?.textContent?.trim() ?? '',
      hint: row.children[1]?.textContent?.trim() ?? '',
    })),
  );
}

/** Narrows to one variable by name and takes it, so nothing depends on the order. */
async function pick(label, controlId, variable) {
  const rows = await offered(label, controlId, variable.name);
  if (rows.length === 0) {
    record(false, `the ${label} picker offers nothing called ${variable.name}`);
    return;
  }
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(150);
}

async function atSettings() {
  await page.goto(settings, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#connection-secret, #connection-secret-variable', { timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function save() {
  const button = page.getByRole('button', { name: 'Save Credentials', exact: true });
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  await button.click();
  await page.waitForTimeout(1500);
}

// -------------------------------------- two fields, two choices, on one card

await atSettings();

const bot = await tabs('Bot token');
const app = await tabs('App-Level Token');
if (bot === null || app === null) {
  record(false, 'a Slack connection does not offer a choice on both of its credentials');
} else {
  record(
    bot.names.join(' | ') === 'Value | Reference' && app.names.join(' | ') === 'Value | Reference',
    `both fields offer the same two words: ${bot.names.join(' | ')} and ${app.names.join(' | ')}`,
  );
  record(
    bot.on.join('') === 'Value' && app.on.join('') === 'Value',
    'and a connection holding two copies of its own opens on Value for both',
  );
}

record(
  (await page.locator('[role="tablist"]').count()) === 2,
  'there are exactly two choices on this card, which is one per credential rather than one for the card',
);
record(
  (await page.locator('[role="tablist"][aria-label="Credential"]').count()) === 0,
  'and no card-level Credential control: a mode of the card could not say which of the two it meant',
);
record(
  (await page.locator('#connection-secret').inputValue()) === MASK &&
    (await page.locator('#connection-app-token').inputValue()) === MASK,
  'each stored credential is drawn as a mask rather than an empty box, which is what says there is one',
);

// -------------------------------------------------- only secrets, and picked

await choose('Bot token', 'Reference');
record(
  (await page.locator('#connection-secret-variable').count()) === 1 &&
    (await page.locator('#connection-secret').count()) === 0,
  'the bot token asks for a variable and stops asking for a value, so the pair the server refuses cannot be sent',
);
record(
  (await page.locator('#connection-app-token').count()) === 1,
  'and the app-level token beside it is untouched: it is still asking for a value of its own',
);

const rows = await offered('Bot token', 'connection-secret-variable');
const labels = rows.map((row) => row.label);
record(labels.includes(forBot.name), `the picker offers the secret ${forBot.name}`);
record(
  !labels.includes(plain.name),
  `and does not offer the value ${plain.name}, rather than leaving the server to refuse it afterwards`,
);
record(
  rows.find((row) => row.label === forBot.name)?.hint === catalog.name,
  'each row says which catalog holds it, since a name is unique only within one',
);

await pick('Bot token', 'connection-secret-variable', forBot);
await page.screenshot({ path: shot('connection-credential-fields.png'), fullPage: true });
await save();

const split = await stored();
record(
  split?.secretVariableId === forBot.id && split?.secretSet === false,
  'the bot token reads the secret it was pointed at, and the connection holds no copy of it',
);
record(
  split?.appTokenSet === true && split?.appTokenVariableId === null,
  'while the app-level token is still the connection’s own — which is the sentence a card-level switch could not say',
);
record(
  (await revealAppToken(connection.id)) === APP,
  'and it is the same app-level token, byte for byte: choosing a source for one field wrote nothing to the other',
);
record(
  (await revealSecret(connection.id)) === null,
  'the referenced one reveals nothing: the reading is recorded against the secret, not against the connection',
);

// ------------------------------------------------------- and the other way round

await atSettings();
record((await tabs('Bot token'))?.on?.join('') === 'Reference', 'reopened, the bot token knows it reads a secret');
record((await tabs('App-Level Token'))?.on?.join('') === 'Value', 'and the app-level token knows it does not');

await choose('Bot token', 'Value');
record(
  (await page.locator('#connection-secret').inputValue()) === '',
  'coming back to its own value the box is empty rather than masked: there is no stored token to leave alone',
);
await page.locator('#connection-secret').fill(BOT);

await choose('App-Level Token', 'Reference');
await pick('App-Level Token', 'connection-app-token-variable', forApp);
await save();

const swapped = await stored();
record(
  swapped?.secretSet === true && swapped?.secretVariableId === null,
  'the bot token is the connection’s own again, and its reference is gone',
);
record(
  swapped?.appTokenVariableId === forApp.id && swapped?.appTokenSet === false,
  'and the app-level token is the one now reading a secret: the two swapped over independently',
);
record((await revealSecret(connection.id)) === BOT, 'the typed bot token is what is stored');
record((await revealAppToken(connection.id)) === null, 'and the referenced app-level token reveals nothing');

// --------------------- the assertion this check exists for: leave both alone

await atSettings();
await page.fill('#connection-name', `${SCRATCH} slack ${stamp} renamed`);
await page.getByRole('button', { name: 'Save Name', exact: true }).click().catch(() => {});
await page.waitForTimeout(800);
await save();

const untouched = await stored();
record(
  untouched?.secretSet === true && untouched?.appTokenVariableId === forApp.id,
  'a save that touches neither credential leaves both exactly as they were',
);
record(
  (await revealSecret(connection.id)) === BOT,
  'and the stored bot token is the same token, byte for byte — an untouched credential field wipes nothing',
);

// ------------------------------- a variable a credential reads cannot be deleted

let refused = null;
try {
  await deleteVariable(forApp.id);
} catch (cause) {
  refused = String(cause?.message ?? cause);
}
record(
  refused !== null && refused.includes(forApp.name) && refused.includes('connection'),
  `deleting a variable a connection reads is refused, and the refusal names what reads it: ${JSON.stringify(
    (refused ?? 'it was allowed').slice(0, 220),
  )}`,
);

let secrecy = null;
try {
  await graphql(`mutation ($id: ID!) { updateVariable(id: $id, input: { kind: VALUE }) { kind } }`, { id: forApp.id });
} catch (cause) {
  secrecy = String(cause?.message ?? cause);
}
record(
  secrecy !== null && /stay a secret/i.test(secrecy),
  `and so is turning it into a value, which would put the token on every member’s screen: ${JSON.stringify(
    (secrecy ?? 'it was allowed').slice(0, 200),
  )}`,
);

await sweep();
await finish(browser);
