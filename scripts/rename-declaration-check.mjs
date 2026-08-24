/**
 * Renaming a function in the signature builder, and what the code does about it.
 *
 * Issue #267: the panel already rewrites the parameter list of the declaration
 * when a parameter is added, and left the *name* of the same declaration behind —
 * so a function renamed to `sssssdsd` went on reading `export default async
 * function sss()` for ever. It ran perfectly, because the sandbox calls the
 * default export, and read as a mistake to everybody who opened it.
 *
 * The fix is deliberately narrow, and the narrowness is what this check is for.
 * Three functions are made, all of them this check's own:
 *
 *   the stub    - its declaration bears its own name, which is what the editor
 *                 wrote. Renaming has to follow, in the column and then in what
 *                 is stored.
 *   hand-named  - its declaration says something else, because somebody chose an
 *                 identifier of their own. Renaming must not touch it, ever.
 *   recursive   - its declaration bears its name and so does a call inside it.
 *                 Renaming the declaration alone would break the call, so the
 *                 whole thing is left as it was.
 *
 * And the fourth question, which is the one a fix like this gets wrong: opening a
 * function whose name and declaration already disagree - the state #267 leaves
 * behind - must change nothing and must not open the page with work in it to
 * lose. That is issue #175's failure wearing a new hat, so it is asked the way
 * #175's check asks it, of the dialog and of the browser both.
 */
import { BASE, WORKSPACE, open, record, finish, shot } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1800, height: 1000 } });

const STAMP = Date.now();
const PREFIX = 'renameCheck';

/* ----------------------------------------------------------------- fixture */

const left = await graphql(
  `query($id: ID!) { workspaceFunctions(workspaceId: $id, page: 0, size: 200) { content { id name } } }`,
  { id: WORKSPACE },
);
for (const old of left.workspaceFunctions.content.filter((held) => held.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept function ${old.name} (#${old.id}) from an earlier run`);
}

const made = [];

async function makeFunction(name, typescript) {
  const answer = await graphql(
    `mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id name } }`,
    {
      input: {
        workspaceId: WORKSPACE,
        name,
        description: 'A function this check made for itself.',
        returnType: 'STRING',
        params: [{ name: 'word', type: 'STRING' }],
        source: typescript,
        typescript,
      },
    },
  );
  made.push(answer.createFunction.id);
  return answer.createFunction;
}

const STUB_NAME = `${PREFIX}Stub${STAMP}`;
const HAND_NAME = `${PREFIX}Hand${STAMP}`;
const SELF_NAME = `${PREFIX}Self${STAMP}`;

let failures = 0;

function check(ok, said) {
  record(ok, said);
  if (!ok) failures += 1;
}

/* -------------------------------------------------------------- the rulers */

/** The code column, line for line, with Monaco's indent spaces put back. */
const codeColumn = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.view-lines .view-line')]
      .sort((one, other) => parseFloat(one.style.top) - parseFloat(other.style.top))
      .map((line) => (line.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\u200b/g, ''))
      .join('\n'),
  );

/** The declaration line, which is the line a rename would land on. */
const firstLine = async () => (await codeColumn()).split('\n')[0].trimEnd();

const dialog = page.locator('dialog[data-check="unsaved-work"][open]');
const asking = async () => (await dialog.count()) > 0;

/** Whether anything would stop the tab being closed. The browser's own question. */
const wouldAsk = () =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

async function openEditor(id) {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.view-lines', { timeout: 30_000 });
  await page.waitForFunction(
    () =>
      (document.querySelector('.view-lines')?.textContent ?? '')
        .replace(/\u00a0/g, ' ')
        .includes('export default'),
    undefined,
    { timeout: 30_000 },
  );
  // Past the late arrivals - the variables, the objects, the importable list -
  // any of which re-renders the panel and could put a stale draft back.
  await page.waitForTimeout(1500);
}

/** What is stored, which is the only copy that matters once the page is closed. */
const stored = (id) =>
  graphql(`query($id: ID!) { function(id: $id) { name source typescript } }`, { id }).then(
    (answer) => answer.function,
  );

/** Types over the Name field, one keystroke at a time, the way somebody does. */
async function renameTo(name) {
  const field = page.locator('#function-name');
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially(name, { delay: 25 });
  await page.waitForTimeout(900);
}

try {
  /* ------------------------------------------- the stub: the rename follows */

  const stub = await makeFunction(
    STUB_NAME,
    `export default async function ${STUB_NAME}(word) {\n  return word;\n}\n`,
  );
  await openEditor(stub.id);

  check(
    (await firstLine()) === `export default async function ${STUB_NAME}(word) {`,
    'the editor opens on the declaration as it was stored',
  );

  const RENAMED = `${PREFIX}Renamed${STAMP}`;
  await renameTo(RENAMED);

  const followed = await firstLine();
  console.log(`after the rename the declaration reads: ${JSON.stringify(followed)}`);
  check(
    followed === `export default async function ${RENAMED}(word) {`,
    'renaming in the panel renames the declaration in the column, and nothing else on the line',
  );
  check(
    !(await codeColumn()).includes(STUB_NAME),
    'and the old name is gone from the code entirely',
  );

  await page.getByRole('button', { name: 'Save Changes' }).click();
  // `ValidationStatus`'s own words for a save the server accepted.
  await page.waitForSelector('text=Saved, and valid', { timeout: 20_000 });

  const kept = await stored(stub.id);
  check(kept.name === RENAMED, `the server stores the new name (${kept.name})`);
  check(
    kept.typescript.includes(`function ${RENAMED}(word)`) &&
      kept.source.includes(`function ${RENAMED}(word)`),
    'and both halves of the stored code carry it: what is opened and what runs',
  );

  /* ------------------------------- a declaration somebody named themselves */

  const hand = await makeFunction(
    HAND_NAME,
    'export default async function whateverIWantToCallIt(word) {\n  return word;\n}\n',
  );
  await openEditor(hand.id);

  const before = await codeColumn();
  await renameTo(`${PREFIX}HandTwo${STAMP}`);
  const after = await codeColumn();

  check(
    after === before && after.includes('function whateverIWantToCallIt(word)'),
    'a declaration named something of its own is left exactly as it was',
  );

  /* --------------------------------------------- a function that calls itself */

  const self = await makeFunction(
    SELF_NAME,
    `export default async function ${SELF_NAME}(word) {\n` +
      `  return word.length > 3 ? await ${SELF_NAME}(word.slice(1)) : word;\n}\n`,
  );
  await openEditor(self.id);

  const beforeSelf = await codeColumn();
  await renameTo(`${PREFIX}SelfTwo${STAMP}`);
  const afterSelf = await codeColumn();

  check(
    afterSelf === beforeSelf,
    'a function that calls itself by name is left alone rather than half-renamed',
  );

  /* ------------------------ opening one that already disagrees changes nothing */

  /*
   * Exactly the state #267 leaves behind on an installation that has been run
   * for a while: renamed on the server, still declaring the old name in the
   * code. Opening it must not quietly rewrite the code, and must not open the
   * page with something to lose - which is issue #175's failure.
   */
  const stale = await makeFunction(
    `${PREFIX}Stale${STAMP}`,
    `export default async function ${PREFIX}Was${STAMP}(word) {\n  return word;\n}\n`,
  );
  await openEditor(stale.id);

  check(
    (await firstLine()) === `export default async function ${PREFIX}Was${STAMP}(word) {`,
    'opening a function whose name and declaration already disagree rewrites nothing',
  );
  check(!(await wouldAsk()), 'and the page has nothing to lose: the browser would let the tab close');

  await page.getByRole('link', { name: 'Functions', exact: true }).first().click();
  await page.waitForTimeout(800);
  check(!(await asking()), 'and leaving it asks nothing');

  await page.screenshot({ path: shot('rename-declaration.png'), fullPage: true });
} catch (failure) {
  record(false, `the check threw: ${failure.message}`);
  failures += 1;
} finally {
  for (const id of made) {
    await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id }).catch(() => undefined);
  }
}

await finish(browser, failures === 0);
