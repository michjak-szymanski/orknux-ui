/**
 * Stopping the quick chat while the model is thinking.
 *
 * The panel makes one request and waits for one answer, and there was no way
 * to end that wait: a question sent to a slow model left the panel saying "…"
 * with nothing to press. Issue #331. The Ask button becomes Stop while a
 * request is in flight, and pressing it drops the request.
 *
 * The response is held open by the check rather than by a slow model, so this
 * needs no model that answers and cannot flake on one being slow or fast: the
 * route is intercepted, the request is caught mid-flight, Stop is pressed, and
 * what is asserted is that the button offered Stop and that the panel came back
 * to rest without an answer on screen.
 */
import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const { browser, context, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* A model for the panel, so the button is offered at all. */
const { models } = await graphql(
  `query($w: ID!) { models(workspaceId: $w) { id kind } }`,
  { w: WORKSPACE },
).catch(() => ({ models: [] }));
const chat = models.find((m) => m.kind === 'CHAT');
record(chat !== undefined, 'the workspace has a chat model to point the panel at');
if (chat === undefined) await finish(browser);

const had = (
  await graphql(`query($w: ID!) { workspace(id: $w) { quickChatModelId } }`, { w: WORKSPACE })
).workspace.quickChatModelId;
await graphql(
  `mutation($w: ID!, $id: ID) { setWorkspaceQuickChatModel(workspaceId: $w, modelId: $id) { id } }`,
  { w: WORKSPACE, id: chat.id },
);

const restore = async () => {
  await graphql(
    `mutation($w: ID!, $id: ID) { setWorkspaceQuickChatModel(workspaceId: $w, modelId: $id) { id } }`,
    { w: WORKSPACE, id: had },
  ).catch(() => undefined);
  await finish(browser);
};

/*
 * Hold the answer. The route is caught and never fulfilled until the check lets
 * it go, so the panel sits in its asking state for exactly as long as is needed
 * to press Stop - no model, slow or fast, decides the timing.
 */
let release;
const held = new Promise((resolve) => { release = resolve; });
await page.route('**/quick-chat', async (route) => {
  await held;
  await route.abort();
});

await page.goto(`${BASE}/workspace/${WORKSPACE}/agents`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const fab = page.getByRole('button', { name: 'Ask about this page' }).last();
await fab.click();
await page.waitForTimeout(400);

const box = page.getByLabel('Ask about this page');
await box.fill('What is on this page?');
await page.getByRole('button', { name: 'Ask', exact: true }).click();
await page.waitForTimeout(600);

const stop = page.getByRole('button', { name: 'Stop', exact: true });
record(await stop.isVisible().catch(() => false), 'while the model is thinking the button offers Stop');

await stop.click();
release();
await page.waitForTimeout(800);

record(
  (await page.getByRole('button', { name: 'Ask', exact: true }).count()) > 0,
  'and pressing it brings the panel back to rest, ready to ask again',
);
record(
  (await page.getByRole('button', { name: 'Stop', exact: true }).count()) === 0,
  'with no Stop left, because nothing is in flight',
);

await restore();
