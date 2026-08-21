/**
 * The wand on the tool editor, and a change accepted where the tool is.
 *
 * Checks the gesture the function editor already had, on a tool: the wand sits
 * in the header, one press opens the quick chat and asks the opening question,
 * and the answer comes back from the workspace's own model. Then it checks the
 * other half - a change offered for the tool on screen is claimed by this page,
 * drawn as a diff with Accept and Reject, and accepting compiles, saves, and
 * says so back into the conversation.
 *
 * The offer is announced here rather than waited for from the model: on this
 * workspace `quickChatMayWrite` is false, so the model may read a tool and
 * describe a change but will never offer one. The event dispatched below is
 * byte-for-byte the one QuickChat sends when it does, so the half being checked
 * - claiming, diffing, compiling, saving, answering - is the real path.
 *
 * The tool is put back the way it was before this exits.
 */
import { BASE, WORKSPACE, open, record, shot, finish } from './suite/harness.mjs';
import { NAMES, idOf } from './suite/named.mjs';

const MARKER = '// wand-check marker';

const { browser, context, page } = await open({ viewport: { width: 1440, height: 900 } });

async function graphql(query, variables = {}) {
  const response = await context.request.post(`${BASE}/graphql`, { data: { query, variables } });
  const payload = await response.json();
  if (payload.errors) throw new Error(payload.errors[0].message);
  return payload.data;
}

/*
 * By name. `?? '13'` was one developer's tool number; anywhere else it is a
 * tool that does not exist, and this check would have driven a wand on the page
 * that says so.
 */
const TOOL = await idOf(graphql, 'tool', WORKSPACE, NAMES.TOOL, process.env.ORKNUX_TOOL);
if (TOOL === null) {
  record(false, `there is no tool called ${NAMES.TOOL} to open the wand on`);
  await finish(browser);
}

const { tool: before } = await graphql('query ($id: ID!) { tool(id: $id) { id name source typescript } }', {
  id: TOOL,
});
const original = before.typescript ?? before.source;

/*
 * Recorded, not merely printed.
 *
 * These fourteen verdicts went to `console.log` and a private counter, and the
 * only thing `finish` was ever handed was `failures === 0` - so a green run of
 * this check announced "ALL PASS (1 checks)" over fourteen measurements, and a
 * red one "SOME FAILED (1 of 1)". The tally is the thing a suite is read by;
 * a check that keeps its own is a check nobody can count.
 */
let failures = 0;
function check(ok, pass, fail) {
  record(ok, ok ? pass : fail);
  if (!ok) failures += 1;
}

/*
 * What the panel actually sends, which is the deterministic half of "it was
 * told what it is looking at". The answer's wording is the model's; the
 * question's contents are the product's.
 */
let asked = null;
page.on('request', (request) => {
  if (asked === null && request.url().includes('/quick-chat')) asked = request.postData();
});

try {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/tools/${TOOL}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-label="Tool source"]', { timeout: 20_000 });

  const wand = page.locator('button[aria-label="Ask the assistant for help with this tool"]');
  check(await wand.isVisible(), 'the wand is on the tool editor', 'no wand on the tool editor');

  const panel = page.locator('section[aria-label="Quick chat"]');
  check(!(await panel.isVisible().catch(() => false)), 'the panel is closed until asked', 'the panel was already open');

  await wand.click();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  const opener = panel.getByText('Can you help me with that?', { exact: true });
  check(await opener.isVisible(), 'the wand opens the panel and asks the opener', 'the opener was not asked');

  // The reply, from whatever model this workspace has. Read structurally: the
  // asked turns are <p>, an answer is the <div> the markdown renders into.
  const replied = await page
    .waitForFunction(
      () => {
        const log = document.querySelector('section[aria-label="Quick chat"] div');
        if (log === null) return false;
        const answers = [...log.children].filter((child) => child.tagName === 'DIV');
        return answers.length > 0 ? answers[0].innerText : false;
      },
      undefined,
      { timeout: 120_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);

  if (replied === null) {
    /*
     * No answer. Before calling that a fault of the wand, ask the doctor: a
     * server holding a different ORKNUX_SECRET_KEY than the one the model
     * providers' keys were written with cannot call any model at all, and the
     * quick chat fails the same way on every page. That is worth saying out
     * loud rather than counting as a failure of this gesture.
     */
    const { doctor } = await graphql('query { doctor { name verdict detail } }');
    const secrets = doctor.find((check) => check.name === 'Stored secrets');
    const shown = await panel.innerText();
    if (secrets !== undefined && secrets.verdict === 'FAIL' && secrets.detail.includes('model_provider.secret')) {
      /*
       * Recorded, not waved through.
       *
       * This used to print NOT VERIFIED and count nothing, so a server that
       * cannot call a model reported this check as a pass over an untested
       * half - which is the same dishonesty as a check that skips an assertion
       * because its fixture is missing. The message still says whose fault it
       * is, so nobody reads it as a broken wand; the tally says the wand's
       * answer was not seen, because it was not.
       */
      record(
        false,
        'no model can be called on this server, so the answer half is untested. ' +
          `The doctor says: ${secrets.detail}. The panel says: ` +
          `${shown.split('\n').filter((line) => line.trim() !== '').pop()}`,
      );
      failures += 1;
    } else {
      record(false, `no answer came back within two minutes. The panel says: ${shown.replace(/\s+/g, ' ')}`);
      failures += 1;
    }
  } else {
    console.log(`--- the assistant said ---\n${replied.slice(0, 600)}\n--------------------------`);
    check(replied.trim() !== '', 'the model answered', 'the model answered with nothing');

    /*
     * Where the question said it was asked from.
     *
     * This used to be `the answer names the tool`, read out of the model's
     * prose - and a model that replies "What would you like to change about
     * this tool?" has plainly been told what it is looking at and has simply
     * not repeated the name. The check failed on a correct product because it
     * was asserting a wording nobody controls. The thing the issue was actually
     * about - whether the panel says which page it is on, so the server can
     * hand the model the tool rather than reach for a function - is in the
     * request, where it is the same every time.
     */
    const path = asked === null ? null : (JSON.parse(asked).page?.path ?? null);
    check(
      path === `/workspace/${WORKSPACE}/tools/${TOOL}`,
      `the question says which page it came from (${path})`,
      `the question named ${JSON.stringify(path)}, not the tool's own page`,
    );

    // A reading and not a verdict: whether it repeated the name is the model's
    // business, and worth seeing in the log when an answer looks wrong.
    const knows = replied.toLowerCase().includes(before.name.toLowerCase());
    console.log(`NOTE: the answer ${knows ? 'names' : 'does not name'} ${before.name}.`);
  }

  // A change offered for the tool on screen, exactly as the panel announces one.
  const proposed = `${MARKER}\n${original}`;
  const claimed = await page.evaluate(
    ({ toolId, name, code }) =>
      !window.dispatchEvent(
        new CustomEvent('orknux:tool-suggestion', {
          detail: { toolId, tool: name, note: 'A marker comment, so the accept can be seen.', code },
          cancelable: true,
        }),
      ),
    { toolId: TOOL, name: before.name, code: proposed },
  );
  check(claimed, 'the tool editor claims the offer', 'the offer went unclaimed');

  // The diff itself, not the label: monaco hangs ariaLabel on its hidden
  // textarea, which is never "visible" to a browser driver.
  // Drawn, and drawing this change: an inserted line is what the marker is.
  // Waited for rather than read at once - monaco puts the editor on screen a
  // frame or two before it has decided what changed.
  const inserted = page.locator('.monaco-diff-editor .line-insert');
  await inserted.first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
  const drawn = (await page.locator('.monaco-diff-editor').count()) > 0 && (await inserted.count()) > 0;
  // Both sides of it are named, so it is not two unnamed boxes to a reader.
  const labelled = (await page.locator('.monaco-diff-editor [aria-label^="Suggested change"]').count()) === 2;
  check(drawn && labelled, 'the change is drawn as a diff', 'no diff appeared');
  // The editor is gone while an offer is open - what is on screen is the
  // proposal against the code, not something anybody can type into.
  check(
    (await page.locator('[aria-label="Tool source"]').count()) === 0,
    'the editor gives way to the diff',
    'the editor is still there under the offer',
  );

  const accept = page.locator('button', { hasText: /^Accept$/ });
  const reject = page.locator('button', { hasText: /^Reject$/ });
  check(
    (await accept.isVisible()) && (await reject.isVisible()),
    'Accept and Reject are offered above it',
    'Accept and Reject are missing',
  );

  await accept.click();
  const saidSaved = await page
    .waitForSelector('text=The suggested change is saved.', { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(saidSaved, 'accepting compiles and saves', 'the accept did not report a save');

  const settled = await panel
    .getByText('I accepted the change and it is saved.', { exact: true })
    .isVisible()
    .catch(() => false);
  check(settled, 'the conversation is told what happened', 'the conversation was not told');

  // What is stored, not what the page is showing.
  const { tool: after } = await graphql('query ($id: ID!) { tool(id: $id) { source typescript } }', { id: TOOL });
  check(
    (after.typescript ?? '').startsWith(MARKER),
    'the accepted TypeScript is what is stored',
    'the store does not have the accepted change',
  );
  // Accepting compiles, the way Save does: what the sandbox runs is stored
  // beside what was written, and it moved with the accepted change.
  check(
    after.source.trim() !== '' && after.source !== before.source,
    'the compiled JavaScript was stored beside it',
    'the stored JavaScript did not follow the accepted change',
  );

  await page.screenshot({ path: shot('tool-wand.png') });
} finally {
  // Put the tool back, whatever happened above.
  await graphql('mutation ($id: ID!, $input: UpdateToolInput!) { updateTool(id: $id, input: $input) { id } }', {
    id: TOOL,
    input: { source: before.source, typescript: before.typescript },
  });
  await browser.close();
}

/*
 * Nothing extra: every verdict above is recorded now, so the tally is the
 * count of measurements and `failures` is only what the NOT VERIFIED path
 * below reads. Handing `failures === 0` in as well would count it twice.
 */
console.log(`${failures} of the measurements above failed`);
await finish(browser);
