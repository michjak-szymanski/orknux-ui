/**
 * The Enabled switch, on the two screens that define a trigger.
 *
 * Issues #247 and #257. A trigger has had an `enabled` column and a firing path
 * that honours it since the beginning, and the only switch for it was the toggle
 * in the trigger list. So the dialog that makes a trigger could not make one
 * that was switched off, and the trigger's own settings page - the screen
 * somebody opens *to change this trigger* - had no opinion on whether it fired.
 * Two reports of the same missing control.
 *
 * It is one control: both screens draw `TriggerForm`, and this drives both of
 * them to prove that. The dialog makes one switched off, the page switches it
 * back on, and each is read back over GraphQL afterwards - because a toggle that
 * draws the right icon and saves nothing is exactly the failure a screenshot
 * cannot tell from a fix.
 *
 * What is deliberately not here is whether a switched-off trigger fires. That is
 * not a question a browser can answer honestly - an incoming event and a tick of
 * the clock do not arrive from a page - and it is covered where it can be:
 * `IncomingTriggerListenerTest`, `TriggerSchedulerTest` and `WebhookAPITest`
 * each drive their own firing path with the switch off.
 *
 * Its fixture is its own and it takes it away again: a scratch trigger nothing
 * instances, named for this run, deleted at the end.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/*
 * A name no other run holds.
 *
 * A trigger name is unique per workspace and a removed one gives its name back,
 * so a fixed name would work until two runs overlapped or one died before its
 * cleanup - and the failure then is "A trigger named … already exists", which
 * reads like the form refusing something it should have taken.
 */
const NAME = `zz trigger switch check ${Date.now()}`;

/** What the server holds for it, which is the only answer that counts. */
const stored = async (id) =>
  (await graphql(`query($id: ID!) { trigger(id: $id) { id name enabled } }`, { id })).trigger;

/** The switch on whichever of the two screens is on the page. */
const toggle = () => page.locator('#trigger-enabled');

/** What that switch says it is: the button carries it, so the icon cannot lie alone. */
const reads = async () => ({
  pressed: await toggle().getAttribute('aria-pressed'),
  title: await toggle().getAttribute('title'),
});

let made = null;

try {
  /* ------------------------------------------------- #247, the quick one */

  await page.goto(`${BASE}/workspace/${WORKSPACE}/triggers`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the trigger list'))) throw new Error('the trigger list never drew');

  await page.getByRole('button', { name: '+ Create Trigger' }).click();
  await page.waitForSelector('#trigger-name', { state: 'visible', timeout: 10_000 });

  record(await toggle().isVisible(), 'the Create Trigger dialog has an Enabled switch (#247)');

  const fresh = await reads();
  record(
    fresh.pressed === 'true' && fresh.title === 'Enabled',
    `a new trigger starts switched on (aria-pressed=${fresh.pressed}, title=${JSON.stringify(fresh.title)})`,
  );

  await page.fill('#trigger-name', NAME);
  await toggle().click();

  const off = await reads();
  record(
    off.pressed === 'false' && off.title === 'Disabled',
    `the switch answers the pointer (aria-pressed=${off.pressed}, title=${JSON.stringify(off.title)})`,
  );

  await page.screenshot({ path: shot('trigger-switch-dialog.png') });

  await page.getByRole('button', { name: 'Create Trigger', exact: true }).click();

  /*
   * Found by name rather than read off the dialog: what is being checked is
   * that the switch reached the server, and the list is where the page says it
   * did. A short wait, because the list reloads after the dialog closes.
   */
  await page.waitForTimeout(1_000);
  const listed = (
    await graphql(`query($w: ID!) { workspaceTriggers(workspaceId: $w, page: 0, size: 200) { content { id name enabled } } }`, {
      w: WORKSPACE,
    })
  ).workspaceTriggers.content.find((row) => row.name === NAME);

  if (listed === undefined) {
    record(false, `the dialog did not make a trigger called ${JSON.stringify(NAME)}`);
    throw new Error('nothing was created');
  }
  made = listed.id;
  record(listed.enabled === false, 'a trigger made with the switch off is stored switched off (#247)');

  /* ------------------------------------------ #257, the trigger's own page */

  await page.goto(`${BASE}/workspace/${WORKSPACE}/triggers/${made}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the trigger settings page'))) throw new Error('the settings page never drew');
  await page.waitForSelector('#trigger-enabled', { state: 'visible', timeout: 10_000 });

  record(await toggle().isVisible(), "the trigger's own settings page has an Enabled switch (#257)");

  const opened = await reads();
  record(
    opened.pressed === 'false' && opened.title === 'Disabled',
    `the page opens showing what the trigger is (aria-pressed=${opened.pressed})`,
  );

  await toggle().click();
  await page.screenshot({ path: shot('trigger-switch-page.png') });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.waitForSelector('text=Saved.', { timeout: 10_000 });

  record((await stored(made)).enabled === true, 'switching it on and saving turns it back on (#257)');

  /*
   * And back off from the same page, because a control that can only ever
   * travel one way would pass everything above.
   */
  await toggle().click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.waitForTimeout(1_000);
  record((await stored(made)).enabled === false, 'and off again from the same screen');

  /*
   * The switch is not the only thing the page saves. A form that sent `enabled`
   * and dropped the rest of itself would pass every assertion above, so the
   * name goes with it on that last save.
   */
  record((await stored(made)).name === NAME, 'saving the switch does not lose the rest of the form');
} catch (cause) {
  record(false, `the check stopped: ${cause instanceof Error ? cause.message : String(cause)}`);
  await page.screenshot({ path: shot('trigger-switch-failed.png') }).catch(() => {});
} finally {
  // Nothing instances it, so it deletes. Left behind it would take its name
  // with it and the next run would still make its own.
  if (made !== null) {
    await graphql(`mutation($id: ID!) { deleteTrigger(id: $id) }`, { id: made }).catch((cause) =>
      console.log(`could not remove the scratch trigger #${made}: ${cause.message}`),
    );
  }
}

await finish(browser);
