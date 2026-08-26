/**
 * The sentence under every paginated list, and whether it names what is above it.
 *
 * The report: the workflow list's footer read "Showing 1-25 of 27 templates".
 * The rows above it are workflows. A template is a different thing in this
 * product - a published copy of a component, kept on the Templates page under
 * Admin and reached from the workflow list's own Use Template button - so the
 * footer was not using a loose word for a workflow, it was naming another
 * screen's noun. The size control beside it inherits the same word and asked
 * "How many templates to show at once" about rows that are not templates.
 *
 * One call site had it wrong out of fourteen, which is the reason this check
 * exists rather than a one-line fix: `CompactPagination` takes the noun as a
 * prop, so the component cannot be right or wrong on its own and every call
 * site is a fresh chance to get it wrong. Nothing else compared the word in the
 * footer against the list it sits under, and nothing would have noticed the
 * fourteenth.
 *
 * So the check has two halves that need each other:
 *
 *   - the source half reads every `<CompactPagination>` out of `src/` and
 *     fails on any whose `unit` is not in the table below. A new paginated
 *     list is then a check failure until somebody writes down what its rows
 *     are called, which is the only way "wherever it is shared" stays true
 *     after today;
 *   - the browser half opens each list that has a route of its own and reads
 *     the sentence the page actually drew - the noun, and that the total is a
 *     fact about the list rather than about the page. A footer counting the
 *     rows in front of it is the other half of the original report, and it is
 *     caught here by turning the page: the range moves, the total does not.
 *
 * The nouns are mostly the heading lowercased, and the table says so by holding
 * the heading too. Three deliberately differ - Executions lists runs, the audit
 * log lists entries, a session lists lines - and those are written down with
 * why, because an unexplained mismatch is exactly what this is looking for.
 *
 * ---------------------------------------------------------------------------
 * And the row above the list, as of issue #174
 *
 * The same wrong noun came back at the other end of the same table: the first
 * column of the workflow list was headed "Template name". The footer half above
 * could not have caught it - it reads `<CompactPagination>` call sites, and a
 * column heading is not one.
 *
 * Only half of what is done for footers can honestly be done for headings. The
 * source half cannot: a footer's noun is a prop on one shared component, so it
 * can be read out of any file and compared against a table, while a heading row
 * is hand-written JSX in twenty-four pages with no shared component, no prop,
 * and nothing to compare a parse against. What *can* be done is the browser
 * half, and it costs nothing extra: this check already opens every routed list
 * and already knows what each one's rows are called, so it reads the heading
 * row off the same page it reads the footer off.
 *
 * Two assertions, and the difference between them matters. The first is the
 * spelled-out one, the same as `unit === 'templates'` above: "template" is
 * another page's noun and may not head a column on any of these lists. The
 * second is the discipline that keeps it true after today - each list's first
 * column heading is written down in the table below, so renaming one is a
 * failure until somebody says what it is now. That is deliberately not "the
 * heading must be the list's noun": the audit log's first column is Action and
 * its rows are entries, and both are right.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, WORKSPACE, open, record, finish, drawn, shot } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

/**
 * Every list that draws the shared footer, and what its rows are called.
 *
 * `path` is what goes after `/workspace/<id>`; `null` means the list has no
 * route of its own and only the source half covers it. `title` is the heading
 * the page draws above the list, so a page renamed without its footer is a
 * failure rather than a thing nobody looks at. `why` is only set where the noun
 * is deliberately not the heading.
 *
 * `column` is the first column's heading, for the half added by #174. `null`
 * means the list draws no heading row at all - the issue list is cards rather
 * than a table - and is a decision written down rather than a page that quietly
 * stopped being covered.
 */
const LISTS = [
  { file: 'WorkspaceWorkflowsPage.tsx', path: '', title: 'Workflows', unit: 'workflows', column: 'Workflow' },
  {
    file: 'ExecutionsPage.tsx',
    path: '/executions',
    title: 'Executions',
    unit: 'runs',
    column: 'Run',
    why: 'the page calls an execution a run everywhere else on it',
  },
  { file: 'WorkspaceTriggersPage.tsx', path: '/triggers', title: 'Triggers', unit: 'triggers', column: 'Name' },
  {
    file: 'WorkspaceTriggersPage.tsx',
    path: null,
    title: 'History',
    unit: 'firings',
    why: 'the second footer on the triggers page, under one trigger’s history',
  },
  { file: 'WorkspaceActionsPage.tsx', path: '/actions', title: 'Actions', unit: 'actions', column: 'Name' },
  { file: 'WorkspaceConditionsPage.tsx', path: '/conditions', title: 'Conditions', unit: 'conditions', column: 'Name' },
  {
    file: 'WorkspaceIssuesPage.tsx',
    path: '/issues',
    title: 'Issues',
    unit: 'issues',
    column: null,
    why: 'the issue list draws rows without a heading row over them',
  },
  { file: 'WorkspaceFunctionsPage.tsx', path: '/functions', title: 'Functions', unit: 'functions', column: 'Name' },
  { file: 'AgentsPage.tsx', path: '/agents', title: 'Agents', unit: 'agents', column: 'Agent' },
  { file: 'WorkspaceObjectsPage.tsx', path: '/objects', title: 'Objects', unit: 'objects', column: 'Name' },
  { file: 'WorkspaceToolsPage.tsx', path: '/tools', title: 'Tools', unit: 'tools', column: 'Name' },
  { file: 'WorkspaceTasksPage.tsx', path: '/tasks', title: 'Tasks', unit: 'tasks', column: 'Task' },
  { file: 'WorkspaceSessionsPage.tsx', path: '/sessions', title: 'Sessions', unit: 'sessions', column: 'Session' },
  {
    file: 'WorkspaceAuditPage.tsx',
    path: '/audit',
    title: 'Audit Log',
    unit: 'entries',
    column: 'Action',
    why: 'a row of an audit log is an entry, and "audit logs" would be the log itself',
  },
  {
    file: 'SessionDetailPage.tsx',
    path: null,
    title: 'Session',
    unit: 'lines',
    why: 'one session’s transcript, reached through a row of the sessions list',
  },
];

// ------------------------------------------------------- what the source says

const PAGES = 'src/pages';

/** Every .tsx under src/pages, however deep. */
function sources(from = PAGES) {
  return readdirSync(from, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(from, entry.name))
      : entry.name.endsWith('.tsx')
        ? [join(from, entry.name)]
        : [],
  );
}

/**
 * Every `<CompactPagination>` in the interface, with the noun it was handed.
 *
 * Read out of the file rather than asked of the browser because the point is
 * coverage: a call site nobody listed is one this check would otherwise pass
 * without ever looking at.
 */
const found = [];
for (const path of sources()) {
  const held = readFileSync(path, 'utf8');
  for (const block of held.split('<CompactPagination').slice(1)) {
    const unit = /unit="([^"]+)"/.exec(block.slice(0, block.indexOf('/>')))?.[1] ?? null;
    found.push({ file: path.split(/[\\/]/).pop(), unit });
  }
}

record(found.length > 0, `the interface has paginated lists to check (${found.length} call sites)`);
record(
  found.every((one) => one.unit !== null),
  `every call site names its rows: ${found.filter((one) => one.unit === null).map((one) => one.file).join(', ') || 'all of them do'}`,
);

const listed = new Set(LISTS.map((one) => `${one.file}|${one.unit}`));
const unlisted = found.filter((one) => !listed.has(`${one.file}|${one.unit}`));
record(
  unlisted.length === 0,
  unlisted.length === 0
    ? `every one of the ${found.length} call sites is a list this check knows the noun of`
    : `a paginated list this check does not know about, or one whose noun changed: ` +
      unlisted.map((one) => `${one.file} says "${one.unit}"`).join('; '),
);

/*
 * And the other way round, so the table cannot rot into a list of screens that
 * no longer exist and quietly stop covering anything.
 */
const inSource = new Set(found.map((one) => `${one.file}|${one.unit}`));
const gone = LISTS.filter((one) => !inSource.has(`${one.file}|${one.unit}`));
record(
  gone.length === 0,
  gone.length === 0
    ? 'and every list in the table is still a list in the interface'
    : `the table names lists the interface no longer has: ${gone.map((one) => `${one.file} "${one.unit}"`).join('; ')}`,
);

/*
 * The one word this whole check was written for. "templates" is a real noun in
 * this product and it belongs to the Templates page under Admin, not to any of
 * these; it is spelled out rather than left to the table so that putting it
 * back into a call site fails by name.
 */
const templated = found.filter((one) => one.unit === 'templates');
record(
  templated.length === 0,
  templated.length === 0
    ? 'no workspace list calls its rows templates, which is another page’s noun'
    : `${templated.map((one) => one.file).join(', ')} calls its rows "templates"`,
);

// ------------------------------------------------------ what the pages draw

/** The footer sentence, pulled apart. Null when the page drew no footer. */
async function footer() {
  const said = await page.evaluate(() =>
    [...document.querySelectorAll('p')].map((one) => one.innerText).find((text) => text.startsWith('Showing')) ?? null,
  );
  if (said === null) return null;
  const parts = /^Showing (\d+)-(\d+) of (\d+) ([a-z]+)/.exec(said.replace(/\s+/g, ' '));
  if (parts === null) return { said, parsed: false };
  return {
    said: said.split('\n')[0],
    parsed: true,
    first: Number(parts[1]),
    last: Number(parts[2]),
    total: Number(parts[3]),
    unit: parts[4],
  };
}

/**
 * The heading row over the list, cell by cell. Null when the page draws none.
 *
 * Found by class rather than by `<th>` because none of these are tables: every
 * one of them is a flex row carrying `styles.tableHeader`, which after the CSS
 * modules build is a class *containing* that word. The first such row on the
 * page, because the two pages here with a second table - triggers, sessions -
 * draw the list this entry is about first.
 */
async function columns() {
  return page.evaluate(() => {
    const row = document.querySelector('[class*="tableHeader"]');
    return row === null ? null : [...row.children].map((one) => one.textContent.trim());
  });
}

/** How many of the routed lists were read off a footer with rows behind it. */
let read = 0;
/** And how many were read off a heading row. */
let headed = 0;

let failed = false;
try {
  for (const list of LISTS.filter((one) => one.path !== null)) {
    const where = `${BASE}/workspace/${WORKSPACE}${list.path}`;
    await page.goto(where, { waitUntil: 'domcontentloaded' });
    if (!(await drawn(page, `${list.title} (${where})`))) continue;
    await page.waitForSelector('text=Showing', { timeout: 20_000 }).catch(() => {});

    const heading = (await page.locator('h1').first().innerText().catch(() => '')).trim();
    record(heading === list.title, `${list.path || '/'} is the ${list.title} page (its heading says "${heading}")`);

    /*
     * The row over the list, which is where #174 found the same wrong noun the
     * footer half was written for. Read before the footer because a page whose
     * columns are wrong is worth saying so about even if its list is empty.
     */
    const heads = await columns();
    if (list.column === null) {
      record(
        heads === null,
        `${list.title} draws no heading row over its rows${list.why === undefined ? '' : ` (${list.why})`}` +
          `${heads === null ? '' : ` - but it drew one: ${heads.join(' | ')}`}`,
      );
    } else if (record(heads !== null, `${list.title} draws a heading row over its rows`)) {
      headed += 1;
      record(
        heads[0] === list.column,
        `${list.title}: its first column is headed "${list.column}" - it says "${heads[0]}"`,
      );
      /*
       * The word this whole check was written for, at the other end of the
       * table. A template is a published copy of a component and lives on the
       * Templates page under Admin; no column of any of these lists is one.
       */
      const templated = heads.filter((one) => /template/i.test(one));
      record(
        templated.length === 0,
        templated.length === 0
          ? `${list.title}: and no column is headed with another page's noun (${heads.join(' | ')})`
          : `${list.title}: a column is headed "${templated.join('", "')}" over rows that are ${list.unit}`,
      );
    }

    const said = await footer();

    /*
     * Some of these hide the footer when the list is empty - there is no range
     * to say and no total worth printing - so an empty list is not a failure
     * here. It is not a silent pass either: the page has to say it is empty in
     * its own words, and the tally at the bottom refuses to call the whole
     * check green off a workspace where nothing exists to read.
     */
    if (said === null) {
      const held = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
      const empty = /No [a-z' ]+ yet|nothing here yet|matches that/i.exec(held)?.[0] ?? null;
      record(
        empty !== null,
        empty !== null
          ? `${list.title} draws no footer because the list is empty, and says so ("${empty}")`
          : `${list.title} drew neither the shared footer nor an empty list: ${JSON.stringify(held.slice(0, 200))}`,
      );
      continue;
    }
    read += 1;
    record(true, `${list.title} draws the shared footer`);
    if (!record(said.parsed, `${list.title}: the footer is the sentence it has always been: "${said.said}"`)) continue;

    record(
      said.unit === list.unit,
      `${list.title} calls its rows "${list.unit}"${list.why === undefined ? '' : ` (${list.why})`} - it said "${said.unit}"`,
    );

    // The size control, where there is one, takes the same word.
    const sized = page.locator(`select[aria-label^="How many"]`);
    if ((await sized.count()) > 0) {
      const asked = await sized.first().getAttribute('aria-label');
      record(
        asked === `How many ${list.unit} to show at once`,
        `${list.title}: the size control beside it uses the same word ("${asked}")`,
      );
    }

    /*
     * The count, said without knowing anything about this page's query: the
     * range is a fact about the page and the total is a fact about the list,
     * so turning the page has to move one and leave the other alone. A footer
     * counting the rows in front of it fails here on every list long enough to
     * have a second page - and where there is no second page, the arithmetic
     * below is still checked, which is all that can honestly be said.
     */
    record(
      said.first <= said.last + 1 && said.last <= said.total,
      `${list.title}: the range is inside the total ("${said.said}")`,
    );

    const next = page.locator('button:has-text("Next")').first();
    if ((await next.count()) > 0 && (await next.isEnabled())) {
      await next.click();
      await page.waitForTimeout(900);
      const two = await footer();
      if (record(two !== null && two.parsed, `${list.title}: page two still draws the footer`)) {
        record(
          two.total === said.total,
          `${list.title}: the total is the list, not the page - it stayed at ${said.total} on page two (${two.total})`,
        );
        record(
          two.first > said.first,
          `${list.title}: and the range moved with the page (${said.first}- -> ${two.first}-)`,
        );
        record(
          two.unit === said.unit,
          `${list.title}: and the noun did not change with the page ("${two.unit}")`,
        );
      }
    }
  }

  /*
   * The guard on the whole browser half. Every assertion above is inside a loop
   * that an empty workspace walks straight through, so without this a database
   * with nothing in it reports the same "ALL PASS" as one where every footer
   * was read. Ten of the twelve routed lists, because the two smallest here -
   * sessions and objects - are the ones a fresh workspace plausibly has none
   * of, and demanding all twelve would make the check a fixture problem rather
   * than a footer one.
   */
  const routed = LISTS.filter((one) => one.path !== null).length;
  record(read >= routed - 2, `enough lists had rows to read a footer off (${read} of ${routed})`);

  /*
   * The same guard for the half added by #174, and a stricter one: a heading
   * row is drawn whether or not the list under it has anything in it, so every
   * list the table says has one must have produced one. Without this the
   * column assertions are inside the same loop an unreachable workspace walks
   * straight through.
   */
  const withColumns = LISTS.filter((one) => one.path !== null && one.column !== null).length;
  record(
    headed === withColumns,
    `every list that has a heading row drew one (${headed} of ${withColumns})`,
  );

  await page.screenshot({ path: shot('pagination-footer-check.png'), fullPage: false });
} catch (cause) {
  failed = true;
  console.error(`FAIL: the check threw: ${cause instanceof Error ? cause.stack : String(cause)}`);
}

await finish(browser, !failed);
