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
 */
const LISTS = [
  { file: 'WorkspaceWorkflowsPage.tsx', path: '', title: 'Workflows', unit: 'workflows' },
  {
    file: 'ExecutionsPage.tsx',
    path: '/executions',
    title: 'Executions',
    unit: 'runs',
    why: 'the page calls an execution a run everywhere else on it',
  },
  { file: 'WorkspaceTriggersPage.tsx', path: '/triggers', title: 'Triggers', unit: 'triggers' },
  {
    file: 'WorkspaceTriggersPage.tsx',
    path: null,
    title: 'History',
    unit: 'firings',
    why: 'the second footer on the triggers page, under one trigger’s history',
  },
  { file: 'WorkspaceActionsPage.tsx', path: '/actions', title: 'Actions', unit: 'actions' },
  { file: 'WorkspaceConditionsPage.tsx', path: '/conditions', title: 'Conditions', unit: 'conditions' },
  { file: 'WorkspaceIssuesPage.tsx', path: '/issues', title: 'Issues', unit: 'issues' },
  { file: 'WorkspaceFunctionsPage.tsx', path: '/functions', title: 'Functions', unit: 'functions' },
  { file: 'AgentsPage.tsx', path: '/agents', title: 'Agents', unit: 'agents' },
  { file: 'WorkspaceObjectsPage.tsx', path: '/objects', title: 'Objects', unit: 'objects' },
  { file: 'WorkspaceToolsPage.tsx', path: '/tools', title: 'Tools', unit: 'tools' },
  { file: 'WorkspaceSessionsPage.tsx', path: '/sessions', title: 'Sessions', unit: 'sessions' },
  {
    file: 'WorkspaceAuditPage.tsx',
    path: '/audit',
    title: 'Audit Log',
    unit: 'entries',
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

/** How many of the routed lists were read off a footer with rows behind it. */
let read = 0;

let failed = false;
try {
  for (const list of LISTS.filter((one) => one.path !== null)) {
    const where = `${BASE}/workspace/${WORKSPACE}${list.path}`;
    await page.goto(where, { waitUntil: 'domcontentloaded' });
    if (!(await drawn(page, `${list.title} (${where})`))) continue;
    await page.waitForSelector('text=Showing', { timeout: 20_000 }).catch(() => {});

    const heading = (await page.locator('h1').first().innerText().catch(() => '')).trim();
    record(heading === list.title, `${list.path || '/'} is the ${list.title} page (its heading says "${heading}")`);

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

  await page.screenshot({ path: shot('pagination-footer-check.png'), fullPage: false });
} catch (cause) {
  failed = true;
  console.error(`FAIL: the check threw: ${cause instanceof Error ? cause.stack : String(cause)}`);
}

await finish(browser, !failed);
