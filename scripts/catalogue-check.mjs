/**
 * The Polish catalogue and the source it is keyed on, held together.
 *
 * ---------------------------------------------------------------------------
 * What this is for
 *
 * The interface is translated by keying on the English sentence: the source
 * still says `t('Add Connection')`, and `src/i18n/pl.ts` maps that sentence to
 * the Polish one. `src/i18n/index.ts` says why - chiefly that a made-up key
 * would have blinded `hint-prose-check` to every sentence in the product, and
 * that `git grep "Add Connection"` is how anybody finds the screen a report is
 * about.
 *
 * The one thing that arrangement costs is this: rewording an English string
 * orphans its entry. Nothing breaks - `t` falls back to what it was handed, so
 * the screen shows correct English - but the Polish silently stops appearing,
 * which is exactly the kind of rot nobody notices for a release. So the
 * orphaned entry is a failure here rather than a screen with one English line
 * on it.
 *
 * The other direction is reported and not failed. A call site with no
 * translation is the ordinary state of a language being worked on, and failing
 * on it would mean no string could ever be added to the interface without
 * somebody who speaks Polish in the same commit. The count is printed so it
 * cannot quietly grow.
 *
 * ---------------------------------------------------------------------------
 * The refusals
 *
 * `src/i18n/refusals.ts` is keyed on what the server sends in
 * `extensions.code`, and its sentences carry `{name}` placeholders filled from
 * `extensions.arguments`. This checks what it can see from here: that every
 * entry is a plausible code and that its placeholders are named rather than
 * numbered. Whether a code is declared by exactly one exception class is the
 * server's to check - the Kotlin is not mounted in this container - and
 * `RefusedErrorTest` is where that lives.
 *
 * Reads the source and starts no browser: `needs: 'nothing'`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

let ok = true;
const fail = (said) => {
  ok = false;
  console.log(`FAIL: ${said}`);
};
const pass = (said) => console.log(`PASS: ${said}`);

/** Every .ts and .tsx under src, except the catalogue itself. */
function sources(from = join(ROOT, 'src')) {
  const found = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const path = join(from, entry.name);
    if (entry.isDirectory()) {
      // The catalogue and the notes beside it quote strings they do not print.
      if (entry.name === 'i18n') continue;
      found.push(...sources(path));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The strings `t()` is called with, out of the source.
 *
 * A quoted literal, either way round: the transform kept whichever quotes the
 * call site already had, so an attribute's double quotes survived beside a text
 * node's single ones. A call on a variable is not a string this catalogue could
 * ever hold, so it is not one to complain about either.
 */
const CALL = /\bt\(\s*(['"])((?:[^'"\\]|\\.)*)\1/g;

const called = new Map();
for (const path of sources()) {
  const src = readFileSync(path, 'utf8');
  let at;
  while ((at = CALL.exec(src)) !== null) {
    const says = at[2].replace(/\\(['"\\])/g, '$1');
    called.set(says, (called.get(says) ?? 0) + 1);
  }
}

/** The catalogue's keys, read as source rather than imported: this is not TypeScript. */
function keysOf(file, after) {
  const src = readFileSync(join(ROOT, 'src', 'i18n', file), 'utf8');
  const body = src.slice(src.indexOf(after));
  const keys = [];
  const line = /^\s{2}(?:"((?:[^"\\]|\\.)*)"|([A-Za-z][A-Za-z0-9]*)):/gm;
  let at;
  while ((at = line.exec(body)) !== null) {
    keys.push((at[1] ?? at[2]).replace(/\\(["\\])/g, '$1'));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// The interface catalogue

const keys = keysOf('pl.ts', 'export const PL');

if (keys.length === 0) fail('the Polish catalogue could not be read at all');
else pass(`the Polish catalogue holds ${keys.length} entries`);

const orphans = keys.filter((key) => !called.has(key));
if (orphans.length > 0) {
  fail(`${orphans.length} catalogue entries are keyed on English no longer in the source:`);
  for (const one of orphans.slice(0, 20)) console.log(`        ${JSON.stringify(one)}`);
  if (orphans.length > 20) console.log(`        … and ${orphans.length - 20} more`);
  console.log('        Reword the key to match the source, or take the entry out.');
} else {
  pass('every catalogue entry is keyed on English the interface still prints');
}

const duplicates = keys.filter((key, i) => keys.indexOf(key) !== i);
if (duplicates.length > 0) {
  fail(`${duplicates.length} keys appear twice; the later one silently wins:`);
  for (const one of duplicates) console.log(`        ${JSON.stringify(one)}`);
} else {
  pass('no key is written twice');
}

const untranslated = [...called.keys()].filter((says) => !keys.includes(says));
console.log(
  `NOTE: ${called.size} strings are wrapped for translation at ${[...called.values()].reduce(
    (a, b) => a + b,
    0,
  )} call sites; ${untranslated.length} have no Polish yet and read as English.`,
);

// ---------------------------------------------------------------------------
// The server's refusals

const refusals = readFileSync(join(ROOT, 'src', 'i18n', 'refusals.ts'), 'utf8');
const codes = keysOf('refusals.ts', 'const PL: Record<string, string>');

if (codes.length === 0) fail('the refusal catalogue could not be read at all');
else pass(`the refusal catalogue holds ${codes.length} codes`);

/*
 * A code is an exception's class name with `Exception` dropped, so it is
 * PascalCase and it never still ends in `Exception` - which is the mistake
 * somebody copying a name out of the Kotlin would make.
 */
const misshapen = codes.filter((code) => !/^[A-Z][A-Za-z0-9]*$/.test(code) || code.endsWith('Exception'));
if (misshapen.length > 0) {
  fail(`${misshapen.length} refusal codes are not the shape the server sends:`);
  for (const one of misshapen) console.log(`        ${one}`);
} else {
  pass('every refusal code is the shape the server sends');
}

/*
 * The codes two exception classes answer to.
 *
 * A code is the exception's class name with `Exception` dropped, which is
 * unambiguous until two classes are given the same name - and seven are, `app`
 * and a module each declaring their own. Two of those pairs do not say the same
 * thing, so translating on the code alone would show the wrong sentence.
 *
 * The list is written twice on purpose: the server's `RefusedErrorTest` reads
 * the Kotlin and fails if it grows, and this copy fails if one of them is ever
 * translated. Neither half can read the other - the Kotlin is not mounted in
 * this container and the submodule is not checked out in the server's CI job -
 * and two guards that each fail loudly is a better answer than one guard that
 * cannot run.
 */
const AMBIGUOUS = [
  'ConnectionNotFound',
  'ExecutionNotFound',
  'McpServerNotFound',
  'ModelNotFound',
  'ModelProviderNotFound',
  'WorkflowGraphEmpty',
  'WorkflowNotFound',
];

const ambiguous = codes.filter((code) => AMBIGUOUS.includes(code));
if (ambiguous.length > 0) {
  fail(`${ambiguous.length} translated codes are answered to by two different exceptions:`);
  for (const one of ambiguous) console.log(`        ${one}`);
  console.log('        Two classes carry that name and do not say the same thing; leave it in English.');
} else {
  pass('no translated code is one two exception classes answer to');
}

/* `{0}` would be a positional placeholder, which the arguments map has nothing for. */
const numbered = [...refusals.matchAll(/\{(\d+)\}/g)];
if (numbered.length > 0) {
  fail(`${numbered.length} refusal sentences use a numbered placeholder; arguments are by name`);
} else {
  pass('every placeholder in a refusal is named, not numbered');
}

console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
