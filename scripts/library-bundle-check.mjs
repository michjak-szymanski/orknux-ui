/**
 * Several files chosen at once, made into one library.
 *
 * Issue #319. The server half is `LibraryBundleTest`, `LibraryBundleInstallTest`
 * and the two upload tests in `ScriptLibraryTest`: the graph is walked, the
 * bodies go in byte for byte, an ES module is refused by name, and what comes
 * out runs in the sandbox.
 *
 * What no server test can say is whether anybody can get there. The file picker
 * takes several files now, and three things about that are only true on a
 * screen: that choosing several does not silently upload the first one, that the
 * permission is *asked* rather than assumed, and that the entry is asked for
 * rather than guessed — a folder of six files has no `index.js` often enough
 * that a guess would be wrong on the day it mattered, and the file it guessed is
 * the one that would run.
 *
 * The registry is deliberately not driven here. Installing a package reaches the
 * real npm from the server, which is a network call in a browser check and a
 * different feature's fixture; `LibraryBundleInstallTest` drives that half
 * against a stub, and what is left for this one is the half made of a person, a
 * file picker and a dialog.
 *
 * Four things:
 *
 *   asked       choosing more than one file opens the question rather than
 *               bundling, and nothing is loaded while it is open
 *   the entry   which file it is entered by is a control, with every chosen
 *               file on it
 *   bundled     saying yes makes one library, and it says on the row that it is
 *               several files rather than reading as the one that was picked
 *   cancelled   saying no loads nothing
 *
 * It removes what it made, because a library left behind is one the next check
 * finds in a list it was reading.
 */
import { BASE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const KEY = 'zzBundled';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/**
 * Two files, one requiring the other.
 *
 * Flat, and on purpose. A browser sends a basename for files chosen singly, so
 * `./lib/parse` would answer nothing here — what the paths in the form are for
 * is the folder case, and `ScriptLibraryTest` drives that with the paths set.
 * What is being measured on this screen is the asking, not the resolver.
 */
const FILES = [
  "var parse = require('./parse');\nmodule.exports = { total: function (t) { return parse(t) + 1; } };",
  'module.exports = function (t) { return Number(t) || 0; };',
];

async function sweep() {
  const { scriptLibraries } = await graphql(`query { scriptLibraries { id key } }`);
  for (const old of scriptLibraries.filter((one) => one.key.startsWith(KEY))) {
    await graphql(`mutation($id: ID!) { deleteScriptLibrary(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept library ${old.key} (#${old.id})`);
  }
}

await sweep();

await page.goto(`${BASE}/admin/libraries`, { waitUntil: 'domcontentloaded' });
await drawn(page, 'library-bundle', { within: 20_000 });

const picker = page.locator('input[type="file"]');
await picker.waitFor({ state: 'attached', timeout: 20_000 });
record(
  (await picker.getAttribute('multiple')) !== null,
  'the file picker takes more than one file',
);

/* --------------------------------------------------------------- the question */

/*
 * The entry is named `zzBundled.js` so the key the server takes from it is the
 * one this check sweeps for afterwards.
 */
await picker.setInputFiles([
  { name: `${KEY}.js`, mimeType: 'text/javascript', buffer: Buffer.from(FILES[0]) },
  { name: 'parse.js', mimeType: 'text/javascript', buffer: Buffer.from(FILES[1]) },
]);
await page.waitForTimeout(600);

const dialog = page.locator('dialog[open]').first();
await dialog.waitFor({ state: 'visible', timeout: 20_000 });
const asked = await dialog.innerText();
record(/bundl/i.test(asked), `choosing several files asks before bundling them ("${asked.split('\n')[0]}")`);

const loaded = (await graphql(`query { scriptLibraries { key } }`)).scriptLibraries;
record(
  !loaded.some((one) => one.key.startsWith(KEY)),
  'and nothing is loaded while the question is open',
);

/* ------------------------------------------------------------------ the entry */

const entry = page.locator('#bundle-entry');
await entry.waitFor({ state: 'visible', timeout: 20_000 });
const offered = await entry.locator('option').allTextContents();
record(offered.length === 2, `which file it is entered by is asked, with both on it (${JSON.stringify(offered)})`);
record(
  offered.some((one) => one.includes(`${KEY}.js`)),
  'and the entry that was chosen is among them',
);

await page.screenshot({ path: shot('library-bundle-asking.png'), fullPage: false });

/* ---------------------------------------------------------------- saying no */

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
record(
  !(await graphql(`query { scriptLibraries { key } }`)).scriptLibraries.some((one) => one.key.startsWith(KEY)),
  'saying no loads nothing',
);

/* --------------------------------------------------------------- saying yes */

await picker.setInputFiles([
  { name: `${KEY}.js`, mimeType: 'text/javascript', buffer: Buffer.from(FILES[0]) },
  { name: 'parse.js', mimeType: 'text/javascript', buffer: Buffer.from(FILES[1]) },
]);
await page.locator('#bundle-entry').waitFor({ state: 'visible', timeout: 20_000 });
await page.locator('#bundle-entry').selectOption(`${KEY}.js`);
await page.locator('dialog[open] button:has-text("Bundle")').click();
await page.waitForTimeout(2000);

const after = (await graphql(`query { scriptLibraries { id key bundledFrom { name } } }`)).scriptLibraries;
const made = after.find((one) => one.key.startsWith(KEY));

record(made !== undefined, `saying yes makes one library (the list holds ${JSON.stringify(after.map((o) => o.key))})`);
record(
  (made?.bundledFrom ?? []).length >= 1,
  `and it says what went into it (${JSON.stringify(made?.bundledFrom ?? null)})`,
);

const shown = await page.locator('body').innerText();
record(
  /bundled from/i.test(shown),
  'and the row says it is a bundle rather than reading as the one file that was picked',
);

await page.screenshot({ path: shot('library-bundle-check.png'), fullPage: false });

await sweep();
await finish(browser);
