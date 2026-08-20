/**
 * The way out of an action's pickers to the definitions they name.
 *
 * The action editor names a connection, a mail server, a function and a
 * condition, and until now said nothing about any of them beyond the name. This
 * opens Create Action, works through the four subtypes that ask, and checks the
 * link mark appears only once something is chosen, points where the route says
 * it should, and opens a tab of its own with the half-filled form left alone.
 *
 * Temporary: delete once it has been looked at.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';

const results = [];
const record = (ok, message) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: 'alice', password: 'password' },
});
if (!signedIn.ok()) {
  console.error('sign-in failed');
  process.exit(1);
}

/** GraphQL as this session, for the fixture the mail field needs. */
const call = async (query, variables) => {
  const answer = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await answer.json();
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors));
  return body.data;
};

/*
 * A mail server to point the Mail Server picker at.
 *
 * The demo workspace has a Slack connection and nothing else, so the SEND_EMAIL
 * branch has no selectable row and the link beside it could never be exercised.
 * Made here and disconnected at the end, so the workspace is as it was found.
 */
const made = await call(
  `mutation ($input: CreateWorkspaceConnectionInput!) {
     createWorkspaceConnection(input: $input) { id name }
   }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: 'Jump check mail',
      type: 'SMTP',
      url: 'smtp.example.com',
      smtpFrom: 'orknux@example.com',
      smtpSecurity: 'STARTTLS',
    },
  },
);
const mailConnectionId = made.createWorkspaceConnection.id;

await page.goto(`${BASE}/workspace/${WORKSPACE}/actions`, { waitUntil: 'domcontentloaded' });
await page.locator('button', { hasText: /^\+ Create Action$/ }).click();
await page.waitForSelector('#action-name', { timeout: 20_000 });
await page.waitForTimeout(1200);

/** The picker's closed box, and what it currently says. */
const picker = (id) => page.locator(`#${id}`);
const chosenIn = async (id) => (await picker(id).innerText()).trim().split('\n')[0].trim();

/** Every way out drawn in the dialog right now. */
const jumps = page.locator('dialog a[target="_blank"]');
const jumpFor = (label) => page.locator(`dialog a[aria-label="${label}"]`);

/** Opens a picker and takes the row whose label is not a "+ New …" instruction. */
async function chooseFirst(id) {
  await picker(id).click();
  await page.waitForTimeout(300);
  const rows = page.locator('[role="option"]');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const label = (await row.innerText()).trim();
    if (label.startsWith('+ ')) continue;
    await row.click();
    await page.waitForTimeout(300);
    return label.split('\n')[0].trim();
  }
  await page.keyboard.press('Escape');
  return null;
}

/** Takes the row whose label is exactly this. */
async function chooseNamed(id, label) {
  await picker(id).click();
  await page.waitForTimeout(300);
  await page.locator('[role="option"]', { hasText: new RegExp(`^${label}`) }).first().click();
  await page.waitForTimeout(300);
}

/** Takes the "+ New …" row, where the picker offers one. */
async function chooseCreate(id) {
  await picker(id).click();
  await page.waitForTimeout(300);
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(300);
}

// ---- Connection, on an outgoing connection ----

// The form arrives with the workspace's first connection already in the field,
// so this is the state the user photographed: something chosen, nothing to open.
// Named rather than taken as it comes, so the mail server made above cannot be
// the one sitting there and the switch below has a Slack connection to leave
// stranded.
await chooseNamed('action-connection', 'Slack');
const connectionLabel = await chosenIn('action-connection');
record(
  (await jumpFor("Open the connection's definition").count()) === 1,
  `a way out beside the Connection picker (on "${connectionLabel}")`,
);
const connectionHref = await jumpFor("Open the connection's definition").getAttribute('href');
record(
  connectionHref?.startsWith(`/workspace/${WORKSPACE}/integrations/connections/`) === true,
  `it points under integrations/connections (${connectionHref})`,
);

await page.screenshot({ path: 'action-jump-connection.png' });

// ---- Mail server, on a send email ----

await page.selectOption('#action-subtype', 'SEND_EMAIL');
await page.waitForTimeout(500);
// The connection chosen for Slack is not one a mail can go through, so the
// field shows nothing - and a link to what is not selected would be a lie.
const mailShows = await chosenIn('action-mail-connection');
record(
  (await jumpFor("Open the mail server's definition").count()) === 0,
  `nothing to open while a Slack connection is stranded here ("${mailShows}")`,
);

const mailLabel = await chooseFirst('action-mail-connection');
if (mailLabel === null) {
  record(false, 'no mail connection in this workspace to pick');
} else {
  record(
    (await jumpFor("Open the mail server's definition").count()) === 1,
    `a way out beside the Mail Server picker (on "${mailLabel}")`,
  );
  const mailHref = await jumpFor("Open the mail server's definition").getAttribute('href');
  record(
    mailHref === `/workspace/${WORKSPACE}/integrations/connections/${mailConnectionId}`,
    `it points at the mail server that was chosen (${mailHref})`,
  );
}

// ---- Function ----

await page.selectOption('#action-subtype', 'FUNCTION');
await page.waitForTimeout(500);
record(
  (await jumpFor("Open the function's definition").count()) === 0,
  'nothing to open while no function is chosen',
);

// "+ New function" names something that does not exist yet, so still nothing.
await chooseCreate('action-function');
record(
  (await jumpFor("Open the function's definition").count()) === 0,
  'nothing to open while the picker is on "+ New function"',
);

const functionLabel = await chooseFirst('action-function');
record(
  (await jumpFor("Open the function's definition").count()) === 1,
  `a way out beside the Function picker (on "${functionLabel}")`,
);
const functionHref = await jumpFor("Open the function's definition").getAttribute('href');
record(
  functionHref?.startsWith(`/workspace/${WORKSPACE}/functions/`) === true,
  `it points under functions (${functionHref})`,
);

// ---- Condition, on a wait ----

await page.selectOption('#action-type', 'WAIT');
await page.waitForTimeout(400);
await page.selectOption('#action-subtype', 'CONDITION');
await page.waitForTimeout(500);
record(
  (await jumpFor("Open the condition's definition").count()) === 0,
  'nothing to open while no condition is chosen',
);

const conditionLabel = await chooseFirst('action-saved-condition');
record(
  (await jumpFor("Open the condition's definition").count()) === 1,
  `a way out beside the Condition picker (on "${conditionLabel}")`,
);
const conditionHref = await jumpFor("Open the condition's definition").getAttribute('href');
record(
  conditionHref?.startsWith(`/workspace/${WORKSPACE}/conditions/`) === true,
  `it points under conditions (${conditionHref})`,
);

// Only ever one at a time: the subtype decides which field is on screen.
record((await jumps.count()) === 1, 'one way out on screen, beside the field that is asking');

// The mark and nothing else: the words live in the title and the label.
const words = (await jumpFor("Open the condition's definition").innerText()).trim();
record(words === '', 'drawn as the link mark, with no words beside it');
const title = await jumpFor("Open the condition's definition").getAttribute('title');
const rel = await jumpFor("Open the condition's definition").getAttribute('rel');
record(title !== null && title !== '' && rel === 'noreferrer', `title and rel are set (${title} / ${rel})`);

// ---- Pressed, not merely present ----

const typedName = 'Jump check';
await page.fill('#action-name', typedName);
const opened = context.waitForEvent('page');
await jumpFor("Open the condition's definition").click();
const tab = await opened;
await tab.waitForLoadState('domcontentloaded');
await tab.waitForTimeout(1500);
const landedOn = new URL(tab.url()).pathname;
record(landedOn === conditionHref, `lands on the condition's own page (${landedOn})`);
const heading = (await tab.locator('h1').first().innerText().catch(() => '')).trim();
record(heading !== '', `that page has a heading (${heading})`);

record(context.pages().length === 2, 'a new tab rather than this one');
record(
  page.url().includes(`/workspace/${WORKSPACE}/actions`),
  'the dialog\'s page was not navigated away',
);
const stillOpen = await page.locator('dialog[open] #action-name').count();
const stillTyped = stillOpen === 1 ? await page.locator('#action-name').inputValue() : '';
record(stillOpen === 1 && stillTyped === typedName, `the form is as it was left ("${stillTyped}")`);

await page.screenshot({ path: 'action-jump-condition.png' });

// The workspace as it was found.
await call(`mutation ($id: ID!) { disconnectWorkspaceConnection(id: $id) }`, { id: mailConnectionId });

await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
