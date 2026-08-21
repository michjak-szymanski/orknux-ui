/**
 * How long component history is kept, set on the Admin screen.
 *
 * The owner asked for fourteen days by default and configurable, which is a
 * setting rather than a constant — and a setting nobody can reach is a
 * constant with extra steps. So this drives the field the way a person does:
 * reads what is on screen, types a different number, presses Save, reloads, and
 * asserts the reloaded page shows the number that was typed rather than the one
 * it started with. A field bound to state that never round-trips to the server
 * passes every unit test and fails exactly this.
 *
 * It also checks the two things that are easy to leave off a number field: that
 * the Save button is dead while the value is the stored one, so pressing it is
 * never a no-op write, and that a value outside the range is refused with a
 * sentence rather than stored.
 *
 * Puts the original number back before it exits, whichever way it went.
 */
import { BASE, open, record, drawn, shot, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open();

const SETTINGS = `${BASE}/admin/settings`;

/** What the server says, which is the only account of what was stored. */
async function stored() {
  const held = await graphql(
    'query { installationSettings { revisionRetentionDays revisionRetentionDaysConfigured } }',
  );
  return held.installationSettings;
}

const started = await stored();
record(
  Number.isInteger(started.revisionRetentionDays) && started.revisionRetentionDays > 0,
  `the installation keeps ${started.revisionRetentionDays} days of component history`,
);

/** The number box on the settings page, found by what it is labelled. */
const field = () => page.getByLabel('How many days of component history to keep');

await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'admin settings')) {
  const heading = await page.getByText('Component history', { exact: true }).count();
  record(heading > 0, 'the settings page has a Component history section');

  const shown = await field().inputValue();
  record(
    shown === String(started.revisionRetentionDays),
    `the field shows what is stored: ${shown} against ${started.revisionRetentionDays}`,
  );

  // Nothing typed yet, so there is nothing to save.
  const save = page.getByRole('button', { name: 'Save', exact: true });
  record(await save.isDisabled(), 'Save is dead while the field holds the stored number');

  const wanted = started.revisionRetentionDays === 30 ? 45 : 30;
  await field().fill(String(wanted));
  record(await save.isEnabled(), 'Save wakes up once the number differs');
  await save.click();
  await page.getByText('Saved.', { exact: true }).waitFor({ timeout: 10_000 }).catch(() => {});

  const afterSave = await stored();
  record(
    afterSave.revisionRetentionDays === wanted,
    `the server stored ${afterSave.revisionRetentionDays}, and ${wanted} was asked for`,
  );

  // The half that a field bound only to component state passes without.
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await drawn(page, 'admin settings after a reload')) {
    const reloaded = await field().inputValue();
    record(reloaded === String(wanted), `a reload still shows ${reloaded}`);
  }

  // A number is not the way to say "keep nothing", so zero is refused.
  await field().fill('0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const refused = await page
    .getByText('not a number of days', { exact: false })
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  record(refused, 'zero days is refused with a sentence saying so');

  const afterRefusal = await stored();
  record(
    afterRefusal.revisionRetentionDays === wanted,
    `and nothing was stored: still ${afterRefusal.revisionRetentionDays}`,
  );

  await page.screenshot({ path: shot('revision-retention.png'), fullPage: true });
}

// Its own data, swept up: the installation goes back to what it kept before.
await graphql('mutation($days: Int!) { setRevisionRetentionDays(days: $days) { revisionRetentionDays } }', {
  days: started.revisionRetentionDays,
});
const ended = await stored();
record(
  ended.revisionRetentionDays === started.revisionRetentionDays,
  `put back to ${ended.revisionRetentionDays}`,
);

await finish(browser);
