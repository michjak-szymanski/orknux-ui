/**
 * What the admin panels look like, and whether their explanations are still
 * reachable now that they are not printed under the fields.
 *
 * The complaint is a visual one - six admin screens that were half prose - so
 * this photographs each page as well as driving the (?) controls that replaced
 * the paragraphs: hovered, pinned by a press, closed by Escape with the focus
 * handed back. It also asserts that the sentences that moved are no longer on
 * the page while every note is shut, and that the ones deliberately kept -
 * empty states, consequences, live readings - still are.
 */
import { BASE, open, record, SHOT_DIR, finish } from './suite/harness.mjs';

/** "before" or "after"; only what the pictures are called. */
const WHEN = process.argv[2] ?? 'after';
/** Where the pictures go, so none are left in the checkout. */
const SHOTS = SHOT_DIR;

const { browser, context, page } = await open({ viewport: { width: 1440, height: 1000 } });

/** Asks the server for an id, so the check does not depend on a seeded number. */
async function ask(query) {
  const answered = await context.request.post(`${BASE}/graphql`, { data: { query } });
  const payload = await answered.json();
  return payload.data;
}

const users = await ask('query { users { id username editable } }');
const shells = await ask('query { shells { id name } }');
const templates = await ask('query { componentTemplates { id name } }');

// An internal one: the tokens and the password are only on a user this
// installation owns, and an external row would hide half the page.
const internal = (users?.users ?? []).filter((held) => held.editable !== false);
const userId = internal[0]?.id ?? users?.users?.[0]?.id ?? null;
const shellId = shells?.shells?.[0]?.id ?? null;
const templateId = templates?.componentTemplates?.[0]?.id ?? null;

/**
 * The six pages, what has to be reachable behind a (?), and what has to stay
 * printed. `gone` is prose that moved; `kept` is prose that must not have.
 */
const pages = [
  {
    name: 'user',
    path: userId === null ? '/admin/users/new' : `/admin/users/${userId}`,
    hints: ['Email', 'Access Tokens'],
    gone: ['A token is this user by another door'],
    kept: [],
  },
  {
    name: 'shell',
    path: shellId === null ? '/admin/shell/new' : `/admin/shell/${shellId}`,
    hints: ['Host', 'Username', 'Private key'],
    gone: ['A host name or address, without a scheme', 'The account commands run as', 'OpenSSH or PEM'],
    kept: [],
  },
  {
    name: 'settings',
    path: '/admin/settings',
    hints: ['Chat', 'Attachments'],
    gone: ['Set in the configuration file'],
    kept: ['ORKNUX_METRICS_ANONYMOUS'],
  },
  {
    name: 'template',
    path: templateId === null ? '/admin/templates/new' : `/admin/templates/${templateId}`,
    hints: ['Name', 'Description', 'File'],
    gone: ['What it is called everywhere it is offered', 'is a row people scroll past'],
    kept: [],
  },
  {
    name: 'roles',
    path: '/admin/roles',
    hints: ['Roles'],
    gone: ['is set in the server’s configuration'],
    kept: [],
  },
  {
    name: 'networking',
    path: '/admin/networking',
    hints: ['Which rule fires for an address'],
    gone: ['Rules are consulted from the top'],
    kept: [],
  },
];

const note = page.locator('[role="note"]');
const shown = async () => (await note.count()) > 0 && (await note.first().isVisible());
/** Somewhere harmless to leave the pointer between measurements. */
const away = async () => {
  await page.mouse.move(1400, 980);
  await page.waitForTimeout(400);
};

for (const each of pages) {
  await page.goto(`${BASE}${each.path}`, { waitUntil: 'domcontentloaded' });
  // These pages ask the server before they draw the form, so the wait is for a
  // control to exist rather than for a number of milliseconds to pass.
  await page
    .locator('button[data-hint]')
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(600);
  await away();

  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: `${SHOTS}/admin-${each.name}-${WHEN}.png`, fullPage: true });

  const found = await page.locator('button[data-hint]').count();
  console.log(`--- ${each.name} (${each.path}): ${found} (?) controls`);

  if (WHEN === 'before') {
    // Only the pictures and the prose count are wanted; there is nothing to drive.
    continue;
  }

  for (const label of each.hints) {
    const control = page.locator(`button[data-hint="${label}"]`);
    record((await control.count()) === 1, `${each.name}: a (?) for ${label}`);
  }
  for (const sentence of each.gone) {
    record(!body.includes(sentence), `${each.name}: "${sentence.slice(0, 40)}…" is no longer printed under a field`);
  }
  for (const sentence of each.kept) {
    record(body.includes(sentence), `${each.name}: "${sentence.slice(0, 40)}…" is still on screen`);
  }

  if (found === 0) continue;

  const first = page.locator(`button[data-hint="${each.hints[0]}"]`).first();
  await first.scrollIntoViewIfNeeded();

  await away();
  record((await shown()) === false, `${each.name}: nothing is shown until it is asked for`);

  await first.hover();
  await page.waitForTimeout(300);
  record(await shown(), `${each.name}: hovering the (?) shows its note`);
  await page.screenshot({ path: `${SHOTS}/admin-${each.name}-${WHEN}-open.png` });

  await away();
  record((await shown()) === false, `${each.name}: it goes when the pointer does`);

  // Pinned by a press, then Escape - which must hand the focus back.
  await first.click();
  await page.waitForTimeout(300);
  record(await shown(), `${each.name}: pressing the (?) pins its note`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  record((await shown()) === false, `${each.name}: Escape closes it`);
  record(
    await first.evaluate((el) => el === document.activeElement),
    `${each.name}: the focus is back on the control`,
  );
}

await finish(browser);
