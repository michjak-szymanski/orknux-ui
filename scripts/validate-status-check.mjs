/**
 * The Validate status, in the four editors that have a Validate button - and
 * the two paragraphs the function editor's panel used to print.
 *
 * The owner read the old status and asked, in these words, "what the f that
 * 'not checked yet' does?". Three things were wrong with it and they compound:
 * the button says **Validate** and the status said *checked*, so two words
 * stood for one action; it sat in a **footer**, which on the object editor put
 * it at the far end of a row from "+ Add Property"; and it never said what
 * validating would **tell** you, so it announced an absence without naming the
 * absence of what.
 *
 * What is measured here, on each of the four:
 *
 *   the words   - the status names the action the button names, and does not
 *                 say "checked". Asserted against the button's own label read
 *                 off the page rather than against the string "Validate", so a
 *                 renamed button fails this rather than quietly desynchronising.
 *   the place   - the status is nearer the Validate button than the footer is.
 *                 Measured in pixels, because "beside" is a distance and an
 *                 assertion that reads the DOM order would pass a status that
 *                 is beside the button in the markup and a screen away on the
 *                 page.
 *   the subject - the empty state names what would be validated, so it is not
 *                 an absence of nothing.
 *   the sequence- empty, then passed, then failed, all three read as one
 *                 sequence: the middle one says Valid and the last says Not
 *                 valid, and neither is a sentence from another vocabulary.
 *   the (?)     - what validating checks is behind a (?) beside the button, and
 *                 it opens. The status itself stays in the open, which is the
 *                 half a check like this usually forgets: UI-DESIGN-RULES.md
 *                 says a status is not an explanation and does not move.
 *
 * The failed state is reached by breaking the code on the page rather than by
 * fixture, because what a real refusal says is the thing under test - a check
 * that asserts a hand-written message asserts its own fixture.
 *
 * And the function editor's two paragraphs, from the same reading session: the
 * prose under Add External and under Return Type is gone from the drawn form
 * and behind a (?) on its heading, while "Open Variables" - a link, not prose -
 * is still there and still points where it pointed. A (?) that swallows a
 * navigation control makes the control unreachable, which is worse than the
 * paragraph it came from.
 *
 * Every fixture is this check's own, made and deleted over GraphQL.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const STAMP = Date.now();
const PREFIX = 'validateStatus';

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
await sweep(left.workspaceObjects.content, `mutation($id: ID!) { deleteObject(id: $id) }`, 'object');

const FUNCTION_NAME = `${PREFIX}Function${STAMP}`;
const madeFunction = await graphql(
  `mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id } }`,
  { input: { workspaceId: WORKSPACE, name: FUNCTION_NAME, returnType: 'STRING' } },
);

const TOOL_NAME = `${PREFIX}Tool${STAMP}`;
const madeTool = await graphql(
  `mutation($input: CreateToolInput!) { createTool(input: $input) { id } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: TOOL_NAME,
      description: 'A tool this check made for itself.',
      source: `function ${TOOL_NAME}(city) {\n  return city;\n}\n`,
      typescript: `function ${TOOL_NAME}(city: string): string {\n  return city;\n}\n`,
      params: [{ name: 'city', type: 'STRING' }],
    },
  },
);

const OBJECT_NAME = `${PREFIX}Object${STAMP}`;
const madeObject = await graphql(
  `mutation($input: CreateObjectInput!) { createObject(input: $input) { id } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: OBJECT_NAME,
      description: 'An object this check made for itself.',
      properties: [{ name: 'channel', kind: 'STRING', description: 'Where it goes.' }],
    },
  },
);

const SKILL_NAME = `${PREFIX}Skill${STAMP}`;
const madeSkill = await graphql(
  `mutation($input: CreateSkillInput!) { createSkill(input: $input) { id } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: SKILL_NAME,
      description: 'A skill this check made for itself.',
      content: `---\nname: ${SKILL_NAME}\ndescription: A skill this check made for itself.\n---\n\nWhat to do, in prose.\n`,
    },
  },
);
console.log('built a function, a tool, an object and a skill of this check’s own');

/* -------------------------------------------------------------- the rulers */

/** The status line's words, or null when nothing on the page is drawing one. */
const statusText = async () => {
  const held = page.locator('[data-check="validate-status"]');
  return (await held.count()) === 0 ? null : (await held.innerText()).trim();
};

/** Where two things are on the page, and how far apart their centres are. */
const apart = async (one, other) => {
  const a = await one.boundingBox();
  const b = await other.boundingBox();
  if (a === null || b === null) return null;
  return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
};

/* --------------------------------------------------------------- the drill */

/**
 * The same questions, put to whichever editor is handed in.
 *
 * `pass` and `fail` are the caller's, because reaching a green and reaching a
 * red is the one thing the four pages do differently - a function and a tool
 * are validated by pressing the button over code that does or does not compile,
 * an object by its properties, a skill by its frontmatter.
 */
async function drill({ label, where, settle, pass, fail, subject }) {
  await page.goto(where, { waitUntil: 'domcontentloaded' });
  await settle();
  await page.waitForTimeout(1200);

  const validate = page.getByRole('button', { name: 'Validate', exact: true });
  record((await validate.count()) === 1, `${label}: there is one Validate button`);

  /* ------------------------------------------------------------ the words */

  const empty = await statusText();
  console.log(`${label} empty: ${JSON.stringify(empty)}`);
  record(empty !== null, `${label} empty: there is a status, in the open`);
  record(
    empty !== null && /not been validated/i.test(empty),
    `${label} empty: it says validated, the word the button says`,
  );
  record(
    empty !== null && /not checked yet/i.test(empty) === false,
    `${label} empty: and not "not checked yet", which named no action anybody could see`,
  );
  record(
    empty !== null && empty.toLowerCase().includes(subject.toLowerCase()),
    `${label} empty: and names what would be validated ("${subject}")`,
  );

  /* ------------------------------------------------------------ the place */

  const footer = page.locator('footer').last();
  const near = await apart(page.locator('[data-check="validate-status"]'), validate);
  const far = await apart(footer, validate);
  console.log(`${label}: status is ${near?.toFixed(0)}px from Validate, the footer ${far?.toFixed(0)}px`);
  record(
    near !== null && far !== null && near < far,
    `${label}: the status is nearer the button than the footer it used to sit in`,
  );

  /* -------------------------------------------------------------- the (?) */

  const hint = page.locator('[data-check="validate-status"]').getByRole('button', { name: /^About /i });
  record((await hint.count()) === 1, `${label}: what validating checks is behind a (?) beside the button`);
  await hint.first().click();
  await page.waitForTimeout(400);
  const opened = await page.locator('[role="note"]').last().innerText();
  console.log(`${label} (?): ${JSON.stringify(opened.replace(/\s+/g, ' ').slice(0, 120))}`);
  record(/validate/i.test(opened), `${label}: and the note says what pressing Validate does`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  record((await statusText()) === empty, `${label}: the status itself did not move behind the (?)`);

  /* --------------------------------------------------------- the sequence */

  await pass();
  await validate.click();
  await page.waitForTimeout(2500);
  const green = await statusText();
  console.log(`${label} passed: ${JSON.stringify(green)}`);
  record(green !== null && /^Valid — /.test(green), `${label} passed: reads "Valid — …", the same sequence`);

  await fail();
  await validate.click();
  await page.waitForTimeout(2500);
  const red = await statusText();
  console.log(`${label} failed: ${JSON.stringify(red)}`);
  record(red !== null && /^Not valid — /.test(red), `${label} failed: reads "Not valid — …", the same sequence`);
  record(red !== green, `${label} failed: and is not what passing said`);
}

/* ------------------------------------------------------------- the editors */

/**
 * Put this code in whichever column is on screen, and do not go on until it is
 * there.
 *
 * `insertText` rather than `type`, and then read back. One insertion is one
 * input event, and what is under test here is what a Validate status says, not
 * what the editor does with keys.
 *
 * That is not the reason this line used to give. Typed key by key the
 * characters came out shuffled - "';n 'o' retu) 4154262ion1787" - because
 * `CodeEditor` wrote the model back from its `value` prop whenever the two
 * differed, and a render landing between two keystrokes carries a value one
 * character behind the model, so the caret went home mid-word. All of that was
 * true. Calling it "the editor's own race and not this check's business" is how
 * it survived: every check that drives this editor stepped around it rather
 * than failing on it, and the owner met it instead. Issue #198 fixed it, and
 * `typing-race-check.mjs` now types at 15ms a key and compares the whole
 * string. Read back rather than slept on either: the wait that is long enough
 * today is the flake next month.
 *
 * One line, so there is no auto-indent to race. Monaco closes the brace itself,
 * which is why none of these write one.
 */
const rewriteCode = async (text) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('.view-lines').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await page.waitForTimeout(600);
    const held = await page.locator('.view-lines').innerText();
    if (held.replace(/\s+/g, ' ').includes(text.replace(/\s+/g, ' ').trim())) return held;
    console.log(`retyping: the column held ${JSON.stringify(held)}`);
  }
  record(false, `the code column would not take ${JSON.stringify(text)}`);
  return null;
};

await drill({
  label: 'function',
  subject: 'The code',
  where: `${BASE}/workspace/${WORKSPACE}/functions/${madeFunction.createFunction.id}`,
  settle: () => page.waitForSelector('.view-lines', { timeout: 30_000 }),
  pass: () => rewriteCode(`export default async function ${FUNCTION_NAME}() { return 'ok';`),
  fail: () => rewriteCode('export default async function ( {{{ '),
});

await drill({
  label: 'tool',
  subject: 'The code',
  where: `${BASE}/workspace/${WORKSPACE}/tools/${madeTool.createTool.id}`,
  settle: () => page.waitForSelector('.view-lines', { timeout: 30_000 }),
  pass: () => rewriteCode(`function ${TOOL_NAME}(city: string): string { return city;`),
  fail: () => rewriteCode('function ( {{{ '),
});

await drill({
  label: 'object',
  subject: 'The properties',
  where: `${BASE}/workspace/${WORKSPACE}/objects/${madeObject.createObject.id}`,
  settle: () => page.locator('#property-name-0').waitFor({ timeout: 30_000 }),
  pass: async () => {
    await page.locator('#property-name-0').fill('channel');
    await page.waitForTimeout(300);
  },
  /* A property with no name at all is the refusal every object editor knows. */
  fail: async () => {
    await page.locator('#property-name-0').fill('');
    await page.waitForTimeout(300);
  },
});

await drill({
  label: 'skill',
  subject: 'The definition',
  where: `${BASE}/workspace/${WORKSPACE}/skills/${madeSkill.createSkill.id}`,
  settle: () => page.locator('textarea[aria-label="Skill definition"]').waitFor({ timeout: 30_000 }),
  pass: async () => {
    await page
      .locator('textarea[aria-label="Skill definition"]')
      .fill(`---\nname: ${SKILL_NAME}\ndescription: A skill this check made for itself.\n---\n\nWhat to do.\n`);
    await page.waitForTimeout(300);
  },
  /* No frontmatter block at all, which is the one thing the format requires. */
  fail: async () => {
    await page.locator('textarea[aria-label="Skill definition"]').fill('Just prose, with no frontmatter.\n');
    await page.waitForTimeout(300);
  },
});

/* ------------------------------- the function editor's two paragraphs */

/*
 * Reloaded rather than continued from, because the drill above left unsaved
 * work on the page and the leave guard would - correctly - ask about it.
 */
await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${madeFunction.createFunction.id}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForSelector('.view-lines', { timeout: 30_000 });
await page.waitForTimeout(1500);

const panel = await page.locator('aside').last().innerText();

record(
  panel.includes('handed to this function after its own parameters') === false,
  'externals: the paragraph is gone from the drawn form',
);
record(
  panel.includes('An object names a shape this workspace defines') === false,
  'return type: the paragraph is gone from the drawn form',
);

const externalsHint = page.getByRole('button', { name: 'About External Parameters' });
record((await externalsHint.count()) === 1, 'externals: there is a (?) on the heading');
await externalsHint.click();
await page.waitForTimeout(400);
const externalsNote = await page.locator('[role="note"]').last().innerText();
console.log(`externals (?): ${JSON.stringify(externalsNote.replace(/\s+/g, ' ').slice(0, 160))}`);
record(
  externalsNote.includes('handed to this function after its own parameters'),
  'externals: and the note carries the sentence that was printed',
);
record(
  externalsNote.includes('values are never shown here'),
  'externals: including the one that explains why a set variable looks empty',
);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

const returnHint = page.getByRole('button', { name: 'About Return Type' });
record((await returnHint.count()) === 1, 'return type: there is a (?) on the heading');
await returnHint.click();
await page.waitForTimeout(400);
const returnNote = await page.locator('[role="note"]').last().innerText();
console.log(`return type (?): ${JSON.stringify(returnNote.replace(/\s+/g, ' ').slice(0, 160))}`);
record(
  returnNote.includes('An object names a shape this workspace defines'),
  'return type: and the note carries the sentence that was printed',
);
record(
  returnNote.includes('Map is for a structure with no defined shape'),
  'return type: both halves of it, not the first sentence only',
);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* The link is not prose and does not move. */
const openVariables = page.getByRole('link', { name: 'Open Variables' });
record((await openVariables.count()) === 1, 'externals: "Open Variables" is still drawn, in the open');
record(
  (await openVariables.getAttribute('href')) === `/workspace/${WORKSPACE}/variables`,
  'externals: and still points at the Variables page',
);
record(
  (await openVariables.getAttribute('target')) === '_blank',
  'externals: in a new tab, so it does not take the code being written with it',
);

/* ---------------------------------------------------------------- clean up */

for (const [mutation, id, kind] of [
  [`mutation($id: ID!) { deleteFunction(id: $id) }`, madeFunction.createFunction.id, 'function'],
  [`mutation($id: ID!) { deleteTool(id: $id) }`, madeTool.createTool.id, 'tool'],
  [`mutation($id: ID!) { deleteSkill(id: $id) }`, madeSkill.createSkill.id, 'skill'],
  [`mutation($id: ID!) { deleteObject(id: $id) }`, madeObject.createObject.id, 'object'],
]) {
  await graphql(mutation, { id }).catch((cause) => console.log(`could not delete the ${kind}: ${cause.message}`));
}
console.log('deleted what this check made');

await finish(browser);
