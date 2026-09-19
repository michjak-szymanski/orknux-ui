/**
 * How long finished runs are kept, on the screen that decides it.
 *
 * Nothing deleted a run before 0.9.7 - no retention, no sweep, and no cascade,
 * because `workflow_execution` carries no foreign key on the workspace or the
 * workflow - so the table grew without bound and a workspace's list counted
 * runs of workflows it no longer had. Issue #167.
 *
 * The same four things `revision-retention-check` asks of the setting beside
 * this one, because they are the same bargain: the field shows what is stored,
 * Save is dead until the number differs, a reload still shows it, and zero is
 * refused - a retention of none is a feature switched off by a number, and the
 * switch for that would be a different setting.
 *
 * What it does not assert is the sweep itself. That is `ExecutionRetentionTest`
 * on the server, where a clock can be moved; this is the screen.
 */
import { BASE, open, record, drawn, shot, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open();

const SETTINGS = `${BASE}/admin/settings`;

/** What the server says, which is the only account of what was stored. */
async function stored() {
  const held = await graphql(
    'query { installationSettings { executionRetentionDays executionRetentionDaysConfigured } }',
  );
  return held.installationSettings;
}

const started = await stored();
record(
  Number.isInteger(started.executionRetentionDays) && started.executionRetentionDays > 0,
  `the installation keeps ${started.executionRetentionDays} days of run history`,
);

/** The number box on the settings page, found by what it is labelled. */
const field = () => page.getByLabel('How many days of run history to keep');

/*
 * This control's Save, not the page's. There are two retention settings on this
 * screen and each has a Save of its own, so asking the page for a button named
 * Save finds both and refuses to guess. The button is the input's sibling.
 */
const save = () => page.locator('#execution-retention-days').locator('..').getByRole('button', { name: 'Save', exact: true });

await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'admin settings')) {
  /*
   * Waited for, not counted straight away.
   *
   * `drawn` is satisfied by the shell - the nav down the side is text, and it
   * is on screen before the settings this page is made of have arrived - so
   * the heading was being counted on a page that had not drawn it yet. Every
   * assertion under this one waits for the field and passed the whole time,
   * which is what a lone failure at the top of a passing check looks like.
   */
  await field().waitFor({ state: 'visible', timeout: 20_000 });
  const heading = await page.getByText('Run history', { exact: true }).count();
  record(heading > 0, 'the settings page has a Run history section');

  const shown = await field().inputValue();
  record(
    shown === String(started.executionRetentionDays),
    `the field shows what is stored: ${shown} against ${started.executionRetentionDays}`,
  );

  // Nothing typed yet, so there is nothing to save.
  record(await save().isDisabled(), 'Save is dead while the field holds the stored number');

  const wanted = started.executionRetentionDays === 30 ? 45 : 30;
  await field().fill(String(wanted));
  record(await save().isEnabled(), 'Save wakes up once the number differs');
  await save().click();
  await page.getByText('Saved.', { exact: true }).waitFor({ timeout: 10_000 }).catch(() => {});

  const afterSave = await stored();
  record(
    afterSave.executionRetentionDays === wanted,
    `the server stored ${afterSave.executionRetentionDays}, and ${wanted} was asked for`,
  );

  // The half that a field bound only to component state passes without.
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await drawn(page, 'admin settings after a reload')) {
    const reloaded = await field().inputValue();
    record(reloaded === String(wanted), `a reload still shows ${reloaded}`);
  }

  // A number is not the way to say "keep nothing", so zero is refused.
  await field().fill('0');
  await save().click();
  const refused = await page
    .getByText('not a number of days', { exact: false })
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  record(refused, 'zero days is refused with a sentence saying so');

  const afterRefusal = await stored();
  record(
    afterRefusal.executionRetentionDays === wanted,
    `and nothing was stored: still ${afterRefusal.executionRetentionDays}`,
  );

  await page.screenshot({ path: shot('revision-retention.png'), fullPage: true });
}

/*
 * Its own data, swept up: the installation goes back to what it kept before.
 * The EXECUTION mutation - this used to call the revision one beside it, a
 * copy that put the wrong setting back and left this one where the check had
 * moved it, so the failure only appeared once the stored number differed
 * from the number the check happens to choose.
 */
await graphql('mutation($days: Int!) { setExecutionRetentionDays(days: $days) { executionRetentionDays } }', {
  days: started.executionRetentionDays,
});
const ended = await stored();
record(
  ended.executionRetentionDays === started.executionRetentionDays,
  `put back to ${ended.executionRetentionDays}`,
);

await finish(browser);
