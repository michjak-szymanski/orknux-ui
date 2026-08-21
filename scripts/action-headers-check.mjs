/**
 * An HTTP request action's headers, in the form somebody actually edits them.
 *
 * Three things, and the third is why the other two exist.
 *
 *  - Rows add and remove, and a row is a name and a value rather than a line of
 *    JSON somebody typed a comma into.
 *  - An action saved before rows existed - its headers a JSON object in a text
 *    column - still opens, and opens as the rows it always meant.
 *  - A row that reads a variable shows the variable's *name* and never what it
 *    holds. That is the whole point of the reference: a bearer token stays in
 *    the variables screen, and an action that names it is not a second place
 *    the token is legible. So this check reads the whole dialog, the whole
 *    page and the whole network answer, and the assertion is that the secret is
 *    in none of them.
 *
 * Whether the resolved value actually reaches the request is a server question
 * and is asserted where the server is - `ActionHeadersTest`. A browser cannot
 * see an outgoing header, and a check that pretended to would be asserting the
 * form rather than the call.
 */
import { BASE, WORKSPACE, drawn, finish, open, record, shot } from './suite/harness.mjs';

/** What must not appear anywhere. Distinctive on purpose, so a match is a match. */
const SECRET = 'Bearer sk-live-9If2-never-shown';

const { browser, page, graphql } = await open();

const stamp = Date.now();
const catalogName = `headers-check-${stamp}`;
const variableName = `HEADERS_CHECK_${stamp}`;
const rowsName = `Headers check rows ${stamp}`;
const legacyName = `Headers check legacy ${stamp}`;

let catalogId = null;
let variableId = null;
const madeActions = [];

try {
  // ---------------------------------------------------------------- fixture

  catalogId = (
    await graphql(
      `mutation ($workspaceId: ID!, $name: String!) {
         createVariableCatalog(workspaceId: $workspaceId, name: $name) { id }
       }`,
      { workspaceId: WORKSPACE, name: catalogName },
    )
  ).createVariableCatalog.id;

  variableId = (
    await graphql(
      `mutation ($input: CreateVariableInput!) { createVariable(input: $input) { id } }`,
      {
        input: {
          workspaceId: WORKSPACE,
          catalogId,
          name: variableName,
          type: 'STRING',
          kind: 'SECRET',
          value: SECRET,
        },
      },
    )
  ).createVariable.id;

  /*
   * The action people already have: headers as one JSON object in a text column,
   * which is what every HTTP action saved before this change holds. Written
   * through `headers` rather than `headerRows` on purpose - this is the shape
   * the compatibility claim is about.
   */
  const legacy = await graphql(
    `mutation ($input: CreateActionInput!) { createAction(input: $input) { id headers headersReadable } }`,
    {
      input: {
        workspaceId: WORKSPACE,
        name: legacyName,
        type: 'EXECUTE',
        subtype: 'HTTP_REQUEST',
        url: 'https://api.example.com/orders',
        method: 'GET',
        headers: '{"Accept": "application/json", "X-Trace": "on"}',
      },
    },
  );
  madeActions.push(legacy.createAction.id);

  record(
    legacy.createAction.headers === '{"Accept": "application/json", "X-Trace": "on"}',
    'an action saved as a JSON string keeps that string in the column, byte for byte',
  );
  record(legacy.createAction.headersReadable === true, 'and the server can read it as rows');

  // ------------------------------------------------------- rows in the form

  await page.goto(`${BASE}/workspace/${WORKSPACE}/actions`);
  if (!(await drawn(page, 'the actions page'))) await finish(browser);

  await page.getByRole('button', { name: /new action|create action/i }).first().click();
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });

  await dialog.getByLabel(/^name$/i).fill(rowsName);
  await dialog.getByLabel(/^subtype$/i).selectOption('HTTP_REQUEST');
  await dialog.getByLabel(/^url$/i).fill('https://api.example.com/orders');

  // Add two rows, and take one away again. The count is read off the name
  // inputs rather than off the block, because a row is what has a name.
  const names = dialog.getByRole('textbox', { name: /^Header \d+ name$/ });
  const add = dialog.getByRole('button', { name: /^Add Header$/ });

  const before = await names.count();
  await add.click();
  await add.click();
  await add.click();
  record((await names.count()) === before + 3, 'Add Header adds a row each time it is pressed');

  await dialog.getByRole('button', { name: /^Remove header 3$/ }).click();
  record((await names.count()) === before + 2, 'and the remove control takes one away');

  // A literal, and a reference beside it.
  await names.nth(before).fill('Accept');
  await dialog.getByRole('textbox', { name: `Header ${before + 1} value` }).fill('application/json');

  await names.nth(before + 1).fill('Authorization');
  await dialog
    .getByRole('group', { name: `Header ${before + 2} source` })
    .getByRole('button', { name: 'Reference' })
    .click();

  const picker = dialog.getByLabel(`Header ${before + 2} variable`);
  await picker.click();
  await page.getByText(variableName, { exact: true }).first().click();

  record(
    (await dialog.innerText()).includes(variableName),
    'a referenced row names the variable it reads',
  );

  // The assertion this whole issue is about, made against the drawn dialog and
  // then again against every byte the page holds.
  record(!(await dialog.innerText()).includes(SECRET), 'and what that variable holds is not in the dialog');
  record(
    !(await page.evaluate(() => document.documentElement.outerHTML)).includes(SECRET),
    'nor anywhere in the page, in a value attribute or a hidden field',
  );

  await page.screenshot({ path: shot('action-headers-rows.png') });

  await dialog.getByRole('button', { name: /^(create|save)/i }).first().click();
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });

  // ------------------------------------------- what was stored, and what was not

  const listed = await graphql(
    `query ($workspaceId: ID!) {
       workspaceActions(workspaceId: $workspaceId, page: 0, size: 200) {
         content { id name headers headersReadable headerRows { name value variableId variableName } }
       }
     }`,
    { workspaceId: WORKSPACE },
  );

  const saved = listed.workspaceActions.content.find((held) => held.name === rowsName);
  if (saved !== undefined) madeActions.push(saved.id);
  record(saved !== undefined, 'the action the form built was saved');

  if (saved !== undefined) {
    record(
      saved.headers.includes(`"variableId":"${variableId}"`) && !saved.headers.includes(SECRET),
      'the column holds which variable, not what the variable holds',
    );
    const reference = saved.headerRows.find((row) => row.name === 'Authorization');
    record(reference?.variableName === variableName, 'and the row answers with the variable name');
    record(reference?.value === null, 'and with no value at all');
    record(
      saved.headerRows.find((row) => row.name === 'Accept')?.value === 'application/json',
      'while the literal beside it is exactly what was typed',
    );
  }

  record(
    !JSON.stringify(listed).includes(SECRET),
    'and the whole answer the browser was given holds the secret nowhere',
  );

  // ------------------------------------------------- the action people already have

  const held = listed.workspaceActions.content.find((one) => one.name === legacyName);
  record(
    held?.headers === '{"Accept": "application/json", "X-Trace": "on"}',
    'an action saved before this change is still stored exactly as it was',
  );
  record(
    held?.headerRows.map((row) => `${row.name}=${row.value}`).join(',') ===
      'Accept=application/json,X-Trace=on',
    'and reads back as the rows it always meant, in the order it was written',
  );
} finally {
  // Nothing this made is left behind: this runs against a database somebody is
  // working in, and a check that litters is a check nobody runs twice.
  for (const id of madeActions) {
    await graphql(`mutation ($id: ID!) { deleteAction(id: $id) }`, { id }).catch(() => {});
  }
  if (variableId !== null) {
    await graphql(`mutation ($id: ID!) { deleteVariable(id: $id) }`, { id: variableId }).catch(() => {});
  }
  if (catalogId !== null) {
    await graphql(`mutation ($id: ID!) { deleteVariableCatalog(id: $id) }`, { id: catalogId }).catch(() => {});
  }
}

await finish(browser);
