/**
 * What the editor says `imports.f(...)` hands back.
 *
 * Every function is stored as `export default async function`, and an imported
 * one is called directly - the harness that settles a promise wraps the function
 * a node runs, not the ones it reaches through `imports`. So `imports.f(1)` is a
 * promise, and it was annotated as the bare return type: the editor neither
 * offered `await` nor minded its absence, and `const x = imports.f(1)` compiled
 * clean and then handed somebody a promise at run time. Type-checking and then
 * behaving differently is worse than either on its own, which is why this is
 * pinned rather than left to a comment.
 *
 * ---------------------------------------------------------------------------
 * Why this one drives no browser
 *
 * `importTypes` is a pure function - imports in, a declaration file out - and
 * the thing worth asserting about its answer is what TypeScript makes of it.
 * Driving the editor to find that out would put a browser, a server and a seeded
 * workspace between the question and the answer, and would still be reading the
 * same compiler's verdict at the end of it. So the compiler is asked directly,
 * with the options `components/monaco.ts` sets on the editor, and the answer is
 * the same one a hover would have shown.
 *
 * Two halves, and both matter. The first reads the declaration `importTypes`
 * writes. The second compiles a call against it, twice - with `await` and
 * without - because an annotation that merely mentions `Promise` is not the
 * claim being made. The claim is that forgetting `await` is now an error.
 *
 *   docker compose run --rm --no-deps dev node scripts/import-await-check.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

const results = [];
function record(ok, what) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`);
  return ok;
}

/* ------------------------------------------------------ the function itself */

/**
 * The editor, left out of the bundle.
 *
 * `importTypes` reaches `tsType` in `api/functions.ts`, which reaches
 * `api/libraries.ts`, which imports `components/monaco.ts` for its `compile` -
 * so bundling the one pure function drags the whole editor in, and the editor
 * wants a browser. Nothing here compiles anything with Monaco, so the module is
 * replaced by one that says so if it is ever called.
 */
const withoutMonaco = {
  name: 'without-monaco',
  // Before Vite resolves it to a path of its own, which is what an id ending in
  // `components/monaco` still looks like and a resolved absolute one does not.
  enforce: 'pre',
  resolveId(id) {
    return /components\/monaco(\.ts)?$/.test(id) || id === 'monaco-editor' ? '\0no-monaco' : null;
  },
  load(id) {
    return id === '\0no-monaco' ? 'export const compile = () => { throw new Error("no editor here"); };' : null;
  },
};

const built = await build({
  root: ROOT,
  logLevel: 'silent',
  configFile: false,
  plugins: [withoutMonaco],
  build: {
    write: false,
    minify: false,
    lib: { entry: 'src/components/importTypes.ts', formats: ['es'], fileName: 'importTypes' },
  },
});
const bundle = Array.isArray(built) ? built[0] : built;
const source = bundle.output[0].code;
const { importTypes } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

/* ---------------------------------------------------- what it writes */

/** One import, as the server describes it: a signature without the externals. */
const imported = (name, returnType, signature) => ({
  functionId: '1',
  name,
  function: { name: 'toUpper', description: 'Shouts a word', signature, returnType, returnObjectName: null },
});

const declaration = importTypes([imported('upper', 'STRING', '(word: string)')], []);
record(
  declaration.includes('upper: (word: string) => Promise<string>;'),
  `an imported function is annotated as a promise, not as its bare return type: ${JSON.stringify(
    declaration.split('\n').find((line) => line.includes('upper:'))?.trim() ?? declaration,
  )}`,
);

const nothing = importTypes([imported('touch', 'NONE', '()')], []);
record(
  nothing.includes('touch: () => Promise<void>;'),
  'a function that returns nothing is a promise of nothing, not nothing',
);

/* -------------------------------------------- what TypeScript makes of it */

const dir = mkdtempSync(join(tmpdir(), 'orknux-imports-'));
writeFileSync(join(dir, 'imports.ts'), declaration);
writeFileSync(
  join(dir, 'tsconfig.json'),
  /*
   * The options `components/monaco.ts` gives the editor, so the verdict here is
   * the verdict a hover would have shown. Its `moduleResolution` is not among
   * them: neither file imports anything, and the setting the editor names has
   * since been removed from the compiler this runs.
   */
  JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    files: ['imports.ts', 'use.ts'],
  }),
);

/** What the compiler said about one call, or null when it said nothing. */
function complaint(code) {
  writeFileSync(join(dir, 'use.ts'), `${code}\nexport { shouted };\n`);
  try {
    execFileSync(process.execPath, [TSC, '-p', dir], { stdio: 'pipe' });
    return null;
  } catch (refused) {
    return `${refused.stdout ?? ''}${refused.stderr ?? ''}`.trim();
  }
}

const awaited = complaint("const shouted: string = await imports.upper('hi');");
record(awaited === null, `an awaited call type-checks${awaited === null ? '' : `: ${awaited}`}`);

const bare = complaint("const shouted: string = imports.upper('hi');");
record(
  bare !== null && bare.includes('Promise'),
  `a call without await is an error that names the promise: ${JSON.stringify(bare ?? 'it compiled')}`,
);

/* ------------------------------------------------------------------ verdict */

const passed = results.every(Boolean);
console.log(
  passed
    ? `ALL PASS (${results.length} assertions, no browser)`
    : `FAILED (${results.filter((one) => !one).length} of ${results.length}, no browser)`,
);
process.exit(passed ? 0 : 1);
