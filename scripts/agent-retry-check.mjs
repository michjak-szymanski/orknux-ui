/**
 * Drives the editor to see that an agent node now has what an action node has:
 * a Retries box, a "When it fails" switch, and a second handle once it is on.
 */
import { BASE, WORKSPACE, WORKFLOW, open, shot, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });

// Whatever agent node this workflow has; the kind label is what says so.
const agent = page.locator('.react-flow__node').filter({ hasText: 'Agent' }).first();
if ((await agent.count()) === 0) {
  console.log('FAIL - no agent node on this canvas to click');
  process.exit(1);
}
await agent.click();
await page.waitForTimeout(600);

const hasRetries = await page.getByText('Retries', { exact: true }).count();
const hasWhenItFails = await page.getByText('When it fails', { exact: true }).count();
console.log(`Retries shown: ${hasRetries > 0}`);
console.log(`When it fails shown: ${hasWhenItFails > 0}`);

const handlesBefore = await page.locator('.react-flow__node.selected .react-flow__handle-right, .react-flow__node.selected .react-flow__handle-bottom').count();

await page.getByText('Handle it here', { exact: true }).click();
await page.waitForTimeout(900);

const handlesAfter = await page.locator('.react-flow__node.selected .react-flow__handle-right, .react-flow__node.selected .react-flow__handle-bottom').count();
const labels = await page.locator('.react-flow__node.selected').innerText();

console.log(`out handles before: ${handlesBefore}, after: ${handlesAfter}`);
console.log(`node text after: ${JSON.stringify(labels)}`);

const attempts = page.locator('input[type="number"]').first();
await attempts.fill('3');
await page.waitForTimeout(600);
const wait = page.locator('input[type="number"]').nth(1);
console.log(`wait box enabled once there are three attempts: ${await wait.isEnabled()}`);

await page.screenshot({ path: shot('agent-retry.png') });
await finish(browser, hasRetries > 0, hasWhenItFails > 0, handlesAfter > handlesBefore);
