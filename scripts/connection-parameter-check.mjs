/**
 * A parameter declared as a connection, offered as one and handed over as one.
 *
 * The type was added so a function could be given one of the workspace's
 * connections and pass it to `orknux.slack.thread`. Adding it to the Kotlin
 * enum, the GraphQL schema and the editor's declarations left three places that
 * still treated it as a shape nobody had thought about, and each failed
 * differently:
 *
 *   the database - two `CHECK` constraints listed the types by hand, so saving a
 *                  parameter was refused by Postgres. That half is guarded by
 *                  `ParameterTypeTest`, in Kotlin, where it belongs.
 *   the run window - every field there is a parameter offered as its type, and a
 *                  connection fell through to the JSON box the maps and arrays
 *                  use. It asked for an id nobody has memorised, off another
 *                  page, quoted correctly.
 *   the mapping - an action's arguments are a text box each, which is right for
 *                  an expression and wrong for a connection, for the same reason.
 *
 * So this drives the two screens and asserts the thing worth asserting about
 * each: that the control is a picker naming the workspace's connections, and
 * that what the picker writes is what the function is actually handed. The
 * second is the half a check could most easily fake - a select that offers the
 * right names and passes the wrong value looks identical in a screenshot - so
 * the function returns the argument it was given and the id is compared.
 *
 * Everything is this check's own, made and deleted over GraphQL, and swept at
 * the start in case an earlier run was killed before it could delete.
 */
import { BASE, WORKSPACE, open, record, finish, shot } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1800, height: 1000 } });

const STAMP = Date.now();
const PREFIX = 'connParamCheck';
const NAME = `${PREFIX}${STAMP}`;
const CONNECTION = `${PREFIX} link ${STAMP}`;

let failures = 0;

function check(ok, said) {
  record(ok, said);
  if (!ok) failures += 1;
}

let functionId = null;
let connectionId = null;

/* ----------------------------------------------------------------- fixture */

const left = await graphql(
  `query($id: ID!) { workspaceFunctions(workspaceId: $id, page: 0, size: 200) { content { id name } } }`,
  { id: WORKSPACE },
);
for (const old of left.workspaceFunctions.content.filter((held) => held.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept function ${old.name} (#${old.id}) from an earlier run`);
}
const stale = await graphql(`query($id: ID!) { workspaceConnections(workspaceId: $id) { id name } }`, {
  id: WORKSPACE,
});
for (const old of stale.workspaceConnections.filter((held) => held.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { disconnectWorkspaceConnection(id: $id) }`, { id: old.id }).catch(
    () => undefined,
  );
  console.log(`swept connection ${old.name} (#${old.id}) from an earlier run`);
}

/*
 * The function hands back what it was given, unchanged.
 *
 * It does not call `orknux.slack.thread`, and that is deliberate: this check has
 * no Slack to read a thread from, and a check that needed one would be a check
 * that only runs where somebody has set one up. What the call needs from this
 * screen is the connection, so the connection is what is measured.
 */
const SOURCE = `export default async function ${NAME}(link, note) {\n  return { link, note };\n}\n`;

try {
  connectionId = (
    await graphql(
      `mutation($input: CreateWorkspaceConnectionInput!) {
         createWorkspaceConnection(input: $input) { id name }
       }`,
      {
        input: {
          workspaceId: WORKSPACE,
          name: CONNECTION,
          type: 'HTTP',
          url: 'https://connection-parameter.example.test',
        },
      },
    )
  ).createWorkspaceConnection.id;

  /*
   * Saved over GraphQL, which is itself the first assertion. Before the
   * migration this mutation came back as a constraint violation - the type
   * existed everywhere except in the two lines of SQL that decide what may be
   * stored - so a check that could not get past its own fixture would have been
   * reporting exactly the bug that shipped.
   */
  functionId = (
    await graphql(`mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id } }`, {
      input: {
        workspaceId: WORKSPACE,
        name: NAME,
        description: 'A function this check made for itself.',
        returnType: 'MAP',
        params: [
          { name: 'link', type: 'CONNECTION' },
          { name: 'note', type: 'STRING' },
        ],
        source: SOURCE,
        typescript: SOURCE,
      },
    })
  ).createFunction.id;
  console.log(`made ${NAME} (#${functionId}) taking connection #${connectionId} (${CONNECTION})`);

  /* -------------------------------------------------------- the run window */

  await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${functionId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.view-lines', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Test Run', exact: true }).click();
  await page.waitForSelector('dialog[data-check="test-run"][open]', { timeout: 20_000 });
  await page.waitForTimeout(500);

  const linkField = page.getByLabel('Argument link');
  const noteField = page.getByLabel('Argument note');
  const linkTag = await linkField.evaluate((node) => node.tagName.toLowerCase());
  const noteTag = await noteField.evaluate((node) => node.tagName.toLowerCase());
  check(linkTag === 'select', `the connection parameter is a picker rather than a JSON box (it is a <${linkTag}>)`);
  check(noteTag === 'input', `and the string beside it is still a plain field (a <${noteTag}>)`);

  /*
   * Waited for rather than read straight off. The list is fetched when the
   * window opens - only then, and only when the function has a parameter that
   * needs it - so for a moment the picker holds the blank row and nothing else.
   * Reading it at a fixed delay passed here and failed on the same machine ten
   * minutes later, which is the definition of a check nobody can believe.
   */
  await page.waitForFunction(
    () => (document.querySelector('select[aria-label="Argument link"]')?.options.length ?? 0) > 1,
    undefined,
    { timeout: 20_000 },
  );
  const offered = await linkField.evaluate((node) => Array.from(node.options).map((option) => option.text));
  check(
    offered.includes(CONNECTION),
    `it offers the workspace's connections by name: ${JSON.stringify(offered.slice(0, 6))}`,
  );
  check(offered[0] === 'nothing', 'with the blank row first, which is the null an unmapped node passes');

  await linkField.selectOption(connectionId);
  await noteField.fill('read the thread');
  await page.screenshot({ path: shot('connection-parameter-run.png'), fullPage: true });

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForSelector('[class*="runVerdict"]', { timeout: 30_000 });
  await page.waitForTimeout(300);

  const verdict = (await page.locator('[class*="runVerdict"]').first().innerText()).trim();
  const answered = await page.locator('[class*="runAnswer"]').innerText();
  console.log(`the window said ${JSON.stringify(verdict)} and ${JSON.stringify(answered)}`);
  check(/^Returned in \d+ ms$/.test(verdict), `the run succeeded: ${verdict}`);

  /*
   * The assertion the whole check is for. A picker offering the right names and
   * writing the wrong value photographs identically to one that works, so what
   * the sandbox was handed is compared against the id of the connection that was
   * chosen - as a string, which is the shape a trigger publishes and the shape
   * `orknux.slack.thread` is documented to take.
   */
  const got = JSON.parse(answered);
  check(
    got.link === String(connectionId),
    `the function was handed the connection that was picked, as its id: ${JSON.stringify(got.link)}`,
  );
  check(got.note === 'read the thread', 'and the string beside it arrived as itself');

  /* ------------------------------------------------------- the action form */

  await page.goto(`${BASE}/workspace/${WORKSPACE}/actions/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#action-name', { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await page.selectOption('#action-subtype', 'FUNCTION');
  await page.waitForTimeout(500);

  await page.locator('#action-function').click();
  await page.waitForTimeout(300);
  await page.locator('[role="option"]', { hasText: new RegExp(`^${NAME}`) }).first().click();
  await page.waitForTimeout(600);

  const mapper = page.locator('#action-mapping-link');
  check((await mapper.count()) === 1, 'the mapping row for a connection argument is a picker');
  check(
    (await page.locator('input[aria-label="Value for note"]').count()) === 1,
    'and the row beside it is still the text box an expression needs',
  );
  /*
   * Blank is not "nothing chosen yet" here - it is the rule printed above these
   * rows, that an argument left empty is taken from the field of that name. A
   * picker that said "Select connection…" over it would read as a field somebody
   * had forgotten, so the empty state has a name of its own.
   */
  const before = (await mapper.innerText()).trim().split('\n')[0].trim();
  check(
    before === 'From the field of that name',
    `and it arrives naming the default rather than looking unfilled: ${JSON.stringify(before)}`,
  );

  await mapper.click();
  await page.waitForTimeout(300);
  await page.locator('[role="option"]', { hasText: new RegExp(`^${CONNECTION}`) }).first().click();
  await page.waitForTimeout(300);
  const after = (await mapper.innerText()).trim().split('\n')[0].trim();
  check(after === CONNECTION, `choosing one leaves it named in the row: ${JSON.stringify(after)}`);

  await page.screenshot({ path: shot('connection-parameter-mapping.png'), fullPage: true });
} catch (failure) {
  record(false, `the check threw: ${failure.message}`);
  failures += 1;
} finally {
  if (functionId !== null) {
    await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: functionId }).catch(() => undefined);
  }
  if (connectionId !== null) {
    await graphql(`mutation($id: ID!) { disconnectWorkspaceConnection(id: $id) }`, { id: connectionId }).catch(
      () => undefined,
    );
  }
}

await finish(browser, failures === 0);
