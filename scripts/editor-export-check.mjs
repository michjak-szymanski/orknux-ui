/**
 * Exporting the workflow you are looking at.
 *
 * Export was on the workflows list and nowhere else, so getting a file of the
 * workflow open in the editor meant going back to the list to find the row.
 * This drives the toolbar button: it opens the depth choice, downloads with
 * each of the two, and reads what actually came back.
 *
 * The assertion that matters is the second one. "This one only" writes an
 * envelope holding the workflow and nothing it runs, which is precisely the
 * file that arrives somewhere else refusing to import; the default has to be
 * the one that carries the agents, actions and triggers with it.
 *
 * And it reads the file rather than the download event. A browser reporting a
 * file is not the same claim as that file holding the component whose name is
 * on the dialog - an export that wrote an empty envelope, or somebody else's,
 * fires exactly the same event.
 */
import { readFileSync } from 'node:fs';
import { BASE, WORKSPACE, WORKFLOW, open, record, shot, finish } from './suite/harness.mjs';

/**
 * How long a file is allowed to take.
 *
 * A deep export is one query and one blob; against a seeded workspace it comes
 * back in well under a second, so this is loose already. It is a named constant
 * because when it runs out the number is half of what the failure has to say.
 */
const PATIENCE = 20_000;

const { browser, context, page } = await open({ viewport: { width: 1440, height: 900 }, context: { acceptDownloads: true } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(1200);

const button = page.locator('button[aria-label^="Export"]');
const offered = await button.count();
console.log(`export button in the toolbar: ${offered === 1 ? 'there' : `${offered} of them`}`);
console.log(`its words: ${await button.first().getAttribute('data-tip')}`);

/**
 * What the screen was doing when no file arrived.
 *
 * This is here because of what a bare timeout cost once. The wait ran out, the
 * script died on "Timeout exceeded while waiting for event download", and that
 * sentence was read as the export delivering nothing - filed against `download()`
 * in ComponentTransfer.tsx, guessing at the blob, the anchor and the dispatch of
 * the click. None of those was wrong. The export query had simply not come back
 * yet: that workspace's skill catalogue had been inflated to twenty-four
 * thousand by this suite's own import checks, and a deep export walking all of
 * them took a minute. A timeout that does not say what it was waiting on sends
 * somebody to read a function that works.
 *
 * So the three cases are told apart, because they belong to three different
 * places. The button still reading "Exporting…" is the server: nothing in the
 * browser has been reached, and the size of the export is the question. An
 * error in the dialog is the export failing and saying so. A dialog that closed
 * with no file is the only one that is the download's own fault - the query
 * answered, the browser was handed the bytes, and nothing came of them.
 */
async function stalled(which, since) {
  const waited = ((Date.now() - since) / 1000).toFixed(0);
  const seen = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('dialog')].find((one) => one.open);
    if (dialog === undefined) return { open: false, buttons: [], error: null };
    return {
      open: true,
      buttons: [...dialog.querySelectorAll('button')].map((one) => one.innerText.trim()),
      error: dialog.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
    };
  });

  const head = `${which}: no file after ${waited}s`;
  if (!seen.open) {
    return `${head}, and the dialog closed - the export answered and the browser was handed something it did not save, which is the download itself`;
  }
  if (seen.error !== null) {
    return `${head}, and the dialog says why: ${seen.error}`;
  }
  if (seen.buttons.some((word) => word.startsWith('Exporting'))) {
    return (
      `${head}, and the button still reads "Exporting…" - the export query has not come back, so nothing in the ` +
      `browser has been reached and the download is not what is wrong. Ask this installation how big a deep ` +
      `export of workflow ${WORKFLOW} in workspace ${WORKSPACE} is; a catalogue that has grown is the usual answer`
    );
  }
  return `${head}; the dialog is open and its buttons read ${seen.buttons.join(', ')}`;
}

/** Opens the dialog, picks a depth, downloads, and reads the file. */
async function exportWith(depthTitle) {
  const which = depthTitle === null ? 'the default depth' : `"${depthTitle}"`;
  await button.first().click();
  await page.waitForSelector('dialog[open] h2:has-text("Export")', { timeout: 10_000 });
  await page.waitForTimeout(400);
  // The name on the dialog is what the file has to come back holding.
  const asked = (await page.locator('dialog[open] h2').first().innerText()).replace(/^Export\s+/, '').trim();
  if (depthTitle !== null) await page.locator(`dialog[open] label:has-text("${depthTitle}")`).click();
  await page.screenshot({ path: shot(`editor-export-${depthTitle === null ? 'default' : 'shallow'}.png`) });

  const since = Date.now();
  let download;
  try {
    [download] = await Promise.all([
      page.waitForEvent('download', { timeout: PATIENCE }),
      page.locator('dialog[open] button:has-text("Download")').click(),
    ]);
  } catch {
    record(false, await stalled(which, since));
    return null;
  }

  const took = Date.now() - since;
  const where = await download.path();
  const raw = readFileSync(where, 'utf-8');
  await page.waitForTimeout(500);
  console.log(`${which}: ${download.suggestedFilename()}, ${raw.length} characters, in ${(took / 1000).toFixed(1)}s`);

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (cause) {
    record(false, `${which}: a file arrived and is not an envelope: ${cause.message}. It starts ${JSON.stringify(raw.slice(0, 120))}`);
    return null;
  }
  return { name: download.suggestedFilename(), asked, envelope };
}

const deep = await exportWith(null);
if (deep !== null) {
  const kindsDeep = deep.envelope.components.map((held) => held.kind);
  console.log(`  depth in the file: ${deep.envelope.depth}`);
  console.log(`  carries: ${kindsDeep.join(', ')}`);

  record(deep.envelope.depth === 'DEEP', `the default depth is DEEP, and the file says ${deep.envelope.depth}`);

  // The file has to hold the component whose name the dialog offered - a
  // download event says a file arrived, not that it is this workflow.
  const root = (deep.envelope.roots ?? []).find((one) => one.kind === 'WORKFLOW');
  record(
    root?.name === deep.asked,
    root === undefined
      ? `the file names no workflow as its root: ${JSON.stringify(deep.envelope.roots)}`
      : `the file's root is the workflow the dialog offered: "${root.name}" for "${deep.asked}"`,
  );
  const carried = deep.envelope.components.find((held) => held.kind === 'WORKFLOW' && held.name === deep.asked);
  record(
    carried !== undefined && Array.isArray(carried.nodes) && carried.nodes.length > 0,
    carried === undefined
      ? `the file carries no WORKFLOW called "${deep.asked}"`
      : `and carries it whole: ${carried.nodes?.length ?? 0} nodes`,
  );
  record(kindsDeep.length > 1, `and the ${kindsDeep.length - 1} things it runs`);

  // And the file the default writes has to be one this installation would take
  // back: a workflow whose actions and triggers are missing is refused.
  const planned = await context.request.post(`${BASE}/graphql`, {
    data: {
      query: `query Plan($workspaceId: ID!, $envelope: String!) {
        componentImportPlan(workspaceId: $workspaceId, envelope: $envelope) {
          importable entries { kind external name disposition } problems
        }
      }`,
      variables: { workspaceId: WORKSPACE, envelope: JSON.stringify(deep.envelope) },
    },
  });
  const plan = (await planned.json()).data.componentImportPlan;
  record(plan.importable, plan.importable ? 'the default file imports' : `the default file is refused: ${plan.problems.join(' ')}`);
}

/*
 * The second depth is only asked when the first one answered.
 *
 * A dialog left open on "Exporting…" cannot be got past - it is modal, so the
 * toolbar button underneath it takes no click, and the second export fails
 * thirty seconds later for a reason that has nothing to do with the second
 * export. One failure, said once, in the words of what actually went wrong.
 */
const shallow = deep === null ? null : await exportWith('This one only');
if (shallow !== null) {
  const kindsShallow = shallow.envelope.components.map((held) => held.kind);
  console.log(`  depth in the file: ${shallow.envelope.depth}`);
  console.log(`  carries: ${kindsShallow.join(', ')}`);
  record(
    kindsShallow.length === 1 && kindsShallow[0] === 'WORKFLOW',
    kindsShallow.length === 1 && kindsShallow[0] === 'WORKFLOW'
      ? '"this one only" is still there, and is still bare'
      : `"this one only" carried ${kindsShallow.join(', ')}`,
  );
}

record(offered === 1, offered === 1 ? 'the toolbar offers Export' : `the toolbar offers ${offered} Export buttons`);

await finish(browser);
