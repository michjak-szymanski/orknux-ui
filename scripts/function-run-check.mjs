/**
 * Running a function from its editor, with parameters, and reading the answer.
 *
 * Issue #266. Validate said whether the sandbox's parser would accept the text,
 * which is a question nobody had; the question people have is whether the
 * function does what they meant, and the only honest way to answer it is to run
 * the thing that actually runs.
 *
 * So the measurement here is not "a panel appeared". It is what came back:
 *
 *   the answer   - two typed fields, filled in as their types, and the JSON the
 *                  function returned read off the panel.
 *   the grant    - the function is handed one of the workspace's variables, and
 *                  the value of it is in what came back. That is the half a test
 *                  run could most easily get wrong: a run that resolved no grant
 *                  would still succeed, and answer wrongly. It is also asserted
 *                  that the panel names the grant and never prints its value.
 *   the failure  - the same function, edited to throw, run again. A panel that
 *                  can only report success is a panel that proves nothing, and
 *                  the reason has to be the same sentence a workflow's own run
 *                  history would have shown.
 *   the record   - it ran, and the workspace's audit says who ran it. This is the
 *                  one execution that leaves no run behind it, so the audit is
 *                  the only place it can be seen at all.
 *
 * Everything is this check's own, made and deleted over GraphQL, and swept at
 * the start in case an earlier run was killed before it could delete.
 */
import { BASE, WORKSPACE, open, record, finish, shot } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1800, height: 1000 } });

const STAMP = Date.now();
const PREFIX = 'runCheck';

let failures = 0;

function check(ok, said) {
  record(ok, said);
  if (!ok) failures += 1;
}

/* ----------------------------------------------------------------- fixture */

const left = await graphql(
  `query($id: ID!) { workspaceFunctions(workspaceId: $id, page: 0, size: 200) { content { id name } } }`,
  { id: WORKSPACE },
);
for (const old of left.workspaceFunctions.content.filter((held) => held.name.startsWith(PREFIX))) {
  await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept function ${old.name} (#${old.id}) from an earlier run`);
}

const NAME = `${PREFIX}${STAMP}`;
const CATALOG = `${PREFIX}Catalog${STAMP}`;
const GRANT = `runCheckSalt${STAMP}`;
/*
 * Not a plausible secret, on purpose: this value ends up in a screenshot and in
 * a failure message, so it says what it is. What matters is only that the
 * function could not have produced it without being handed it.
 */
const HELD = 'salted-by-the-workspace';

let functionId = null;
let variableId = null;
let catalogId = null;

/** What the panel is showing as the answer, whichever way the run went. */
const answerText = () => page.locator('[class*="runAnswer"]').innerText();

/** The verdict line above it: "Returned in 3 ms", or "Failed in …". */
const verdictText = () =>
  page.locator('[class*="runVerdict"]').first().innerText();

async function openEditor(id) {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/functions/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Test Run', { timeout: 30_000 });
  await page.waitForFunction(
    () =>
      (document.querySelector('.view-lines')?.textContent ?? '')
        .replace(/\u00a0/g, ' ')
        .includes('export default'),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1200);
}

/** Presses Run and waits for the panel to say what happened. */
async function run() {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForSelector('[class*="runVerdict"]', { timeout: 30_000 });
  await page.waitForTimeout(300);
}

const source = (body) =>
  `export default async function ${NAME}(word, times, salt) {\n${body}\n}\n`;

const ANSWERS = source('  return { said: word.repeat(times), salt };');
const THROWS = source("  throw new Error('the ' + word + ' went wrong');");

try {
  catalogId = (
    await graphql(
      `mutation($w: ID!, $n: String!) { createVariableCatalog(workspaceId: $w, name: $n) { id } }`,
      { w: WORKSPACE, n: CATALOG },
    )
  ).createVariableCatalog.id;

  variableId = (
    await graphql(`mutation($input: CreateVariableInput!) { createVariable(input: $input) { id name } }`, {
      input: {
        workspaceId: WORKSPACE,
        catalogId,
        name: GRANT,
        type: 'STRING',
        kind: 'SECRET',
        value: HELD,
      },
    })
  ).createVariable.id;

  functionId = (
    await graphql(`mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id } }`, {
      input: {
        workspaceId: WORKSPACE,
        name: NAME,
        description: 'A function this check made for itself.',
        returnType: 'MAP',
        params: [
          { name: 'word', type: 'STRING' },
          { name: 'times', type: 'NUMBER' },
        ],
        externalVariableIds: [variableId],
        source: ANSWERS,
        typescript: ANSWERS,
      },
    })
  ).createFunction.id;
  console.log(`made ${NAME} (#${functionId}), granted ${GRANT} (#${variableId})`);

  /* ------------------------------------------------------------ the answer */

  await openEditor(functionId);

  // A field per parameter, as its own type: the string is typed as a string and
  // the number as a number, which is the whole of the difference between this
  // and asking somebody to write a JSON array.
  await page.getByLabel(`Argument word`).fill('ha');
  await page.getByLabel(`Argument times`).fill('3');
  // And there is no field for the grant: it is not the caller's to supply.
  check(
    (await page.getByLabel(`Argument ${GRANT}`).count()) === 0,
    'the panel offers no field for the workspace variable the function is granted',
  );

  await run();

  const verdict = await verdictText();
  const answered = await answerText();
  console.log(`the panel said ${JSON.stringify(verdict)} and ${JSON.stringify(answered)}`);

  check(/^Returned in \d+ ms$/.test(verdict.trim()), `the panel says it returned, and how long it took: ${verdict}`);
  check(
    JSON.parse(answered).said === 'hahaha',
    'and shows what the function returned, computed from the arguments that were typed',
  );
  check(
    JSON.parse(answered).salt === HELD,
    'the workspace variable really was handed over: the run resolved it exactly as a workflow does',
  );
  /*
   * The line that names the grant, read on its own rather than off the whole
   * panel: the answer above it holds the value, because this function chose to
   * return it. What is being asserted is that the panel does not print a
   * variable's value of its own accord.
   */
  const handed = await page.locator('aside p', { hasText: 'Handed ' }).first().innerText();
  check(
    handed.includes(GRANT) && !handed.includes(HELD),
    `the panel names the grant it was handed and not its value: ${JSON.stringify(handed)}`,
  );

  await page.screenshot({ path: shot('function-run.png'), fullPage: true });

  /* ----------------------------------------------------------- the failure */

  await graphql(`mutation($id: ID!, $input: UpdateFunctionInput!) { updateFunction(id: $id, input: $input) { id } }`, {
    id: functionId,
    input: { source: THROWS, typescript: THROWS },
  });

  await openEditor(functionId);
  await page.getByLabel(`Argument word`).fill('kettle');
  await page.getByLabel(`Argument times`).fill('1');
  await run();

  const failedVerdict = await verdictText();
  const failedAnswer = await answerText();
  console.log(`after it was made to throw: ${JSON.stringify(failedVerdict)} / ${JSON.stringify(failedAnswer)}`);

  check(/^Failed in \d+ ms$/.test(failedVerdict.trim()), `a thrown error is reported as a failure: ${failedVerdict}`);
  check(
    failedAnswer.includes('the kettle went wrong'),
    'and the panel shows what the script actually said, not that something went wrong',
  );
  check(
    failedAnswer.startsWith(`${NAME} `),
    "under the function's own name, which is the sentence a workflow's run history would have shown",
  );

  await page.screenshot({ path: shot('function-run-failed.png'), fullPage: true });

  /* ------------------------------------------------------------ the record */

  const audited = await graphql(
    `query($w: ID!) { workspaceAudit(workspaceId: $w, page: 0, size: 50) { content { message } } }`,
    { w: WORKSPACE },
  );
  const said = audited.workspaceAudit.content.map((row) => row.message);
  check(
    said.filter((message) => message === `Function ${NAME} run from the editor`).length >= 2,
    'both runs are in the workspace audit: this is the one execution that leaves no run behind it',
  );
} catch (failure) {
  record(false, `the check threw: ${failure.message}`);
  failures += 1;
} finally {
  if (functionId !== null) {
    await graphql(`mutation($id: ID!) { deleteFunction(id: $id) }`, { id: functionId }).catch(() => undefined);
  }
  if (variableId !== null) {
    await graphql(`mutation($id: ID!) { deleteVariable(id: $id) }`, { id: variableId }).catch(() => undefined);
  }
  if (catalogId !== null) {
    await graphql(`mutation($id: ID!) { deleteVariableCatalog(id: $id) }`, { id: catalogId }).catch(
      () => undefined,
    );
  }
}

await finish(browser, failures === 0);
