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
 */
import { mkdirSync } from 'node:fs';

import { BASE, WORKSPACE, open, record, SHOT_DIR, finish } from './suite/harness.mjs';

const WHEN = process.env.ORKNUX_SHOTS ?? 'after';
const SHOTS = SHOT_DIR;
mkdirSync(SHOTS, { recursive: true });

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

/**
 * The first link on a list page that looks like the page under test.
 *
 * Waited for rather than sampled once. A list read a second and a half after
 * the navigation is a list that may not have been fetched yet, and an empty one
 * reads here as "no page to open" - a whole page of this check reported missing
 * because a request was slow. Twenty seconds of asking, and a list that really
 * is empty still reports it.
 */
async function findLink(listPath, pattern) {
  await page.goto(`${BASE}${listPath}`, { waitUntil: 'domcontentloaded' });
  const upTo = Date.now() + 20_000;
  for (;;) {
    const hrefs = await page.locator('a').evaluateAll((links) => links.map((one) => one.getAttribute('href')));
    const found = hrefs.find((href) => href !== null && pattern.test(href));
    if (found !== undefined) return found;
    if (Date.now() >= upTo) return null;
    await page.waitForTimeout(250);
  }
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
    gone: [
      'Every mail this connection sends is from this address',
      'orknux listens for mentions and runs the triggers waiting on them',
    ],
    kept: [],
  },
  {
    name: 'workflow settings',
    path: workflow,
    hints: 1,
    /*
     * This was `kept`, on the argument that a consequence read after the fact
     * has already happened. The rules file settled the other way - a consequence
     * worth knowing beforehand goes behind the (?) beside the thing it is about
     * - and the owner rejected the same argument on the quick-chat switch, so
     * this sentence moved with the rest of them.
     */
    gone: ['renaming it affects every workspace'],
    kept: [],
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

/**
 * Wait for the page, rather than for two seconds.
 *
 * Two seconds was enough against a warm dev server and not against a cold one,
 * and what a page that has not arrived yet looks like here is an empty body -
 * the loader stays silent for its first three seconds on purpose. So every
 * "no longer printed under a field" passed on nothing at all, and only the
 * count of (?) failed. That reads exactly like a page whose prose was deleted
 * and never replaced, which sent somebody looking for a bug that was not there.
 *
 * So the emptiness is failed on directly and by name, and the waiting is done
 * on the page instead of on the clock.
 */
async function drawn(name) {
  const upTo = Date.now() + 25_000;
  while (Date.now() < upTo) {
    const text = (await page.locator('body').innerText()).trim();
    const loading = (await page.locator('[role="status"]').count()) > 0;
    if (text.length > 0 && !loading) return true;
    await page.waitForTimeout(250);
  }
  return record(false, `${name}: the page never drew anything, so nothing read off it means a thing`);
}

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
  if (!(await drawn(one.name))) continue;

  // The plugins page keeps its parameters shut until a plugin is opened.
  if (one.opens === true) {
    const opener = page.locator('main button[aria-expanded]').first();
    await opener.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    if ((await opener.count()) > 0) {
      await opener.click();
      await page.waitForTimeout(800);
    }
  }

  /*
   * And on the thing being looked for, where the page is meant to have one. A
   * (?) that never comes still fails, twenty seconds later; a (?) that is
   * merely late no longer reads as one that was never written.
   */
  const hints = page.locator('[data-hint]');
  const wantsHint = one.hints > 0 || one.gone.length > 0;
  if (wantsHint) {
    await hints.first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});
  }

  await away();
  await page.screenshot({ path: `${SHOTS}/${WHEN}-${one.name.replace(/ /g, '-')}.png`, fullPage: true });
  if (WHEN === 'before') {
    console.log(`photographed ${one.name}`);
    continue;
  }

  const many = await hints.count();

  /*
   * The fields first, and then what is printed under them - in that order,
   * because "is no longer printed under a field" is a sentence about a field
   * that is on the screen. On a page whose form has not arrived it passes on
   * an empty body, and the only complaint left is the count of (?), which
   * reads as prose deleted and never replaced. It happened twice and sent
   * somebody looking for a deletion that was never made.
   *
   * So a page that owes a (?) and has none after twenty seconds fails here,
   * saying which of the two it is, and nothing further is read off it.
   */
  if (wantsHint && many === 0) {
    record(false, `${one.name}: no (?) after 20s - either the fields never drew or the (?) is missing; nothing below is worth reading`);
    continue;
  }

  const body = await page.locator('body').innerText();
  for (const sentence of one.gone) {
    record(!body.includes(sentence), `${one.name}: "${sentence}" is no longer printed under a field`);
  }
  for (const sentence of one.kept) {
    record(body.includes(sentence), `${one.name}: "${sentence}" is still printed, as it must be`);
  }

  if (one.hints > 0) record(many >= one.hints, `${one.name}: ${many} (?) on the page, expecting ${one.hints}`);
  if (many === 0) {
    /*
     * A page in this list that costs the run no measurement at all.
     *
     * Four of these are here for the hover behaviour alone - nothing listed as
     * moved, nothing listed as kept, and no count owed - so a page that drew no
     * (?) fell straight through this `continue` and contributed nothing. The
     * run then reported however many assertions it happened to make, which is
     * fewer than the file names pages, and passed. Whether such a page should
     * carry a (?) is a question; that nobody was told it carried none is not.
     */
    if (one.gone.length === 0 && one.kept.length === 0) {
      record(false, `${one.name}: no (?) on the page and nothing listed to look for, so this page asserted nothing`);
    }
    continue;
  }

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
  /*
   * Waited for by name, and reported rather than thrown. The form is behind a
   * loader, and a `selectOption` against a chooser that has not drawn yet ends
   * this whole script in a stack trace - which leaves every assertion after it
   * unrun and unreported, and the run says nothing about the eight pages that
   * had already passed.
   */
  const chooser = page.locator('#provider-type');
  const chooserDrew = await chooser
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!chooserDrew) {
    record(false, 'new provider (Azure): the form never drew its type chooser');
  } else {
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
  }

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
      // Same reason as `drawn`: a list read off a page that has not arrived is
      // empty, and an empty list of labels is not a missing (?).
      await page.locator('[data-hint]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});
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
  // A reading and not a verdict, so a page that did not draw one costs a line
  // of output and not the run: everything above has already been judged.
  const clicked = await measured
    .click({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(400);
  const control = clicked ? await measured.boundingBox() : null;
  const placed = clicked ? await page.locator('[role="note"]').first().boundingBox() : null;
  if (control === null || placed === null) {
    console.log('NOTE: nothing to measure - no (?) opened on the workspace settings page.');
  } else {
    console.log(
      `NOTE: the (?) is at ${Math.round(control.x)},${Math.round(control.y)} and its note at ` +
        `${Math.round(placed.x)},${Math.round(placed.y)}. Under the control is right; offset by 240,64 ` +
        `means main became the containing block, which is the shared control's to answer.`,
    );
  }
}

if (WHEN === 'before') {
  await browser.close();
  console.log('pictures only; nothing asserted');
  process.exit(0);
}
await finish(browser);
