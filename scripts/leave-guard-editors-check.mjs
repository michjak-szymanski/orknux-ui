/**
 * The object, tool and skill editors asking before unsaved work is walked away
 * from - every editor of the shape issue #138 was filed against, bar the
 * function.
 *
 * `leave-guard-check.mjs` measures the function editor. This measures the
 * others - the object and the tool, named in #138 and given the guard
 * afterwards, and the skill, which was never in that list until #159 noticed -
 * and it asks all of them the same six questions in the same order:
 *
 *   dirty then leave   - asks, and the page is still there behind the question
 *   clean then leave   - says nothing; the editor was only read
 *   typed then undone  - says nothing either, which is the difference between
 *                        comparing against what was loaded and counting keys
 *   saved then leave   - says nothing. This is the one that matters most: a
 *                        guard that asks after a save is a guard people learn
 *                        to click through, and then it protects nobody
 *   Back, pressed      - asks, and the address bar has not moved
 *   the answers        - "Leave" really does throw the edit away, and
 *                        "Save & Leave" really does store it
 *
 * Two mechanisms are measured, because there are two. A link inside the
 * application is react-router's to follow and the editor's to intercept, so
 * that one is measured by clicking a link and looking for the dialog. Closing
 * the tab is the browser's, and a page may only answer it by calling
 * `preventDefault` on `beforeunload` - there is no dialog of ours to look for,
 * and Chromium will not show its own to a script - so that one is measured by
 * asking the page whether it would: dispatch a cancelable `beforeunload` and
 * see whether anything stops it. That is exactly the question the browser acts
 * on when the tab is closed.
 *
 * None of the three has a create route, so there is no "being written" case
 * here: an object, a tool and a skill are all made elsewhere and these pages
 * only ever open one that exists. That is the whole of what differs from the
 * function's check.
 *
 * The object, the tool and the skill are this check's own, made and deleted
 * over GraphQL, so nothing in the workspace is edited by running it.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const STAMP = Date.now();
const PREFIX = 'leaveGuardEditors';

/*
 * Anything a run that died halfway through left behind.
 *
 * Swept at the start rather than guarded at the end, because the sweep also
 * cleans up after the runs the suite's timeout killed, which no `finally` can.
 */
const left = await graphql(
  `query($id: ID!) {
     workspaceTools(workspaceId: $id, page: 0, size: 100) { content { id name } }
     workspaceObjects(workspaceId: $id, page: 0, size: 100) { content { id name } }
     workspaceSkills(workspaceId: $id, page: 0, size: 100) { content { id name } }
   }`,
  { id: WORKSPACE },
);
for (const old of left.workspaceTools.content.filter((held) => held.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteTool(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept tool ${old.name} (#${old.id}) from an earlier run`);
}
for (const old of left.workspaceObjects.content.filter((held) => held.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteObject(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept object ${old.name} (#${old.id}) from an earlier run`);
}
for (const old of left.workspaceSkills.content.filter((held) => held.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteSkill(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept skill ${old.name} (#${old.id}) from an earlier run`);
}

const TOOL_NAME = `${PREFIX}Tool${STAMP}`;
/* What the editor opens, and what the sandbox is handed: the same tool, twice. */
const TOOL_TS = `function ${TOOL_NAME}(city: string): string {
  return city;
}
`;
const TOOL_JS = `function ${TOOL_NAME}(city) {
  return city;
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
      params: [{ name: 'city', type: 'STRING' }],
    },
  },
);
console.log(`made tool ${madeTool.createTool.name} (#${madeTool.createTool.id})`);

const OBJECT_NAME = `${PREFIX}Object${STAMP}`;
const madeObject = await graphql(
  `mutation($input: CreateObjectInput!) { createObject(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: OBJECT_NAME,
      description: 'An object this check made for itself.',
      properties: [{ name: 'channel', kind: 'STRING', description: 'Where it goes.' }],
    },
  },
);
console.log(`made object ${madeObject.createObject.name} (#${madeObject.createObject.id})`);

const SKILL_NAME = `${PREFIX}Skill${STAMP}`;
/*
 * The frontmatter block first, because that is the part Validate reads and the
 * part a save is refused over. Everything this check types goes after it, so a
 * failure here is the guard's and never the format's.
 */
const madeSkill = await graphql(
  `mutation($input: CreateSkillInput!) { createSkill(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: SKILL_NAME,
      description: 'A skill this check made for itself.',
      content: `---\nname: ${SKILL_NAME}\ndescription: A skill this check made for itself.\n---\n\nWhat to do, in prose.\n`,
    },
  },
);
console.log(`made skill ${madeSkill.createSkill.name} (#${madeSkill.createSkill.id})`);

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
const press = (label) => dialog.getByRole('button', { name: label, exact: true }).click();

/* --------------------------------------------------------------- the drill */

/**
 * The same run of questions, put to whichever editor is handed in.
 *
 * The two editors differ in what "make a change" means - one is a code column
 * and the other is a text field - so that much is the caller's to supply. What
 * is asked, and in what order, is not: a guard that behaves differently on two
 * pages of the same shape is two guards.
 */
async function drill(spec) {
  const { label, where, list, settle, edit, undo, onScreen, stored } = spec;
  const outLink = page.locator(`a[href="${list}"]`).last();

  const openEditor = async () => {
    await page.goto(where, { waitUntil: 'domcontentloaded' });
    await settle();
  };

  /* ------------------------------------------------ clean, and left alone */

  await openEditor();
  record((await wouldAsk()) === false, `${label} untouched: the browser would not ask on the way out`);
  record((await asking()) === false, `${label} untouched: nothing is being asked`);
  await outLink.click();
  await page.waitForTimeout(900);
  record(page.url().endsWith(list), `${label} clean then leave: the link was followed (${page.url()})`);
  record((await asking()) === false, `${label} clean then leave: without a question`);

  /* --------------------------------------------------------- dirty, and asked */

  await openEditor();
  const opened = await onScreen();
  const MARK = '//edited-by-the-check';
  await edit(MARK);
  record((await wouldAsk()) === true, `${label} dirty: the browser would ask on the way out`);

  await outLink.click();
  await page.waitForTimeout(700);
  record(await asking(), `${label} dirty then leave: the editor asks first`);
  record(page.url().startsWith(where), `${label} dirty then leave: and has not gone anywhere (${page.url()})`);

  await press('Cancel');
  await page.waitForTimeout(400);
  record((await asking()) === false, `${label} cancel: the question is put away`);
  record((await onScreen()).includes(MARK), `${label} cancel: the edit is still on screen`);

  /* ---------------------------------------------------------- Back, pressed */

  await page.goBack();
  await page.waitForTimeout(900);
  record(await asking(), `${label} Back while dirty: the editor asks`);
  record(page.url().startsWith(where), `${label} Back while dirty: and the address has not moved (${page.url()})`);
  await press('Cancel');
  await page.waitForTimeout(400);

  /* ----------------------------------------- typed, then taken back out again */

  await undo(MARK);
  record((await onScreen()) === opened, `${label} undone: the page is what was loaded again`);
  record((await wouldAsk()) === false, `${label} undone: so the browser would not ask`);
  await outLink.click();
  await page.waitForTimeout(900);
  record(page.url().endsWith(list), `${label} undone then leave: the link was followed (${page.url()})`);
  record((await asking()) === false, `${label} undone then leave: without a question`);

  /* ----------------------------------------------------- leave without saving */

  await openEditor();
  await edit('//thrown-away');
  await outLink.click();
  await page.waitForTimeout(700);
  record(await asking(), `${label} leave without saving: asked`);
  await press('Leave');
  await page.waitForTimeout(1200);
  record(page.url().endsWith(list), `${label} leave without saving: the link was followed (${page.url()})`);
  record(!(await stored()).includes('//thrown-away'), `${label} leave without saving: the server never heard about it`);

  /* ------------------------------------------------------------- save & leave */

  await openEditor();
  await edit('//kept');
  await outLink.click();
  await page.waitForTimeout(700);
  record(await asking(), `${label} save & leave: asked`);
  await press('Save & Leave');
  await page.waitForTimeout(6000);
  record(page.url().endsWith(list), `${label} save & leave: the link was followed (${page.url()})`);
  record((await stored()).includes('//kept'), `${label} save & leave: and the change was stored`);

  /* ------------------------------------- saved by hand, then leave: no question */

  await openEditor();
  await edit('//saved-by-hand');
  await page.locator('button', { hasText: 'Save Changes' }).click();
  await page.waitForTimeout(6000);
  record((await stored()).includes('//saved-by-hand'), `${label} saved: the change reached the server`);
  record((await wouldAsk()) === false, `${label} saved then leave: the browser would not ask`);
  await outLink.click();
  await page.waitForTimeout(900);
  record((await asking()) === false, `${label} saved then leave: the editor does not ask either`);
  record(page.url().endsWith(list), `${label} saved then leave: the link was followed (${page.url()})`);

  /* ---------------------------------------- Back, once, on an editor left clean */

  await openEditor();
  await page.goBack();
  await page.waitForTimeout(1500);
  record(
    !page.url().startsWith(where),
    `${label} clean: one press of Back leaves, rather than being swallowed by the guard (${page.url()})`,
  );
}

/* ------------------------------------------------------------- the tool editor */

const toolId = madeTool.createTool.id;
await drill({
  label: 'tool:',
  where: `${BASE}/workspace/${WORKSPACE}/tools/${toolId}`,
  list: `/workspace/${WORKSPACE}/tools`,
  /*
   * Monaco, the objects and the parameter sync all have to have settled: until
   * they have, "nothing has changed yet" is not yet true - the effect that keeps
   * the declaration in step with the panel runs when the workspace's objects
   * arrive, which is after the tool does.
   */
  settle: async () => {
    await page.waitForSelector('.view-lines', { timeout: 30_000 });
    await page.waitForTimeout(2500);
  },
  /** Types at the end of the first line, which is somebody editing the code. */
  edit: async (what) => {
    await page.locator('.view-lines').click();
    await page.keyboard.press('End');
    await page.keyboard.type(what);
    await page.waitForTimeout(700);
  },
  undo: async (what) => {
    await page.locator('.view-lines').click();
    await page.keyboard.press('End');
    for (let at = 0; at < what.length; at += 1) await page.keyboard.press('Backspace');
    await page.waitForTimeout(900);
  },
  onScreen: () => page.locator('.view-lines').innerText(),
  stored: async () => {
    const read = await graphql(`query($id: ID!) { tool(id: $id) { typescript source } }`, { id: toolId });
    return read.tool.typescript ?? read.tool.source;
  },
});

/* ----------------------------------------------------------- the object editor */

const objectId = madeObject.createObject.id;
await drill({
  label: 'object:',
  where: `${BASE}/workspace/${WORKSPACE}/objects/${objectId}`,
  list: `/workspace/${WORKSPACE}/objects`,
  settle: async () => {
    await page.waitForSelector('#object-description', { timeout: 30_000 });
    await page.waitForTimeout(1200);
  },
  /*
   * There is no code column here, so the change is made where an object's work
   * actually is: the sentence saying what the shape is for. A property's name
   * would do as well - both go through the same comparison - and the
   * description is the one field that cannot be refused for its contents, so a
   * failure here is the guard's and never the server's.
   */
  edit: async (what) => {
    const field = page.locator('#object-description');
    await field.fill(`${await field.inputValue()}${what}`);
    await page.waitForTimeout(700);
  },
  undo: async (what) => {
    const field = page.locator('#object-description');
    const held = await field.inputValue();
    await field.fill(held.slice(0, held.length - what.length));
    await page.waitForTimeout(900);
  },
  onScreen: () => page.locator('#object-description').inputValue(),
  stored: async () => {
    const read = await graphql(`query($id: ID!) { workflowObject(id: $id) { description } }`, { id: objectId });
    return read.workflowObject.description ?? '';
  },
});

/* ------------------------------------------------------------ the skill editor */

const skillId = madeSkill.createSkill.id;
await drill({
  label: 'skill:',
  where: `${BASE}/workspace/${WORKSPACE}/skills/${skillId}`,
  list: `/workspace/${WORKSPACE}/skills`,
  /*
   * The catalogs arrive after the skill does and fill the folder picker, and
   * until they have, "nothing has changed yet" is a claim about a form that is
   * still being filled in.
   */
  settle: async () => {
    await page.waitForSelector('textarea[aria-label="Skill definition"]', { timeout: 30_000 });
    await page.waitForTimeout(1500);
  },
  /*
   * At the end of the markdown, which is where a skill's work is: it is prose,
   * and somebody writing one is typing paragraphs rather than editing a field.
   * After the frontmatter on purpose - see the fixture above.
   */
  edit: async (what) => {
    const area = page.locator('textarea[aria-label="Skill definition"]');
    await area.fill(`${await area.inputValue()}${what}`);
    await page.waitForTimeout(700);
  },
  undo: async (what) => {
    const area = page.locator('textarea[aria-label="Skill definition"]');
    const held = await area.inputValue();
    await area.fill(held.slice(0, held.length - what.length));
    await page.waitForTimeout(900);
  },
  onScreen: () => page.locator('textarea[aria-label="Skill definition"]').inputValue(),
  stored: async () => {
    const read = await graphql(`query($id: ID!) { skill(id: $id) { content } }`, { id: skillId });
    return read.skill.content;
  },
});

/* ------------------------------------------------------------------- tidy up */

const mine = await graphql(
  `query($id: ID!) {
     workspaceTools(workspaceId: $id, page: 0, size: 100) { content { id name } }
     workspaceObjects(workspaceId: $id, page: 0, size: 100) { content { id name } }
     workspaceSkills(workspaceId: $id, page: 0, size: 100) { content { id name } }
   }`,
  { id: WORKSPACE },
);
for (const held of mine.workspaceTools.content.filter((one) => one.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteTool(id: $id) }`, { id: held.id }).catch((cause) => {
    console.log(`could not delete tool ${held.name} (#${held.id}): ${cause.message}`);
  });
}
for (const held of mine.workspaceObjects.content.filter((one) => one.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteObject(id: $id) }`, { id: held.id }).catch((cause) => {
    console.log(`could not delete object ${held.name} (#${held.id}): ${cause.message}`);
  });
}
for (const held of mine.workspaceSkills.content.filter((one) => one.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteSkill(id: $id) }`, { id: held.id }).catch((cause) => {
    console.log(`could not delete skill ${held.name} (#${held.id}): ${cause.message}`);
  });
}

await finish(browser);
