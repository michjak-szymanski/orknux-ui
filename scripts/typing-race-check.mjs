/**
 * Typing fast into the code editor, and the four things that are allowed to
 * write over what was typed.
 *
 * Issue #198. `CodeEditor` wrote its Monaco model back from its `value` prop on
 * every render where the two disagreed. A passive effect does not run at commit
 * - it is flushed after paint - so a keystroke that lands in that gap leaves the
 * effect holding a `value` one character behind the model it is about to
 * overwrite. `setValue` then replaces the document with the older text and sends
 * the caret to the top, mid-word, and the next characters land wherever the
 * caret now is. Driven at a 15ms key delay, "export default async function"
 * came back as "';n 'o' retu) 4154262ion1787".
 *
 * That is why this check types with a delay rather than with `insertText`.
 * `insertText` is one input event and cannot race anything, which is exactly why
 * every check in this suite that used it - and Playwright's own default typing
 * speed, which is slower than a person - went on passing while the editor
 * scrambled real text. The measurement here is the whole typed string compared
 * character for character against what the editor is holding afterwards.
 *
 * Typing is only half of it. The prop is also how four legitimate writers put
 * code into this editor, and a fix that simply stopped writing would break all
 * four, silently:
 *
 *   the panel      - a parameter added on the right rewrites the declaration on
 *                    the left, because the server refuses to save a function
 *                    whose code cannot accept what it is handed. Only while the
 *                    panel is ahead of the server (issue #175, `panelMoved`), so
 *                    this check asserts both halves: nothing is rewritten on a
 *                    load, and the rewrite lands when a parameter really is added
 *   a suggestion   - the assistant's change, accepted in the bar over the diff
 *   a revision     - restoring a version from the History panel, which writes
 *                    into the editor already on screen
 *   another one    - opening a different function, whose code has to replace what
 *                    the last one left there
 *
 * Everything here is this check's own, made and deleted over GraphQL, and swept
 * at the start in case an earlier run was killed before it could delete.
 *
 * The split is pushed to its narrowest panel before anything is typed. Not
 * cosmetic: the editor wraps rather than scrolls, and a wrapped line is several
 * `.view-line` elements carrying an indent nobody typed, so a line long enough
 * to wrap cannot be read back character for character. Both typed lines are kept
 * well inside what the column holds, and the check counts the rendered lines
 * before believing either comparison.
 */
import { BASE, WORKSPACE, open, record, finish, shot } from './suite/harness.mjs';

const { browser, context, page, graphql } = await open({ viewport: { width: 1800, height: 1000 } });

/*
 * The narrowest the panel goes, written before any page runs, so the code column
 * gets the rest of an 1800px row and the typed line has no reason to wrap.
 */
await context.addInitScript(() => {
  try {
    window.localStorage.setItem('orknux.function-editor.panel-width', '300');
  } catch {
    /* A browser that refuses storage still runs the check, on the default split. */
  }
});

/* ----------------------------------------------------------------- fixture */

const STAMP = Date.now();
const PREFIX = 'typingRace';

const left = await graphql(
  `query($id: ID!) { workspaceFunctions(workspaceId: $id, page: 0, size: 200) { content { id name } } }`,
  { id: WORKSPACE },
);
for (const old of left.workspaceFunctions.content.filter((held) => held.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept function ${old.name} (#${old.id}) from an earlier run`);
}

/** The one that gets typed into, and the one that gets opened after it. */
const TYPED_NAME = `${PREFIX}Typed${STAMP}`;
const WRITERS_NAME = `${PREFIX}Writers${STAMP}`;

const TYPED_CODE = `export default async function ${TYPED_NAME}() {
  return 'the function that gets typed into';
}
`;
const WRITERS_CODE = `export default async function ${WRITERS_NAME}() {
  return 'the version before the suggestion';
}
`;

const makeFunction = async (name, typescript) =>
  (
    await graphql(
      `mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id name } }`,
      {
        input: {
          workspaceId: WORKSPACE,
          name,
          description: 'A function this check made for itself.',
          returnType: 'STRING',
          source: typescript,
          typescript,
        },
      },
    )
  ).createFunction;

const typed = await makeFunction(TYPED_NAME, TYPED_CODE);
const writers = await makeFunction(WRITERS_NAME, WRITERS_CODE);
console.log(`made ${typed.name} (#${typed.id}) and ${writers.name} (#${writers.id})`);

/* -------------------------------------------------------------- the rulers */

/**
 * What the editor is holding, exactly.
 *
 * Read off the rendered lines and put back the space Monaco draws as a
 * no-break space. `\n` is left alone: it separates model lines here, because
 * the caller has already been told the line did not wrap.
 */
const shownCode = async () =>
  (await page.locator('.view-lines').innerText()).replace(/ /g, ' ').replace(/\r\n/g, '\n');

/** The same text with every run of whitespace flattened, for comparing shapes. */
const collapse = (text) => text.replace(/\s+/g, ' ').trim();

/** How many rendered lines there are, which is not how many model lines. */
const drawnLines = () => page.locator('.view-line').count();

/** Where two strings stop agreeing, said in a way a failure can be read from. */
function divergence(wanted, got) {
  const upTo = Math.min(wanted.length, got.length);
  for (let at = 0; at < upTo; at += 1) {
    if (wanted[at] !== got[at]) {
      return `at character ${at}: wanted ${JSON.stringify(wanted.slice(at, at + 24))}, got ${JSON.stringify(got.slice(at, at + 24))}`;
    }
  }
  return wanted.length === got.length
    ? 'nowhere - they are the same'
    : `at character ${upTo}: one is ${wanted.length} long and the other ${got.length}`;
}

const openEditor = async (id) => {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.view-lines', { timeout: 30_000 });
  // The stored code has to be in the column before anything is measured against
  // it: an editor drawn empty would pass a comparison against nothing.
  await page.waitForFunction(
    () =>
      (document.querySelector('.view-lines')?.textContent ?? '')
        .replace(/ /g, ' ')
        .includes('export default'),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1200);
};

/* ----------------------------------------------- the panel, on a load and on a move */

await openEditor(writers.id);

const onLoad = await shownCode();
record(
  collapse(onLoad) === collapse(WRITERS_CODE),
  'opening a function leaves its stored code exactly as it was stored, with no declaration rewritten on sight',
);
record(!onLoad.includes('city'), 'and there is no parameter in it yet');

await page.getByRole('button', { name: 'Add Parameter' }).click();
await page.getByLabel('Parameter 1 name').fill('city');
await page.waitForTimeout(1500);

const afterParameter = await shownCode();
console.log(`after adding a parameter: ${JSON.stringify(collapse(afterParameter).slice(0, 120))}`);
record(
  afterParameter.includes('city: string'),
  'adding a parameter in the panel rewrites the declaration to take it',
);

/* ------------------------------------------------------------ a suggestion */

await openEditor(writers.id);

const SUGGESTED = `export default async function ${WRITERS_NAME}() {
  return 'the suggestion this check offered';
}
`;
await page.evaluate(
  ([functionId, code]) => {
    window.dispatchEvent(
      new CustomEvent('orknux:function-suggestion', {
        detail: { functionId, note: 'A change this check offered.', code },
        cancelable: true,
      }),
    );
  },
  [String(writers.id), SUGGESTED],
);

const accept = page.getByRole('button', { name: 'Accept' });
await accept.waitFor({ timeout: 15_000 });
record(true, 'a suggestion for the function on screen is claimed by the editor rather than the chat');
await accept.click();
await page.waitForSelector('.view-lines', { timeout: 30_000 });
await page.waitForTimeout(3000);

const afterAccept = await shownCode();
console.log(`after accepting: ${JSON.stringify(collapse(afterAccept).slice(0, 120))}`);
record(
  collapse(afterAccept) === collapse(SUGGESTED),
  'accepting the suggestion puts the suggested code in the editor',
);

const stored = (await graphql(`query($id: ID!) { function(id: $id) { typescript } }`, { id: writers.id })).function;
record(collapse(stored.typescript) === collapse(SUGGESTED), 'and the save that went with it stored the same code');

/* -------------------------------------------------------------- a revision */

/*
 * Read again first. The History panel fetches its list when the page draws, and
 * the save above happened after that - so the version the accept displaced is
 * on the server and not yet in the list on screen.
 */
await openEditor(writers.id);

const history = page.getByRole('region', { name: 'History' });
await history.waitFor({ timeout: 20_000 }).catch(() => undefined);
const rows = history.locator('li');
await rows.first().waitFor({ timeout: 20_000 }).catch(() => undefined);
record((await rows.count()) > 0, `the History panel lists ${await rows.count()} version(s) to restore`);

// Newest first, so the top row is what the accepted suggestion replaced.
await rows.first().getByRole('button').first().click();
await page.waitForTimeout(800);
await history.getByRole('button', { name: 'Restore this version' }).click();
await page.waitForTimeout(3000);

const afterRestore = await shownCode();
console.log(`after restoring: ${JSON.stringify(collapse(afterRestore).slice(0, 120))}`);
record(
  collapse(afterRestore) === collapse(WRITERS_CODE),
  'restoring a version from the History panel writes it into the editor already on screen',
);
record(
  !afterRestore.includes('the suggestion this check offered'),
  'and the code it replaced is gone from the column',
);

/* ------------------------------------------------------- another component */

/*
 * Reached by the road it is really taken: the list, and a row clicked on it, so
 * the second function arrives through react-router rather than through a fresh
 * document. The list is five to a page and sorted by name, so a function made a
 * moment ago is rarely on the page it opens at - `?made=` is the list's own
 * answer to that, and it is what the editor's own Back link carries.
 */
await page.goto(`${BASE}/workspace/${WORKSPACE}/functions?made=${typed.id}`, { waitUntil: 'domcontentloaded' });
const row = page.getByRole('link', { name: TYPED_NAME, exact: true });
await row.waitFor({ timeout: 20_000 });
await row.click();
await page.waitForSelector('.view-lines', { timeout: 30_000 });
await page.waitForTimeout(2500);

const afterSwitch = await shownCode();
console.log(`after switching: ${JSON.stringify(collapse(afterSwitch).slice(0, 120))}`);
record(
  collapse(afterSwitch) === collapse(TYPED_CODE),
  'opening another function loads its code into the editor',
);
record(
  !afterSwitch.includes(WRITERS_NAME),
  'and the function that was open before it is not still showing',
);

/* ------------------------------------------------------- typed at 15ms/key */

/*
 * Last, and on the page the switch above landed on. Typing here leaves work the
 * leave guard is entitled to ask about, and a check that then navigates is a
 * check arguing with a dialog it is not testing.
 *
 * One line, and every character in it one Monaco leaves alone. No bracket, no
 * quote and no backtick, because Monaco closes those itself and a check that
 * asserted its own text against auto-closed text would fail for the editor
 * being an editor. A line comment, so the language service has no diagnostic
 * and no suggestion to offer while it is being written.
 */
const TYPED_LINE = '// 15ms a key, no pauses: 0123456789 alpha bravo charlie delta echo foxtrot golf;';

await page.locator('.view-lines').click();
await page.keyboard.press('Control+A');
await page.keyboard.press('Delete');
await page.waitForTimeout(400);

const startedAt = Date.now();
await page.keyboard.type(TYPED_LINE, { delay: 15 });
console.log(`typed ${TYPED_LINE.length} characters in ${Date.now() - startedAt}ms`);

// Long enough for anything the last keystroke scheduled to have run. A clobber
// that lands after the assertion is the same bug arriving late.
await page.waitForTimeout(2000);

const rendered = await drawnLines();
record(rendered === 1, `the typed line is drawn as ${rendered} rendered line(s), so it can be read back whole`);

const cameOut = await shownCode();
console.log(`typed:   ${JSON.stringify(TYPED_LINE)}`);
console.log(`came out: ${JSON.stringify(cameOut)}`);
record(
  cameOut === TYPED_LINE,
  `typed at 15ms a key, the editor holds exactly what was typed - ${divergence(TYPED_LINE, cameOut)}`,
);
await page.screenshot({ path: shot('typing-race.png'), fullPage: false });

/*
 * And again from a caret in the middle of what is already there, because the
 * bug sent the caret home: characters typed after it landed at the top of the
 * document rather than where the person was looking.
 */
await page.keyboard.press('Home');
await page.waitForTimeout(300);
const INSERTED = 'typed in at the front, ';
await page.keyboard.type(INSERTED, { delay: 15 });
await page.waitForTimeout(2000);

const stillOne = await drawnLines();
record(stillOne === 1, `the line is still drawn as ${stillOne} rendered line(s), so it can be read back whole`);

const afterInsert = await shownCode();
const wantedAfterInsert = INSERTED + TYPED_LINE;
console.log(`after insert: ${JSON.stringify(afterInsert)}`);
record(
  afterInsert === wantedAfterInsert,
  `typing from the start of the line inserts there, character for character - ${divergence(wantedAfterInsert, afterInsert)}`,
);

/* ----------------------------------------------------------------- swept up */

for (const made of [typed, writers]) {
  await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: made.id }).catch(() => undefined);
  console.log(`removed ${made.name} (#${made.id})`);
}

await finish(browser);
