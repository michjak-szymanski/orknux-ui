/**
 * Turning a node from the canvas rather than from the panel.
 *
 * R has always turned the selected node and the details panel has always had a
 * button, but neither is in view when somebody is looking at the shape of a
 * graph. This checks the control appears on the selected node, that pressing it
 * turns the node, and that R still does the same thing through the same path.
 */
import { BASE, WORKSPACE, WORKFLOW, open, shot, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(1000);

const turn = page.locator('button', { hasText: /^Turn$/ });
const onCanvas = () => turn.filter({ has: page.locator('img') }).first();

const beforeSelecting = await onCanvas().isVisible().catch(() => false);

const node = page.locator('.react-flow__node').first();
await node.click();
await page.waitForTimeout(600);

const appears = await onCanvas().isVisible();
// The panel names the way the node faces, which is how the turn is read back.
// Found by the button beside it - the icon field alongside wears the same class.
const facing = page.locator('div:has(> button[title="Turn the node (R)"]) > span').first();
const first = (await facing.innerText()).trim();

await onCanvas().click();
await page.waitForTimeout(400);
const afterClick = (await facing.innerText()).trim();

await page.locator('.react-flow__pane').press('r');
await page.waitForTimeout(400);
const afterKey = (await facing.innerText()).trim();

await page.screenshot({ path: shot('turn-node.png') });

console.log(`before selecting anything: ${beforeSelecting ? 'shown' : 'not shown'}`);
console.log(`on the selected node:      ${appears ? 'shown' : 'not shown'}`);
console.log(`facing: ${first} -> click -> ${afterClick} -> R -> ${afterKey}`);

const quiet = beforeSelecting === false;
const offered = appears === true;
const clickTurns = afterClick !== first;
const keyTurns = afterKey !== afterClick;
console.log(quiet ? 'PASS: nothing on an unselected node' : 'FAIL: shown without a selection');
console.log(offered ? 'PASS: offered on the selected node' : 'FAIL: not offered');
console.log(clickTurns ? 'PASS: the button turns it' : 'FAIL: the button did nothing');
console.log(keyTurns ? 'PASS: R still turns it' : 'FAIL: R stopped working');

await finish(browser, quiet, offered, clickTurns, keyTurns);
