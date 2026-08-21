/**
 * The History panel's explanation, behind the (?) - and its status still in the
 * open.
 *
 * `UI-DESIGN-RULES.md` states the convention and, in the same section, the
 * exceptions to it. This panel had one of each, two lines apart, which is why
 * it is worth a check of its own rather than a line in `hint-forms-check`:
 *
 *   - "Every save keeps what this was before it. How long they are kept is an
 *     administrator's setting." explains what the panel is. It goes behind the
 *     question mark.
 *   - "Nothing yet. The next save will keep what this says now, and it will
 *     appear here." is the state of the thing being looked at. The rules list
 *     that among what stays visible, and it is quoted there almost word for
 *     word.
 *
 * A check that only asserted "no prose in the panel" would pass a panel that
 * had lost both, and losing the second is a real regression: it is the only
 * thing a component with no history says. So both halves are here, and the
 * failure of either is named.
 *
 * `RevisionHistory` is one component standing in four frames - the tool
 * editor's aside, the function editor's, the skill editor's, and a card on the
 * agent settings page. Two of those are driven, chosen because their layouts
 * differ most (an aside beside a code editor, a card in a column of cards), and
 * the source half below asserts that the other two are the same component
 * rather than copies that could be converted separately and were not.
 *
 * Builds its own tool and its own agent and takes both away again, named after
 * the clock so a failed run leaves nothing another run trips over.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, WORKSPACE, open, record, finish, drawn, shot } from './suite/harness.mjs';

/** The explanation, and the status. Spelled here so a rewrite fails by name. */
const EXPLANATION = 'Every save keeps what this was before it';
const STATUS = 'Nothing yet. The next save will keep what this says now';

// ------------------------------------------------------- what the source says

/**
 * Every page that draws the panel.
 *
 * Read out of `src/` rather than asked of the browser for the reason the
 * footer check reads its call sites: the point is coverage. A fifth page that
 * rendered its own copy of this panel - or the same component re-converted
 * back - is a failure here, before anybody has to notice it on a screen.
 */
const FRAMES = [
  'ToolEditorPage.tsx',
  'FunctionEditorPage.tsx',
  'SkillEditorPage.tsx',
  'AgentSettingsPage.tsx',
];

function sources(from = 'src') {
  return readdirSync(from, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(from, entry.name))
      : entry.name.endsWith('.tsx')
        ? [join(from, entry.name)]
        : [],
  );
}

const renderers = sources()
  .filter((path) => !path.endsWith('RevisionHistory.tsx'))
  .filter((path) => readFileSync(path, 'utf8').includes('<RevisionHistory'))
  .map((path) => path.split(/[\\/]/).pop())
  .sort();

record(
  renderers.join(',') === [...FRAMES].sort().join(','),
  `the panel is one component in ${FRAMES.length} frames - the interface renders it from: ${renderers.join(', ') || 'nowhere'}`,
);

const held = readFileSync('src/components/RevisionHistory.tsx', 'utf8');
record(
  held.includes('<FieldHint label="History">'),
  'and that component hands its explanation to a FieldHint',
);
record(
  !/<p className=\{styles\.note\}>/.test(held),
  'and no longer prints a paragraph of it under the heading',
);

// ------------------------------------------------------ what the pages draw

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const TAG = `hint${Date.now().toString(36)}`;
let toolId = null;
let agentId = null;
let failed = false;

try {
  toolId = (
    await graphql(
      'mutation($workspaceId: ID!, $name: String!) { createTool(input: { workspaceId: $workspaceId, name: $name }) { id } }',
      { workspaceId: WORKSPACE, name: TAG },
    )
  ).createTool.id;
  agentId = (
    await graphql(
      'mutation($workspaceId: ID!, $name: String!) { createAgent(input: { workspaceId: $workspaceId, name: $name, type: LLM }) { id } }',
      { workspaceId: WORKSPACE, name: TAG },
    )
  ).createAgent.id;

  /*
   * Neither has been saved over, so both panels are in the state that draws the
   * status line - which is the state this check needs and the state a reader
   * meets first.
   */
  const frames = [
    ['the tool editor', `/workspace/${WORKSPACE}/tools/${toolId}`],
    ['the agent settings page', `/workspace/${WORKSPACE}/agents/${agentId}/settings`],
  ];

  for (const [what, path] of frames) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    if (!(await drawn(page, what))) continue;

    const history = page.getByRole('region', { name: 'History' });
    const there = await history
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!record(there, `${what} draws the History panel`)) continue;

    const said = (await history.innerText()).replace(/\s+/g, ' ').trim();

    // The (?) is there, and it is the one about this panel rather than a
    // neighbour's that happens to be inside the region.
    const hint = history.locator('button[data-hint="History"]');
    record((await hint.count()) === 1, `${what}: the panel carries one (?) of its own`);

    record(
      !said.includes(EXPLANATION),
      `${what}: the explanation is no longer printed under the heading ` +
        `(the panel says ${JSON.stringify(said.slice(0, 90))})`,
    );

    // And the exception, which is the half a "no prose" check would delete.
    record(
      said.includes(STATUS),
      `${what}: the status stayed in the open - a component with no history still says so`,
    );

    /*
     * What the (?) is for. Hovering rather than pressing, because hovering is
     * the cheaper of the two ways in and the one that has to work: a note that
     * only opens when pinned is a note most readers never see. The text lands
     * in a portalled [role=note] on the body, not inside the region.
     */
    if ((await hint.count()) === 1) {
      await hint.hover();
      const note = page.locator('[role="note"]');
      const opened = await note
        .first()
        .waitFor({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (record(opened, `${what}: hovering the (?) opens a note`)) {
        const words = (await note.first().innerText()).replace(/\s+/g, ' ').trim();
        record(
          words.includes(EXPLANATION),
          `${what}: and the note holds the sentence that used to be printed ("${words.slice(0, 90)}")`,
        );
      }
      await page.mouse.move(0, 0);
    }

    await page.screenshot({ path: shot(`history-hint-${what.split(' ')[1]}.png`), fullPage: false });
  }
} catch (cause) {
  failed = true;
  console.error(`FAIL: the check threw: ${cause instanceof Error ? cause.stack : String(cause)}`);
} finally {
  // Its own data, swept up whichever assertion failed on the way.
  if (toolId !== null) {
    await graphql('mutation($id: ID!) { deleteTool(id: $id) }', { id: toolId }).catch(() => undefined);
  }
  if (agentId !== null) {
    await graphql('mutation($id: ID!) { deleteAgent(id: $id) }', { id: agentId }).catch(() => undefined);
  }
}

await finish(browser, !failed);
