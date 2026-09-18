/**
 * Loading a plugin that asks for something, stopped at the question and loaded
 * on the answer.
 *
 * The load used to die instead of asking, when what the plugin asked for was a
 * capability: the permissions refusal carried its list to the screen and the
 * capabilities refusal surfaced as a 500 carrying nothing, so a plugin updated
 * to ask the server for one more thing could not be loaded at all. The two are
 * one question now, and this measures the whole path: both lists drawn, each
 * under its own sentence — a permission relaxes the sandbox, a capability asks
 * the server to act, and neither may be agreed to under cover of the other —
 * and one press of Allow and Load sending both kinds of names back.
 *
 * The plugin is this check's own, under a key nobody would mistake for real,
 * and it is unloaded at the end; a row an earlier killed run left behind is
 * swept at the start.
 */
import { BASE, open, record, finish } from './suite/harness.mjs';

/** Nobody's plugin is called this. The sweep is by key. */
const KEY = 'acceptcheckscratch';

const SOURCE = `export default class Scratch extends OrknuxPlugin {
  id() { return '${KEY}'; }
  apiVersion() { return 1; }
  permissions() { return ['INTL']; }
  capabilities() { return ['SLACK_READ_THREAD']; }
  functions() {
    return [new OrknuxFunction({
      name: 'nothingMuch',
      returnType: 'boolean',
      run: () => true,
    })];
  }
}
`;

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const unloadMine = async () => {
  const { plugins } = await graphql(`query { plugins { id key } }`);
  const mine = plugins.find((one) => one.key === KEY);
  if (mine === undefined) return false;
  await graphql(`mutation ($id: ID!) { unloadPlugin(id: $id) }`, { id: mine.id });
  return true;
};

if (await unloadMine()) console.log('NOTE: swept a scratch plugin from an earlier run');

await page.goto(`${BASE}/admin/plugins`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 20_000 });

/*
 * Handed to the hidden input as bytes rather than as a file on disk, so the
 * check owns what is declared and there is no fixture to drift from the
 * assertion below.
 */
await page.setInputFiles('input[type="file"]', {
  name: `${KEY}.js`,
  mimeType: 'text/javascript',
  buffer: Buffer.from(SOURCE, 'utf8'),
});

await page.waitForSelector('section >> text=needs these to run', { timeout: 30_000 });
const asking = page.locator('section').filter({ hasText: 'needs these to run' }).first();
const said = await asking.innerText();

record(said.includes('INTL'), 'the question names the permission');
record(said.includes('SLACK_READ_THREAD'), 'and the capability, in the same question');
record(
  said.includes('It asks the server to do these on its behalf.'),
  'the capability stands under its own sentence rather than inside the permission list',
);
// Under it, not above it: the sandbox list first, then what the server is asked.
record(
  said.indexOf('INTL') < said.indexOf('It asks the server to do these'),
  'the permission list comes before the capability sentence',
);

/*
 * Nothing was stored by the refusal. The row appearing only after the answer
 * is the arrangement the question exists for.
 */
const { plugins: before } = await graphql(`query { plugins { key } }`);
record(!before.some((one) => one.key === KEY), 'nothing is stored while the question stands');

await page.getByRole('button', { name: 'Allow and Load' }).click();
await page.waitForSelector(`text=Loaded ${KEY}`, { timeout: 30_000 });
const notice = await page.locator(`text=Loaded ${KEY}`).first().innerText();
record(notice.includes(`${KEY}_nothingMuch`), `loading says what it provides - "${notice}"`);

const { plugins: after } = await graphql(`query { plugins { key permissions { name } } }`);
const stored = after.find((one) => one.key === KEY);
record(stored !== undefined, 'one answer loaded it');
record(
  stored !== undefined && stored.permissions.some((one) => one.name === 'INTL'),
  'and the permission half of the answer is on the row',
);

record(await unloadMine(), 'the scratch plugin is unloaded again');

await finish(browser);
