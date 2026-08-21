/**
 * The shared trigger and condition forms, after their explanations went behind
 * the (?).
 *
 * These two forms are drawn on a settings page and inside a dialog, so what is
 * checked here is checked on both surfaces: the fields belong to the components,
 * and the frame only lends them its look.
 *
 * Two things to see. That every explanation which was printed under a field is
 * gone from the page - the sentences are looked for anywhere in the body text,
 * so a paragraph left behind under a different class name still fails - and that
 * what replaced them behaves the way the node panel's does: a hover shows the
 * note, a press pins it, a pinned note carries a close.
 *
 * What deliberately stayed printed is checked for too, because hiding one of
 * those would be a regression this would otherwise pass: an empty state, a
 * consequence of what is about to be saved, and a reading of what the form is
 * looking at now.
 *
 * ORKNUX_SHOTS=before takes the pictures and skips the assertions, so the same
 * script photographs the old forms from a checkout without the change.
 */
import { mkdirSync } from 'node:fs';

import { BASE, WORKSPACE, open, record, SHOT_DIR, finish } from './suite/harness.mjs';

const WHEN = process.env.ORKNUX_SHOTS ?? 'after';
const SHOTS = SHOT_DIR;
mkdirSync(SHOTS, { recursive: true });

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/*
 * Which trigger, which condition, which agent - looked up rather than written
 * down.
 *
 * These paths were nine hard numbers out of the developer's database:
 * /triggers/18, /conditions/7, /agents/9. Against a workspace built by
 * `seed-demo.mjs` those ids belong to nothing, and the page each one lands on is
 * the honest "That trigger does not exist" card - about ninety characters of
 * <main>, under the three hundred this waits for. So the check reported "the
 * page drew nothing in twenty seconds" about a page that had drawn the right
 * thing in well under one, and three settings pages spent a while looking like a
 * product defect.
 *
 * The names are the fixture, the numbers are not - the same rule
 * `scripts/suite/fixture.mjs` already works by. These are the names
 * `seed-demo.mjs` writes.
 */
const named = async (what, wanted, rows) => {
  const found = rows.find((row) => row.name === wanted);
  if (found === undefined) {
    console.log(`FAIL: no ${what} called ${JSON.stringify(wanted)} in workspace ${WORKSPACE}.`);
    console.log(`      There is: ${rows.map((row) => row.name).join(', ') || '(nothing)'}`);
    console.log('      Has scripts/seed-demo.mjs been run against this server?');
    await browser.close();
    process.exit(1);
  }
  return found;
};

const catalogue = await graphql(
  `query($w: ID!) {
     workspaceTriggers(workspaceId: $w, page: 0, size: 200) { content { id name } }
     workspaceConditions(workspaceId: $w, page: 0, size: 200) { content { id name } }
     workspaceAgents(workspaceId: $w, page: 0, size: 200) { content { id name } }
     workspaceObjects(workspaceId: $w, page: 0, size: 200) { content { id name propertyCount } }
   }`,
  { w: WORKSPACE },
);

const incoming = (await named('trigger', 'Slack message received', catalogue.workspaceTriggers.content)).id;
const scheduled = (await named('trigger', 'Nightly backlog sweep', catalogue.workspaceTriggers.content)).id;
const webhook = (await named('trigger', 'Ticket raised in Zendesk', catalogue.workspaceTriggers.content)).id;
const outage = (await named('condition', 'Mentions an outage', catalogue.workspaceConditions.content)).id;
const agent = (await named('agent', 'Support responder', catalogue.workspaceAgents.content)).id;

/*
 * A shape with no fields in it, which is what one of the notes below is about -
 * "This one has no fields yet, so any JSON matches it". The seed builds Ticket
 * and Customer and both have fields, so if there is no empty one to borrow this
 * makes its own and takes it away again at the end. Only what this made is
 * deleted; a borrowed one is left alone.
 */
const borrowed = catalogue.workspaceObjects.content.find((row) => row.propertyCount === 0);
const scratch =
  borrowed === undefined
    ? (
        await graphql(
          'mutation($input: CreateObjectInput!) { createObject(input: $input) { id name } }',
          {
            input: {
              workspaceId: WORKSPACE,
              // An identifier, because the server refuses an object name that
              // is not one - it is what a reference has to be able to write.
              name: 'zzSuiteNoFields',
              description: 'Made by scripts/hint-forms-check.mjs, and removed again by it.',
            },
          },
        )
      ).createObject
    : null;
const shapeless = borrowed ?? scratch;

/** Opens one of the pickers and takes the row whose label reads like this. */
async function pick(id, label) {
  await page.click(`#${id}`);
  await page.waitForTimeout(300);
  await page.locator('[role="option"]', { hasText: label }).first().click();
  await page.waitForTimeout(400);
}

/*
 * A screen, what it must no longer print, and what it must still print.
 *
 * `gone` are the sentences that moved behind the (?): found anywhere in the body
 * while nothing is open, the move did not happen. `kept` are the ones judged not
 * to be explanations of a field at all.
 */
const screens = [
  {
    name: 'trigger incoming',
    path: `/workspace/${WORKSPACE}/triggers/${incoming}`,
    hints: 5,
    gone: [
      'Select the connection that will trigger this event',
      'The specific event that activates this trigger',
      'Asked before anything starts, so an event it turns down leaves no run behind',
      'JSON added underneath the event',
      'Nodes drawn from this trigger start with it',
    ],
    kept: [],
  },
  {
    name: 'trigger scheduled',
    path: `/workspace/${WORKSPACE}/triggers/${scheduled}`,
    hints: 5,
    gone: [
      'A cron expression defining when the trigger fires',
      'The timezone used to resolve the cron schedule',
      'The clock carries no data',
    ],
    kept: [],
  },
  {
    name: 'trigger webhook',
    path: `/workspace/${WORKSPACE}/triggers/${webhook}`,
    hints: 6,
    gone: [
      'Where this installation answers',
      'What a request has to contain',
      'A caller the function turns down is answered 401',
      'JSON added underneath the request',
    ],
    kept: [],
  },
  {
    /*
     * The same webhook, asked for the two notes that only appear once somebody
     * has chosen something: a shape with no fields in it, and a function to ask
     * about the caller. Neither is stored - the form is never saved.
     */
    name: 'trigger webhook chosen',
    path: `/workspace/${WORKSPACE}/triggers/${webhook}`,
    hints: 7,
    async drive() {
      await pick('trigger-object', shapeless.name);
      await page.selectOption('#trigger-auth', 'FUNCTION');
      await page.waitForTimeout(400);
    },
    gone: ['Handed the request by name'],
    kept: ['This one has no fields yet, so any JSON matches it'],
  },
  {
    name: 'condition',
    path: `/workspace/${WORKSPACE}/conditions/${outage}`,
    hints: 1,
    gone: ['Nodes drawn from this condition start with it'],
    // What the condition now says, in the words the list uses. A reading of the
    // thing being edited, not a note about a field.
    kept: ['Matches when message text contains outage'],
  },
  {
    name: 'condition new',
    path: `/workspace/${WORKSPACE}/conditions/new`,
    hints: 1,
    gone: ['Nodes drawn from this condition start with it'],
    // The value list, with nothing in it yet.
    kept: ['Nothing yet.'],
  },
  {
    name: 'condition function',
    path: `/workspace/${WORKSPACE}/conditions/new`,
    hints: 2,
    async drive() {
      await page.selectOption('#condition-type', 'FUNCTION');
      await page.waitForTimeout(400);
    },
    gone: ['Only functions that return a boolean can answer a condition'],
    kept: [],
  },
  {
    /*
     * The same field asked to make the function it points at. What that will do
     * on save stays printed, because it is what saving is about to do.
     */
    name: 'condition new function',
    path: `/workspace/${WORKSPACE}/conditions/new`,
    hints: 2,
    async drive() {
      await page.selectOption('#condition-type', 'FUNCTION');
      await page.waitForTimeout(400);
      await pick('condition-function', 'New function');
    },
    gone: ['Only functions that return a boolean can answer a condition'],
    kept: ['Created with this condition, saying no to everything'],
  },
  {
    /*
     * Not one of the two forms, but the third caller of the field they share.
     *
     * `IconField` printed the sentence its caller handed it, and now hands it to
     * a (?) instead - so an agent's settings page, which the settings batch left
     * alone for exactly that reason, loses its paragraph here.
     */
    name: 'agent settings',
    path: `/workspace/${WORKSPACE}/agents/${agent}/settings`,
    hints: 2,
    /*
     * The two grant switches went with issue #173. They were `kept` here on the
     * argument that a consequence of granting something is not an explanation
     * of it; the rules file settled the other way - a consequence worth knowing
     * before granting a permission belongs in the (?) beside that permission -
     * and both sentences are now inside the `FieldHint` on their own switch.
     * They are listed as moved rather than dropped, so the check still asserts
     * the product says them, only elsewhere.
     */
    gone: [
      'Nodes drawn from this agent start with it',
      'a loop nothing here breaks',
      'can do whatever that account can',
    ],
    kept: [],
  },
  {
    /*
     * The other surface. The dialog lends the form its own class names and none
     * of them is the row the (?) stands in, so this is where a hint that only
     * lines up on a settings page would show itself.
     */
    name: 'trigger dialog',
    path: `/workspace/${WORKSPACE}/triggers`,
    hints: 5,
    dialog: true,
    async drive() {
      await page.locator('button', { hasText: 'Create Trigger' }).first().click();
      await page.waitForTimeout(600);
    },
    gone: [
      'Select the connection that will trigger this event',
      'The specific event that activates this trigger',
      'JSON added underneath the event',
      'Nodes drawn from this trigger start with it',
    ],
    kept: [],
  },
];

const note = page.locator('[role="note"]');
const shown = async () => (await note.count()) > 0 && (await note.first().isVisible());
const away = async () => {
  await page.mouse.move(1400, 980);
  await page.waitForTimeout(300);
};

/**
 * What every (?) on the screen says, each one opened in turn.
 *
 * `gone` used to mean one thing: the sentence is not printed in the open. That
 * passes just as well for a sentence that was deleted as for one that moved,
 * and the rules file is explicit that deleting it is the mistake the move
 * invites - something said only in a paragraph and then trimmed away is a thing
 * the product no longer says anywhere. So `gone` now means both halves: not in
 * the open, and in the note.
 */
async function noteText() {
  const controls = page.locator('[data-hint]');
  const many = await controls.count();
  let held = '';
  for (let index = 0; index < many; index += 1) {
    const one = controls.nth(index);
    if (!(await one.isVisible().catch(() => false))) continue;
    await one.hover().catch(() => {});
    await page.waitForTimeout(250);
    if (await shown()) held += `\n${await note.first().innerText()}`;
    await away();
  }
  return held;
}

/** One screen at a time, for photographing something that has to be opened first. */
const only = process.env.ORKNUX_ONLY ?? null;

for (const one of screens) {
  if (only !== null && one.name !== only) continue;

  await page.goto(`${BASE}${one.path}`, { waitUntil: 'domcontentloaded' });
  /*
   * Waited for rather than slept through. These pages ask for a catalogue or
   * four before they can draw a form, and a fixed two seconds passed for every
   * one of them until the agent's settings page - which asks for more than the
   * rest - drew nothing in time and reported every sentence on it as gone.
   */
  /*
   * Thirty seconds rather than twenty. These forms have been measured taking
   * eleven to draw against a loaded development server - the vite dev server
   * transforms modules on demand and the page fetches four catalogues before
   * it can lay a field out - and a budget that a healthy page misses under load
   * is a budget that reports load as breakage.
   */
  let settled = true;
  try {
    await page.waitForFunction(
      () => (document.querySelector('main')?.innerText?.length ?? 0) > 300,
      { timeout: 30_000 },
    );
  } catch {
    /*
     * What is on the page, not just how little of it there is. A settings page
     * asked for something that is not there answers with a short card saying so,
     * and that card is under the threshold above - so a bare "drew nothing"
     * cannot tell a page that failed to render from a page that rendered a
     * refusal. The first two hundred characters settle it at a glance.
     */
    settled = false;
    const drew = await page.evaluate(() => document.querySelector('main')?.innerText ?? '<there is no main>');
    record(
      false,
      `${one.name}: the page did not settle in thirty seconds; <main> holds ${drew.length} characters: ` +
        JSON.stringify(drew.slice(0, 200)),
    );
  }
  /*
   * And nothing is read off a page that did not settle.
   *
   * This used to fall through and go on asserting. "…is no longer printed under
   * a field" passed on the empty body, which is the shape of every false alarm
   * this suite has produced: a screen that never drew, reported as a screen
   * whose prose was deleted. The refusal above is the whole of what this page
   * has to say.
   */
  if (!settled) continue;
  await page.waitForTimeout(1500);
  if (one.drive !== undefined) await one.drive();

  await away();
  const file = one.name.replace(/ /g, '-');
  await page.screenshot({ path: `${SHOTS}/${WHEN}-${file}.png`, fullPage: true });
  if (WHEN === 'before') {
    console.log(`photographed ${one.name}`);
    continue;
  }

  const body = await page.locator('body').innerText();
  const said = one.gone.length > 0 ? await noteText() : '';
  for (const sentence of one.gone) {
    record(!body.includes(sentence), `${one.name}: "${sentence}" is no longer printed under a field`);
    record(said.includes(sentence), `${one.name}: "${sentence}" is what a (?) on the screen says`);
  }
  for (const sentence of one.kept) {
    record(body.includes(sentence), `${one.name}: "${sentence}" is still printed, as it must be`);
  }

  const hints = page.locator('[data-hint]');
  const many = await hints.count();
  const labels = await hints.evaluateAll((all) => all.map((each) => each.getAttribute('data-hint')));
  record(many >= one.hints, `${one.name}: ${many} (?) drawn, expecting ${one.hints} [${labels.join(', ')}]`);
  if (many === 0) continue;

  const hint = hints.first();
  const label = await hint.getAttribute('data-hint');

  record((await shown()) === false, `${one.name}: nothing is shown until it is asked for`);

  await hint.hover();
  await page.waitForTimeout(300);
  record(await shown(), `${one.name}: hovering the (?) beside ${label} shows the note`);
  record(
    (await page.locator('[role="note"] button').count()) === 0,
    `${one.name}: a hovered note carries no close control`,
  );

  await away();
  record((await shown()) === false, `${one.name}: it goes when the pointer does`);

  await hint.click();
  await page.waitForTimeout(300);
  record(await shown(), `${one.name}: pressing it pins the note`);
  await away();
  record(await shown(), `${one.name}: a pinned note stays when the pointer leaves`);
  const closer = page.locator('[role="note"] button');
  record((await closer.count()) === 1, `${one.name}: a pinned note carries a close control`);

  /*
   * Where the note lands, measured rather than judged. It is placed against the
   * window, and a form inside a dialog or inside the shell's animated `main` is
   * exactly the kind of ancestor that can capture a fixed element - so the two
   * rectangles are printed and the note is asserted to sit under its control.
   */
  const control = await hint.boundingBox();
  const placed = await note.first().boundingBox();
  record(
    Math.abs(placed.x - control.x) < 40 && placed.y > control.y && placed.y - control.y < 60,
    `${one.name}: the note is under its (?) — control ${Math.round(control.x)},${Math.round(control.y)}, ` +
      `note ${Math.round(placed.x)},${Math.round(placed.y)}`,
  );

  await page.screenshot({ path: `${SHOTS}/${WHEN}-${file}-pinned.png` });

  /*
   * Whether anything is drawn over it, which is a different question from where
   * it is - and on the dialogs, a different answer.
   *
   * A note portalled to the body is painted below a `<dialog>` opened with
   * showModal, whatever its z-index says: the dialog is in the top layer and the
   * body is not. So on a settings page the note is on top and this asserts it,
   * and in a dialog it is placed correctly and covered, which is reported rather
   * than failed - where the note is drawn belongs to the shared control, not to
   * the forms standing inside the frame.
   */
  const onTop = await page.evaluate(() => {
    const drawn = document.querySelector('[role="note"]');
    const box = drawn.getBoundingClientRect();
    const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return at !== null && (at === drawn || drawn.contains(at));
  });
  if (one.dialog === true) {
    console.log(
      `NOTE: ${one.name}: the note is placed under its (?) and ${onTop ? 'is on top' : 'is covered by the dialog'}. ` +
        'A modal <dialog> is in the top layer and the body the note is portalled to is not, so a note ' +
        "opened inside one cannot be read. That is the shared control's to answer, not this form's.",
    );
  } else {
    record(onTop, `${one.name}: nothing is drawn over the note`);
  }

  /*
   * Put away by its own control, except where nothing can reach that control -
   * there, by the key that is the other way out. Escape is worth pressing in a
   * dialog anyway: unprevented it is a close request the browser answers by
   * shutting the whole form, so this also says the form survived being read.
   */
  if (one.dialog === true) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    record((await shown()) === false, `${one.name}: Escape puts the note away`);
    record(
      (await page.locator('dialog[open]').count()) === 1,
      `${one.name}: and leaves the form it was read in open`,
    );
  } else {
    await closer.click();
    await page.waitForTimeout(300);
    record((await shown()) === false, `${one.name}: the close control puts it away`);
  }
}

if (scratch !== null) {
  await graphql('mutation($id: ID!) { deleteObject(id: $id) }', { id: scratch.id });
}

if (WHEN === 'before') {
  await browser.close();
  console.log('pictures only; nothing asserted');
  process.exit(0);
}
await finish(browser);
