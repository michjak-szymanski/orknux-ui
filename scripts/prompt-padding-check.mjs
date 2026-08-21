/**
 * The system prompt box and the description box, measured against each other.
 *
 * Issue #190 asked for less padding. The number was never the point: the two
 * multi-line fields on the agent form disagreed, and one of them was wrong.
 *
 * `.inputWrapperPrompt` lived in AgentForm.module.css and said the same three
 * things the frames' `.inputWrapperTall` says. One class each, so specificity
 * tied and source order decided - and this stylesheet is injected first, so the
 * frame's `align-items: center` and `padding: 0 12px` won both. What was left
 * was a 120px box with no padding holding a textarea sized to its content and
 * centred in it: 39px of nothing above the first line and 39 below, against the
 * description's 13.
 *
 * So this asserts agreement rather than a number. A future change to
 * `.inputWrapperTall` moves both and this still passes; a change that moves only
 * one of them is the bug this was written for.
 */
import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

const { workspaceAgents } = await graphql(
  `query ($w: ID!) { workspaceAgents(workspaceId: $w) { content { id name } } }`,
  { w: WORKSPACE },
);
const agent = workspaceAgents.content[0];

if (agent === undefined) {
  record(false, `no agent in workspace ${WORKSPACE} to open the form on`);
  await finish(browser);
}

await page.goto(`${BASE}/workspace/${WORKSPACE}/agents/${agent.id}/settings`, {
  waitUntil: 'domcontentloaded',
});

if (await drawn(page, 'the agent form')) {
  await page.waitForSelector('#agent-description', { timeout: 20_000 });

  // The prompt is behind a disclosure, which may already be open.
  const toggle = page.getByRole('button', { name: 'System Prompt' }).first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.waitForSelector('#agent-system-prompt', { timeout: 10_000 });
  await page.waitForTimeout(300);

  const measured = await page.evaluate(() => {
    const read = (selector) => {
      const field = document.querySelector(selector);
      const wrapper = field.parentElement;
      const f = field.getBoundingClientRect();
      const w = wrapper.getBoundingClientRect();
      const style = getComputedStyle(wrapper);
      return {
        padTop: style.paddingTop,
        padBottom: style.paddingBottom,
        height: style.height,
        // What the eye actually reads: box edge to first line, last line to box
        // edge. Padding alone would miss a box that centres its contents.
        gapTop: Math.round(f.top - w.top),
        gapBottom: Math.round(w.bottom - f.bottom),
      };
    };
    return { description: read('#agent-description'), prompt: read('#agent-system-prompt') };
  });

  const { description, prompt } = measured;
  record(
    prompt.padTop === description.padTop && prompt.padBottom === description.padBottom,
    `the two boxes pad alike: prompt ${prompt.padTop}/${prompt.padBottom}, ` +
      `description ${description.padTop}/${description.padBottom}`,
  );
  record(
    prompt.gapTop === description.gapTop && prompt.gapBottom === description.gapBottom,
    `and the text starts and ends in the same place in each: prompt ${prompt.gapTop}/${prompt.gapBottom}, ` +
      `description ${description.gapTop}/${description.gapBottom}`,
  );
  record(
    prompt.height === description.height,
    `and neither is taller than it needs: prompt ${prompt.height}, description ${description.height}`,
  );
}

await finish(browser);
