/**
 * One gesture, one control: every stored credential is revealed by the eye.
 *
 * Issue #191. A workspace variable's secret offered an eye; a connection's
 * credential offered a green word reading `Reveal`, and the model provider's
 * key and the MCP server's token offered the same word with no way back - press
 * it and the key stayed on the screen until the page was loaded again. Three
 * shapes for the same act.
 *
 * What this asserts is the three things that were wrong, rather than that a
 * button exists:
 *
 *   - the control carries no text, so it is the icon and not the word;
 *   - it toggles, so a revealed secret can be put away again;
 *   - its accessible name changes with the state, because a word carries its
 *     own meaning and a bare glyph does not.
 *
 * The variables page is measured beside them, since "consistent with variables"
 * is the whole request and a check that only reads the pages that changed would
 * pass if the two drifted apart again from the other side.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/** The control inside one field's row, described rather than clicked. */
async function control(selector) {
  return page.evaluate((one) => {
    const field = document.querySelector(one);
    if (field === null) return null;
    const button = field.parentElement.querySelector('button');
    if (button === null) return null;
    return {
      text: button.textContent.trim(),
      label: button.getAttribute('aria-label'),
      pressed: button.getAttribute('aria-pressed'),
    };
  }, selector);
}

const { workspaceConnections } = await graphql(
  `query ($w: ID!) { workspaceConnections(workspaceId: $w) { id name type secretSet appTokenSet } }`,
  { w: WORKSPACE },
);

const withSecret = workspaceConnections.find((one) => one.secretSet);
if (withSecret === undefined) {
  record(false, `no connection in workspace ${WORKSPACE} holds a credential to reveal`);
} else {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations/connections/${withSecret.id}`, {
    waitUntil: 'domcontentloaded',
  });
  if (await drawn(page, 'the connection form')) {
    await page.waitForSelector('#connection-secret', { timeout: 20_000 });

    const hidden = await control('#connection-secret');
    record(hidden !== null, `the connection's credential offers a control: ${JSON.stringify(hidden)}`);
    record(hidden?.text === '', `it is a glyph and not a word: text ${JSON.stringify(hidden?.text)}`);
    record(
      hidden?.pressed === 'false' && /^Show /.test(hidden?.label ?? ''),
      `and unpressed it says what pressing it does: ${JSON.stringify(hidden?.label)}`,
    );

    // The half it used not to have. Revealing reads the stored value back, so
    // this waits on the field rather than on the clock.
    await page.locator('#connection-secret').locator('..').locator('button').first().click();
    await page.waitForFunction(
      () => document.querySelector('#connection-secret').value.startsWith('•') === false,
      undefined,
      { timeout: 15_000 },
    );
    const shown = await control('#connection-secret');
    record(
      shown?.pressed === 'true' && /^Hide /.test(shown?.label ?? ''),
      `revealed, the same control says the opposite: ${JSON.stringify(shown?.label)}, pressed ${shown?.pressed}`,
    );

    // And back, which is the thing a control that only reveals cannot do.
    await page.locator('#connection-secret').locator('..').locator('button').first().click();
    await page.waitForFunction(
      () => document.querySelector('#connection-secret').value.startsWith('•'),
      undefined,
      { timeout: 5_000 },
    );
    const again = await control('#connection-secret');
    record(again?.pressed === 'false', `and pressing it again puts the secret away: ${JSON.stringify(again?.label)}`);

    record(
      !(await page.getByRole('button', { name: 'Reveal', exact: true }).count()),
      'and there is no button called Reveal left on the page',
    );
  }
}

const withAppToken = workspaceConnections.find((one) => one.appTokenSet);
if (withAppToken !== undefined) {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/integrations/connections/${withAppToken.id}`, {
    waitUntil: 'domcontentloaded',
  });
  if (await drawn(page, 'the Slack connection form')) {
    await page.waitForSelector('#connection-app-token', { timeout: 20_000 });
    const app = await control('#connection-app-token');
    record(
      app !== null && app.text === '' && /^Show /.test(app.label ?? ''),
      `the app-level token beside it wears the same control: ${JSON.stringify(app)}`,
    );
  }
} else {
  record(false, `no Slack connection in workspace ${WORKSPACE} holds an app-level token`);
}

const { modelProviders } = await graphql(
  `query ($w: ID!) { modelProviders(workspaceId: $w) { id name secretSet } }`,
  { w: WORKSPACE },
);
const provider = modelProviders.find((one) => one.secretSet);
if (provider === undefined) {
  record(false, `no model provider in workspace ${WORKSPACE} holds a key`);
} else {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/models/providers/${provider.id}`, {
    waitUntil: 'domcontentloaded',
  });
  if (await drawn(page, 'the provider form')) {
    await page.waitForSelector('#provider-secret', { timeout: 20_000 });
    const key = await control('#provider-secret');
    record(
      key !== null && key.text === '' && /^Show /.test(key.label ?? ''),
      `the model provider's key wears it too: ${JSON.stringify(key)}`,
    );
    record(
      !(await page.getByRole('button', { name: 'Reveal', exact: true }).count()),
      'and the word is gone from the provider form as well',
    );
  }
}

// The page the other three were made to agree with.
await page.goto(`${BASE}/workspace/${WORKSPACE}/variables`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the variables page')) {
  const eyes = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-pressed]')]
      .map((one) => one.getAttribute('aria-label'))
      .filter((label) => /^(Show|Hide) /.test(label ?? '')),
  );
  record(
    eyes.length > 0,
    `and the variables page, which everything was made to agree with, still names its own the same way: ${JSON.stringify(eyes.slice(0, 3))}`,
  );
}

await finish(browser);
