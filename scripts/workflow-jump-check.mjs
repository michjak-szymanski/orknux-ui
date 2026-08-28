/**
 * The way from a workflow's settings to its graph.
 *
 * Issue #304. A workflow is two pages - the settings that name it and the
 * editor that says what it does - and the settings page pointed at neither the
 * editor nor anything else. Getting to the graph meant going back to the list
 * and finding the row again, which is the same complaint the jump checks
 * already cover for agents, actions, conditions and triggers.
 *
 * Same tab rather than a new one, which is the one place this differs from
 * `agent-jump-check`. Those marks are references - go and read what this tool
 * does - and open beside a half-edited form so it is not thrown away. This is
 * not a reference: it is the other half of the thing already open, and a
 * workflow that ended up in two tabs of itself is worse than the walk back
 * through the list.
 *
 * What is asserted is that the link is there, points where `routes.tsx` says
 * the editor lives, and actually lands on a drawn graph. The last one is the
 * point: a link to a route that renders nothing is what a `href` assertion on
 * its own would call a pass.
 */
import { BASE, WORKSPACE, WORKFLOW, open, record, shot, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

const settings = `/workspace/${WORKSPACE}/workflows/${WORKFLOW}/settings`;
await page.goto(`${BASE}${settings}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1', { timeout: 20_000 });
await page.waitForTimeout(400);

const jump = page.getByRole('link', { name: 'Open Editor' });

record((await jump.count()) === 1, 'the settings page carries one way through to the editor');

const href = await jump.getAttribute('href');
record(
  href === `/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`,
  `it points at this workflow's editor (${href})`,
);
record((await jump.getAttribute('target')) === null, 'in the same tab: it is the other half of what is open, not a reference');

await page.screenshot({ path: shot('workflow-jump-settings.png') });

// Pressed, not merely present. A href to a route that draws nothing is still a
// href, and this check exists because the walk back through the list worked.
await jump.click();
await page.waitForSelector('.react-flow__node', { timeout: 20_000 });
await page.waitForTimeout(600);

record(
  new URL(page.url()).pathname === `/workspace/${WORKSPACE}/workflows/${WORKFLOW}/editor`,
  `pressing it lands on the editor (${new URL(page.url()).pathname})`,
);
record(
  (await page.locator('.react-flow__node').count()) > 0,
  'with the graph drawn, rather than an empty route that answers to the same address',
);

await page.screenshot({ path: shot('workflow-jump-editor.png') });

await finish(browser);
