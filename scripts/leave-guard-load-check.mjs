/**
 * The four editors, opened and not touched: the guard has nothing to say.
 *
 * Issue #175. The owner opened `check_jira_signature`, changed nothing, clicked
 * away, and the guard from #138 asked about work nobody had done. The guard's
 * whole value is that it only speaks when something really changed, so a guard
 * that speaks on arrival is worse than no guard: people learn to click through
 * it, and then it is not there on the day it matters.
 *
 * `leave-guard-check.mjs` and `leave-guard-editors-check.mjs` both assert the
 * untouched case and both passed while this was broken, because the fixtures
 * they build are simpler than anything anybody stores. A function created over
 * GraphQL with no parameters gets the stub the server prints, and the stub's
 * declaration is exactly the declaration the panel would write - so the page
 * rewriting the code on load rewrote it to what was already there and nothing
 * showed. That is the gap, and it is what this check fills: every fixture here
 * is a component whose stored code was written by hand and does *not* agree
 * with its own details panel, which is what everything in a real workspace
 * looks like after a year.
 *
 * What is measured, for each of the four:
 *
 *   loaded    - the page holds what the server holds, character for character.
 *               A load-time rewrite is caught here rather than three assertions
 *               later, and it is printed both ways round so a failure says what
 *               changed rather than that something did.
 *   clean     - nothing would stop the tab being closed, and no question is
 *               open. Asserted the moment the page has finished loading and
 *               before any interaction at all: no click, no keystroke, not even
 *               a focus.
 *   left      - and clicking out of the editor really does leave, in silence.
 *
 * The waiting matters as much as the asserting. The fault was a race - the code
 * column was brought into step with the details panel one render after the
 * workspace's variables and objects arrived in their own fetches - so a check
 * that reads the page before those land measures the moment before the bug.
 * Each editor is therefore settled on something only the late fetch can draw:
 * the function's external named rather than blank, the tool's object-typed
 * parameter naming its object. Then a further pause, and only then the reading.
 *
 * And because "never rewrite the code" would pass everything above while
 * quietly removing the reason the rewrite exists, the last section changes a
 * parameter in the panel and asserts the declaration still follows it.
 *
 * Every fixture is this check's own, made and deleted over GraphQL, so nothing
 * in the workspace is edited by running it.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const STAMP = Date.now();
const PREFIX = 'leaveGuardLoad';

/*
 * Anything a run that died halfway through left behind. Swept at the start
 * rather than guarded at the end, because the sweep also cleans up after the
 * runs the suite's timeout killed, which no `finally` can.
 */
const left = await graphql(
  `query($id: ID!) {
     workspaceFunctions(workspaceId: $id, page: 0, size: 100) { content { id name } }
     workspaceTools(workspaceId: $id, page: 0, size: 100) { content { id name } }
     workspaceObjects(workspaceId: $id, page: 0, size: 100) { content { id name } }
     workspaceSkills(workspaceId: $id, page: 0, size: 100) { content { id name } }
   }`,
  { id: WORKSPACE },
);
const sweep = async (held, mutation, kind) => {
  for (const old of held.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(mutation, { id: old.id }).catch(() => undefined);
    console.log(`swept ${kind} ${old.name} (#${old.id}) from an earlier run`);
  }
};
await sweep(left.workspaceFunctions.content, `mutation($id: ID!) { deleteFunction(id: $id) }`, 'function');
await sweep(left.workspaceTools.content, `mutation($id: ID!) { deleteTool(id: $id) }`, 'tool');
await sweep(left.workspaceSkills.content, `mutation($id: ID!) { deleteSkill(id: $id) }`, 'skill');
// Objects last: a function or a tool that names one holds it down.
await sweep(left.workspaceObjects.content, `mutation($id: ID!) { deleteObject(id: $id) }`, 'object');

/** Two of the workspace's variables, for a function that is handed some. */
const workspaceVariables = await graphql(
  `query($id: ID!) { workspaceVariables(workspaceId: $id, page: 0, size: 50) { content { id name type } } }`,
  { id: WORKSPACE },
);
const someVariables = workspaceVariables.workspaceVariables.content.slice(0, 2);
if (someVariables.length < 2) {
  record(false, `this workspace keeps ${someVariables.length} variables; a function with two externals needs two`);
  await finish(browser);
}

/** An object of this check's own, so the tool below has one to name. */
const OBJECT_NAME = `${PREFIX}Object${STAMP}`;
const madeObject = await graphql(
  `mutation($input: CreateObjectInput!) { createObject(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: OBJECT_NAME,
      description: 'An object this check made for itself.',
      properties: [
        { name: 'channel', kind: 'STRING', description: 'Where it goes.' },
        { name: 'urgent', kind: 'BOOLEAN', description: 'Whether it goes now.' },
      ],
    },
  },
);
const scratchObject = madeObject.createObject;
console.log(`made object ${scratchObject.name} (#${scratchObject.id})`);

/*
 * The function from the issue, in the shape that broke: an explicit return
 * type, two externals, and a hand-written body whose parameter list is nobody's
 * business but the author's. The panel will say the function is handed two
 * externals and takes no declared parameters; the code says it takes `payload`
 * and `secret`. Both are true - the declaration in the code is what the author
 * wrote, and the page has no business rewriting it on sight.
 */
const FUNCTION_NAME = `${PREFIX}Function${STAMP}`;
const FUNCTION_TS = `export default async function ${FUNCTION_NAME}(payload: any, secret: string) {
  const signature = payload['X-Hub-Signature-256'];
  if (!signature) return 'missing';

  const expected = \`sha256=\${secret}\`;
  return signature === expected ? 'valid' : 'invalid';
}`;
/* The same function with the annotations gone, which is what the sandbox runs. */
const FUNCTION_JS = `export default async function ${FUNCTION_NAME}(payload, secret) {
    const signature = payload['X-Hub-Signature-256'];
    if (!signature)
        return 'missing';
    const expected = \`sha256=\${secret}\`;
    return signature === expected ? 'valid' : 'invalid';
}
`;
const madeFunction = await graphql(
  `mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: FUNCTION_NAME,
      description: 'A function this check made for itself.',
      returnType: 'STRING',
      typescript: FUNCTION_TS,
      source: FUNCTION_JS,
      externalVariableIds: someVariables.map((one) => one.id),
    },
  },
);
const scratchFunction = madeFunction.createFunction;
console.log(
  `made function ${scratchFunction.name} (#${scratchFunction.id}), handed ` +
    someVariables.map((one) => one.name).join(' and '),
);

/*
 * The tool of the same shape: a parameter that names an object, so its
 * annotation cannot be written until the workspace's objects have arrived, and
 * a declaration written by hand that says something else again.
 */
const TOOL_NAME = `${PREFIX}Tool${STAMP}`;
const TOOL_TS = `function ${TOOL_NAME}(ticket: any, note: string): string {
  return note + ticket.channel;
}
`;
const TOOL_JS = `function ${TOOL_NAME}(ticket, note) {
  return note + ticket.channel;
}
`;
const madeTool = await graphql(
  `mutation($input: CreateToolInput!) { createTool(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: TOOL_NAME,
      description: 'A tool this check made for itself.',
      source: TOOL_JS,
      typescript: TOOL_TS,
      params: [
        { name: 'ticket', type: 'OBJECT', objectId: scratchObject.id },
        { name: 'note', type: 'STRING' },
      ],
    },
  },
);
const scratchTool = madeTool.createTool;
console.log(`made tool ${scratchTool.name} (#${scratchTool.id})`);

/*
 * A skill whose prose is formatted - blank lines, trailing newline, indented
 * list - because a page that normalises what it loads would show up here.
 */
const SKILL_NAME = `${PREFIX}Skill${STAMP}`;
const SKILL_CONTENT = `---
name: ${SKILL_NAME}
description: A skill this check made for itself.
---

What to do, in prose.

  - one thing
  - another thing
`;
const madeSkill = await graphql(
  `mutation($input: CreateSkillInput!) { createSkill(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: SKILL_NAME,
      description: 'A skill this check made for itself.',
      content: SKILL_CONTENT,
    },
  },
);
const scratchSkill = madeSkill.createSkill;
console.log(`made skill ${scratchSkill.name} (#${scratchSkill.id})`);

/* -------------------------------------------------------------- the rulers */

/** Whether anything would stop the tab being closed. The browser's own question. */
const wouldAsk = () =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

const dialog = page.locator('dialog[data-check="unsaved-work"][open]');
const asking = async () => (await dialog.count()) > 0;

/**
 * The code column, line for line.
 *
 * Not `.view-lines` innerText, which is how this was first written and which
 * quietly drops the blank lines - so a body with a paragraph break in it read
 * back as a body without one, and the check reported a rewrite that had not
 * happened. Monaco draws each line as its own absolutely-positioned div, so the
 * lines are gathered in the order they are painted in and a blank one comes
 * back as the empty string it is. The non-breaking spaces Monaco indents with
 * are turned back into the spaces they stand for.
 */
const codeColumn = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.view-lines .view-line')]
      .sort((one, other) => parseFloat(one.style.top) - parseFloat(other.style.top))
      .map((line) => (line.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\u200b/g, ''))
      .join('\n'),
  );

/** The declaration line, which is the line a rewrite would land on. */
const firstLine = async () => (await codeColumn()).split('\n')[0].trimEnd();

/* --------------------------------------------------------------- the drill */

/**
 * Open one editor, let it finish arriving, and ask the three questions.
 *
 * `settled` is the caller's because only the caller knows what its page draws
 * last. It is not optional and it is not a sleep: the fault this check exists
 * for lived in the gap between a page being readable and a page being finished,
 * and a check that reads the first of those measures the wrong moment.
 */
async function untouched({ label, where, list, settled, held, stored }) {
  await page.goto(where, { waitUntil: 'domcontentloaded' });
  await settled();
  // Past the last of the late arrivals, whatever order they came in.
  await page.waitForTimeout(1500);

  const onScreen = await held();
  if (onScreen === stored) {
    record(true, `${label} loaded: the page holds what the server holds`);
  } else {
    record(
      false,
      `${label} loaded: the page rewrote it before anybody touched it\n` +
        `        stored: ${JSON.stringify(stored)}\n` +
        `        screen: ${JSON.stringify(onScreen)}`,
    );
  }

  record((await wouldAsk()) === false, `${label} untouched: the browser would not ask on the way out`);
  record((await asking()) === false, `${label} untouched: nothing is being asked`);

  await page.locator(`a[href="${list}"]`).last().click();
  await page.waitForTimeout(900);
  record((await asking()) === false, `${label} untouched then leave: without a question`);
  record(page.url().endsWith(list), `${label} untouched then leave: the link was followed (${page.url()})`);
}

/* ------------------------------------------------------------- the function */

const FUNCTION_WHERE = `${BASE}/workspace/${WORKSPACE}/functions/${scratchFunction.id}`;
const FUNCTION_LIST = `/workspace/${WORKSPACE}/functions`;

await untouched({
  label: 'function',
  where: FUNCTION_WHERE,
  list: FUNCTION_LIST,
  settled: async () => {
    await page.waitForSelector('.view-lines', { timeout: 30_000 });
    /*
     * The external named rather than numbered. Until the workspace's variables
     * have arrived the select has no option to show, so this is the one thing
     * on the page that says the late fetch has landed - which is exactly the
     * render the rewrite used to happen on.
     */
    await page
      .locator('select[aria-label="External parameter 1"]')
      .locator(`option[value="${someVariables[0].id}"]`)
      .waitFor({ state: 'attached', timeout: 30_000 });
  },
  held: () => codeColumn(),
  stored: FUNCTION_TS,
});

/* ----------------------------------------------------------------- the tool */

const TOOL_WHERE = `${BASE}/workspace/${WORKSPACE}/tools/${scratchTool.id}`;
const TOOL_LIST = `/workspace/${WORKSPACE}/tools`;

await untouched({
  label: 'tool',
  where: TOOL_WHERE,
  list: TOOL_LIST,
  settled: async () => {
    await page.waitForSelector('.view-lines', { timeout: 30_000 });
    // The object-typed parameter naming its object: the objects have arrived.
    await page
      .locator('select[aria-label="Object for ticket"]')
      .locator(`option[value="${scratchObject.id}"]`)
      .waitFor({ state: 'attached', timeout: 30_000 });
  },
  held: () => codeColumn(),
  // Monaco draws the empty line after a trailing newline, so the column is the
  // whole file including it.
  stored: TOOL_TS,
});

/* --------------------------------------------------------------- the object */

const OBJECT_WHERE = `${BASE}/workspace/${WORKSPACE}/objects/${scratchObject.id}`;
const OBJECT_LIST = `/workspace/${WORKSPACE}/objects`;

await untouched({
  label: 'object',
  where: OBJECT_WHERE,
  list: OBJECT_LIST,
  settled: async () => {
    // Both rows drawn, the second of which is the last thing this page draws.
    await page.locator('#property-name-1').waitFor({ timeout: 30_000 });
  },
  /*
   * An object has no code column, so what it holds is its rows - and the rows
   * are what the comparison behind the guard is over, sent as the payload a
   * save would send rather than row by row.
   */
  held: async () => (await page.locator('input[id^="property-name-"]').evaluateAll((rows) => rows.map((row) => row.value))).join(', '),
  stored: 'channel, urgent',
});

/* ---------------------------------------------------------------- the skill */

const SKILL_WHERE = `${BASE}/workspace/${WORKSPACE}/skills/${scratchSkill.id}`;
const SKILL_LIST = `/workspace/${WORKSPACE}/skills`;

await untouched({
  label: 'skill',
  where: SKILL_WHERE,
  list: SKILL_LIST,
  settled: async () => {
    await page.locator('textarea[aria-label="Skill definition"]').waitFor({ timeout: 30_000 });
  },
  /* The skill editor writes its prose in a textarea, not in Monaco. */
  held: () => page.locator('textarea[aria-label="Skill definition"]').inputValue(),
  stored: SKILL_CONTENT,
});

/* ------------------------------------------- and the rewrite still happens */

/*
 * The other half of the same property.
 *
 * "Never rewrite the code" passes everything above and takes away the reason
 * the rewrite was written: the server refuses a function whose code cannot
 * accept what it is handed, and being refused for something the panel just did
 * to you is not a way to find that out. So the panel is moved, and the
 * declaration has to follow it.
 */
await page.goto(FUNCTION_WHERE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.view-lines', { timeout: 30_000 });
await page
  .locator('select[aria-label="External parameter 1"]')
  .locator(`option[value="${someVariables[0].id}"]`)
  .waitFor({ state: 'attached', timeout: 30_000 });
await page.waitForTimeout(1500);

const beforeTheMove = await firstLine();
await page.getByRole('button', { name: 'Remove external parameter 1' }).click();
await page.waitForTimeout(800);
const afterTheMove = await firstLine();

console.log(`declaration before: ${beforeTheMove}`);
console.log(`declaration after:  ${afterTheMove}`);
record(
  afterTheMove !== beforeTheMove && afterTheMove.includes(someVariables[1].name),
  'panel moved: the declaration follows it, and holds the external that is left',
);
record(
  afterTheMove.includes(someVariables[0].name) === false,
  'panel moved: and not the one that was taken off',
);
record(await wouldAsk(), 'panel moved: which is work, and the guard says so');

/* ---------------------------------------------------------------- clean up */

await page.evaluate(() => window.removeEventListener('beforeunload', () => {}));
for (const [mutation, id, kind] of [
  [`mutation($id: ID!) { deleteFunction(id: $id) }`, scratchFunction.id, 'function'],
  [`mutation($id: ID!) { deleteTool(id: $id) }`, scratchTool.id, 'tool'],
  [`mutation($id: ID!) { deleteSkill(id: $id) }`, scratchSkill.id, 'skill'],
  [`mutation($id: ID!) { deleteObject(id: $id) }`, scratchObject.id, 'object'],
]) {
  await graphql(mutation, { id }).catch((cause) => console.log(`could not delete the ${kind}: ${cause.message}`));
}
console.log('deleted what this check made');

await finish(browser);
