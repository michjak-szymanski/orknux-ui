/**
 * Installing a library by naming a package (issue #265).
 *
 * The Libraries screen has two ways in and one kind of row: a file somebody
 * chose, and a package somebody named. What this drives is the second, and the
 * three things about it that are worth measuring in a browser rather than in the
 * server's own suite.
 *
 * **That the field is there, beside the upload and not instead of it.** The
 * whole design rests on the registry being a way of *getting* the file rather
 * than something the product depends on, so the upload has to survive next to
 * it. An installation with no registry configured draws no field at all, which
 * is why this asks the server first and says which case it is looking at rather
 * than failing on the wrong one.
 *
 * **That a version has to be pinned, and that the refusal arrives as the
 * server's own sentence.** `latest` is refused before anything is fetched, so
 * this half needs no network and runs anywhere the product runs - which is the
 * only reason it can be in the suite at all. It is also the assertion that would
 * catch the change nobody would notice: an interface that swallowed the sentence
 * and printed "Could not install that package" would leave somebody unable to
 * tell a typo from a package that ships no module.
 *
 * **That the explanation is behind the (?) and not printed under the field.**
 * Six admin screens were half prose once. The rules here are long - a pinned
 * version, one self-contained file, no bundling - and every one of them belongs
 * in the note.
 *
 * **And that a CommonJS package installs, which is issue #274.** That half needs
 * a package to actually come back, and it must not come back from npm: a check
 * that reaches the real registry goes red the day somebody unpublishes
 * something. `scripts/suite/npm-stub.py` is the same arrangement
 * `image-model-check.mjs` uses for the thing it cannot stub in the browser - a
 * registry the *server* can reach, serving a real gzipped tarball, started by
 * hand. Point the installation at it, set ORKNUX_LIBRARY_STUB=1, and the half
 * below runs; without it the check says so and stops, because the only other
 * registry there is is the one it may not touch.
 */
import { BASE, open, record, drawn, shot, finish } from './suite/harness.mjs';

/** Whether this installation is pointed at `scripts/suite/npm-stub.py`. */
const STUBBED = (process.env.ORKNUX_LIBRARY_STUB ?? '') !== '';

/** What that stub publishes. Named here because the two files are one pair. */
const CJS = 'orknux-cjs@1.0.0';
const NEEDS = 'orknux-needs@1.0.0';

const { browser, context, page } = await open({ viewport: { width: 1440, height: 1000 } });

/** Whether this installation fetches packages at all, asked before anything is read. */
const asked = await context.request.post(`${BASE}/graphql`, {
  data: { query: 'query { libraryRegistry { configured url } }' },
});
const status = (await asked.json())?.data?.libraryRegistry ?? { configured: false, url: '' };
console.log(`--- registry: ${status.configured ? status.url : 'none configured'}`);

await page.goto(`${BASE}/admin/libraries`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'admin libraries'))) await finish(browser);
await page.waitForTimeout(400);

const field = page.locator('input[aria-label="Package and exact version"]');
const install = page.getByRole('button', { name: 'Install', exact: true });
const upload = page.getByRole('button', { name: /Load Library/ });

record(await upload.isVisible(), 'the upload is still there, whatever the registry does');

if (status.configured !== true) {
  /*
   * Not a skip. An installation configured without a registry must draw no
   * field, and that is exactly as much of a claim as the other branch - a
   * control that fails on being used is the one thing an offline installation
   * should never be shown.
   */
  record((await field.count()) === 0, 'no registry configured, so no field offering to fetch from one');
  await page.screenshot({ path: shot('library-install-none.png') });
  await finish(browser);
}

record((await field.count()) === 1, 'a field for a package and its version');
record(
  (await field.getAttribute('placeholder')) === 'random@4.1.0',
  'the placeholder is a package pinned to a version, which is the whole rule in four words',
);
record(await install.isDisabled(), 'Install does nothing until something has been typed');

/*
 * The rules live behind the (?), not under the field. Asserted as the absence of
 * the sentences from the visible page as well as the presence of the control:
 * a (?) that exists beside a paragraph saying the same thing is the state this
 * product spent a release getting out of.
 */
const hint = page.locator('button[data-hint="Libraries"]');
record((await hint.count()) === 1, 'a (?) beside the heading');
const before = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
for (const sentence of ['does not bundle', 'exact version', 'fetches it once']) {
  record(!before.includes(sentence), `"${sentence}" is not printed on the page while the note is shut`);
}
await hint.hover();
await page.waitForTimeout(400);
const opened = (await page.locator('[role="note"]').first().innerText()).replace(/\s+/g, ' ');
record(opened.includes('does not bundle'), 'the note is where the answer on dependencies is');
record(opened.includes('latest'), 'and where the reason a version is pinned is');
await page.mouse.move(1400, 990);
await page.waitForTimeout(300);

const loaded = await page.locator('[class*="_row_"]').count();

/*
 * A tag instead of a version. Refused before anything is fetched, so this runs
 * on a machine with no way out - and the sentence that comes back is the
 * server's, which is the half worth pinning.
 */
await field.fill('random@latest');
record(await install.isEnabled(), 'Install wakes up once a package has been named');
await install.click();
await page.waitForTimeout(1200);

const refusal = (await page.locator('[class*="_noticeError_"]').first().innerText().catch(() => '')).replace(
  /\s+/g,
  ' ',
);
console.log(`--- refusal: ${JSON.stringify(refusal)}`);
record(refusal.includes('exact version'), 'a tag is refused, and the refusal says to name an exact version');
record(refusal.includes('random@latest'), 'and it says which of the two things typed was wrong');
record(
  (await page.locator('[class*="_row_"]').count()) === loaded,
  'nothing was loaded by a request that was refused',
);
await page.screenshot({ path: shot('library-install-refused.png') });

/* ------------------------------------------------------- installing, for real */

if (!STUBBED) {
  console.log('--- no stub registry (ORKNUX_LIBRARY_STUB unset), so nothing is installed');
  await finish(browser);
}

/**
 * A CommonJS package, which is the whole of #274.
 *
 * The owner tried `base64-js@1.5.1` and was told the package ships no ES module
 * to install. It ships one file, requires nothing, and is a self-contained
 * module written in the other spelling; the rule was wider than its reason. What
 * is measured here is what an administrator sees when they type one: a row, with
 * the package it came from and the fact that it is CommonJS on it, and the
 * members the file exports rather than an empty object.
 */
await field.fill(CJS);
await install.click();
await page.waitForTimeout(2500);

const installed = page.locator('[class*="_row_"]').filter({ hasText: 'orknux-cjs' }).first();
record(await installed.isVisible(), 'a CommonJS package installs, where a release ago it was refused');

const row = (await installed.innerText()).replace(/\s+/g, ' ');
console.log(`--- row: ${JSON.stringify(row)}`);
record(row.includes(`npm · ${CJS}`), 'the row says which package and which version it came from');
record(row.includes('index.js'), 'and which file inside it is the one that runs');
record(
  row.includes('CommonJS'),
  'and that it is CommonJS, because the stored file is wrapped when it runs and nowhere else',
);
record(row.includes('upper'), 'what the file put on exports is what the row offers to importers');
await page.screenshot({ path: shot('library-install-commonjs.png') });

/**
 * And the refusal that is left, which is the one that matters.
 *
 * A CommonJS entry calling `require` names a second package. Installed, it would
 * fail at its first call in the middle of somebody's workflow, so it is refused
 * here with the specifier in the sentence - the assertion that would catch an
 * interface swallowing the server's words for a shorter apology of its own.
 */
await field.fill(NEEDS);
await install.click();
await page.waitForTimeout(2500);

const needy = (await page.locator('[class*="_noticeError_"]').first().innerText().catch(() => '')).replace(
  /\s+/g,
  ' ',
);
console.log(`--- refusal: ${JSON.stringify(needy)}`);
record(needy.includes('requires "buffer"'), 'a package that requires another is refused, and by name');
record(needy.includes('does not bundle'), 'and the sentence says why, which is the whole answer on dependencies');
record(
  (await page.locator('[class*="_row_"]').filter({ hasText: 'orknux-needs' }).count()) === 0,
  'and nothing was loaded by a request that was refused',
);

/*
 * Taken away again. This check runs against a live installation and one that
 * left a library behind would change what the next run sees - and what the next
 * person looking at the screen sees.
 */
const listed = await context.request.post(`${BASE}/graphql`, {
  data: { query: 'query { scriptLibraries { id key } }' },
});
const mine = ((await listed.json())?.data?.scriptLibraries ?? []).find((one) => one.key === 'orknux-cjs');
if (mine !== undefined) {
  await context.request.post(`${BASE}/graphql`, {
    data: { query: `mutation { deleteScriptLibrary(id: ${mine.id}) }` },
  });
}

await finish(browser);
