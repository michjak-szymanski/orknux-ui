/**
 * A provider the timed sweep is told not to call.
 *
 * The sweep asks every configured provider every few minutes so that
 * "Connected" on the Models screen means today rather than the day somebody
 * last pressed the button. For an endpoint that is only sometimes running - a
 * model server on a laptop, a box started for an afternoon - that is a failed
 * row and a connection refused in the log every five minutes about a state
 * nobody thinks is wrong, and there was no way to say so.
 *
 * The server half is `ProviderCheckSwitchTest`: the sweep skips it, Test
 * Connection still calls it, and an update that says nothing about the switch
 * leaves it alone. What no server test can say is whether anybody can reach the
 * switch, so that is what is here - the control on the provider's own page,
 * pressed, saved, and read back **off the server** rather than off the screen.
 *
 * Reading it back is the point. A toggle that paints itself and sends nothing
 * looks identical to one that works until the page is reloaded, and a form that
 * sends the field only when it changes is the same bug one save later. So every
 * assertion below is either the value `modelProviders` answers with or the
 * state of the control after a fresh load - never the control immediately after
 * it was clicked.
 *
 * The provider it makes is its own, under a name nobody would mistake for real,
 * pointed at a port nothing listens on - which is the very case this exists for
 * - and removed at both ends of the run in case one was killed halfway.
 */
import { BASE, WORKSPACE, open, record, shot, finish } from './suite/harness.mjs';

/** Nobody's provider is called this. The sweep is by prefix. */
const SCRATCH = 'providerCheckSwitchCheck';

/** Nothing listens here, and nothing should: it is what an idle laptop looks like. */
const NOWHERE = 'http://127.0.0.1:9/v1';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const listProviders = async () =>
  (
    await graphql(`query ($w: ID!) { modelProviders(workspaceId: $w) { id name checkEnabled status } }`, {
      w: WORKSPACE,
    })
  ).modelProviders;

const removeProvider = (id) => graphql(`mutation ($id: ID!) { removeModelProvider(id: $id) }`, { id });

async function sweep() {
  for (const one of (await listProviders()).filter((row) => row.name.startsWith(SCRATCH))) {
    await removeProvider(one.id);
  }
}

await sweep();

const made = (
  await graphql(
    `mutation ($w: ID!, $name: String!, $endpoint: String!) {
       createModelProvider(input: { workspaceId: $w, name: $name, endpoint: $endpoint, secret: "sk-scratch" }) {
         id checkEnabled
       }
     }`,
    { w: WORKSPACE, name: `${SCRATCH} laptop`, endpoint: NOWHERE },
  )
).createModelProvider;

record(made.checkEnabled === true, `a provider made without an opinion is one the sweep may call (${made.checkEnabled})`);

const page_ = `${BASE}/workspace/${WORKSPACE}/models/providers/${made.id}`;
const toggle = page.locator('[data-testid="provider-check-toggle"]');

/** The switch as the page has drawn it, after whatever load just happened. */
const drawnAs = async () => {
  await toggle.waitFor({ state: 'visible', timeout: 20_000 });
  return {
    on: (await toggle.getAttribute('aria-checked')) === 'true',
    /* The words beside it, which are the whole affordance for somebody who
       cannot tell one small picture from another. */
    said: (await toggle.evaluate((el) => el.parentElement.textContent))?.trim() ?? '',
  };
};

async function saveIt() {
  const button = page.getByRole('button', { name: 'Save Changes', exact: true });
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  await button.click();
  await page.waitForTimeout(1500);
}

const stored = async () => (await listProviders()).find((one) => one.id === made.id) ?? null;

/* ------------------------------------------------ the switch, as it is found */

await page.goto(page_, { waitUntil: 'domcontentloaded' });
const found = await drawnAs();
record(found.on, `the page opens with the switch on, as the provider is (aria-checked ${found.on})`);
record(
  /every few minutes|co kilka minut/i.test(found.said),
  `and says what it is currently doing beside it ("${found.said}")`,
);

/* ------------------------------------------------------------------- off */

await toggle.click();
await saveIt();

const off = await stored();
record(
  off !== null && off.checkEnabled === false,
  `pressing it and saving turns the sweep off on the server, not only on the screen (${off?.checkEnabled})`,
);

await page.reload({ waitUntil: 'domcontentloaded' });
const reloaded = await drawnAs();
record(!reloaded.on, `and the page comes back with it off (aria-checked ${reloaded.on})`);
record(
  /only when asked|na żądanie/i.test(reloaded.said),
  `saying so in words rather than only in a picture ("${reloaded.said}")`,
);

await page.screenshot({ path: shot('provider-check-switch.png') });

/*
 * The button is not governed by it. A switch that also stopped Test Connection
 * would not be "do not poll this", it would be "this provider is off" - and
 * there is already a way to say that, which is to remove it. The endpoint is
 * unreachable, so what is asserted is that the check *ran*, not that it passed:
 * a failed answer written to the row is the button having worked.
 */
await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
await page.waitForTimeout(4000);
const checked = await stored();
record(
  checked !== null && checked.status !== 'NOT_CHECKED',
  `Test Connection still calls a provider the sweep is not allowed to (status ${checked?.status})`,
);
record(
  checked !== null && checked.checkEnabled === false,
  'and checking it by hand does not quietly turn the sweep back on',
);

/* --------------------------------------------------------------- and back */

await page.reload({ waitUntil: 'domcontentloaded' });
await drawnAs();
await toggle.click();
await saveIt();

const on = await stored();
record(
  on !== null && on.checkEnabled === true,
  `it goes back on the same way, so the switch is a switch rather than a door (${on?.checkEnabled})`,
);

await sweep();
record((await listProviders()).every((one) => !one.name.startsWith(SCRATCH)), 'the scratch provider is cleared up');

await finish(browser);
