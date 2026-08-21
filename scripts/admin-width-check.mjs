/**
 * Every admin page fills the column it was given, and none of them caps it.
 *
 * The report: the user editor drew itself in a 640px card pinned to the left of
 * a 1920px screen, while every other page under Admin ran the full width. The
 * owner's words were "inconsistent user editor panel width with other pages",
 * and the important half of that sentence is the last three words - one page had
 * drifted, and fixing that one page by eye would only have moved the
 * inconsistency somewhere else.
 *
 * Measured before anything was changed, at 1440 and at 1920: eighteen admin
 * addresses drawn, sixteen filling the content column exactly and two addresses
 * of the one component - `/admin/users/new` and `/admin/users/:userId` -
 * stopping at 640px. The cap was a single declaration in
 * `AdminUserPage.module.css`. So there was never a "form pages are narrower"
 * convention to honour: the other admin forms - a shell, a template, a
 * workspace's settings, the installation's settings - all fill, and the fields
 * on them that are genuinely narrow say so one field at a time (`.fieldNarrow`
 * on the shell page is `flex: 0 0 120px`, because a port is five characters
 * wide). That is where narrowness belongs. A whole panel capped is a different
 * statement, and it was being made in one file only.
 *
 * ---------------------------------------------------------------------------
 * Where the width comes from, and why this check is about the absence of a rule
 *
 * There is no shared page-container class, and there should not be one: the
 * container is already shared. `AppShell` draws the `<main>` every page is
 * handed - the column beside the sidebar, its padding, its clearance at the
 * bottom - and a page's own blocks are `width: 100%` inside it. A second
 * wrapper carrying a max-width would be a second place to decide the width,
 * which is the thing that just went wrong.
 *
 * So what is worth checking is not "every page uses the shared class" but the
 * rule that shared container implies: *a page does not cap the column it was
 * given.* Anything narrower is stated inside the page, on the field or the
 * paragraph that wants it - the subtitles capped at 70ch are right, and
 * untouched here, because a line of prose 1600px long is unreadable while a
 * text field 1600px long is merely large.
 *
 * This is read out of the source rather than off a browser on purpose. A
 * measurement can only see the pages that rendered, and half of these need a
 * fixture to render at all - there was no template in the database this was
 * measured against, so `/admin/templates/:templateId` was never drawn. Read out
 * of `src/`, every page is covered whether or not anything exists to put in it,
 * and the check needs no server.
 * ---------------------------------------------------------------------------
 *
 * What it does:
 *
 *   - walks `navigation.ts` for the admin paths, so a page added there is
 *     covered without anybody remembering to add it here;
 *   - follows each through `routes.tsx` to the file that draws it;
 *   - finds the blocks that page puts directly inside `<AppShell>` - its top
 *     level, the things that occupy the column;
 *   - and fails if any of their classes carries a `max-width`, or if the
 *     element carries an inline one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';

/** Everything recorded, so the exit code is the whole of it. */
const results = [];
function record(ok, message) {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
  return Boolean(ok);
}

// ---------------------------------------- the admin paths, from the registry

/**
 * Every path the registry marks `access: 'admin'`.
 *
 * Split on the `path:` key rather than parsed as TypeScript: each entry runs
 * from its own `path:` to the next one, which is enough to read the two fields
 * this needs off it.
 */
function adminPaths() {
  const source = readFileSync(join(SRC, 'navigation.ts'), 'utf8');
  const start = source.indexOf('export const PAGES = [');
  const end = source.indexOf('] as const satisfies');
  if (start === -1 || end === -1) throw new Error('navigation.ts no longer holds a PAGES array this can read');

  return source
    .slice(start, end)
    .split(/\bpath: '/)
    .slice(1)
    .map((chunk) => {
      const path = chunk.slice(0, chunk.indexOf("'"));
      const rest = chunk.slice(chunk.indexOf("'") + 1);
      const next = rest.search(/\bpath: '/);
      return { path, entry: next === -1 ? rest : rest.slice(0, next) };
    })
    .filter((one) => /access: 'admin'/.test(one.entry))
    .map((one) => one.path);
}

// ---------------------------------------- a path, and the file that draws it

/** Component name to the file it is imported from, for every import in routes.tsx. */
function importedFiles(source) {
  const files = new Map();
  for (const [, names, from] of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
    for (const name of names.split(',')) {
      // `X as Y`: the name used further down the file is Y.
      const used = name.includes(' as ') ? name.split(' as ')[1] : name;
      files.set(used.trim(), `${join(SRC, from.replace(/^\.\//, ''))}.tsx`);
    }
  }
  return files;
}

/** Which component each route renders, read off the record in routes.tsx. */
function routedComponents(source) {
  const rendered = new Map();
  for (const [, path, component] of source.matchAll(/'(\/[^']*)':\s*\([^)]*\)\s*=>\s*\(?\s*<([A-Z]\w+)/g)) {
    rendered.set(path, component);
  }
  return rendered;
}

const routes = readFileSync(join(SRC, 'routes.tsx'), 'utf8');
const files = importedFiles(routes);
const components = routedComponents(routes);

const paths = adminPaths();
record(paths.length > 0, `the registry has admin pages to check (${paths.length} paths)`);

/** Each page file, and the admin paths that reach it. */
const pages = new Map();
const unrouted = [];
for (const path of paths) {
  const component = components.get(path);
  const file = component === undefined ? undefined : files.get(component);
  if (file === undefined) {
    unrouted.push(path);
    continue;
  }
  pages.set(file, [...(pages.get(file) ?? []), path]);
}

record(
  unrouted.length === 0,
  unrouted.length === 0
    ? `every admin path in the registry reaches a page file (${pages.size} files)`
    : `an admin path this check could not follow to a file: ${unrouted.join(', ')}`,
);

// ---------------------------------------- what a page puts in the column

/**
 * Where the tag that starts at [from] ends, and whether it closed itself.
 *
 * Brace-aware, because a prop can hold a whole element -
 * `sidebar={<AdminSidebar active="users" />}` - and the `>` inside it does not
 * end the tag it is written on.
 */
function tagEnd(text, from) {
  let braces = 0;
  let quote = null;
  for (let at = from; at < text.length; at += 1) {
    const character = text[at];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') quote = character;
    else if (character === '{') braces += 1;
    else if (character === '}') braces -= 1;
    else if (character === '>' && braces === 0) return { at, selfClosing: text[at - 1] === '/' };
  }
  return { at: text.length, selfClosing: true };
}

/**
 * The elements a page writes directly inside `<AppShell>`: its top level.
 *
 * A scanner rather than a parse. It tracks how deep in the tree it is and keeps
 * the opening tags it meets at depth zero, skipping comments, which are the one
 * thing between tags that can hold a stray `<`.
 */
function topLevelBlocks(source) {
  const blocks = [];

  for (const opened of [...source.matchAll(/<AppShell[\s>]/g)]) {
    const shell = tagEnd(source, opened.index);
    if (shell.selfClosing) continue;

    let depth = 0;
    let at = shell.at + 1;
    while (at < source.length) {
      if (source.startsWith('{/*', at)) {
        const shut = source.indexOf('*/}', at);
        at = shut === -1 ? source.length : shut + 3;
        continue;
      }
      const next = source.indexOf('<', at);
      if (next === -1) break;

      if (source.startsWith('</', next)) {
        if (depth === 0) break; // </AppShell>, and the page is read.
        depth -= 1;
        at = source.indexOf('>', next) + 1;
        continue;
      }

      const tag = tagEnd(source, next);
      const written = source.slice(next, tag.at + 1);
      if (depth === 0) blocks.push(written);
      if (!tag.selfClosing) depth += 1;
      at = tag.at + 1;
    }
  }

  return blocks;
}

/** Every `styles.x` named in an element's className. */
function classesOf(tag) {
  const named = /className=(\{[\s\S]*?\}|"[^"]*")/.exec(tag);
  if (named === null) return [];
  return [...named[1].matchAll(/styles\.(\w+)/g)].map((one) => one[1]);
}

// ---------------------------------------- what those classes declare

/** Every declaration block written for `.name`, selector lists included. */
function rulesFor(css, name) {
  const found = [];
  const wanted = new RegExp(`\\.${name}(?![\\w-])`);
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(',').some((one) => wanted.test(one.trim()))) found.push(match[2]);
  }
  return found;
}

let capped = 0;
let examined = 0;

for (const [file, reached] of [...pages].sort()) {
  const source = readFileSync(file, 'utf8');
  const css = readFileSync(file.replace(/\.tsx$/, '.module.css'), 'utf8');
  const shown = file.split(/[\\/]/).pop();

  const blocks = topLevelBlocks(source);
  if (!record(blocks.length > 0, `${shown} puts something in the column (${blocks.length} top-level blocks)`)) continue;
  examined += 1;

  const inline = blocks.filter((tag) => /style=\{\{[^}]*maxWidth/.test(tag));
  if (inline.length > 0) capped += 1;
  record(
    inline.length === 0,
    inline.length === 0
      ? `${shown}: no top-level block caps itself with an inline maxWidth`
      : `${shown}: a top-level block caps itself with an inline maxWidth`,
  );

  const names = [...new Set(blocks.flatMap(classesOf))];
  const offenders = names.flatMap((name) => {
    const declared = rulesFor(css, name)
      .flatMap((body) => [...body.matchAll(/(?:^|;)\s*max-width\s*:\s*([^;]+)/g)])
      .map((one) => one[1].trim());
    return declared.length === 0 ? [] : [`.${name} (max-width: ${declared.join(', ')})`];
  });

  if (offenders.length > 0) capped += 1;
  record(
    offenders.length === 0,
    offenders.length === 0
      ? `${shown} leaves the column alone: ${names.map((one) => `.${one}`).join(', ')} — ${reached.join(', ')}`
      : `${shown} caps the column it was given: ${offenders.join('; ')} — a page under Admin fills the width, and anything narrower is said on the field or the paragraph that wants it, not on the panel around them`,
  );
}

record(examined >= 10, `enough admin pages were read for this to mean anything (${examined})`);
record(
  capped === 0,
  capped === 0 ? 'no admin page caps the content column' : `${capped} admin page(s) cap the content column`,
);

const failed = results.filter((one) => !one).length;
console.log(failed === 0 ? `\nALL PASS (${results.length})` : `\n${failed} of ${results.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
