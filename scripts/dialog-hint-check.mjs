/**
 * The dialogs ask instead of explaining, and this checks both halves of that.
 *
 * For every sentence moved behind a (?): the words are nowhere in what the page
 * draws until somebody asks, and they are there the moment a pointer rests on
 * the question mark beside the right label. The first half is read off
 * `document.body.innerText` rather than off a class, so a paragraph merely
 * re-homed under a different class still fails.
 *
 * For every sentence deliberately left printed: it is still on screen with
 * nothing asked for, because a unit, an empty state and a consequence are not
 * explanations and a hover is the wrong place for them.
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

/** Everything the page is drawing, wherever it is drawn - notes included. */
const bodyText = async () => {
  const text = await page.evaluate(() => document.body.innerText);
  return text.replace(/\s+/g, ' ');
};

const tidy = (words) => words.replace(/\s+/g, ' ').trim();

/** Somewhere harmless, so nothing is being hovered while the page is read. */
const away = async () => {
  await page.mouse.move(4, 4);
  await page.waitForTimeout(250);
};

/**
 * One sentence that moved: gone from the page, and back the moment its own (?)
 * is hovered - the one beside the label named, not any of the others.
 */
async function moved(label, sentence) {
  await away();
  const before = await bodyText();
  record(!before.includes(tidy(sentence)), `${label}: not printed anywhere on the page`);

  const control = page.locator(`[data-hint="${label}"]`);
  if ((await control.count()) !== 1) {
    record(false, `${label}: expected one (?) beside it, found ${await control.count()}`);
    return;
  }

  await control.hover();
  await page.waitForTimeout(300);
  const asked = await bodyText();
  record(asked.includes(tidy(sentence)), `${label}: the (?) beside it says it`);

  /*
   * And the note has to be what is painted, not merely present and in the right
   * place. Every dialog here is `showModal()`, which puts it in the browser's
   * top layer; a note portalled outside that layer lands at exactly the right
   * coordinates and is drawn under the dialog, where nobody can read it. Both
   * `innerText` and a bounding box say yes to that state, so neither is the
   * question - what the browser hands back at that point is. Measured the way
   * `hint-placement-check.mjs` measures it.
   */
  const note = page.locator('[role="note"]').first();
  const box = await note.boundingBox();
  const onTop =
    box === null
      ? false
      : await page.evaluate(
          ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="note"]') != null,
          [box.x + box.width / 2, box.y + box.height / 2],
        );
  record(onTop, `${label}: the note is what is actually drawn there`);
  await away();
}

/** One sentence that stayed, and must be readable with nothing asked for. */
async function stayed(what, sentence) {
  await away();
  const text = await bodyText();
  record(text.includes(tidy(sentence)), `${what}: still printed, as it should be`);
}

// ---- The action editor ----

await page.goto(`${BASE}/workspace/${WORKSPACE}/actions`, { waitUntil: 'domcontentloaded' });
await page.locator('button', { hasText: /^\+ Create Action$/ }).click();
await page.waitForSelector('#action-name', { timeout: 20_000 });
await page.waitForTimeout(1000);

console.log('--- Create Action, outgoing connection');
await moved(
  'Connection',
  "A connection set up under this workspace's Integrations, which is where the credentials for it live. This picks which one the message goes through.",
);
await moved('Content', 'Sent exactly as written. Leave it empty and each node says what to send.');

console.log('--- Create Action, send email');
await page.selectOption('#action-subtype', 'SEND_EMAIL');
await page.waitForTimeout(400);
await moved(
  'Mail Server',
  "An SMTP connection from this workspace's integrations. The from-address is the connection's, so every mail sent through it agrees about who it is from.",
);
await moved('To', 'Sent exactly as written. Leave it empty and each node says who the mail goes to.');
await moved('Body', 'Plain text. Leave it empty and each node says what the mail says.');

console.log('--- Create Action, function');
await page.selectOption('#action-subtype', 'FUNCTION');
await page.waitForTimeout(400);
await moved(
  'Parameters Mapping',
  'Left empty, an argument is taken from the field of that name. Anything typed here is passed as it stands.',
);

console.log('--- Create Action, wait on a condition');
await page.selectOption('#action-type', 'WAIT');
await page.waitForTimeout(300);
await page.selectOption('#action-subtype', 'CONDITION');
await page.waitForTimeout(400);
await moved(
  'Condition',
  'A condition defined in Conditions, or one made here. The action waits until it holds, checking again every retry interval until the timeout runs out.',
);
await stayed('the timeout unit', 'Timeout in seconds');
await stayed('the retry unit', 'Seconds between condition checks');

console.log('--- Create Action, wait on an expression');
await page.selectOption('#action-subtype', 'INLINE_CONDITION');
await page.waitForTimeout(400);
await moved('Expression', 'JavaScript over what the previous node produced.');

console.log('--- Create Action, wait for a time');
await page.selectOption('#action-subtype', 'TIME');
await page.waitForTimeout(400);
await stayed('the duration unit', 'How long to wait, in seconds');

// ---- Adding a workspace connection ----

console.log('--- Add Connection, SMTP');
await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations`, { waitUntil: 'domcontentloaded' });
await page.locator('button', { hasText: /^\+ Add Connection$/ }).click();
await page.waitForSelector('#workspace-connection-name', { timeout: 20_000 });
await page.waitForTimeout(600);
await page.selectOption('#workspace-connection-type', 'SMTP');
await page.waitForTimeout(400);
await moved(
  'From Address',
  'Every mail this connection sends is from this address, and a provider that has not authorised it refuses the message however good the password is.',
);
// The password box only exists once there is a username to go with it.
await page.fill('#workspace-connection-username', 'postmaster');
await page.waitForTimeout(400);
await stayed(
  'what a stored password means',
  'Stored encrypted, and never shown again in the list. Many providers want an app password here rather than the account',
);

console.log('--- Add Connection, Slack');
await page.selectOption('#workspace-connection-type', 'SLACK');
await page.waitForTimeout(400);
await moved(
  'Bot token',
  'In your Slack app under OAuth & Permissions, as the Bot User OAuth Token.',
);
await moved(
  'App-Level Token',
  'From Basic Information, with connections:write. Giving one is what lets Slack mentions start workflows',
);

// ---- A proxy rule ----

console.log('--- Add Proxy Rule');
await page.goto(`${BASE}/admin/networking`, { waitUntil: 'domcontentloaded' });
await page.locator('button', { hasText: /Add Proxy Rule/ }).click();
await page.waitForSelector('#proxy-rule-name', { timeout: 20_000 });
await page.waitForTimeout(600);
await moved(
  'URL pattern',
  'A regular expression, matched against the whole URL and found anywhere in it, ignoring case. Anchor it with ^ and $ to match the whole address.',
);
await moved(
  'Proxy host',
  'A host name, without a scheme. A proxy is spoken to over plain HTTP whatever the request going through it is.',
);
await stayed(
  'what an empty password box means',
  'Stored encrypted and never shown again. Leaving this empty keeps whatever is already stored.',
);

// ---- Moving an issue: the whole paragraph stays ----

console.log('--- Move Issue');
const issues = await context.request.post(`${BASE}/graphql`, {
  data: {
    query: `query ($workspaceId: ID!) {
      workspaceIssues(workspaceId: $workspaceId, page: 0, size: 1) { content { number } }
    }`,
    variables: { workspaceId: WORKSPACE },
  },
});
const first = (await issues.json())?.data?.workspaceIssues?.content?.[0]?.number;
if (first === undefined) {
  console.log('SKIP: no issue in this workspace to open');
} else {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/${first}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const mover = page.locator('button', { hasText: /^Move$/ }).first();
  if ((await mover.count()) === 0) {
    console.log('SKIP: no Move button on this issue');
  } else {
    await mover.click();
    await page.waitForTimeout(800);
    await stayed(
      'what moving an issue costs',
      'Its comments, labels, links, observers and files come with it.',
    );
  }
}

await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL PASS (${results.length})` : `${failed} of ${results.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
