/**
 * The default session memory a workspace gives the agents that set none, and
 * what an agent then says about where its number came from.
 *
 * The follow-up half of issue #226. The share stayed on the agent, where an
 * exception belongs, and gained a step behind it: **agent, then workspace, then
 * the built-in allowance.** So there are two screens now and one quantity, and
 * what this drives is the seam between them - a default set on one page has to
 * turn up on the other, and clearing it has to put that agent back.
 *
 * Four things it is here to catch, none of which the source can be read for:
 *
 *   the figures       every number under the workspace's slider is a number the
 *                     API gave, to the character, exactly as on the agent
 *   one share, many   the same 25% is comfortable on a 200,000-token window and
 *   windows           refused on an 8,000-token one, and this screen has to say
 *                     so *without* refusing the setting - the server judges a
 *                     workspace default on the bounds alone, deliberately, and
 *                     a screen that invented a per-model refusal here would be
 *                     refusing a default that is right for every other model
 *   inheritance       an agent that sets nothing reports the workspace's share
 *                     and says it is the workspace's, and goes back to saying
 *                     "the built-in allowance" the moment the default is gone
 *   the refusal       the bounds sentence is printed as it arrived. The track
 *                     stops at the server's ceiling so nobody can reach past it
 *                     by dragging - which is why the check reaches past it
 *                     another way: that slot is the safety net for the two
 *                     copies of the ceiling parting company, and a safety net
 *                     nothing ever tests is a safety net nobody knows is torn
 *
 * The models are made here rather than hoped for. Waiting for a seeded
 * installation to happen to hold a window too small for a quarter of it to be
 * given is a check that passes wherever it does not. Both models, the agent,
 * and the default itself are put back afterwards, including what an earlier
 * killed run left behind.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const PREFIX = 'zzWorkspaceMemory';

/** The share this check sets as the default, and reads back everywhere. */
const SHARE = 25;

/** Past the server's ceiling, which no track here can reach by dragging. */
const TOO_MUCH = 80;

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

  // Whatever a killed run left set. Every assertion below is about a workspace
  // that starts with no default, which is the state every workspace ships in.
  await graphql(
    `mutation($w: ID!) { setWorkspaceDefaultMemoryShare(workspaceId: $w, share: null) { id } }`,
    { w: WORKSPACE },
  ).catch(() => undefined);
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
 * The two ends of the problem this card exists to be honest about.
 *
 * Roomy has 200,000 tokens of window and reserves 8,000 for its answer, so a
 * quarter of it is a share it gives without complaint. Cramped has 8,000 with
 * 6,000 of them reserved; once the tenth the server holds back for the
 * instructions is allowed for there are 1,200 left, so the same quarter is a
 * share it cannot give. One percentage, two answers, and the workspace default
 * is allowed to be set regardless - which is the assertion this fixture is for.
 */
const roomy = await makeModel('roomy', 200_000, 8_000);
const cramped = await makeModel('cramped', 8_000, 6_000);

const made = await graphql(`mutation($input: CreateAgentInput!) { createAgent(input: $input) { id name } }`, {
  input: {
    workspaceId: WORKSPACE,
    name: `${PREFIX} ${Date.now()}`,
    type: 'LLM',
    description: 'Made by scripts/workspace-memory-check.mjs to inherit one share, and removed again after.',
  },
});
const AGENT = made.createAgent.id;
console.log(`made agent ${made.createAgent.name} (#${AGENT})`);

/*
 * The agent is pointed at the roomy model and given no share of its own, which
 * is the whole point of it: what it reports has to be the workspace's answer.
 */
await graphql(`mutation($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }`, {
  id: AGENT,
  input: { name: made.createAgent.name, modelId: roomy.id },
});

/** What the API says a share works out to against one model. */
async function budgetOf(modelId, share) {
  const { memoryBudget } = await graphql(
    `query($w: ID!, $m: ID, $s: Int) {
       memoryBudget(workspaceId: $w, modelId: $m, share: $s) {
         share inherited derived totalTokens conversationTokens toolResultTokens longestResultTokens turns refusal
       }
     }`,
    { w: WORKSPACE, m: modelId, s: share },
  );
  return memoryBudget;
}

/** And what it says about the same share asked as a workspace default. */
async function defaultOf(share) {
  const { memoryBudget } = await graphql(
    `query($w: ID!, $s: Int) {
       memoryBudget(workspaceId: $w, share: $s, workspaceDefault: true) {
         share inherited derived totalTokens conversationTokens toolResultTokens longestResultTokens turns refusal
       }
     }`,
    { w: WORKSPACE, s: share },
  );
  return memoryBudget;
}

/** What the agent itself reports, which is the resolution order's answer. */
async function agentBudget() {
  const { agent } = await graphql(
    `query($id: ID!) { agent(id: $id) { memoryShare memoryBudget { share inherited derived totalTokens } } }`,
    { id: AGENT },
  );
  return agent;
}

/** The workspace's stored default. */
async function storedDefault() {
  const { workspace } = await graphql(`query($id: ID!) { workspace(id: $id) { defaultMemoryShare } }`, {
    id: WORKSPACE,
  });
  return workspace.defaultMemoryShare;
}

/**
 * The three figures as the page has to print them.
 *
 * Built from what the API answered rather than written down here, so a screen
 * that recomputed one of these and landed a token out fails - which is the
 * whole reason to assert against the API at all.
 */
function figuresOf(budget) {
  return [
    `${budget.totalTokens.toLocaleString('en-US')} tokens`,
    `${budget.conversationTokens.toLocaleString('en-US')} tokens, ${budget.turns} turns`,
    `${budget.toolResultTokens.toLocaleString('en-US')} tokens, longest ${budget.longestResultTokens.toLocaleString('en-US')}`,
  ];
}

/* ------------------------------------------------------------- the drawing */

const SLIDER = '#workspace-memory-share';
const AGAINST = '#workspace-memory-against';
const AGENT_SLIDER = '#agent-memory-share';

/**
 * What one of the two cards is showing.
 *
 * The card rather than the field, because the figures are the card's readout
 * and are deliberately drawn beside the field rather than inside it - see the
 * markup, and `hint-prose-check`, which is why.
 */
async function shown(selector) {
  return page.evaluate((one) => {
    const slider = document.querySelector(one);
    if (slider === null) return null;
    const card = slider.closest('section, form') ?? null;
    const alerts = [...(card?.querySelectorAll('[role="alert"]') ?? [])].map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    const paragraphs = [...(card?.querySelectorAll('p') ?? [])].map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    const picker = card?.querySelector('#workspace-memory-against') ?? null;
    const save = [...(card?.querySelectorAll('button') ?? [])].find((node) =>
      (node.textContent ?? '').trim().startsWith('Sav'),
    );
    return {
      value: slider.value,
      disabled: slider.disabled,
      min: slider.min,
      max: slider.max,
      said: (card?.querySelector('output')?.textContent ?? '').trim(),
      terms: [...(card?.querySelectorAll('dt') ?? [])].map((node) => (node.textContent ?? '').trim()),
      figures: [...(card?.querySelectorAll('dd') ?? [])].map((node) =>
        (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
      alerts,
      // Everything the card says in the open that is not an alert and not the
      // one-word note a save leaves behind.
      notes: paragraphs.filter((text) => !alerts.includes(text) && text !== 'Saved.'),
      saved: paragraphs.includes('Saved.'),
      against: picker === null ? null : picker.value,
      saveOff: save === undefined ? null : save.disabled,
    };
  }, selector);
}

/**
 * Wait until the card has answered, rather than sleeping in front of it.
 *
 * Every figure here arrives from a query the page sends after the control has
 * been still for a moment, so a card read too soon is a card holding nothing -
 * and every assertion of the form "the page prints what the API answered" fails
 * against an empty readout in exactly the way it fails against a wrong one.
 * That is the false alarm this suite has had most of, and a fixed pause is what
 * causes it: the pause is long enough on the machine it was written on.
 *
 * Anything the card can say counts as an answer - the figures, a refusal, or
 * the note about one model - because which of the three it is is the thing
 * being asserted and must not be waited for.
 */
async function settled(selector, within = 15_000) {
  const until = Date.now() + within;
  for (;;) {
    const now = await shown(selector);
    const answered =
      now !== null && (now.figures.length > 0 || now.alerts.length > 0 || now.notes.length > 0);
    if (answered || Date.now() >= until) return now;
    await page.waitForTimeout(200);
  }
}

/**
 * What colour the card is saying something in, and what the two colours it
 * could be saying it in actually are.
 *
 * Read off the page rather than assumed. Danger on this product means the Save
 * in front of you will not go through, and this card prints a sentence beside a
 * Save that still works - so the one thing that must not happen is those two
 * being drawn alike. A class name renamed or a stylesheet tidied would not show
 * up in any assertion above; the pixel does.
 */
async function colours(text) {
  return page.evaluate((says) => {
    const slider = document.querySelector('#workspace-memory-share');
    const card = slider?.closest('section') ?? null;
    const said = [...(card?.querySelectorAll('p') ?? [])].find((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(says.slice(0, 40)),
    );
    /*
     * The tokens resolved the way the browser resolves them, through an element
     * that wears one. Read straight off `:root` they come back as whatever was
     * typed into the stylesheet - `#a1a1aa` beside a computed `rgb(161, 161,
     * 170)` - and comparing those two is comparing a hex to a decimal.
     */
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.append(probe);
    const resolve = (token) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const answer = {
      colour: said === undefined ? null : getComputedStyle(said).color,
      danger: resolve('--color-danger'),
      muted: resolve('--color-text-muted'),
    };
    probe.remove();
    return answer;
  }, text);
}

/** Two CSS colours as far apart as the smallest channel between them. */
function apart(one, other) {
  const channels = (colour) => (colour.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  const [a, b] = [channels(one), channels(other)];
  if (a.length < 3 || b.length < 3) return 0;
  return Math.max(...a.map((value, at) => Math.abs(value - b[at])));
}

/**
 * Moves the slider the way a person does, as far as React is concerned.
 *
 * Through the native setter and then an `input` event: React holds the value in
 * its own state and reads it back off the element, so assigning `.value`
 * directly is a change it never hears about and the page snaps back on its next
 * render.
 *
 * `past` is how the last case is reached at all. A range input clamps whatever
 * it is given to its own `max`, and this track's `max` is the server's ceiling,
 * so no drag and no arrow key can ask for a share outside the bounds - which is
 * the point of setting it there. The refusal slot exists for the day those two
 * copies of the ceiling part company, so the only way to find out whether it
 * still prints the server's sentence is to take the ceiling off for one drag.
 */
async function drag(selector, to, past = false) {
  await page.evaluate(
    ([one, value, lift]) => {
      const slider = document.querySelector(one);
      if (lift) slider.removeAttribute('max');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(slider, String(value));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    },
    [selector, to, past],
  );
  // The preview is asked for after a pause, so the figures land a moment later.
  await page.waitForTimeout(900);
}

async function save() {
  await page.locator('section:has(#workspace-memory-share) button:has-text("Save")').click();
  await page.waitForTimeout(2000);
}

const SETTINGS = `${BASE}/workspace/${WORKSPACE}/settings`;
await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });

/**
 * Whether the control is there at all.
 *
 * Waited for rather than assumed, and recorded rather than thrown: a settings
 * page with no such control is the first thing this check is about - it is what
 * this page was before this change - and a stack trace saying a selector timed
 * out is a worse account of that than a line saying so.
 */
let drew = false;

if (await drawn(page, 'the workspace settings page')) {
  drew = await page
    .waitForSelector(SLIDER, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  record(drew, 'the workspace settings page offers a default session memory control');
  await page.waitForTimeout(1200);
}

if (drew) {
  /* ---- a workspace that has decided nothing, which is every workspace ---- */

  const bare = await settled(SLIDER);
  const builtIn = await defaultOf(null);

  record(bare?.said === 'Default', `it reads Default until somebody sets one (${JSON.stringify(bare?.said)})`);
  record(
    Number(bare?.min) === 0 && Number(bare?.max) === 50,
    `the track runs from Default to the server's ceiling (${bare?.min}–${bare?.max})`,
  );
  record(
    bare?.against === null,
    'and offers nothing to work it out against, because the built-in allowance is not a share of anything',
  );
  for (const figure of figuresOf(builtIn)) {
    record(
      (bare?.figures ?? []).includes(figure),
      `at Default it prints the built-in allowance the API gave: ${JSON.stringify(figure)}`,
    );
  }

  /* ---- a share, worked out against one model at a time ---- */

  await drag(SLIDER, SHARE);
  await page.selectOption(AGAINST, roomy.id);
  await page.waitForTimeout(900);

  const generous = await shown(SLIDER);
  const onRoomy = await budgetOf(roomy.id, SHARE);

  record(generous?.said === `${SHARE}%`, `dragging it says what was asked for (${JSON.stringify(generous?.said)})`);
  record(generous?.against === roomy.id, 'a share brings out the model the figures are worked out against');
  record(onRoomy.refusal === null, `${roomy.name} can give ${SHARE}% of its window`);
  for (const figure of figuresOf(onRoomy)) {
    record(
      (generous?.figures ?? []).includes(figure),
      `the page prints what the API answered for that model: ${JSON.stringify(figure)}`,
    );
  }

  /*
   * The honest problem, measured. The same percentage against a window an order
   * of magnitude smaller, and the difference has to reach the screen without
   * the setting being refused: a workspace default is judged on the bounds
   * alone, on purpose, because refusing it here would refuse a default that is
   * right for every other model in the workspace.
   */
  await page.selectOption(AGAINST, cramped.id);
  await page.waitForTimeout(900);

  const tight = await shown(SLIDER);
  const onCramped = await budgetOf(cramped.id, SHARE);
  const asDefault = await defaultOf(SHARE);

  record(
    onCramped.refusal !== null,
    `and ${cramped.name} cannot give the same ${SHARE}% (${onCramped.refusal})`,
  );
  record(asDefault.refusal === null, 'while the server accepts that same share as a workspace default');
  record(
    (tight?.notes ?? []).includes(onCramped.refusal),
    `the page says so in the server's own words (${JSON.stringify((tight?.notes ?? [])[0]?.slice(0, 70))})`,
  );
  record((tight?.figures ?? []).length === 0, 'and prints no figures beside it, which would be a share it will not get');
  record(tight?.saveOff === false, 'but Save stays on: one model cannot refuse a default the others can give');
  record((tight?.alerts ?? []).length === 0, 'and nothing is raised as an alert, because nothing was refused');

  /*
   * And it does not wear the colour of a refusal. Not "is a different colour" -
   * a check that reads a value and asserts it differs passes on a difference no
   * eye can find - but the distance between them, and which of the two tokens
   * it actually landed on.
   */
  const said = await colours(onCramped.refusal);
  record(
    apart(said.colour, said.danger) >= 40,
    `and not in the colour of a refusal, which is beside a Save that works (${said.colour} against ${said.danger})`,
  );
  record(
    apart(said.colour, said.muted) === 0,
    `it is the muted note this card draws its asides in (${said.colour} against ${said.muted})`,
  );

  await page.screenshot({ path: shot('workspace-memory-per-model.png') });

  /* ---- saved, and still there after a reload ---- */

  await page.selectOption(AGAINST, roomy.id);
  await page.waitForTimeout(900);
  await save();

  record((await storedDefault()) === SHARE, `Save records the default on the workspace (${await storedDefault()})`);
  record((await shown(SLIDER))?.saved === true, 'and the card says it saved');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SLIDER, { timeout: 20_000 });
  await page.waitForTimeout(1200);
  record((await settled(SLIDER))?.said === `${SHARE}%`, 'and it comes back on the page after a reload');

  /* ---- and the agent that set nothing now follows it ---- */

  const following = await agentBudget();
  record(following.memoryShare === null, 'the agent has still set no share of its own');
  record(
    following.memoryBudget.share === SHARE && following.memoryBudget.inherited === true,
    `but its budget is the workspace's ${SHARE}%, and says it is inherited ` +
      `(${following.memoryBudget.share}, inherited ${following.memoryBudget.inherited})`,
  );

  await page.goto(`${BASE}/workspace/${WORKSPACE}/agents/${AGENT}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(AGENT_SLIDER, { timeout: 20_000 });
  await page.waitForTimeout(1400);

  const inheriting = await settled(AGENT_SLIDER);
  record(inheriting?.said === 'Default', 'the agent still sits at Default, because it has set nothing');
  record(
    (inheriting?.figures ?? []).includes(`the workspace's ${SHARE}%`),
    `and Default now says where the number comes from (${JSON.stringify(inheriting?.figures)})`,
  );
  for (const figure of figuresOf(await budgetOf(roomy.id, SHARE))) {
    record(
      (inheriting?.figures ?? []).includes(figure),
      `with the inherited share's own figures under it: ${JSON.stringify(figure)}`,
    );
  }
  record(inheriting?.saveOff === false, 'and nothing about inheriting a share stops that agent being saved');

  await page.screenshot({ path: shot('agent-memory-inherited.png') });

  /*
   * And the agent that has no model yet, which is what every agent is on the
   * day it is made.
   *
   * This is the one place the new step behind the agent can go wrong quietly.
   * A share with no window to be a share of is refused - rightly - and an agent
   * at Default now *has* a share where its workspace set one, so the preview
   * this card asks for comes back refused about a share nobody on this form
   * asked for. Printed as a refusal it would turn Save off on every agent made
   * after the workspace decided anything, which is a form that cannot be saved
   * and offers no way out of it. `updateAgent` would have accepted the save: it
   * judges a share only where one was sent.
   */
  await graphql(`mutation($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }`, {
    id: AGENT,
    input: { name: made.createAgent.name, modelId: null },
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(AGENT_SLIDER, { timeout: 20_000 });
  const modelless = await settled(AGENT_SLIDER);
  const withNoModel = await budgetOf(null, null);

  record(withNoModel.refusal !== null, `a share with no model is refused by the server (${withNoModel.refusal})`);
  record(
    modelless?.saveOff === false,
    'but an agent with no model yet can still be saved, because it asked for no share',
  );
  record((modelless?.alerts ?? []).length === 0, 'and nothing on its card is raised as a refusal');
  record(
    (modelless?.figures ?? []).includes('the built-in allowance'),
    `and Default says the built-in allowance, which is what it really gets (${JSON.stringify(modelless?.figures)})`,
  );
  record(
    (modelless?.notes ?? []).includes(withNoModel.refusal),
    'with the server telling it why the workspace share did not reach it',
  );

  await graphql(`mutation($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }`, {
    id: AGENT,
    input: { name: made.createAgent.name, modelId: roomy.id },
  });

  /* ---- cleared, and the agent goes back to the built-in allowance ---- */

  await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SLIDER, { timeout: 20_000 });
  await settled(SLIDER);
  await drag(SLIDER, 0);
  await save();

  record((await storedDefault()) === null, 'dragging back to Default clears the workspace default');

  const alone = await agentBudget();
  record(
    alone.memoryBudget.share === null && alone.memoryBudget.inherited === false,
    `and the agent falls to the built-in allowance again (${alone.memoryBudget.share}, ` +
      `inherited ${alone.memoryBudget.inherited})`,
  );
  record(
    alone.memoryBudget.totalTokens === builtIn.totalTokens,
    `which is the same allowance it had before any of this (${alone.memoryBudget.totalTokens})`,
  );

  await page.goto(`${BASE}/workspace/${WORKSPACE}/agents/${AGENT}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(AGENT_SLIDER, { timeout: 20_000 });
  await page.waitForTimeout(1400);
  record(
    ((await settled(AGENT_SLIDER))?.figures ?? []).includes('the built-in allowance'),
    'and the agent says so, rather than going on naming a workspace share that is gone',
  );

  /* ---- a share outside the bounds, refused in the server's own sentence ---- */

  const refusedByServer = await defaultOf(TOO_MUCH);
  let refusedByMutation = null;
  await graphql(`mutation($w: ID!, $s: Int) { setWorkspaceDefaultMemoryShare(workspaceId: $w, share: $s) { id } }`, {
    w: WORKSPACE,
    s: TOO_MUCH,
  }).catch((cause) => {
    refusedByMutation = String(cause.message ?? cause);
  });

  record(refusedByServer.refusal !== null, `the server refuses ${TOO_MUCH}% as a default (${refusedByServer.refusal})`);
  record(
    refusedByMutation !== null && refusedByMutation.includes(refusedByServer.refusal),
    'and the mutation refuses it in the very same sentence, which is what makes the preview worth printing',
  );
  record((await storedDefault()) === null, 'and nothing was stored by the attempt');

  await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SLIDER, { timeout: 20_000 });
  await settled(SLIDER);
  await drag(SLIDER, TOO_MUCH, true);

  const outside = await shown(SLIDER);
  record(
    (outside?.alerts ?? []).includes(refusedByServer.refusal),
    `the page prints that refusal word for word (${JSON.stringify((outside?.alerts ?? [])[0]?.slice(0, 70))})`,
  );
  record((outside?.figures ?? []).length === 0, 'and shows no figures beside it, which would be a default nobody gets');
  record(outside?.saveOff === true, 'and Save is off while the default cannot be saved');

  const refused = await colours(refusedByServer.refusal);
  record(
    apart(refused.colour, refused.danger) === 0,
    `and this one *is* in the colour of a refusal, because it is one (${refused.colour} against ${refused.danger})`,
  );

  await page.screenshot({ path: shot('workspace-memory-refused.png') });
}

/* -------------------------------------------------- and the fixture is gone */

await graphql(`mutation($w: ID!) { setWorkspaceDefaultMemoryShare(workspaceId: $w, share: null) { id } }`, {
  w: WORKSPACE,
}).catch(() => undefined);
await graphql(`mutation($id: ID!) { deleteAgent(id: $id) }`, { id: AGENT }).catch(() => undefined);
for (const model of [roomy, cramped]) {
  await graphql(`mutation($id: ID!) { removeModel(id: $id) }`, { id: model.id }).catch(() => undefined);
}
console.log('swept the agent, both models and the default');

await finish(browser);
