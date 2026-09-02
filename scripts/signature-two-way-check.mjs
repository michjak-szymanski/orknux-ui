/**
 * The function editor's signature, edited from either side.
 *
 * Issue #321. The panel beside the code and the declaration in it are one
 * signature with two controls, and only one of them was listened to. Editing a
 * parameter in the panel rewrote the declaration, which is right. Editing the
 * declaration left the panel showing the old parameters - and it is the panel
 * that is saved, so somebody who typed the change into the code, which is what
 * anybody writing code reaches for, ended up with a function whose stored
 * signature was whatever the panel still believed.
 *
 * Four things this is here to catch:
 *
 *   panel to code   the direction that already worked, here so a fix that
 *                   breaks it is caught rather than celebrated
 *   code to panel   the bug: a parameter renamed in the declaration reaches the
 *                   panel
 *   the type too    and its type, since a name that moved without its type
 *                   would be half a fix that reads as a whole one
 *   the settling    the two do not chase each other. The panel writes the
 *                   declaration and the declaration is read back, which is a
 *                   loop, and the check watches it long enough to see it stop
 *
 * The last one is the reason this check exists at all rather than a unit test
 * over the parser: a parser that reads a declaration correctly and a page that
 * writes one correctly can still, together, never come to rest.
 *
 * Makes a function and deletes it.
 */
import { BASE, WORKSPACE, open, drawn, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const MARK = 'zzSignatureTwoWay';
const NAME = `${MARK}${Date.now()}`;

const sweep = async () => {
  const { workspaceFunctions } = await graphql(
    `query($w: ID!) { workspaceFunctions(workspaceId: $w, size: 200) { content { id name } } }`,
    { w: WORKSPACE },
  );
  for (const old of workspaceFunctions.content.filter((one) => one.name.startsWith(MARK))) {
    await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept ${old.name} (#${old.id})`);
  }
};

await sweep();

const made = await graphql(
  `mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: NAME,
      description: 'Made by signature-two-way-check, and deleted by it.',
      params: [{ name: 'ticket', type: 'STRING' }],
      returnType: 'STRING',
      typescript: `export default function ${NAME}(ticket: string): string {\n  return ticket;\n}\n`,
      source: `export default function ${NAME}(ticket) {\n  return ticket;\n}\n`,
    },
  },
);
const FUNCTION = made.createFunction.id;
console.log(`made ${made.createFunction.name} (#${FUNCTION})`);

const clean = async () => {
  await sweep();
  await finish(browser);
};

/* ------------------------------------------------------------------ reading */

/** What the panel says the first parameter is. */
const panel = async () => ({
  name: await page.inputValue('input[aria-label="Parameter 1 name"]').catch(() => null),
  type: await page.inputValue('select[aria-label="Parameter 1 type"]').catch(() => null),
});

/**
 * The code, as the editor is drawing it.
 *
 * Read off the rendered lines rather than out of a model handle: the editor is
 * not put on `window`, deliberately, and the drawn text is what somebody would
 * be looking at anyway. Monaco pads with non-breaking spaces, taken back out so
 * a comparison against ordinary text means something.
 */
const code = () =>
  page.$eval('.view-lines', (held) => held.innerText.replace(/ /g, ' ')).catch(() => null);

/**
 * Replaces the whole of the code, the way a paste does.
 *
 * `insertText` rather than `type`: Monaco closes a bracket the moment one is
 * typed, so typing a function in would leave the stray halves of every pair it
 * helpfully added, and the check would be measuring that instead.
 */
async function writeAll(text) {
  await page.click('.view-lines');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

/** Watches until something is true of the page, keeping the last sample. */
async function until(what, why, ms) {
  const stop = Date.now() + ms;
  let last = null;
  for (;;) {
    last = { panel: await panel(), code: await code() };
    if (what(last)) return last;
    if (Date.now() > stop) {
      console.log(`gave up waiting for ${why}: ${JSON.stringify(last)}`);
      return null;
    }
    await page.waitForTimeout(150);
  }
}

/* -------------------------------------------------------------------- drive */

await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${FUNCTION}`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the function editor'))) await clean();

const opened = await page
  .waitForSelector('input[aria-label="Parameter 1 name"]', { timeout: 25_000 })
  .then(() => true)
  .catch(() => false);
record(opened, 'the editor opens with the function\'s parameters in the panel');
if (!opened) await clean();

await page.waitForTimeout(1500);
record((await panel()).name === 'ticket', `and the panel starts on what was stored (${(await panel()).name})`);

/* ---- panel to code, which already worked ---- */

await page.fill('input[aria-label="Parameter 1 name"]', 'reference');

const wrote = await until(
  (now) => (now.code ?? '').includes('reference'),
  'the declaration to follow the panel',
  15_000,
);
record(wrote !== null, 'renaming a parameter in the panel rewrites the declaration');

/* ---- code to panel, which is the bug ---- */

await writeAll(
  `export default function ${NAME}(caseNumber: number): string {\n  return String(caseNumber);\n}\n`,
);

const read = await until(
  (now) => now.panel.name === 'caseNumber',
  'the panel to follow the declaration',
  15_000,
);
record(read !== null, 'and renaming it in the declaration moves the panel');
record(
  read !== null && read.panel.type === 'NUMBER',
  `the type comes with it, rather than the name moving alone (${read?.panel.type ?? null})`,
);

/* ---- and they come to rest ---- */

const settled = read === null ? null : { ...read };
await page.waitForTimeout(4000);
const after = { panel: await panel(), code: await code() };
record(
  settled !== null &&
    after.panel.name === settled.panel.name &&
    after.panel.type === settled.panel.type &&
    after.code === settled.code,
  'the two stop there rather than chasing each other: four seconds later nothing has moved',
);

/* ---- and the declaration still says what the panel does ---- */

record(
  (after.code ?? '').includes('caseNumber: number'),
  `the declaration was not rewritten back over the edit (${JSON.stringify(
    (after.code ?? '').split('\n').find((line) => line.includes('export default')) ?? null,
  )})`,
);

await clean();
