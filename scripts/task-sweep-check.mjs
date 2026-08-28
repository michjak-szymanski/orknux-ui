/**
 * How long a stuck task waits, set on the Admin screen.
 *
 * Issue #297 put a net under the hand-over: something looks on a timer and
 * picks up anything that has been sitting at Queued longer than it should be.
 * The number that says how long was asked for as a setting rather than a
 * property with a follow-up, and a setting nobody can reach is a constant with
 * extra steps - so this drives the field the way a person does. It is the
 * retention check's shape, against the field beside it, plus the one thing that
 * field does not have.
 *
 * That one thing: **the control is drawn only where the inline engine is
 * running.** An installation carrying its tasks on Temporal recovers a stuck
 * one through Temporal and takes the interval from its configuration file, so
 * the field is not offered there at all. The suite runs against the inline
 * engine, so that half is measured by answering `taskSweepConfigurable` with
 * false on the way to the page - which changes what is drawn and nothing that
 * is stored, and is exactly the branch being asserted.
 *
 * Puts the original number back before it exits, whichever way it went.
 */
import { BASE, open, record, drawn, shot, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const SETTINGS = `${BASE}/admin/settings`;
const LABEL = 'How long before a stuck task is picked up';

/** What the server says, which is the only account of what was stored. */
async function stored() {
  const held = await graphql(
    'query { installationSettings { taskSweepMinutes taskSweepMinutesConfigured taskSweepConfigurable } }',
  );
  return held.installationSettings;
}

const started = await stored();
record(
  Number.isInteger(started.taskSweepMinutes) && started.taskSweepMinutes > 0,
  `a task left queued is picked up after ${started.taskSweepMinutes} minutes`,
);
record(
  started.taskSweepConfigurable === true,
  `this installation runs the inline engine, so the field is offered [configurable=${started.taskSweepConfigurable}]`,
);

/** The number box, and the Save that belongs to it rather than to retention. */
const field = () => page.getByLabel('How many minutes a task may wait before it is picked up');
/*
 * By its accessible name and not by its text. Both Saves on this page say
 * Save, which is right on the screen and useless as a way of telling them
 * apart - so this one carries an aria-label naming what it saves, which is
 * also what stops the retention check finding two buttons where it expects one.
 */
const save = () =>
  page.getByRole('button', { name: 'Save how long before a stuck task is picked up', exact: true });

await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'admin settings')) {
  /*
   * Wait for the field before counting anything.
   *
   * `drawn` answers as soon as the card has drawn, and the card draws before
   * the settings it is about have arrived - so the section is a moment behind
   * it. `count()` takes a snapshot and does not wait, unlike every action
   * below it, which is exactly how a heading that is on the page reads as
   * missing while everything after it passes.
   */
  await field().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  record(
    (await page.getByText('Queued tasks', { exact: true }).count()) > 0,
    'the settings page has a Queued tasks section',
  );

  const shown = await field().inputValue();
  record(
    shown === String(started.taskSweepMinutes),
    `the field shows what is stored: ${shown} against ${started.taskSweepMinutes}`,
  );

  /*
   * The rule this project pins: no paragraph of explanation under a field. Both
   * halves, because a sentence deleted rather than moved passes the first on
   * its own - it must not be readable while every note is shut, and it must be
   * readable once one is open.
   */
  const shut = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  record(!shut.includes('that hand-over can be lost'), 'nothing is explained in prose under the field');
  record(
    (await page.locator(`button[data-hint="${LABEL}"]`).count()) === 1,
    'what it does is behind a (?) beside its label',
  );
  await page.locator(`button[data-hint="${LABEL}"]`).first().hover();
  await page.waitForTimeout(400);
  const note = (await page.locator('[role="note"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  record(note.includes('that hand-over can be lost'), 'and the (?) is where the sentence went');
  await page.mouse.move(1400, 980);
  await page.waitForTimeout(300);

  // Nothing typed yet, so there is nothing to save.
  record(await save().isDisabled(), 'Save is dead while the field holds the stored number');

  const wanted = started.taskSweepMinutes === 17 ? 23 : 17;
  await field().fill(String(wanted));
  record(await save().isEnabled(), 'Save wakes up once the number differs');
  await save().click();
  await page.getByText('Saved.', { exact: true }).waitFor({ timeout: 10_000 }).catch(() => {});

  const afterSave = await stored();
  record(
    afterSave.taskSweepMinutes === wanted,
    `the server stored ${afterSave.taskSweepMinutes}, and ${wanted} was asked for`,
  );

  // The half that a field bound only to component state passes without.
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await drawn(page, 'admin settings after a reload')) {
    const reloaded = await field().inputValue();
    record(reloaded === String(wanted), `a reload still shows ${reloaded}`);
  }

  // Refused in words, and not rounded into the nearest number that fits.
  await field().fill('0');
  await save().click();
  const refused = await page
    .getByText('not a number of minutes', { exact: false })
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  record(refused, 'zero minutes is refused with a sentence saying so');

  const afterRefusal = await stored();
  record(
    afterRefusal.taskSweepMinutes === wanted,
    `and nothing was stored: still ${afterRefusal.taskSweepMinutes}`,
  );

  await page.screenshot({ path: shot('task-sweep-settings.png'), fullPage: true });
}

// ---------------------------------------------------------------------------
// And on Temporal there is no field at all

await page.route('**/graphql', async (route) => {
  const answer = await route.fetch();
  const body = (await answer.text()).replace(/"taskSweepConfigurable":true/g, '"taskSweepConfigurable":false');
  await route.fulfill({ response: answer, body });
});
await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'admin settings as a Temporal installation')) {
  await page
    .getByLabel('How many days of component history to keep')
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {});
  record(
    (await field().count()) === 0,
    'an installation running Temporal is not offered the interval at all',
  );
  record(
    (await page.getByText('Queued tasks', { exact: true }).count()) === 0,
    'nor the heading over it, so there is no empty section left behind',
  );
  // The rest of the page is what says the field went rather than the page.
  record(
    (await page.getByLabel('How many days of component history to keep').count()) === 1,
    'and everything else on the screen is untouched',
  );
  await page.screenshot({ path: shot('task-sweep-settings-temporal.png'), fullPage: true });
}
await page.unroute('**/graphql');

// Its own data, swept up: the installation goes back to what it waited before.
await graphql(
  'mutation($minutes: Int!) { setTaskSweepMinutes(minutes: $minutes) { taskSweepMinutes } }',
  { minutes: started.taskSweepMinutes },
);
const ended = await stored();
record(
  ended.taskSweepMinutes === started.taskSweepMinutes,
  `put back to ${ended.taskSweepMinutes}`,
);

await finish(browser);
