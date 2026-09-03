/**
 * Runs every check in scripts/suite/suite.mjs and exits non-zero if any failed.
 *
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --only turn-check,bend-check
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --needs workflow
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --ci
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --fail-fast
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --in-order
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --any-workspace
 *   docker exec orknux-ui-dev-1 node scripts/suite/run.mjs --jobs 4
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
 * The proxy stall, and why a timeout here is now worth believing
 *
 * Against the development server these checks speak to vite on 5173, which
 * proxies /graphql and /api to the server on 8080. That proxy used to stall: a
 * few requests in a thousand hung for thirty-five seconds, which from inside a
 * check reads as a `waitForSelector` that never resolves or a screen reported
 * as having drawn nothing - indistinguishable from a real defect, and the cause
 * of three false bug reports in a day. Issue #163 is the whole account of it.
 *
 * It was the connection, not the proxy. Vite opened a new one to the server for
 * every request it forwarded; from the container that crossing loses a SYN
 * every few hundred attempts, and the wait is then Linux's retry ladder -
 * 1s, 3s, 7s, 15s, 31s. `orknux-ui/vite.config.ts` now hands the proxy a
 * keep-alive agent, so it makes the crossing about once per hundred requests
 * instead of once per request. Same query, 1600 times each way at four in
 * flight, before and after:
 *
 *   through vite, before : median 20ms, p99 1291ms, max 35.7s, 2 unanswered
 *   through vite, after  : median  8ms, p99  169ms, max  0.9s, none over 2s
 *
 * So: a check that times out here is now much more likely to be telling the
 * truth. Run it again once to be sure - the machine can still be busy - but do
 * not write a timeout off as the proxy without looking, and if the long hangs
 * come back, measure the connection rather than the check.
 * ---------------------------------------------------------------------------
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TESTS, inCi } from './suite.mjs';
import { fixtureTrouble } from './fixture-check.mjs';
import { fixtureEnv } from './fixture.mjs';

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

/**
 * What each check took last time, so the cheap ones can go first.
 *
 * Recorded rather than declared. A number written into `suite.mjs` is a number
 * that was true once and drifts silently afterwards, and the ordering it buys
 * is not worth a second thing to keep up to date; what a run already knows is
 * how long every check took, so it writes that down and the next run reads it.
 *
 * A check with no entry - a new one, or a first run - is treated as expensive
 * and goes last, which is the safe way round: an unknown check that turns out
 * to be cheap costs one run of bad ordering, and one assumed cheap would hold
 * up the first answer, which is the whole point of the ordering.
 */
const TIMINGS = resolve(RESULTS, 'timings.json');

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

/* ------------------------------------------------------------------ ordering */

/**
 * Cheapest first, so a broken build says so in a minute rather than in forty.
 *
 * The checks used to run in declaration order, which is the order somebody
 * wrote them in and has nothing to do with what they cost - so a break a
 * nine-second check would have caught could surface half an hour in, behind a
 * two-minute one waiting on a model. Issue #308.
 *
 * Ties keep declaration order, which is what `sort` being stable gives, so a
 * fresh checkout with no timings runs exactly as it always did.
 *
 * `--in-order` puts it back for the run where the order itself matters: reading
 * a full log against the file, or reproducing a run somebody else described.
 */
let timings = {};
try {
  timings = JSON.parse(readFileSync(TIMINGS, 'utf8'));
} catch {
  // No file yet, which is a first run and not a problem.
}

const inOrder = argv.includes('--in-order');
if (!inOrder) {
  chosen = [...chosen].sort((one, two) => (timings[one.name] ?? Infinity) - (timings[two.name] ?? Infinity));
}

/**
 * Stop at the first failure.
 *
 * For the question "is this build broken at all", which is most of the times
 * this is run by hand and none of the times it is run in CI - there the whole
 * list is the report, and stopping early would hide the other four things that
 * are also wrong.
 */
const failFast = argv.includes('--fail-fast');

/* ------------------------------------------------------------------- fixture */

/*
 * Asked before anything is spawned, because the answer decides whether running
 * at all means anything. A suite pointed at the wrong workspace does not fail -
 * it passes vacuously on empty pages - so being told in five seconds is worth
 * more than every check this could have started in the meantime.
 */
/**
 * How many checks run at once, and the isolation that makes that honest.
 *
 * One by default, which is what this has always done. Above one the checks
 * cannot share a workspace: two in the same one walk over each other's rows and
 * a list assertion sees the other's fixture, which is why issue #308 says
 * isolation first and concurrency second.
 *
 * The unit of isolation is the **worker** and not the check. A copy of the
 * fixture per check would be a hundred and thirty-one seeds to build; four
 * workers is four copies, and within a worker the checks run one at a time
 * exactly as they always have. Each worker is handed the ids of its own copy
 * through the environment - the same environment `fixture.mjs` prints - so no
 * check changes, because every check already takes its workspace from there.
 */
const jobs = Math.max(1, Number(flag('--jobs') ?? 1) || 1);

const trouble = argv.includes('--any-workspace') || jobs > 1 ? null : await fixtureTrouble();
if (trouble !== null) {
  console.error(trouble.join('\n'));
  console.error('If the checks you are running build their own fixture, --any-workspace says so.');
  process.exit(2);
}

/**
 * One copy of the fixture per worker, resolved before any of them start.
 *
 * The first worker takes the copy that is already there - no suffix, the one a
 * single-job run and every screenshot use - and the rest take `#2`, `#3`. Each
 * is looked up rather than built: seeding is the seed's job, and a runner that
 * quietly built four workspaces would be a runner quietly building four
 * workspaces on somebody's server.
 *
 * Refused with the command that fixes it, for the reason the check above is
 * refused at all: without this the second worker points at the first's
 * workspace, and the two would produce failures that are nothing of the sort.
 */
const shards = [];
if (jobs > 1) {
  for (let worker = 0; worker < jobs; worker += 1) {
    const shard = worker === 0 ? '' : String(worker + 1);
    try {
      shards.push(await fixtureEnv(shard));
    } catch (unbuilt) {
      console.error(`Worker ${worker + 1} has no fixture: ${unbuilt.message}`);
      console.error(`Build it:  ORKNUX_SUITE_SHARD=${shard} node scripts/seed-demo.mjs`);
      console.error('Or run with fewer --jobs.');
      process.exit(2);
    }
  }
  console.log(`${jobs} workers, on workspaces ${shards.map((held) => held.ORKNUX_WORKSPACE).join(', ')}`);
}

/* ------------------------------------------------------------------- running */

/** One check, as a child process, with its output kept and a timeout on it. */
function run(test, worker = 0) {
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
      // The worker's own copy of the fixture, where there is more than one. A
      // single-job run hands over exactly what it was given, unchanged.
      env: shards.length === 0 ? process.env : { ...process.env, ...shards[worker] },
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
let stoppedAt = null;

/** One check's line, and everything it said when it failed. */
function report(result, worker) {
  const seconds = `${(result.took / 1000).toFixed(1)}s`;
  const verdict = result.code === 0 ? 'PASS' : 'FAIL';
  // The worker is named only where there is more than one, so a single-job run
  // prints exactly the line it always printed.
  const whose = shards.length === 0 ? '' : `[${worker + 1}] `;
  console.log(`${verdict}  ${whose}${result.test.name.padEnd(26)} ${seconds.padStart(7)}  ${result.test.what}`);
  if (result.code !== 0) {
    console.log(
      result.output
        .split('\n')
        .map((line) => `      | ${line}`)
        .join('\n'),
    );
  }
}

/**
 * The checks, taken one at a time by whichever worker is free.
 *
 * A shared queue rather than a slice of the list each: the checks differ by
 * more than an order of magnitude in what they cost, so handing worker three a
 * fixed third of them means worker three finishing ten minutes after the rest.
 * Taking the next one when free is what makes four workers cost a quarter
 * rather than a third.
 *
 * The order is still cheapest-first, so the first answers are still the fast
 * ones - and `--fail-fast` still stops, though what it stops is *starting*
 * anything new: the checks already running are let finish, because killing a
 * browser mid-assertion produces output nobody can read and the answer to "is
 * this build broken" has already arrived.
 */
let next = 0;
async function worker(at) {
  for (;;) {
    if (stoppedAt !== null) return;
    const mine = next;
    next += 1;
    if (mine >= chosen.length) return;

    const result = await run(chosen[mine], at);
    done.push(result);
    report(result, at);
    if (result.code !== 0 && failFast) {
      stoppedAt = result.test.name;
      return;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(jobs, chosen.length) }, (_unused, at) => worker(at)));

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

/*
 * What this run cost, for the next one to order by.
 *
 * Merged into what was already there rather than replacing it, because a run
 * with `--only` or `--ci` knows about a handful of checks, and knowing nothing
 * about the rest is not the same as their being fast. A killed check is written
 * down too, at the timeout it was killed at: it is the most expensive thing
 * here and it going last is right.
 */
writeFileSync(
  resolve(RESULTS, 'timings.json'),
  `${JSON.stringify(
    { ...timings, ...Object.fromEntries(done.map((result) => [result.test.name, result.took])) },
    null,
    1,
  )}\n`,
);

console.log(`\n${done.length - failed.length} of ${done.length} passed.`);
const skipped = chosen.length - done.length;
if (skipped > 0) {
  console.log(`Stopped at ${stoppedAt}: ${skipped} not run. Drop --fail-fast for the whole list.`);
}
if (failed.length > 0) console.log(`Failed: ${failed.map((result) => result.test.name).join(', ')}`);
console.log(`Report: ${resolve(RESULTS, 'junit.xml')}`);

process.exit(failed.length > 0 ? 1 : 0);
