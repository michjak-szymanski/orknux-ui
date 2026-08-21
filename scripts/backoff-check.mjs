/**
 * The doubling curve, from the panel to the database and back.
 *
 * Sets an agent node to three attempts with the wait doubling, saves, reloads
 * the page and reads the box again - so what is asserted is that the choice
 * survived the round trip, not that a checkbox can be ticked. It puts the node
 * back to one attempt afterwards, which is what it was.
 */
import { BASE, WORKSPACE, WORKFLOW, open, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1100 } });

const doubling = page.getByText('Double the wait after each attempt');
const box = () => doubling.locator('xpath=../input');
const attempts = page.locator('input[type="number"]').first();

async function openTheAgent() {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.locator('.react-flow__node').filter({ hasText: 'Agent' }).first().click();
  await page.waitForTimeout(600);
}

async function save() {
  await page.locator('button[aria-label^="Save"]').click();
  await page.waitForTimeout(1500);
}

await openTheAgent();

// Dead while the node runs once: there is nothing for a curve to describe.
const deadAtOne = await box().isDisabled();

await attempts.fill('3');
await page.waitForTimeout(300);
const liveAtThree = await box().isEnabled();

await box().check();
await page.waitForTimeout(200);
await save();

await openTheAgent();
const keptTicked = await box().isChecked();
const keptAttempts = await attempts.inputValue();

// Back to one attempt, which is where this node started.
await attempts.fill('');
await page.waitForTimeout(300);
await save();

console.log(`dead while there is one attempt: ${deadAtOne}`);
console.log(`live once there are three:       ${liveAtThree}`);
console.log(`after a save and a reload:       attempts ${keptAttempts}, doubling ${keptTicked}`);

const ok = deadAtOne && liveAtThree && keptTicked && keptAttempts === '3';
console.log(ok ? 'PASS: the curve is taken, saved and read back' : 'FAIL: see above');

await finish(browser, ok);
