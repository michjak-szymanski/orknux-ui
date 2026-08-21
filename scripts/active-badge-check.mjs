/**
 * Pressing Active/Inactive keeps what is on screen - issue #155.
 *
 * The badge in an editor's title row turns the thing on and off. It did that by
 * sending `setEnabled`, taking the whole tool back off the server and putting it
 * through the same `apply()` the page uses on load - so the name, the
 * description, the code and the parameter list were all replaced by the stored
 * copy. Edit the code, press the badge, and the edit was gone: no dialog, no
 * warning, nothing to put it back with.
 *
 * Issue #138's leave guard does not cover this and should not. That guard is
 * about *leaving*, and pressing a badge is not a navigation - it is the same
 * loss coming through a different door.
 *
 * So the measurement is the one the issue asks for, on both editors that draw
 * the badge over a draft:
 *
 *   edit, press the badge, and the edit is still there   - the bug itself
 *   ...and the badge still flipped, both ways            - the fix is not
 *                                                          "stop toggling"
 *   ...and the server still has the old text             - the toggle sent
 *                                                          `enabled` and
 *                                                          nothing else
 *   ...and the editor still knows it is dirty            - the leave guard is
 *                                                          composed with, not
 *                                                          switched off
 *   press it on a clean editor and nothing moves         - the ordinary case
 *                                                          still works
 *
 * The last two are what keeps a green run honest. A fix that made the toggle a
 * no-op would pass the first assertion; a fix that quietly marked the page clean
 * would pass the first three and hand the next person the same loss with the
 * guard turned off as well.
 *
 * The tool and the skill are this check's own, made and deleted over GraphQL, so
 * nothing in the workspace is edited by running it.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const STAMP = Date.now();
const PREFIX = 'activeBadge155';

/** What is on the page: the word in the badge, and whether it is Active. */
const badge = page.locator('h1 + button');
const badgeSays = () => badge.innerText();

/** Whether anything would stop the tab being closed - the leave guard, asked. */
const wouldAsk = () =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

/**
 * Press the badge and wait for the word in it to change.
 *
 * Waited on rather than slept through: the press is a round trip to the server,
 * and a fixed pause is either longer than every run needs or shorter than one
 * run in ten does. Returns what the badge settled on, so a press that never
 * landed fails on the word rather than on a timeout with no sentence in it.
 */
async function pressBadge(within = 15_000) {
  const was = await badgeSays();
  await badge.click();
  const upTo = Date.now() + within;
  for (;;) {
    const now = await badgeSays();
    if (now !== was) return now;
    if (Date.now() >= upTo) return now;
    await page.waitForTimeout(200);
  }
}

/*
 * Anything a run that died halfway through left behind. Swept at the start
 * rather than only at the end, because the sweep also cleans up after the runs
 * the suite's timeout killed, which no `finally` can.
 */
const left = await graphql(
  `query($id: ID!) {
     workspaceTools(workspaceId: $id, page: 0, size: 100) { content { id name } }
     workspaceSkills(workspaceId: $id, page: 0, size: 100) { content { id name } }
   }`,
  { id: WORKSPACE },
);
for (const old of left.workspaceTools.content.filter((held) => held.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteTool(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept tool ${old.name} (#${old.id}) from an earlier run`);
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
  `mutation($input: CreateToolInput!) { createTool(input: $input) { id name enabled } }`,
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

const SKILL_NAME = `${PREFIX}Skill${STAMP}`;
const madeSkill = await graphql(
  `mutation($input: CreateSkillInput!) { createSkill(input: $input) { id name enabled } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: SKILL_NAME,
      description: 'A skill this check made for itself.',
      content: `---\nname: ${SKILL_NAME}\ndescription: Scratch, for issue #155.\n---\n\nA paragraph.\n`,
    },
  },
);
console.log(`made skill ${madeSkill.createSkill.name} (#${madeSkill.createSkill.id})`);

/* --------------------------------------------------------------- the drill */

/**
 * The same run of questions, put to whichever editor is handed in.
 *
 * The two editors differ in what "make a change" means - one is Monaco and the
 * other is a plain textarea - so that much is the caller's to supply. What is
 * asked, and in what order, is not: a badge that behaves differently on two
 * pages of the same shape is two badges.
 */
async function drill(spec) {
  const { label, where, settle, edit, onScreen, stored, guarded } = spec;
  const MARK = '//kept-through-the-toggle';

  /*
   * The leave guard is only asked about on the editors that have one. Issue
   * #138 gave it to the function, object and tool editors; the skill editor was
   * not named in it and has none, so asking that page whether it would stop a
   * tab closing measures a hole nobody has filled yet rather than this fix. It
   * is a real hole - see the note where this is called - and it is not this
   * check's to fail on.
   */
  const guardIs = async (want, said) => {
    if (!guarded) return;
    record((await wouldAsk()) === want, said);
  };

  /* ------------------------------- a draft on screen, and the badge pressed */

  await page.goto(where, { waitUntil: 'domcontentloaded' });
  await settle();

  const before = await badgeSays();
  record(
    before === 'Active' || before === 'Inactive',
    `${label} the badge is drawn and says ${JSON.stringify(before)}`,
  );

  const opened = await onScreen();
  await edit(MARK);
  record((await onScreen()).includes(MARK), `${label} the edit is on screen before the badge is pressed`);
  await guardIs(true, `${label} and the editor knows it is dirty`);

  const after = await pressBadge();

  /* This is issue #155. Everything else here is about the fix being a real one. */
  record((await onScreen()).includes(MARK), `${label} pressing the badge keeps the edit on screen`);

  record(after !== before, `${label} and the badge really did flip: ${before} -> ${after}`);
  record(
    !(await stored()).includes(MARK),
    `${label} and the server was told about the badge only, not about the draft`,
  );
  await guardIs(true, `${label} and the editor still knows it is dirty`);

  /* ------------------------------------------------ pressed again, and back */

  const back = await pressBadge();
  record((await onScreen()).includes(MARK), `${label} pressing it back keeps the edit too`);
  record(back === before, `${label} and the badge is back to ${before}`);

  /* ------------------------- the ordinary case: nothing typed, nothing lost */

  await page.goto(where, { waitUntil: 'domcontentloaded' });
  await settle();
  await guardIs(false, `${label} reopened clean: the editor has nothing to lose`);
  const flipped = await pressBadge();
  record(flipped !== before, `${label} clean: the badge flips as it always did (${before} -> ${flipped})`);
  record((await onScreen()) === opened, `${label} clean: and what is on screen is what was loaded`);
  await guardIs(false, `${label} clean: and the page is not made dirty by the toggle`);

  /* Left as it was found, so a rerun starts where this one did. */
  await pressBadge();
}

/* --------------------------------------------------------- the tool editor */

const toolId = madeTool.createTool.id;
await drill({
  label: 'tool:',
  where: `${BASE}/workspace/${WORKSPACE}/tools/${toolId}`,
  guarded: true,
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
  onScreen: () => page.locator('.view-lines').innerText(),
  stored: async () => {
    const read = await graphql(`query($id: ID!) { tool(id: $id) { typescript source } }`, { id: toolId });
    return read.tool.typescript ?? read.tool.source;
  },
});

/* -------------------------------------------------------- the skill editor */

/*
 * `guarded: false`, and not because of anything issue #155 did.
 *
 * The skill editor never got issue #138's leave guard - that issue named the
 * function, object and tool editors, and this page was not one of them - so
 * there is nothing here to ask about closing a tab, and unsaved markdown is
 * still lost by a link or a Back press. That is worth filing; it is not
 * something this fix broke, and failing on it here would make a red check that
 * says the wrong thing. The badge, which is what this measures, is now the same
 * on both pages.
 */
const skillId = madeSkill.createSkill.id;
await drill({
  label: 'skill:',
  where: `${BASE}/workspace/${WORKSPACE}/skills/${skillId}`,
  guarded: false,
  settle: async () => {
    await page.waitForSelector('textarea[aria-label="Skill definition"]', { timeout: 30_000 });
    await page.waitForTimeout(1200);
  },
  /*
   * A skill is prose, so the change is made in the prose. Appended rather than
   * typed into the middle: the frontmatter at the top is what Validate reads,
   * and a check that broke it would be failing for the server's reasons.
   */
  edit: async (what) => {
    const field = page.locator('textarea[aria-label="Skill definition"]');
    await field.fill(`${await field.inputValue()}${what}\n`);
    await page.waitForTimeout(700);
  },
  onScreen: () => page.locator('textarea[aria-label="Skill definition"]').inputValue(),
  stored: async () => {
    const read = await graphql(`query($id: ID!) { skill(id: $id) { content } }`, { id: skillId });
    return read.skill.content ?? '';
  },
});

/* ------------------------------------------------------------------- tidy up */

const mine = await graphql(
  `query($id: ID!) {
     workspaceTools(workspaceId: $id, page: 0, size: 100) { content { id name } }
     workspaceSkills(workspaceId: $id, page: 0, size: 100) { content { id name } }
   }`,
  { id: WORKSPACE },
);
for (const held of mine.workspaceTools.content.filter((one) => one.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteTool(id: $id) }`, { id: held.id }).catch((cause) => {
    console.log(`could not delete tool ${held.name} (#${held.id}): ${cause.message}`);
  });
}
for (const held of mine.workspaceSkills.content.filter((one) => one.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteSkill(id: $id) }`, { id: held.id }).catch((cause) => {
    console.log(`could not delete skill ${held.name} (#${held.id}): ${cause.message}`);
  });
}

await finish(browser);
