/**
 * Runs every check in scripts/suite/suite.mjs and exits non-zero if any failed.
 *
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --only turn-check,bend-check
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --needs workflow
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --ci
 *
 * Each check is a process of its own rather than a function called in this one.
 * That is deliberate and it is what makes the timeout below mean anything: a
 * check that hangs waiting for a selector that will never appear is killed and
 * reported, and the ones after it still run. In one process the first hang ends
 * the suite and everything behind it is simply unknown.
 *
 * Output is collected rather than streamed, so a passing check prints one line
 * and a failing one prints one line and then everything it said. The whole
 * point of a suite is that a green run is short enough to read.
 *
 * The JUnit file at the end is for the same reason the server's suite writes
 * one: GitHub renders it, and "SOME FAILED" in a log twelve thousand lines down
 * is not a report.
 *
 * ---------------------------------------------------------------------------
 * Before blaming the product for a check that timed out
 *
 * Against the development server these checks speak to vite on 5173, which
 * proxies /graphql and /api through to the server on 8080. That proxy stalls.
 * Measured while a full run was going, the same trivial query sent alternately
 * both ways from one process, 1567 times each:
 *
 *   through vite  : median 30ms, p99 1145ms, max 35.8s, 3 unanswered in 45s
 *   straight at it: median 17ms, p99   25ms, max  1.9s, none over 2s
 *
 * So a few requests in a thousand hang for half a minute, and none of them are
 * the server's doing - the two figures come from requests interleaved a fifth
 * of a second apart. What that looks like from inside a check is a
 * `page.waitForSelector` that never resolves, an `apiRequestContext.post:
 * Timeout 30000ms exceeded`, or a screen reported as having drawn nothing -
 * which is exactly what a real defect looks like too. Several of this session's
 * failures were that and nothing else.
 *
 * How to tell them apart, in this order:
 *
 *   1. Run the one check again, alone, on a quiet machine. A defect repeats;
 *      a stall does not. Three times is enough to be sure.
 *   2. Look at what failed. A stall reads as a thirty-second timeout on a
 *      request that ordinarily takes thirty milliseconds, or as a page that
 *      drew nothing at all. A defect usually names something specific that was
 *      on the screen and should not have been, or the other way round.
 *
 * Not something a check can be written around: every one of them speaks to one
 * origin, and in development that origin is the proxy. CI serves both halves
 * from the all-in-one image and has no proxy in the way, which is why this is
 * a development-machine problem and not a CI one.
 * ---------------------------------------------------------------------------
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TESTS, inCi } from './suite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..');
const ROOT = resolve(SCRIPTS, '..');

/*
 * Long, and on purpose. These are end-to-end checks against a real server: one
 * of them waits two minutes for a model and several deliberately hold the API
 * back to watch a loading mark appear. The number exists to catch a hang, not
 * to enforce a budget - a check killed at four minutes has hung.
 */
const TIMEOUT = Number(process.env.ORKNUX_SUITE_TIMEOUT ?? 240_000);

const RESULTS = process.env.ORKNUX_SUITE_RESULTS ?? resolve(SCRIPTS, 'suite/results');

/* ------------------------------------------------------------------ choosing */

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? '');
};

let chosen = TESTS;
if (argv.includes('--ci')) chosen = chosen.filter(inCi);

const only = flag('--only');
if (only !== null) {
  const wanted = new Set(only.split(',').map((name) => name.trim().replace(/\.mjs$/, '')));
  const unknown = [...wanted].filter((name) => !TESTS.some((test) => test.name === name));
  if (unknown.length > 0) {
    console.error(`No such check: ${unknown.join(', ')}`);
    console.error(`There is: ${TESTS.map((test) => test.name).join(', ')}`);
    process.exit(2);
  }
  chosen = chosen.filter((test) => wanted.has(test.name));
}

const needs = flag('--needs');
if (needs !== null) {
  const wanted = new Set(needs.split(',').map((name) => name.trim()));
  chosen = chosen.filter((test) => test.needs.some((need) => wanted.has(need)));
}

if (argv.includes('--list')) {
  for (const test of chosen) {
    const held = inCi(test) ? '' : '[not in CI] ';
    console.log(`${test.name.padEnd(26)} ${test.needs.join(',').padEnd(12)} ${held}${test.what}`);
  }
  process.exit(0);
}

if (chosen.length === 0) {
  console.error('Nothing to run.');
  process.exit(2);
}

/* ------------------------------------------------------------------- running */

/** One check, as a child process, with its output kept and a timeout on it. */
function run(test) {
  return new Promise((done) => {
    const began = Date.now();
    /*
     * Its own process group, which is what makes the timeout below work. A
     * check is a node process that has launched a chromium, and killing only
     * the node leaves the browser running and holding the pipes open - so the
     * runner goes on waiting for output from a process it has already killed.
     * The group is killed instead, and the browser goes with it.
     */
    const child = spawn(process.execPath, [`scripts/${test.name}.mjs`], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    // Killed rather than waited on. SIGKILL because a chromium that is not
    // answering will not answer a polite signal either.
    const alarm = setTimeout(() => {
      child.kill('SIGKILL');
      output += `\n--- killed after ${TIMEOUT / 1000}s ---\n`;
    }, TIMEOUT);

    child.on('error', (problem) => {
      clearTimeout(alarm);
      done({ test, code: 127, output: `${output}\n${problem.message}`, took: Date.now() - began });
    });

    child.on('exit', (code, signal) => {
      clearTimeout(alarm);
      if (signal !== null) output += `
--- ended by ${signal} ---
`;
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Already gone, which is the ordinary case.
        }
        done({ test, code: code ?? 1, output, took: Date.now() - began });
      }, 250);
    });
  });
}

console.log(`${chosen.length} checks against ${process.env.ORKNUX_UI_URL ?? 'http://localhost:5173'}\n`);

const done = [];
for (const test of chosen) {
  const result = await run(test);
  done.push(result);
  const seconds = `${(result.took / 1000).toFixed(1)}s`;
  const verdict = result.code === 0 ? 'PASS' : 'FAIL';
  console.log(`${verdict}  ${test.name.padEnd(26)} ${seconds.padStart(7)}  ${test.what}`);
  if (result.code !== 0) {
    console.log(
      result.output
        .split('\n')
        .map((line) => `      | ${line}`)
        .join('\n'),
    );
  }
}

/* ---------------------------------------------------------------- the report */

const failed = done.filter((result) => result.code !== 0);

/*
 * XML 1.0 cannot carry most control characters at all - not even escaped - and
 * playwright's error output is full of the escape that starts a colour code. A
 * report that fails to parse is a report nobody sees, so they are dropped here
 * rather than passed through.
 */
const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const seconds = (ms) => (ms / 1000).toFixed(3);

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<testsuite name="orknux-ui" tests="${done.length}" failures="${failed.length}" time="${seconds(
    done.reduce((sum, result) => sum + result.took, 0),
  )}">`,
  ...done.map((result) => {
    const open = `  <testcase classname="orknux-ui.suite" name="${escape(result.test.name)}" time="${seconds(result.took)}">`;
    if (result.code === 0) return `${open}</testcase>`;
    return [
      open,
      `    <failure message="${escape(result.test.what)}">${escape(result.output)}</failure>`,
      '  </testcase>',
    ].join('\n');
  }),
  '</testsuite>',
  '',
].join('\n');

mkdirSync(RESULTS, { recursive: true });
writeFileSync(resolve(RESULTS, 'junit.xml'), xml);

console.log(`\n${done.length - failed.length} of ${done.length} passed.`);
if (failed.length > 0) console.log(`Failed: ${failed.map((result) => result.test.name).join(', ')}`);
console.log(`Report: ${resolve(RESULTS, 'junit.xml')}`);

process.exit(failed.length > 0 ? 1 : 0);
