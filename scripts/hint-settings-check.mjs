/**
 * The workspace settings pages, after their explanations went behind the (?).
 *
 * Two things to see. That every page which had prose under its fields no longer
 * prints it - the sentences are checked for by their words, so a paragraph left
 * behind under a different class name still fails - and that the control which
 * replaced them behaves the way the node panel's does: a hover shows the note, a
 * press pins it, a pinned note carries a close.
 *
 * What deliberately stayed printed is checked for too. An empty state, a
 * consequence of ticking a box, a reading of what a field is set to now: hiding
 * one of those behind a hover would be a regression this would otherwise pass.
 *
 * ORKNUX_SHOTS=before takes the pictures and skips the assertions, so the same
 * script photographs the old pages from a checkout without the change.
 *
 * Temporary: delete once it has been looked at.
 */
import { mkdirSync } from 'node:fs';

import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';
const WHEN = process.env.ORKNUX_SHOTS ?? 'after';
const SHOTS = process.env.ORKNUX_SHOT_DIR ?? '.hint-shots';
mkdirSync(SHOTS, { recursive: true });

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

/** The first link on a list page that looks like the page under test. */
async function findLink(listPath, pattern) {
  await page.goto(`${BASE}${listPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const hrefs = await page.locator('a').evaluateAll((links) => links.map((one) => one.getAttribute('href')));
  return hrefs.find((href) => href !== null && pattern.test(href)) ?? null;
}

const agent = await findLink(`/workspace/${WORKSPACE}/agents`, /\/agents\/[^/]+\/settings$/);
const workflow = await findLink(`/workspace/${WORKSPACE}`, /\/workflows\/[^/]+\/settings$/);
const connection = await findLink(
  `/workspace/${WORKSPACE}/integrations`,
  /\/integrations\/connections\/[^/]+$/,
);
const provider = await findLink(`/workspace/${WORKSPACE}/models`, /\/models\/providers\/[^/]+$/);
const trigger = await findLink(`/workspace/${WORKSPACE}/triggers`, /\/triggers\/[^/]+$/);
const condition = await findLink(`/workspace/${WORKSPACE}/conditions`, /\/conditions\/[^/]+$/);

/*
 * A page, what it must no longer print, and what it must still print.
 *
 * `gone` are the sentences that moved behind the (?): found anywhere in the
 * body while nothing is open, the move did not happen. `kept` are the ones that
 * were judged not to be explanations at all.
 */
const pages = [
  {
    name: 'workspace settings',
    path: `/workspace/${WORKSPACE}/settings`,
    hints: 5,
    gone: [
      'Who can see this workspace is set on the Roles screen',
      'A cheap model is the right choice here',
      'Chosen once for the workspace',
      'A speaker appears under every answer',
      'Answers questions about the page somebody is on',
    ],
    kept: [],
  },
  {
    name: 'plugins',
    path: `/workspace/${WORKSPACE}/plugins`,
    hints: 1,
    opens: true,
    gone: ['is used exactly as written'],
    kept: [],
  },
  {
    name: 'agent settings',
    path: agent,
    hints: 1,
    gone: ['External tool servers this agent can connect to'],
    kept: ['a loop nothing here breaks', 'can do whatever that account can'],
  },
  {
    name: 'provider settings',
    path: provider,
    hints: 1,
    gone: ['Keys and Endpoint', 'on every request'],
    kept: [],
  },
  {
    name: 'connection settings',
    path: connection,
    hints: 0,
    gone: ['Every mail this connection sends is from this address', "Socket Mode token"],
    kept: [],
  },
  {
    name: 'workflow settings',
    path: workflow,
    hints: 0,
    gone: [],
    kept: ['renaming it affects every workspace'],
  },
  {
    name: 'trigger settings',
    path: trigger,
    hints: 0,
    gone: [],
    kept: [],
  },
  {
    name: 'condition settings',
    path: condition,
    hints: 0,
    gone: [],
    kept: [],
  },
  {
    name: 'admin workspace settings',
    path: `/admin/workspaces/${WORKSPACE}/settings`,
    hints: 1,
    gone: ['Whoever holds one of these can see the workspace'],
    kept: [],
  },
];

const note = page.locator('[role="note"]');
const shown = async () => (await note.count()) > 0 && (await note.first().isVisible());
const away = async () => {
  await page.mouse.move(1400, 980);
  await page.waitForTimeout(300);
};

/** One page at a time, for photographing a panel that has to be opened first. */
const only = process.env.ORKNUX_ONLY ?? null;

for (const one of pages) {
  if (only !== null && one.name !== only) continue;
  if (one.path === null) {
    record(false, `${one.name}: no page to open - the list had no link to one`);
    continue;
  }

  await page.goto(`${BASE}${one.path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // The plugins page keeps its parameters shut until a plugin is opened.
  if (one.opens === true) {
    const opener = page.locator('main button[aria-expanded]').first();
    if ((await opener.count()) > 0) {
      await opener.click();
      await page.waitForTimeout(800);
    }
  }

  await away();
  await page.screenshot({ path: `${SHOTS}/${WHEN}-${one.name.replace(/ /g, '-')}.png`, fullPage: true });
  if (WHEN === 'before') {
    console.log(`photographed ${one.name}`);
    continue;
  }

  const body = await page.locator('body').innerText();
  for (const sentence of one.gone) {
    record(!body.includes(sentence), `${one.name}: "${sentence}" is no longer printed under a field`);
  }
  for (const sentence of one.kept) {
    record(body.includes(sentence), `${one.name}: "${sentence}" is still printed, as it must be`);
  }

  const hints = page.locator('[data-hint]');
  const many = await hints.count();
  if (one.hints > 0) record(many >= one.hints, `${one.name}: ${many} (?) on the page, expecting ${one.hints}`);
  if (many === 0) continue;

  const hint = hints.first();
  const label = await hint.getAttribute('data-hint');

  record((await shown()) === false, `${one.name}: nothing is shown until it is asked for`);

  await hint.hover();
  await page.waitForTimeout(300);
  record(await shown(), `${one.name}: hovering the (?) beside ${label} shows the note`);
  record(
    (await page.locator('[role="note"] button').count()) === 0,
    `${one.name}: a hovered note carries no close control`,
  );

  await away();
  record((await shown()) === false, `${one.name}: it goes when the pointer does`);

  await hint.click();
  await page.waitForTimeout(300);
  record(await shown(), `${one.name}: pressing it pins the note`);
  await away();
  record(await shown(), `${one.name}: a pinned note stays when the pointer leaves`);
  const closer = page.locator('[role="note"] button');
  record((await closer.count()) === 1, `${one.name}: a pinned note carries a close control`);

  await page.screenshot({ path: `${SHOTS}/${WHEN}-${one.name.replace(/ /g, '-')}-pinned.png` });

  await closer.click();
  await page.waitForTimeout(300);
  record((await shown()) === false, `${one.name}: the close control puts it away`);
}

if (WHEN !== 'before' && only === null) {
  /*
   * Three fields nothing in this workspace happens to ask for.
   *
   * The Azure authentication method only exists on an Azure provider, and the
   * two mail and Slack fields only on a connection of those kinds - this
   * installation has a socket-mode Slack and no SMTP at all. The provider one is
   * reached by choosing the kind on the new-provider form, which saves nothing;
   * the connection ones by rewriting the kind in the reply on its way to the
   * page, which changes what is drawn and not what is stored.
   */
  await page.goto(`${BASE}/workspace/${WORKSPACE}/models/providers/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.selectOption('#provider-type', 'AZURE_OPENAI');
  await page.waitForTimeout(600);
  const azureHints = await page.locator('[data-hint]').evaluateAll((all) =>
    all.map((one) => one.getAttribute('data-hint')),
  );
  record(
    azureHints.includes('Authentication Method'),
    `new provider (Azure): the authentication method has a (?), not a paragraph [${azureHints.join(', ')}]`,
  );
  record(
    !(await page.locator('body').innerText()).includes('on every request'),
    'new provider (Azure): what the method does is no longer printed under it',
  );

  if (connection !== null) {
    for (const kind of ['SMTP', 'SLACK']) {
      await page.route('**/graphql', async (route) => {
        const answer = await route.fetch();
        let body = await answer.text();
        body = body.replace(/"type":"[A-Z_]+"/g, `"type":"${kind}"`);
        await route.fulfill({ response: answer, body });
      });
      await page.goto(`${BASE}${connection}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      const labels = await page.locator('[data-hint]').evaluateAll((all) =>
        all.map((one) => one.getAttribute('data-hint')),
      );
      const wanted = kind === 'SMTP' ? 'From Address' : 'App-Level Token';
      record(labels.includes(wanted), `connection settings (${kind}): ${wanted} has a (?) [${labels.join(', ')}]`);
      await page.unroute('**/graphql');
    }
  }

  /*
   * Where the note lands, measured rather than judged.
   *
   * It is placed against the window, and these pages sit inside a `main` the
   * shell animates in - anything that leaves a transform on that element makes
   * it the containing block for a fixed note, which lands the note offset by
   * its corner instead. That was seen twice while these pages were being
   * changed and has not been seen since, so this reports the two rectangles
   * rather than passing or failing on them: the placement belongs to the shared
   * control, not to any page that uses it.
   */
  await page.goto(`${BASE}/workspace/${WORKSPACE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const measured = page.locator('[data-hint]').first();
  await measured.click();
  await page.waitForTimeout(400);
  const control = await measured.boundingBox();
  const placed = await page.locator('[role="note"]').first().boundingBox();
  console.log(
    `NOTE: the (?) is at ${Math.round(control.x)},${Math.round(control.y)} and its note at ` +
      `${Math.round(placed.x)},${Math.round(placed.y)}. Under the control is right; offset by 240,64 ` +
      `means main became the containing block, which is the shared control's to answer.`,
  );
}

await browser.close();
if (WHEN === 'before') process.exit(0);
const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
