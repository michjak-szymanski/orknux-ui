/**
 * Editing a tool's signature in the tool editor, the way the function editor does it.
 *
 * Issue #140: a tool had no editable signature at all - the server showed every
 * model one hard-coded `input` argument and handed the sandbox a one-element
 * list. This drives the editor: it reads the parameter the tool starts with,
 * renames it, adds a second one of another type, checks the declaration in the
 * code column followed the panel, saves, reloads, and checks it stuck.
 *
 * A scratch tool of its own, created and deleted through the API, so the
 * workspace's own tools are not edited to prove a point.
 *
 * Temporary: delete once it has been looked at.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5174';
const WORKSPACE = process.env.ORKNUX_WORKSPACE ?? '9';
const NAME = 'signatureCheck140';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: 'alice', password: 'password' },
});
if (!signedIn.ok()) {
  console.error('FAIL sign-in');
  process.exit(1);
}

async function graphql(query, variables = {}) {
  const answer = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const body = await answer.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

let toolId = null;
let failures = 0;

function check(said, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${said}`);
  if (!ok) failures += 1;
}

try {
  // A tool created the way anything else creates one: nothing said about what it
  // takes, so it takes what every tool used to take.
  const made = await graphql(
    `mutation ($input: CreateToolInput!) { createTool(input: $input) { id params { name type } signature } }`,
    { input: { workspaceId: WORKSPACE, name: NAME, description: 'Scratch, for issue #140.' } },
  );
  toolId = made.createTool.id;
  check(`a new tool starts at ${made.createTool.signature}`, made.createTool.signature === '(input: map)');

  await page.goto(`${BASE}/workspace/${WORKSPACE}/tools/${toolId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Parameters', { timeout: 20_000 });
  await page.waitForTimeout(800);

  const firstName = page.getByLabel('Parameter 1 name');
  check('the editor shows the parameter it takes', (await firstName.inputValue()) === 'input');

  // Renamed and retyped, then a second one added: the two things the function
  // editor can do to a signature and this one could not.
  await firstName.fill('city');
  await page.getByLabel('Parameter 1 type').selectOption('STRING');
  await page.getByRole('button', { name: 'Add Parameter' }).click();
  await page.waitForTimeout(300);
  await page.getByLabel('Parameter 2 name').fill('days');
  await page.getByLabel('Parameter 2 type').selectOption('NUMBER');
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.waitForSelector('text=Saved.', { timeout: 20_000 });

  // The declaration in the code followed the panel, or the tool would be handed
  // arguments its own code never binds. Read back from what was stored, which is
  // the only copy that matters once the page is closed.
  const written = await graphql(`query ($id: ID!) { tool(id: $id) { typescript source } }`, { id: toolId });
  check(
    'the declaration in the code took the new parameters',
    written.tool.typescript.includes('signatureCheck140(city: string, days: number)') &&
      written.tool.source.includes('signatureCheck140(city, days)'),
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Parameters', { timeout: 20_000 });
  await page.waitForTimeout(800);

  const reloaded = [
    await page.getByLabel('Parameter 1 name').inputValue(),
    await page.getByLabel('Parameter 1 type').inputValue(),
    await page.getByLabel('Parameter 2 name').inputValue(),
    await page.getByLabel('Parameter 2 type').inputValue(),
  ];
  check(
    `after a reload the editor still says ${reloaded.join(' ')}`,
    reloaded.join(' ') === 'city STRING days NUMBER',
  );

  const stored = await graphql(`query ($id: ID!) { tool(id: $id) { signature } }`, { id: toolId });
  check(
    `the server stores ${stored.tool.signature}`,
    stored.tool.signature === '(city: string, days: number)',
  );

  await page.screenshot({ path: '/tmp/tool-signature.png' });
} catch (failure) {
  console.log(`FAIL ${failure.message}`);
  failures += 1;
} finally {
  if (toolId !== null) {
    await graphql(`mutation ($id: ID!) { deleteTool(id: $id) }`, { id: toolId }).catch(() => undefined);
  }
  await browser.close();
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
