/**
 * An agent's session memory: one slider, the server's figures, and a refusal
 * that stops the save.
 *
 * Issue #226. What a session hands back to a model used to be five constants in
 * the server's source; it is now a share of the chosen model's context window,
 * set per agent. The whole of the arithmetic and the whole of the wording stay
 * over there - this screen sends a percentage and prints what comes back - so
 * that is what is measured here: not that the numbers are right, but that the
 * numbers on the page are the numbers the API gave, to the character.
 *
 * Four states, and each one is a state somebody is actually in:
 *
 *   no model chosen   the slider is dead and reads Default, because a share of
 *                     no window is nothing
 *   nothing set       the built-in default's figures, and an agent that has
 *                     never been given a share must go on looking like this
 *   a share set       the figures change, and they are the server's
 *   refused          the sentence is printed as it arrived and Save is off
 *
 * The refusal is provoked rather than hoped for: the check makes a model whose
 * window is small and whose reserved answer is most of it, so half of it is a
 * share that model cannot give. Waiting for a seeded model to happen to refuse
 * something would be a check that passes on installations where it does not.
 *
 * Everything it makes - two models and an agent - it removes again, including
 * what an earlier killed run left behind.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const PREFIX = 'zzMemoryShare';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

async function sweep() {
  const { workspaceAgents } = await graphql(
    `query($w: ID!) { workspaceAgents(workspaceId: $w, page: 0, size: 200) { content { id name } } }`,
    { w: WORKSPACE },
  );
  for (const old of workspaceAgents.content.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { deleteAgent(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept agent ${old.name} (#${old.id})`);
  }

  const { models } = await graphql(`query($w: ID!) { models(workspaceId: $w) { id name } }`, { w: WORKSPACE });
  for (const old of models.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeModel(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept model ${old.name} (#${old.id})`);
  }
}

await sweep();

const { modelProviders } = await graphql(`query($w: ID!) { modelProviders(workspaceId: $w) { id name } }`, {
  w: WORKSPACE,
});
const provider = modelProviders[0];
if (provider === undefined) {
  record(false, 'this workspace has no model provider, so there is nothing to hang a model on');
  await finish(browser);
}

/** A model, made here, with the window this check needs it to have. */
async function makeModel(name, contextWindow, maxOutput) {
  const made = await graphql(
    `mutation($input: CreateModelInput!) { createModel(input: $input) { id name contextWindow maxOutput } }`,
    {
      input: {
        providerId: provider.id,
        name: `${PREFIX} ${name}`,
        modelId: `${PREFIX}-${name}`,
        kind: 'CHAT',
        contextWindow,
        maxOutput,
      },
    },
  );
  console.log(`made model ${made.createModel.name} (#${made.createModel.id}), window ${contextWindow}`);
  return made.createModel;
}

/*
 * Roomy: 200k of window and 8k reserved for the answer, so an ordinary share is
 * one it can give.
 *
 * Cramped: 8k of window with 6k of it reserved for the answer. Once the tenth
 * the server holds back for the instructions is allowed for there are 1,200
 * tokens left, so half the window is a share this model cannot give - which is
 * the refusal, arrived at through the model's own numbers rather than by
 * hoping a seeded model happens to be small.
 */
const roomy = await makeModel('roomy', 200_000, 8_000);
const cramped = await makeModel('cramped', 8_000, 6_000);

const made = await graphql(
  `mutation($input: CreateAgentInput!) { createAgent(input: $input) { id name } }`,
  {
    input: {
      workspaceId: WORKSPACE,
      name: `${PREFIX} ${Date.now()}`,
      type: 'LLM',
      description: 'Made by scripts/agent-memory-check.mjs to drag one slider, and removed again after.',
    },
  },
);
const AGENT = made.createAgent.id;
console.log(`made agent ${made.createAgent.name} (#${AGENT})`);

/** What the API says a share works out to - the numbers the page has to match. */
async function budgetOf(modelId, share) {
  const { memoryBudget } = await graphql(
    `query($w: ID!, $m: ID, $s: Int) {
       memoryBudget(workspaceId: $w, modelId: $m, share: $s) {
         derived totalTokens conversationTokens toolResultTokens longestResultTokens turns refusal
       }
     }`,
    { w: WORKSPACE, m: modelId, s: share },
  );
  return memoryBudget;
}

/* ------------------------------------------------------------- the drawing */

const SLIDER = '#agent-memory-share';

/** What the field is showing: the slider's state, and every figure under it. */
async function shown() {
  return page.evaluate((selector) => {
    const slider = document.querySelector(selector);
    if (slider === null) return null;
    const field = slider.closest('div')?.parentElement ?? null;
    const alert = field?.querySelector('[role="alert"]') ?? null;
    return {
      value: slider.value,
      disabled: slider.disabled,
      min: slider.min,
      max: slider.max,
      said: (field?.querySelector('output')?.textContent ?? '').trim(),
      figures: [...(field?.querySelectorAll('dd') ?? [])].map((one) => one.textContent?.trim() ?? ''),
      refusal: alert === null ? null : (alert.textContent ?? '').trim(),
    };
  }, SLIDER);
}

/**
 * Moves the slider the way a person does, as far as React is concerned.
 *
 * Through the native setter and then an `input` event: React holds the value in
 * its own state and reads it back off the element, so assigning `.value`
 * directly is a change it never hears about and the page snaps back on its next
 * render.
 */
async function drag(to) {
  await page.evaluate(
    ([selector, value]) => {
      const slider = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(slider, String(value));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    },
    [SLIDER, to],
  );
  // The preview is asked for after a pause, so the figures land a moment later.
  await page.waitForTimeout(900);
}

async function chooseModel(id) {
  await page.selectOption('#agent-model', id);
  await page.waitForTimeout(900);
}

await page.goto(`${BASE}/workspace/${WORKSPACE}/agents/${AGENT}/settings`, { waitUntil: 'domcontentloaded' });

/**
 * Whether the control is there at all.
 *
 * Waited for rather than assumed, and recorded rather than thrown: a card with
 * no session memory control is the first thing this check is about - it is what
 * this page was before issue #226 - and a stack trace saying a selector timed
 * out is a worse account of that than a line saying so.
 */
let drew = false;

if (await drawn(page, 'the agent settings page')) {
  drew = await page
    .waitForSelector(SLIDER, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  record(drew, 'the agent settings card offers a session memory control');
  await page.waitForTimeout(900);
}

if (drew) {
  /* ---- an agent with no model, which is what a new one is ---- */

  const bare = await shown();
  record(bare?.disabled === true, 'with no model chosen there is nothing to drag');
  record(bare?.said === 'Default', `and it reads Default (${JSON.stringify(bare?.said)})`);
  record(bare?.refusal === null, 'and says nothing was refused, because nothing was asked for');

  /* ---- nothing set, on a model: the built-in default ---- */

  await chooseModel(roomy.id);
  const untouched = await shown();
  const theDefault = await budgetOf(roomy.id, null);

  record(untouched?.disabled === false, 'choosing a model makes it draggable');
  record(untouched?.said === 'Default', 'an agent that has never been given a share still reads Default');
  record(theDefault.derived === false, 'and the API calls that the default rather than a worked-out share');
  record(
    untouched?.figures.some((figure) => figure.includes(theDefault.totalTokens.toLocaleString('en-US'))),
    `the default's own figures are on the page (${theDefault.totalTokens} in ${JSON.stringify(untouched?.figures)})`,
  );

  /* ---- a share, and the figures it works out to ---- */

  await drag(20);
  const set = await shown();
  const twenty = await budgetOf(roomy.id, 20);

  record(set?.said === '20%', `dragging it says what was asked for (${JSON.stringify(set?.said)})`);
  record(twenty.derived === true, 'the API works that share out against the window');
  record(twenty.refusal === null, 'and does not refuse it');

  /*
   * The whole point of the check: every figure on the page is a figure the
   * server sent. Compared as printed - grouped in thousands - so a screen that
   * recomputed one of these and landed a token or two out fails here.
   */
  const wanted = [
    `${twenty.totalTokens.toLocaleString('en-US')} tokens`,
    `${twenty.conversationTokens.toLocaleString('en-US')} tokens, ${twenty.turns} turns`,
    `${twenty.toolResultTokens.toLocaleString('en-US')} tokens, longest ${twenty.longestResultTokens.toLocaleString('en-US')}`,
  ];
  const drawnFigures = (set?.figures ?? []).map((one) => one.replace(/\s+/g, ' '));
  for (const figure of wanted) {
    record(
      drawnFigures.some((one) => one === figure),
      `the page prints what the API answered: ${JSON.stringify(figure)}`,
    );
  }
  record(
    drawnFigures.every((one) => !one.toLowerCase().includes('character')),
    `and calls them tokens, which is what they are (${JSON.stringify(drawnFigures)})`,
  );
  record(
    Number(set?.max) === 50 && Number(set?.min) === 0,
    `the track runs from Default to the server's ceiling (${set?.min}–${set?.max})`,
  );

  const saveable = await page.locator('button[type="submit"]').isDisabled();
  record(saveable === false, 'a share the model can give leaves Save alone');

  /* ---- and one it cannot ---- */

  await chooseModel(cramped.id);
  await drag(50);
  const refused = await shown();
  const half = await budgetOf(cramped.id, 50);

  record(half.refusal !== null, `the API refuses half of the cramped model's window (${half.refusal})`);
  record(
    refused?.refusal === half.refusal,
    `the page prints that refusal, word for word (${JSON.stringify(refused?.refusal)})`,
  );
  record((refused?.figures.length ?? 0) === 0, 'and shows no figures beside it, which would be the default’s');
  record(
    await page.locator('button[type="submit"]').isDisabled(),
    'Save is off while the share cannot be saved',
  );

  await page.screenshot({ path: shot('agent-memory-refused.png') });

  /* ---- saved, and still there after a reload ---- */

  await chooseModel(roomy.id);
  await drag(20);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(2500);

  const stored = await graphql(`query($id: ID!) { agent(id: $id) { memoryShare modelId } }`, { id: AGENT });
  record(stored.agent.memoryShare === 20, `the share was saved (${stored.agent.memoryShare})`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SLIDER, { timeout: 20_000 });
  await page.waitForTimeout(1200);
  const reloaded = await shown();
  record(reloaded?.said === '20%', `and comes back on the page (${JSON.stringify(reloaded?.said)})`);

  /* ---- and back to the default, which has to be sendable ---- */

  await drag(0);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(2500);
  const cleared = await graphql(`query($id: ID!) { agent(id: $id) { memoryShare } }`, { id: AGENT });
  record(
    cleared.agent.memoryShare === null,
    `dragging back to Default puts it back to the built-in one (${cleared.agent.memoryShare})`,
  );
}

/* -------------------------------------------------- and the fixture is gone */

await graphql(`mutation($id: ID!) { deleteAgent(id: $id) }`, { id: AGENT }).catch(() => undefined);
for (const model of [roomy, cramped]) {
  await graphql(`mutation($id: ID!) { removeModel(id: $id) }`, { id: model.id }).catch(() => undefined);
}
console.log('swept the agent and both models');

await finish(browser);
