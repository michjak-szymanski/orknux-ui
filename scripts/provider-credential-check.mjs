/**
 * A model provider's credential: its own key, or a workspace secret it reads.
 *
 * Issue #232, and the second answer to it. The choice was a pair of tabs above
 * the Authentication card, which reads as a mode of the card because that is
 * where it was; it is a property of the one field it decides. So the placement
 * is measured here as well as the behaviour: the tabs stand inside the field
 * block that holds the box, on the label's own line, directly above the one
 * control that block draws, and they are named after that field rather than
 * after the card. A card with two secrets is then two of these and no
 * ambiguity - which is the whole reason for the move, since a provider has one
 * secret column and a Slack connection has two.
 *
 * The server takes one of the two and refuses the pair, so the form
 * has to be a thing that cannot ask for both — and the whole of the risk is in
 * the field that was already there. "A key is stored, leave it alone" is
 * spelled as a `null` secret and drawn as a row of dots, and every arrangement
 * that lets somebody choose a variable instead has a way of turning that into
 * "clear the key" or into "this save changed nothing". So the credential is
 * driven here end to end and read back off the server rather than off the
 * screen:
 *
 *   - a provider made with a key of its own holds one, and reveals it;
 *   - a provider made reading a secret holds none, and names the one it reads;
 *   - an edit that does not touch the credential leaves the stored key *byte
 *     for byte*, which is the assertion this check exists for;
 *   - moving from a key to a secret drops the key, and moving back demands a
 *     new one rather than offering to leave alone a key that is not there.
 *
 * Only secrets are offerable. A value is returned with the variable listing, so
 * a provider may not read one and the server says so — but a picker that offers
 * one and lets the save explain it afterwards has taught the rule at the cost
 * of a save. The list is asserted to hold the secret and not the value.
 *
 * And the sentence a broken credential gets. A provider that cannot read its
 * key fails a connection check exactly the way an unreachable one does; issue
 * #211 is what happens when the screen then says something about the endpoint.
 * Two states are read: a secret with nothing in it, where the words are the
 * server's own and name the variable, and a reference pointing at nothing.
 *
 * That second one is put in front of the page rather than made, and
 * deliberately so. It has no route through the API — deleting a variable a
 * provider reads is refused, and so is deleting the catalog holding it, both of
 * which are asserted here — so it arrives only from a restore or a database
 * edited by hand. The state is real, the way to reach it is not, so the answer
 * comes back through the browser with the flag set, exactly as the server would
 * send it.
 *
 * It writes nothing it does not remove: its own catalog, its own variables and
 * its own providers, all under a name nobody would mistake for real, swept at
 * the end and swept again by prefix at the start in case a run was killed.
 */
import { BASE, WORKSPACE, open, record, shot, finish } from './suite/harness.mjs';

/** Nobody's catalog is called this. The sweep is by prefix. */
const SCRATCH = 'providerCredentialCheck';

/** What the form draws in place of a stored key. `ProviderSettingsPage` agrees. */
const MASK = '••••••••••••••••';

/** The keys this check types. Distinct, so "which one is stored" has an answer. */
const FIRST_KEY = 'sk-its-own-first-0001';
const SECOND_KEY = 'sk-its-own-second-0002';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const models = `${BASE}/workspace/${WORKSPACE}/models`;

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

const listProviders = async () =>
  (
    await graphql(
      `query ($w: ID!) {
         modelProviders(workspaceId: $w) {
           id name endpoint status lastCheckMessage
           secretSet secretVariableId secretVariableName secretVariableCatalog secretVariableMissing
         }
       }`,
      { w: WORKSPACE },
    )
  ).modelProviders;

const deleteCatalog = (id) => graphql(`mutation ($id: ID!) { deleteVariableCatalog(id: $id) }`, { id });
const deleteVariable = (id) => graphql(`mutation ($id: ID!) { deleteVariable(id: $id) }`, { id });
const deleteProvider = (id) => graphql(`mutation ($id: ID!) { removeModelProvider(id: $id) }`, { id });

const reveal = async (id) =>
  (await graphql(`mutation ($id: ID!) { revealModelProviderSecret(id: $id) }`, { id }))
    .revealModelProviderSecret;

/**
 * Everything under the scratch name, gone. In that order and no other: a
 * variable a provider reads cannot be removed, and a catalog holding anything
 * cannot be either.
 */
async function sweep() {
  for (const one of (await listProviders()).filter((row) => row.name.startsWith(SCRATCH))) {
    await deleteProvider(one.id).catch(() => {});
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
  await graphql(
    `mutation ($w: ID!, $n: String!) { createVariableCatalog(workspaceId: $w, name: $n) { id name } }`,
    { w: WORKSPACE, n: `${SCRATCH}_${stamp}` },
  )
).createVariableCatalog;

const makeVariable = async (what, kind, value) =>
  (
    await graphql(`mutation ($i: CreateVariableInput!) { createVariable(input: $i) { id name kind catalogName } }`, {
      i: { workspaceId: WORKSPACE, catalogId: catalog.id, name: `${SCRATCH}_${what}_${stamp}`, type: 'STRING', kind, value },
    })
  ).createVariable;

/** The one a provider is pointed at, and which holds something to call with. */
const held = await makeVariable('held', 'SECRET', 'sk-from-the-workspace');
/** A secret with nothing in it, for the sentence a check gets in that case. */
const empty = await makeVariable('empty', 'SECRET', '');
/** Not offerable: a value is read with the listing, so a provider may not read one. */
const plain = await makeVariable('plain', 'VALUE', 'not-a-secret');

// ------------------------------------------------------------- reading a form

/**
 * One field's pair of tabs.
 *
 * Found by the name that field gives them rather than by a word about the card.
 * That is not pedantry about a selector: it is the assertion. A control called
 * "Credential" belongs to whatever is around it, and there is no answer to
 * "which secret is this about" on a card with two; a control called after the
 * API Key can only be the API Key's.
 */
const sourceTabs = (label = 'API Key') =>
  page.locator(`[role="tablist"][aria-label="Where the ${label} comes from"]`);

/** Which of them is offered and which is on. Read off ARIA, not off a class. */
async function tabs(label = 'API Key') {
  const list = sourceTabs(label);
  if ((await list.count()) === 0) return null;
  return list.evaluate((node) => {
    const all = Array.from(node.querySelectorAll('[role="tab"]'));
    return {
      names: all.map((tab) => tab.textContent?.trim() ?? ''),
      on: all.filter((tab) => tab.getAttribute('aria-selected') === 'true').map((tab) => tab.textContent?.trim() ?? ''),
    };
  });
}

/**
 * Where those tabs stand in relation to the field they govern.
 *
 * Containment first - the block holding the box holds the tabs - and then how
 * that block reads: one control and one choice in it, the label above both, and
 * the tabs on the label's line rather than in a row of their own. The numbers
 * are here because "it moved" is not the claim; the claim is that it moved onto
 * something, and a check that only asserted the tabs were somewhere else would
 * pass on them being at the foot of the page.
 */
async function placement(label, controlId) {
  return page.evaluate(
    ({ label, controlId }) => {
      const list = document.querySelector(`[role="tablist"][aria-label="Where the ${label} comes from"]`);
      const control = document.getElementById(controlId);
      if (list === null || control === null) return null;
      const named = document.querySelector(`label[for="${controlId}"]`);

      /* The field is the nearest thing around the control that holds the tabs
         as well. If there is none, they are not in the same field. */
      let field = control.parentElement;
      while (field !== null && !field.contains(list)) field = field.parentElement;

      /* Whatever the tabs themselves stand in. On the field's own label line
         that holds the field's label and no control at all; above a card it
         holds a label of its own, which is the arrangement being ruled out. */
      const line = list.parentElement;
      const controls = (node) =>
        node.querySelectorAll('input, select, textarea, [aria-haspopup="listbox"]').length;

      const box = (node) => node.getBoundingClientRect();
      const middle = (node) => (box(node).top + box(node).bottom) / 2;
      return {
        shared: field !== null,
        controls: field === null ? 0 : controls(field),
        tablists: field === null ? 0 : field.querySelectorAll('[role="tablist"]').length,
        named: named?.textContent?.trim() ?? null,
        withTheLabel: line !== null && named !== null && line.contains(named) && controls(line) === 0,
        onTheLabelsLine: named === null ? false : Math.abs(middle(list) - middle(named)) <= 12,
        above: box(list).bottom <= box(control).top,
        gap: box(control).top - box(list).bottom,
      };
    },
    { label, controlId },
  );
}

const keyBox = () => page.locator('#provider-secret');
const picker = () => page.locator('#provider-secret-variable');

/** Chooses one of the two, on the field named, and lets the form redraw. */
async function choose(which, label = 'API Key') {
  await sourceTabs(label).getByRole('tab', { name: which, exact: true }).click();
  await page.waitForTimeout(200);
}

/** Opens the picker, optionally narrows it, and reads every row it offers. */
async function offered(typed = '', label = 'API Key') {
  // Only if it is shut: the trigger toggles, so opening an open one closes it.
  if ((await page.locator('[role="listbox"]').count()) === 0) await picker().click();
  const search = page.locator(`input[aria-label="Search workspace secrets for the ${label}"]`);
  await search.waitFor({ state: 'visible', timeout: 10_000 });
  if (typed !== '') await search.fill(typed);
  await page.waitForTimeout(200);
  return page.locator('[role="listbox"]').evaluate((node) => ({
    rows: Array.from(node.querySelectorAll('[role="option"]')).map((row) => ({
      label: row.children[0]?.textContent?.trim() ?? '',
      hint: row.children[1]?.textContent?.trim() ?? '',
    })),
    marks: Array.from(node.querySelectorAll('mark')).map((one) => one.textContent ?? ''),
  }));
}

/** Narrows to one variable by name and takes it, so nothing depends on the order. */
async function pick(variable) {
  const rows = await offered(variable.name);
  if (rows.rows.length === 0) {
    record(false, `the picker offers nothing called ${variable.name}`);
    return rows;
  }
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(150);
  return rows;
}

/** Fills the two fields every provider needs, whatever its credential is. */
async function identify(name, endpoint = 'https://example.invalid/v1') {
  await page.fill('#provider-name', name);
  await page.fill('#provider-endpoint', endpoint);
}

/** A provider form, drawn. */
async function atForm(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#provider-name', { timeout: 30_000 });
  await page.waitForTimeout(400);
}

/** The models page, with its provider table drawn. */
async function atList() {
  await page.goto(models, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Providers', { timeout: 30_000 });
  await page.waitForTimeout(600);
}

async function save(label) {
  const button = page.getByRole('button', { name: label, exact: true });
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  await button.click();
  /* Creating leaves for the list, and that arrival is the save having landed;
     an edit stays where it is, so there is only the clock to wait on. */
  if (label === 'Create') {
    await page.waitForURL((url) => url.pathname.endsWith('/models'), { timeout: 20_000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);
}

const stored = async (id) => (await listProviders()).find((one) => one.id === id) ?? null;
const named = async (name) => (await listProviders()).find((one) => one.name === name) ?? null;

// -------------------------------------------------- the choice, on a new form

await atForm(`${models}/providers/new`);

const fresh = await tabs();
if (fresh === null) {
  record(false, "the new-provider form offers no choice at all: the API Key field has no pair of tabs");
} else {
  record(
    fresh.names.join(' | ') === 'Value | Reference',
    `the field offers both as a pair of tabs: ${fresh.names.join(' | ')}`,
  );
  record(
    fresh.on.length === 1 && fresh.on[0] === 'Value',
    `exactly one is chosen, and a new provider starts on its own value: ${JSON.stringify(fresh.on)}`,
  );
}

record(
  (await keyBox().count()) === 1 && (await picker().count()) === 0,
  'on its own value the form asks for a key and does not ask for a variable',
);

// --------------------------------------------- and whose choice it is: the field's

/* What was rejected, gone. The tabs were called Credential and stood above the
   card; a card-level mode is the thing this change is about, so its absence is
   asserted rather than assumed. */
record(
  (await page.locator('[role="tablist"][aria-label="Credential"]').count()) === 0,
  'there is no Credential tablist above the card any more: the choice is not a mode of the card',
);

const where = await placement('API Key', 'provider-secret');
if (where === null) {
  record(false, 'the API Key field has no tabs of its own, so nothing about where they stand can be read');
} else {
  record(where.shared, 'the tabs stand inside the same field block as the box they decide');
  record(
    where.controls === 1 && where.tablists === 1,
    `and that block holds one control and one choice, so which field the choice is about cannot be in doubt: ${where.controls} control(s), ${where.tablists} choice(s)`,
  );
  record(
    (where.named ?? '').startsWith('API Key'),
    `the label above both is the field's own name: ${JSON.stringify(where.named)}`,
  );
  record(
    where.withTheLabel,
    'the tabs stand on that label’s line — the same line, holding the label and no control of its own',
  );
  record(
    where.onTheLabelsLine,
    'and they are drawn level with it, which is what makes them read as the label’s field and not as the card’s',
  );
  record(
    where.above && where.gap < 40,
    `and directly above the box, with nothing between them: ${Math.round(where.gap)}px`,
  );
}

/*
 * Whatever the field is called, the choice is that field's.
 *
 * The name of this field changes with the authentication method - the same
 * column is the API Key or the Entra client secret - and the control has to
 * follow it, because on a card with two secrets the name is the only thing
 * saying which one is being answered.
 */
await page.selectOption('#provider-type', 'AZURE_OPENAI');
await page.getByRole('tab', { name: 'Service Principal', exact: true }).click();
await page.waitForTimeout(300);
const asSecret = await placement('Client Secret', 'provider-secret');
record(
  asSecret !== null && asSecret.shared && (asSecret.named ?? '').startsWith('Client Secret'),
  `on Entra ID the field is a Client Secret and its tabs are named after that: ${JSON.stringify(asSecret?.named)}`,
);
record(
  (await sourceTabs('API Key').count()) === 0,
  'and the API Key tabs went with the API Key: one choice per field, never one per card',
);

/* Back to a plain form for the rest of it. */
await atForm(`${models}/providers/new`);

await choose('Reference');
record(
  (await picker().count()) === 1 && (await keyBox().count()) === 0,
  'on a workspace secret the key box is gone, so the form cannot send the pair the server refuses',
);
record(
  (await placement('API Key', 'provider-secret-variable'))?.shared === true,
  'and the tabs are in the picker’s field just as they were in the box’s: the field is the same field',
);

// ------------------------------------------------------- only secrets, picked

const all = await offered();
const labels = all.rows.map((row) => row.label);
record(labels.includes(held.name), `the picker offers the secret ${held.name}`);
record(
  !labels.includes(plain.name),
  `and does not offer the value ${plain.name}, rather than leaving the server to refuse it afterwards`,
);
record(
  all.rows.find((row) => row.label === held.name)?.hint === catalog.name,
  `each row says which catalog holds it, since a name is unique only within one: ${JSON.stringify(
    all.rows.find((row) => row.label === held.name)?.hint,
  )}`,
);

/* The open list, narrowed, kept as a picture: the marks are a colour on a word
   and no number says whether they can be seen. */
await offered(held.name);
await page.screenshot({ path: shot('provider-credential-picker.png') });

const narrowed = await pick(held);
record(
  narrowed.rows.length === 1 && narrowed.rows[0].label === held.name,
  `typing a name narrows the list to ${narrowed.rows.length} row(s)`,
);
record(
  narrowed.marks.join('').includes(SCRATCH),
  `and the part that matched is marked, by the matcher the rest of the interface uses: ${JSON.stringify(
    narrowed.marks.slice(0, 3),
  )}`,
);

// --------------------------------------------- a provider that reads a secret

const readerName = `${SCRATCH} reader ${stamp}`;
await identify(readerName);
await save('Create');

const reader = await named(readerName);
if (reader === null) {
  record(false, 'creating a provider that reads a workspace secret saved nothing');
} else {
  record(reader.secretVariableId === held.id, `it is stored against the variable it was pointed at (${reader.secretVariableId})`);
  record(reader.secretSet === false, 'and holds no credential of its own, which is what secretSet now means');
  record(reader.secretVariableMissing === false, 'the reference resolves');
  record(
    reader.secretVariableName === held.name && reader.secretVariableCatalog === catalog.name,
    `it carries the name and the catalog to show: ${reader.secretVariableName} · ${reader.secretVariableCatalog}`,
  );
  record(
    (await reveal(reader.id)) === null,
    'revealing it returns nothing: the reading is recorded against the secret, not against the provider',
  );
}

/* The row on the list says where its key comes from, which is the state of the
   thing being looked at rather than an explanation of it. */
await atList();
const rowNotes = await page.locator('[data-secret-variable]').allTextContents();
record(
  rowNotes.some((note) => note.includes(held.name) && note.includes(catalog.name)),
  `the provider's row says which secret it reads: ${JSON.stringify(rowNotes)}`,
);

// ------------------------------------------- a provider with a key of its own

await atForm(`${models}/providers/new`);
const ownName = `${SCRATCH} own ${stamp}`;
await identify(ownName);
await keyBox().fill(FIRST_KEY);
await save('Create');

const own = await named(ownName);
if (own === null) {
  record(false, 'creating a provider with a key of its own saved nothing, so nothing after this can be asked');
  await sweep();
  await finish(browser);
}
record(own.secretSet === true && own.secretVariableId === null, 'a provider given a key holds it, and reads no variable');
record((await reveal(own.id)) === FIRST_KEY, 'and it is the key that was typed');

// ---------------------------- the assertion this check exists for: leave alone

await atForm(`${models}/providers/${own.id}`);
record(
  (await tabs())?.on?.[0] === 'Value',
  'reopened, the field knows which of the two this provider is',
);
record(
  (await keyBox().inputValue()) === MASK,
  'the stored key is drawn as a mask rather than as an empty box, which is what says there is one',
);

await page.fill('#provider-name', `${ownName} renamed`);
await save('Save Changes');

const renamed = await stored(own.id);
record(renamed?.name === `${ownName} renamed`, 'an edit that touches only the name saves the name');
record(renamed?.secretSet === true, 'and leaves the provider holding a credential');
record(
  (await reveal(own.id)) === FIRST_KEY,
  'and the stored key is the same key, byte for byte — an untouched credential field wipes nothing',
);

// ----------------------------------------------- moving from one to the other

await choose('Reference');
await pick(held);
await save('Save Changes');

const moved = await stored(own.id);
record(
  moved?.secretVariableId === held.id && moved?.secretSet === false,
  'moving a provider onto a workspace secret drops the copy it held',
);
record((await reveal(own.id)) === null, 'and there is nothing of its own left to reveal');

/* ...and back, which is the move that can silently do nothing. */
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#provider-name', { timeout: 30_000 });
await page.waitForTimeout(400);
record((await tabs())?.on?.[0] === 'Reference', 'reopened, it knows it is reading a secret');
await choose('Value');
record(
  (await keyBox().inputValue()) === '',
  'coming back to its own value the box is empty rather than masked: there is no stored key to leave alone',
);

await keyBox().fill(SECOND_KEY);
await save('Save Changes');

const back = await stored(own.id);
record(back?.secretSet === true && back?.secretVariableId === null, 'giving it a key of its own drops the reference');
record((await reveal(own.id)) === SECOND_KEY, 'and stores the key that was typed, not the one before it');

// -------------------------------- what the check says when the secret is empty

await choose('Reference');
await pick(empty);
await save('Save Changes');
await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
await page.waitForTimeout(6000);

const said = (await page.locator('form').innerText()).replace(/\s+/g, ' ');
record(
  said.includes(empty.name) && /has no value/i.test(said),
  `the check's own words are shown, naming the variable: ${JSON.stringify(said.slice(-240))}`,
);
record(
  !/check the endpoint/i.test(said),
  'and they do not send anybody to look at the endpoint, which is the confusion #211 was about',
);
await page.screenshot({ path: shot('provider-credential-empty-secret.png'), fullPage: true });

// -------------------------------------------- a reference pointing at nothing

/* First the two guards that make one rare. Both are the server's, and both are
   what this interface is entitled to rely on when it calls a broken reference
   a thing that should not happen. */
let refused = null;
try {
  await deleteVariable(empty.id);
} catch (cause) {
  refused = String(cause?.message ?? cause);
}
record(
  refused !== null && refused.includes(empty.name),
  `deleting a variable a provider reads is refused, in words naming the variable: ${JSON.stringify(
    (refused ?? 'it was allowed').slice(0, 220),
  )}`,
);

let catalogRefused = null;
try {
  await deleteCatalog(catalog.id);
} catch (cause) {
  catalogRefused = String(cause?.message ?? cause);
}
record(
  catalogRefused !== null,
  `and so is deleting the catalog it is in, so there is no way through the API to strand one: ${JSON.stringify(
    (catalogRefused ?? 'it was allowed').slice(0, 160),
  )}`,
);

/**
 * So the state is handed to the page instead: the server's own answer, with the
 * flag the server would set on a reference it could not resolve. Nothing else
 * about the answer is touched, so what is measured below is this interface
 * reading a real shape.
 */
let stranding = false;
await page.route('**/graphql', async (route) => {
  if (!stranding) return route.continue();
  const answer = await route.fetch();
  const body = await answer.json().catch(() => null);
  if (body === null) return route.fulfill({ response: answer });

  const strand = (one) =>
    one !== null && typeof one === 'object' && 'secretVariableMissing' in one
      ? {
          ...one,
          secretSet: false,
          secretVariableId: 'a-variable-that-is-not-there',
          secretVariableName: null,
          secretVariableCatalog: null,
          secretVariableMissing: true,
        }
      : one;

  const data = body.data ?? {};
  if (Array.isArray(data.modelProviders)) data.modelProviders = data.modelProviders.map(strand);
  if (data.modelProvider !== undefined && data.modelProvider !== null) data.modelProvider = strand(data.modelProvider);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

stranding = true;
await atForm(`${models}/providers/${own.id}`);
const alarm = (await page.locator('[data-secret-missing]').first().textContent().catch(() => null)) ?? '';
record(alarm !== '', `a provider whose reference points at nothing says so on its page: ${JSON.stringify(alarm)}`);
record(
  /secret/i.test(alarm) && !/check the endpoint/i.test(alarm),
  'in words about the secret, and not in words that send anybody to the endpoint',
);
record(
  /endpoint is fine|not its endpoint/i.test(alarm),
  'and it says so outright, because a provider with no key fails a check the way an unreachable one does',
);
await page.screenshot({ path: shot('provider-credential-missing.png'), fullPage: true });

await atList();
const rowAlarm = (await page.locator('[data-secret-missing]').first().textContent().catch(() => null)) ?? '';
record(rowAlarm !== '', `and its row in the list carries the same mark: ${JSON.stringify(rowAlarm)}`);
record(
  /secret/i.test(rowAlarm) && /endpoint/i.test(rowAlarm),
  'which names the secret and clears the endpoint in one line, where a row has room for one line',
);
await page.screenshot({ path: shot('provider-credential-missing-row.png') });

stranding = false;
await sweep();
await finish(browser);
