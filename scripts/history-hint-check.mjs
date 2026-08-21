/**
 * The History and Publications panels: explanation behind the (?), status still
 * in the open.
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
 * The Publications panel on a workflow's settings page is the same shape and is
 * checked the same way, because it is the same split with the halves further
 * apart: what a publication *is* is told once, and whether this workflow has
 * one is told every time. Its note has a second requirement of its own - "the
 * newest publication is what triggers and schedules run" is the fact somebody
 * needs before restoring an older one, so the check asks for that sentence by
 * name rather than for the note being non-empty. A note trimmed for brevity on
 * the way behind the (?) is the failure worth catching here.
 *
 * Builds its own tool, agent and workflow and takes them away again, named
 * after the clock so a failed run leaves nothing another run trips over - and
 * because a workflow *definition* cannot be removed at all, only unassigned, so
 * the name it was given is taken for good.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, WORKSPACE, open, record, finish, drawn, shot } from './suite/harness.mjs';

/**
 * The explanations, and the statuses. Spelled here so a rewrite fails by name.
 *
 * A status is the whole string the panel draws, not a substring of it: the
 * refinement this check was rewritten for is that a status says the state and
 * stops. Both of these used to run on into a second sentence about how the
 * panel fills, which is the thing the (?) beside them exists to say.
 */
const EXPLANATION = 'Every save keeps what this was before it';
const STATUS = 'Nothing yet.';
const PUBLISHED_EXPLANATION = 'A workflow’s versions are what was published, not what was saved';
/** What left the status line and has to be in the note rather than nowhere. */
const PUBLISHED_FILLS = 'Publishing this workflow makes a version of it';
/** The half of it that is not there to be interesting. See the note above. */
const PUBLISHED_RUNS = 'The newest publication is what triggers and schedules run';
const PUBLISHED_STATUS = 'Never published.';

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

/*
 * The workflow's twin, which shares this one's stylesheet and had the same
 * paragraph in the same place. Read from the source for the same reason: it is
 * drawn from one page today and the point is that a second one cannot render an
 * unconverted copy.
 */
const publications = sources()
  .filter((path) => !path.endsWith('PublicationHistory.tsx'))
  .filter((path) => readFileSync(path, 'utf8').includes('<PublicationHistory'))
  .map((path) => path.split(/[\/]/).pop())
  .sort();
record(
  publications.join(',') === 'WorkflowSettingsPage.tsx',
  `the Publications panel is one component too - the interface renders it from: ${publications.join(', ') || 'nowhere'}`,
);
const publicationSource = readFileSync('src/components/PublicationHistory.tsx', 'utf8');
record(
  publicationSource.includes('<FieldHint label="Publications">'),
  'and it hands its explanation to a FieldHint as well',
);
record(
  !/<p className=\{styles\.note\}>/.test(publicationSource),
  'and neither of the two still prints a paragraph under its heading',
);
/*
 * And the rule that styled them, which nothing uses now. Comments stripped
 * first, because the stylesheet says in prose that `.note` was taken out and a
 * naive search would find that sentence and call it a selector.
 */
const stylesheet = readFileSync('src/components/RevisionHistory.module.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
record(
  !/\.note/.test(stylesheet),
  'and the rule that styled those two paragraphs is gone from the stylesheet they shared',
);

// ------------------------------------------------------ what the pages draw

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const TAG = `hint${Date.now().toString(36)}`;
let toolId = null;
let agentId = null;
let assignmentId = null;
let workflowId = null;
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
  const made = (
    await graphql(
      'mutation($workspaceId: ID!, $name: String!) { createWorkflow(input: { workspaceId: $workspaceId, name: $name }) { id workflowId } }',
      { workspaceId: WORKSPACE, name: TAG },
    )
  ).createWorkflow;
  assignmentId = made.id;
  workflowId = made.workflowId;

  /*
   * Nothing has been saved over and nothing has been published, so all three
   * panels are in the state that draws the status line - which is the state
   * this check needs and the state a reader meets first.
   */
  const PANELS = [
    {
      what: 'the tool editor',
      region: 'History',
      path: `/workspace/${WORKSPACE}/tools/${toolId}`,
      status: STATUS,
      /* Must be in the note, in whatever words it ended up in. */
      explains: [EXPLANATION, 'appears here', 'administrator'],
      /* Must not be on the screen: the panel teaching how it fills. */
      taught: [EXPLANATION, 'The next save will keep', 'will appear here'],
    },
    {
      what: 'the agent settings page',
      region: 'History',
      path: `/workspace/${WORKSPACE}/agents/${agentId}/settings`,
      status: STATUS,
      explains: [EXPLANATION, 'appears here', 'administrator'],
      taught: [EXPLANATION, 'The next save will keep', 'will appear here'],
    },
    {
      what: 'the workflow settings page',
      region: 'Publications',
      path: `/workspace/${WORKSPACE}/workflows/${workflowId}/settings`,
      status: PUBLISHED_STATUS,
      /*
       * `PUBLISHED_RUNS` is asked for by name rather than left to "the note is
       * not empty". It is the fact somebody needs before restoring an older
       * publication, and a note trimmed for brevity would lose it first.
       */
      explains: [PUBLISHED_EXPLANATION, PUBLISHED_FILLS, PUBLISHED_RUNS],
      taught: [PUBLISHED_EXPLANATION, PUBLISHED_FILLS, 'will appear here'],
    },
  ];

  for (const panel of PANELS) {
    const { what, region, path } = panel;
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    if (!(await drawn(page, what))) continue;

    const found = page.getByRole('region', { name: region });
    const there = await found
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!record(there, `${what} draws the ${region} panel`)) continue;

    const said = (await found.innerText()).replace(/\s+/g, ' ').trim();

    // The (?) is there, and it is the one about this panel rather than a
    // neighbour's that happens to be inside the region.
    const hint = found.locator(`button[data-hint="${region}"]`);
    record((await hint.count()) === 1, `${what}: the ${region} panel carries one (?) of its own`);

    /*
     * Nothing the note holds is also printed. One list rather than two
     * assertions, because the fault this is written against is not "the
     * explanation came back" - it is any one sentence of it coming back, which
     * is how a panel un-converts itself a clause at a time.
     */
    const printed = panel.taught.filter((one) => said.includes(one));
    record(
      printed.length === 0,
      printed.length === 0
        ? `${what}: nothing the (?) says is printed under the heading as well`
        : `${what}: the panel still prints ${printed.map((one) => JSON.stringify(one)).join(', ')}`,
    );

    /*
     * And the exception, exactly. `toBe` rather than `includes`: the whole
     * refinement here is that a status says the state and stops - "Nothing yet.
     * The next save will keep what this says now, and it will appear here" is a
     * state and then a lesson, and an `includes` assertion passes both.
     */
    const state = found.locator('[class*="empty"]');
    const drew = (await state.count()) === 1 ? (await state.innerText()).replace(/\s+/g, ' ').trim() : null;
    record(
      drew === panel.status,
      `${what}: the status is the state and nothing after it - it says ${JSON.stringify(drew)}, ` +
        `and should say ${JSON.stringify(panel.status)}`,
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
        const missing = panel.explains.filter((one) => !words.includes(one));
        record(
          missing.length === 0,
          missing.length === 0
            ? `${what}: and the note holds everything that left the screen ("${words.slice(0, 110)}")`
            : `${what}: the note lost ${missing.map((one) => JSON.stringify(one)).join(', ')} - ` +
              `it says "${words}"`,
        );
      }
      await page.mouse.move(0, 0);
    }

    await page.screenshot({ path: shot(`history-hint-${region.toLowerCase()}-${what.split(' ')[1]}.png`), fullPage: false });
  }
} catch (cause) {
  failed = true;
  console.error(`FAIL: the check threw: ${cause instanceof Error ? cause.stack : String(cause)}`);
} finally {
  // Its own data, swept up whichever assertion failed on the way. The workflow
  // definition cannot be removed, only unassigned - which is why TAG is a clock.
  if (toolId !== null) {
    await graphql('mutation($id: ID!) { deleteTool(id: $id) }', { id: toolId }).catch(() => undefined);
  }
  if (agentId !== null) {
    await graphql('mutation($id: ID!) { deleteAgent(id: $id) }', { id: agentId }).catch(() => undefined);
  }
  if (assignmentId !== null) {
    await graphql('mutation($id: ID!) { removeWorkflow(id: $id) }', { id: assignmentId }).catch(() => undefined);
  }
}

await finish(browser, !failed);
