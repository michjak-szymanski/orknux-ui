/**
 * A workspace created from the admin screen reaches the selector at once.
 *
 * Issue #302, reported as the selector never appearing after the first
 * workspace was made. The cached list was already dropped on a create - that
 * part was right - but dropping it only makes the *next* mount fetch again, and
 * creating a workspace from the admin screen navigates nowhere. The selector
 * already on screen kept the list it had fetched when the page opened, which on
 * a fresh installation was empty, and it draws nothing when its list holds no
 * workspace matching the selected one. So the box was missing until the tab was
 * reloaded.
 *
 * The reported case cannot be staged here - the fixture has workspaces, and the
 * suite is not going to delete them to make an installation look new. What is
 * staged is the same defect one workspace further along: make one through the
 * dialog, and it has to be in the selector with nothing reloaded and nowhere
 * navigated. On the old code it is not, for exactly the reason the first one
 * was missing.
 *
 * The reload afterwards is the control. If the name only shows up after one,
 * the list is still being fetched at mount and nothing else.
 *
 * It leaves the workspace it makes: there is no removeWorkspace on the schema
 * this drives. The name carries a timestamp behind a `zz suite` prefix, the way
 * `chat-workspace-switch-check` names the one it makes.
 */
import { BASE, WORKSPACE, open, record, drawn, shot, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

const MADE = `zz suite - selector catches up ${Date.now()}`;

/* Admin is where the report came from, and it is the page that creates a
   workspace without moving off itself. */
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await drawn(page, 'the admin screen');

const picker = page.locator('select[aria-label="Selected workspace"]');
await picker.waitFor({ timeout: 20_000 });

const namesIn = async () => picker.locator('option').evaluateAll((all) => all.map((one) => one.textContent.trim()));

const before = await namesIn();
record(before.length > 0, `the selector is drawn with the workspaces that exist (${before.length})`);
record(!before.includes(MADE), 'and does not name one that has not been made yet');

// ------------------------------------------------------------ through the form

await page.getByRole('button', { name: /Create Workspace|New Workspace|Add Workspace/i }).first().click();
await page.waitForTimeout(400);
await page.getByLabel('Workspace name').fill(MADE);
await page.getByRole('button', { name: 'Create Workspace', exact: true }).last().click();

// Nothing reloaded and nowhere navigated: the selector has to catch up on its own.
await page.waitForTimeout(2500);

const after = await namesIn();
record(after.includes(MADE), `the new workspace is in the selector without a reload (${after.length} listed)`);
record(
  new URL(page.url()).pathname === '/admin',
  `and the page never moved to get it there (${new URL(page.url()).pathname})`,
);
await page.screenshot({ path: shot('workspace-selector-after-create.png') });

// --------------------------------------------------------------- the control

await page.reload({ waitUntil: 'domcontentloaded' });
await drawn(page, 'the admin screen again');
await picker.waitFor({ timeout: 20_000 });

const reloaded = await namesIn();
record(reloaded.includes(MADE), 'it is still there after a reload, which says the create itself was real');
record(reloaded.length === after.length, `and nothing else came or went with it (${reloaded.length})`);
record(
  reloaded.some((name) => name !== MADE),
  `workspace ${WORKSPACE} and its neighbours are untouched beside it`,
);

await finish(browser);
