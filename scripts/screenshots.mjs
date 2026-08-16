/**
 * Takes the screenshots the manual uses.
 *
 * A script rather than a folder of images somebody once made by hand, because
 * documentation screenshots rot faster than the prose around them: a button
 * moves, a column is renamed, and the picture goes on showing last year's
 * product while the paragraph beside it is correct. Regenerating has to be one
 * command or it never happens.
 *
 * Run it against a running installation with the demo data in it:
 *
 *   docker exec orknux-ui-dev-1 node scripts/screenshots.mjs
 *
 * The credentials are the ones seeded into the development directory in
 * orknux-server's `docker/ldap/bootstrap.ldif` — they are in that repository in
 * plain text on purpose, and they are of no use anywhere else.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

/*
 * localhost, because this runs inside the container that serves the interface.
 * Reaching it as `host.docker.internal` instead is refused by the dev server —
 * vite checks the Host header against `server.allowedHosts` — and the refusal
 * arrives as a sign-in failure, which points at the wrong thing entirely.
 */
const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const USER = process.env.ORKNUX_USER ?? 'alice';
const PASSWORD = process.env.ORKNUX_PASSWORD ?? 'password';
/*
 * `screens` rather than `docs`, which would put the files under the same path
 * as the documentation's own route. A static file wins that race today; a
 * change to how the built app is served could quietly turn every picture into
 * the docs page rendered as an image request.
 */
const OUT = new URL('../public/screens/', import.meta.url).pathname;

/**
 * What to photograph, and how to know the page has settled.
 *
 * `waitFor` is a selector that only exists once the data has arrived. Without
 * one every screenshot is a race, and the ones that lose show an empty table —
 * which is exactly the "raw and dull" the pictures are meant to fix.
 */
const SHOTS = [
  { name: 'workflows', path: '/workspace/1', waitFor: 'text=Workflows' },
  /*
   * The graph, which is the one picture that shows what this product is. It
   * waits for a node to be on the canvas rather than for the page: React Flow
   * mounts the canvas empty and fills it a frame later, so a screenshot of the
   * page alone is a screenshot of a grid.
   */
  { name: 'editor', path: '/workspace/1/workflows/3/editor', waitFor: '.react-flow__node' },
  { name: 'executions', path: '/workspace/1/executions', waitFor: 'text=Executions' },
  { name: 'models', path: '/workspace/1/models', waitFor: 'text=Available Models' },
  { name: 'variables', path: '/workspace/1/variables', waitFor: 'text=Variables' },
  { name: 'agents', path: '/workspace/1/agents', waitFor: 'text=Agents' },
  { name: 'triggers', path: '/workspace/1/triggers', waitFor: 'text=Triggers' },
  // The composer, by its label rather than its placeholder: `text=` matches
  // content, and a placeholder is an attribute, so it never matched at all.
  { name: 'chat', path: '/chat', waitFor: 'textarea[aria-label="Message"]' },
  { name: 'doctor', path: '/admin/doctor', waitFor: 'text=Doctor' },
  { name: 'workspace-settings', path: '/workspace/1/settings', waitFor: 'text=Workspace Settings' },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  // A laptop's worth of page, at twice the pixels so the result is still sharp
  // on the screen somebody reads the manual on.
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await mkdir(OUT, { recursive: true });

// Signing in through the API rather than the form: this is a screenshot script,
// and driving a login screen is one more thing that can break for reasons that
// have nothing to do with the picture being taken.
const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: USER, password: PASSWORD },
});
if (!signedIn.ok()) {
  console.error(`Could not sign in as ${USER}: ${signedIn.status()} ${await signedIn.text()}`);
  process.exit(1);
}

// The sign-in screen itself, before the session is used — the one page a reader
// meets before they are anybody.
const anonymous = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const loginPage = await anonymous.newPage();
await loginPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await loginPage.screenshot({ path: `${OUT}sign-in.png` });
console.log('sign-in');
await anonymous.close();

/*
 * `domcontentloaded` and then the selector, rather than `networkidle`.
 *
 * Several of these pages never go idle — the executions list polls, the quick
 * chat asks about its workspace, an auto-refresh ticks — so waiting for silence
 * waits for something that does not happen and fails after thirty seconds on a
 * page that was ready in one. What the picture actually needs is the content,
 * and the selector is what says the content arrived.
 */
let failures = 0;
for (const shot of SHOTS) {
  try {
    await page.goto(`${BASE}${shot.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(shot.waitFor, { timeout: 15_000 });
    // Animations settle, and a refresh already in flight lands.
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}${shot.name}.png` });
    console.log(shot.name);
  } catch (failure) {
    // One page that will not settle should not cost the other nine. It is
    // reported and counted, so a run that half worked cannot look like a
    // run that worked.
    failures += 1;
    console.warn(`  ${shot.name}: ${failure.message.split('\n')[0]}`);
  }
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} of ${SHOTS.length} could not be taken.`);
  process.exit(1);
}
console.log('\nWritten to public/screens/');
