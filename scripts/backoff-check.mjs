/**
 * The backoff, from the panel to the database and back.
 *
 * Six numbers where there were three and a checkbox, so what this measures is
 * not that a box can be typed into. It is the three things the panel promises:
 * that a field describing the gap between attempts is dead while there is only
 * one attempt, that the ceiling is dead while the wait it caps cannot grow, and
 * that the sentence under the fields says what the six numbers actually come to
 * - which is the only part of the panel nobody could work out for themselves.
 *
 * Then it saves, reloads, and reads the boxes again, so the round trip is
 * measured rather than assumed. It puts the node back to one attempt afterwards,
 * which is what it was.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1100 } });

/** The three boxes that are always there, in the order the panel draws them. */
const attempts = () => page.locator('input[type="number"]').nth(0);
const initialWait = () => page.locator('input[type="number"]').nth(1);
const multiplier = () => page.locator('input[type="number"]').nth(2);

/** And the three behind the word, once it has been pressed. */
const maximumWait = () => page.locator('input[type="number"]').nth(3);
const jitter = () => page.locator('input[type="number"]').nth(4);
const budget = () => page.locator('input[type="number"]').nth(5);

const more = () => page.getByRole('button', { name: /Ceiling, jitter and budget|Fewer settings/ });

/** What the panel says the policy will do, which is the line this is really about. */
const sentence = () => page.locator('p').filter({ hasText: /attempts|One attempt/ }).last();

async function openTheAgent() {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.locator('.react-flow__node').filter({ hasText: 'Agent' }).first().click();
  await page.waitForTimeout(600);
}

async function type(box, value) {
  await box().fill(value);
  await page.waitForTimeout(300);
}

async function save() {
  await page.locator('button[aria-label^="Save"]').click();
  await page.waitForTimeout(1500);
}

await openTheAgent();

// Everything past the attempt count describes the gap between two attempts, and
// with one attempt there is no gap for any of it to describe.
record(await initialWait().isDisabled(), 'the wait is dead while the node runs once');
record(await multiplier().isDisabled(), 'the multiplier is dead with it');
record((await sentence().innerText()).includes('One attempt'), 'and the panel says so in words');

await type(attempts, '3');
record((await initialWait().isEnabled()) && (await multiplier().isEnabled()), 'both come alive on a second attempt');

/*
 * Two seconds at one and a half: waits of 2s and 3s, which is five seconds and
 * is not a number anybody reads off the three boxes above it. That is the whole
 * argument for the sentence being there.
 */
await type(initialWait, '2');
await type(multiplier, '1.5');
const composed = await sentence().innerText();
record(composed.includes('3 attempts') && composed.includes('5s'), `the sentence composes the numbers: "${composed}"`);

/*
 * What the checkbox this replaced used to mean, said as a number. Two seconds
 * doubling three times over is 2s then 4s, and six seconds is what the panel
 * says - so a node set the way the old tick set it does the old thing.
 */
await type(multiplier, '2');
const doubled = await sentence().innerText();
record(doubled.includes('6s'), `a multiplier of two is what the tick used to mean: "${doubled}"`);

// The three that most nodes never set are behind a word rather than in the way.
record(!(await maximumWait().isVisible()), 'the ceiling, the jitter and the budget are not shown by default');
await more().click();
await page.waitForTimeout(300);
record(await budget().isVisible(), 'and are there once asked for');

// A ceiling over a wait that cannot grow is not a bound on it, so it is not a
// box to type into either.
record(await maximumWait().isEnabled(), 'the ceiling is live under a curve');
await type(multiplier, '1');
record(await maximumWait().isDisabled(), 'and dead over a wait that never grows');

await type(multiplier, '1.5');
await type(jitter, '0.25');
await type(budget, '600');
await save();

await openTheAgent();
const kept = {
  attempts: await attempts().inputValue(),
  wait: await initialWait().inputValue(),
  multiplier: await multiplier().inputValue(),
};
// Set on the node, so the panel opens on them rather than hiding them behind a
// word somebody would have to know to press.
record(await budget().isVisible(), 'a node with a ceiling or a budget opens showing them');
const keptMore = { jitter: await jitter().inputValue(), budget: await budget().inputValue() };

record(
  kept.attempts === '3' && kept.wait === '2' && kept.multiplier === '1.5' &&
    keptMore.jitter === '0.25' && keptMore.budget === '600',
  `the whole backoff survives a save: ${JSON.stringify({ ...kept, ...keptMore })}`,
);

// Back to one attempt, which is where this node started.
await type(attempts, '');
await save();

await finish(browser);
