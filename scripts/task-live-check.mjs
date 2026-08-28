/**
 * A task watched while it runs, and the page keeping up with it on its own.
 *
 * The point of this check is the word *while*. Reading a finished task's log
 * proves nothing about a live view - the old page did that perfectly, one
 * refresh at a time - so what is asserted here is that lines the page did not
 * have when it was drawn were on it afterwards, with nothing having reloaded and
 * nothing having polled, and that they were on it at a moment when the page
 * still said the task was running.
 *
 * **How it can prove that.** Four things make it airtight:
 *
 *   1. There is no refresh control on the page any more, and this asserts that
 *      too. If a poll comes back, this check starts lying, so it also checks
 *      that it cannot.
 *   2. A marker is put on `window` after the page settles. A reload would take
 *      it away, so its survival is proof that nothing navigated.
 *   3. The count of lines and what the page says it is doing are read in *one*
 *      evaluate, so "a line was there while it said Working" is a claim about
 *      one moment rather than about two readings a tenth of a second apart.
 *   4. The task lasts long enough for any of that to be observed at all. See
 *      below, because this is the part that was wrong.
 *
 * ## Why it needs a model, when it used not to
 *
 * It was written against a model pointed at `.invalid`, on the reasoning
 * `task-check` gives: the prompt is written into the log before the model is
 * asked and a model that never answers is recorded as a note saying so, so the
 * session gets lines either way. That is true and it is not enough. Measured:
 * such a task is **forty milliseconds** end to end and writes three lines - the
 * prompt, a note that the model could not answer, and a note that the task
 * stopped. There is no "while". The page usually draws after the task is
 * already over, and on the runs where it does not, every remaining line arrives
 * inside one frame. The retry loop that used to be here - start another, up to
 * four times, until one is caught running - was a lottery dressed as a fixture,
 * and the first time this check was ever executed it lost it four times out of
 * four.
 *
 * So the fixture is a model that takes its time, which is also the only kind
 * that can show the other half of this page: a reasoning model's thinking,
 * drawn while it is being thought. `scripts/suite/reasoning-stub.py` is that
 * model - a page of Python emitting `reasoning_content` over twelve seconds and
 * then calling `task_done`. It cannot be stubbed in the browser, for the reason
 * `image-model-check` gives about its own: the thinking is produced by the
 * server calling a provider, written into the task's session, and followed over
 * a stream, so a stub in the page would be a check of the stub.
 *
 * That is what makes this `ci: false`. What CI keeps is `task-check`, which
 * proves the machinery around a task and needs nothing; what it gives up is a
 * check that could only ever have passed by luck. Run this by hand:
 *
 *   python scripts/suite/reasoning-stub.py 8198
 *   node scripts/suite/run.mjs --only task-live-check
 *
 * Where the stub is, as the *server* reaches it, goes in ORKNUX_REASONING_STUB.
 *
 * The last part opens the finished task in a *new* page, which is the other
 * half of the promise: somebody arriving after the fact must get the same
 * account without the streaming. Same lines, same thinking, same durations, from
 * the same record - which is why the reasoning is written down rather than
 * relayed. `TaskStreamAPI` hands the connection back every four minutes, so
 * anything only relayed would be gone at the next stint.
 */
import { BASE, WORKSPACE, open, check, record, shot, finish } from './suite/harness.mjs';

/** Where something that thinks out loud is, as the *server* sees it. */
const STUB = process.env.ORKNUX_REASONING_STUB ?? 'http://localhost:8198';

const stamp = Date.now();
const PROVIDER = `zzScratchLiveProvider${stamp}`;
const MODEL = `zzScratchLiveModel${stamp}`;
const PROMPT = `zz Scratch Live Task ${stamp} - look at last week's runs and report back`;

const { browser, context, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/*
 * Anything an earlier run left behind. Swept at the start rather than guarded at
 * the end, because a `finally` cannot clean up after the suite's own timeout.
 */
const before = await graphql(
  `query ($workspaceId: ID!) {
     workspaceTasks(workspaceId: $workspaceId, page: 0, size: 200) { content { id title status } }
     modelProviders(workspaceId: $workspaceId) { id name }
     workspaceAgents(workspaceId: $workspaceId, page: 0, size: 200) { content { id name } }
   }`,
  { workspaceId: WORKSPACE },
);
for (const old of before.workspaceTasks.content.filter((row) => row.title.startsWith('zz Scratch Live Task'))) {
  if (!['DONE', 'FAILED', 'STOPPED'].includes(old.status)) {
    await graphql(`mutation ($id: ID!) { stopTask(id: $id) { id } }`, { id: old.id }).catch(() => undefined);
  }
  await graphql(`mutation ($id: ID!) { deleteTask(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept task ${old.title} (#${old.id}) from an earlier run`);
}
for (const old of before.modelProviders.filter((row) => row.name.startsWith('zzScratchLiveProvider'))) {
  await graphql(`mutation ($id: ID!) { removeModelProvider(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept provider ${old.name} (#${old.id}) from an earlier run`);
}
/*
 * And the agent, which is named after the model it was made from and so carries
 * the model's prefix rather than a prefix of its own. Taking the provider away
 * does not take it with it, and an agent standing on a model that is gone is
 * exactly the debris the picker would then be offering.
 */
for (const old of before.workspaceAgents.content.filter((row) => row.name.startsWith('zzScratchLiveModel'))) {
  await graphql(`mutation ($id: ID!) { deleteAgent(id: $id) }`, { id: old.id }).catch(() => undefined);
  console.log(`swept agent ${old.name} (#${old.id}) from an earlier run`);
}

// A model that takes its time and thinks out loud, which is what this check
// needs one to be. It makes its own and takes it away again: a seeded
// installation has none, and one that borrowed whatever was there would say a
// different thing on every machine.
const provider = (
  await graphql(`mutation ($input: CreateModelProviderInput!) { createModelProvider(input: $input) { id } }`, {
    input: { workspaceId: WORKSPACE, name: PROVIDER, endpoint: STUB, secret: 'sk-scratch' },
  })
).createModelProvider;
const model = (
  await graphql(`mutation ($input: CreateModelInput!) { createModel(input: $input) { id } }`, {
    input: { providerId: provider.id, name: MODEL, modelId: 'stub-reasoning', kind: 'CHAT' },
  })
).createModel;
console.log(`made ${MODEL} (#${model.id}) pointed at ${STUB}`);

/*
 * And an agent standing on it, because that is what a task is given now. Issue
 * #295 made `agentId` required and took the bare model out of the picker, so
 * the option chosen below is an agent rather than a model.
 * `createAgentForModel` makes one named after the model and granted nothing,
 * which is the right fixture here: what is being watched is the stub's thinking
 * arriving on the page, and grants would only add rounds it has to get through
 * before it starts.
 */
const worker = (
  await graphql(`mutation ($m: ID!) { createAgentForModel(modelId: $m) { id name } }`, { m: model.id })
).createAgentForModel;
console.log(`made agent ${worker.name} (#${worker.id}) to be given the task`);

// --- start it from the page, so the page is open while it works -------------

const OVER = ['Done', 'Failed', 'Stopped'];

/**
 * Everything this check reads off the page, in one evaluate.
 *
 * One round trip rather than five, and that is the whole of what makes the
 * assertions below say anything. "A line was on the page while the page said the
 * task was running" is a claim about *one* moment; two round trips to the
 * browser are two moments a tenth of a second apart, and this check's first ever
 * run failed on exactly that - it read the state, found the task over, and
 * stopped without ever looking at the log that had filled up while it was
 * asking. Which of the two came first decided the verdict, and neither order
 * was measuring anything.
 */
const readPage = () =>
  page.evaluate(() => {
    const block = document.querySelector('[data-testid="thinking"]');
    return {
      lines: document.querySelectorAll('[data-testid="task-log"] [data-kind]').length,
      state: document.querySelector('[data-testid="task-state"]')?.textContent?.trim() ?? '',
      watching: document.querySelector('[data-testid="task-watching"]')?.textContent?.trim() ?? '',
      thinking: block !== null,
      live: block?.getAttribute('data-live') ?? '',
      open: block?.querySelector('button')?.getAttribute('aria-expanded') ?? '',
      elapsed: block?.querySelector('[data-testid="thinking-elapsed"]')?.textContent?.trim() ?? '',
      label: block?.querySelector('button')?.textContent?.trim() ?? '',
      /*
        Whether the round's answer is on the page yet.

        Asked as "is there an AGENT line" rather than off the line count,
        because that count is not a count of lines: a spoken line draws a
        `data-kind` on its row and another on the word that says who spoke, so
        every one of them counts twice. It is the right number to compare with
        itself, which is all the growth assertions do with it, and the wrong
        number to compare with a threshold.
      */
      answered: document.querySelector('[data-testid="task-log"] [data-kind="AGENT"]') !== null,
      reasoning: block?.querySelector('pre')?.textContent?.length ?? 0,
    };
  });

await page.goto(`${BASE}/workspace/${WORKSPACE}/tasks`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:text("Tasks")', { timeout: 20_000 });
await page.locator('#task-prompt').fill(PROMPT);
await page.locator('#task-worker').selectOption(String(worker.id));
await page.locator('button:text("Start")').click();
await page.waitForURL(/\/tasks\/\d+$/, { timeout: 20_000 });
const taskId = page.url().split('/').pop();
await page.waitForSelector('[data-testid="task-log"]', { timeout: 20_000 });

const drawn = await readPage();
check(
  !OVER.includes(drawn.state),
  `the page is open on a task that is still going: "${drawn.state}", with ${drawn.lines} line(s) drawn`,
  `task #${taskId} already read "${drawn.state}" when the page drew, so there was nothing live to watch. ` +
    `Is ${STUB} answering? (python scripts/suite/reasoning-stub.py 8198)`,
);
if (OVER.includes(drawn.state)) await finish(browser);

/**
 * What the page held the moment it was drawn, and never touched again.
 *
 * The growth assertion used to be made against a variable the watching loop
 * overwrote every quarter second - so what it actually asserted was that a line
 * landed in the last 250ms before the ending, which is a window this check has
 * no way to aim at. This one is the reading taken before any of it, so the
 * comparison is "the page has more on it than it was drawn with" - which is the
 * claim, and is not a race.
 */
const drawnAtFirst = drawn.lines;

/*
 * The marker. Anything that navigates takes it with it, so every assertion after
 * this one is also an assertion that the page never reloaded.
 */
await page.evaluate(() => {
  window.__orknuxNeverReloaded = true;
});

// --- there is no refresh control, and that matters ---------------------------

/*
 * Asserted rather than assumed. If an AutoRefresh came back, the growth this
 * check measures below could be a poll rather than the stream, and the check
 * would go on passing while testing nothing - which is the failure mode the
 * whole suite is written against.
 */
const refreshers = await page.locator('select[aria-label="Refresh automatically"]').count();
check(
  refreshers === 0,
  'the page has no refresh control, so nothing on it can be arriving by poll',
  'a refresh control is on the page, and anything arriving could be a poll rather than the stream',
);

// --- the model thinking, drawn while it thinks -------------------------------

/*
 * Waited for on its own rather than after the ending, because a check that only
 * looked at a finished task's log would pass just as well on a build that wrote
 * the whole of the reasoning down once the turn was over - which is exactly the
 * shape this feature replaced, and the one that made the page read as dead
 * between turns.
 */
let sawThinking = false;
try {
  await page.locator('[data-testid="thinking"]').first().waitFor({ state: 'visible', timeout: 60_000 });
  sawThinking = true;
} catch {
  sawThinking = false;
}
const midRun = await readPage();
check(
  sawThinking && midRun.live === 'true' && !OVER.includes(midRun.state),
  `what the model is thinking is drawn while the task still reads "${midRun.state}"`,
  `the thinking block reads live="${midRun.live}" on a task reading "${midRun.state}"`,
);

/*
 * The fold, which is where this page and the chat part company.
 *
 * The chat folds every block, because thinking is the model talking to itself
 * and belongs where a footnote belongs. A task takes dozens of turns, so drawing
 * all of them open would put the work somebody came to watch off the bottom of
 * the screen - but what they came for is the model thinking *now*. So the block
 * being written is open, and the ones after the fact are not; the second half of
 * that is asserted at the end.
 */
check(
  midRun.open === 'true' && midRun.reasoning > 0,
  `the block being written is open, with ${midRun.reasoning} characters of reasoning readable without a press`,
  `the live block reads aria-expanded="${midRun.open}" with ${midRun.reasoning} characters shown`,
);

/*
 * And something on it moves.
 *
 * The assertion the chat's own check was rebuilt around, and the one worth
 * having here. A block of text that happens to be growing does not tell somebody
 * the model is alive - a number going up does - and neither "it is drawn" nor
 * "the live mark is set" can tell those apart. Two and a bit seconds, because
 * the count moves once a second and one second could straddle a single tick and
 * read the same value twice for honest reasons.
 */
await page.waitForTimeout(2200);
const later = await readPage();
check(
  midRun.elapsed !== '' && later.elapsed !== '' && midRun.elapsed !== later.elapsed && !OVER.includes(later.state),
  `the count of how long it has been thinking moves while the task runs (${midRun.elapsed} then ${later.elapsed})`,
  `the count read ${JSON.stringify(midRun.elapsed)} then ${JSON.stringify(later.elapsed)} ` +
    `on a task reading "${later.state}"`,
);

/*
 * And the words themselves grow, which is the other half of "live".
 *
 * The count is the browser's own clock and would tick just as happily beside a
 * block that never changed. This is what says the *session* is being written to
 * while the model works rather than once at the end - the line is opened on the
 * first frame of reasoning and grown as the rest arrives, and the page is being
 * handed it again each time it does.
 */
check(
  later.reasoning > midRun.reasoning,
  `and the reasoning itself grows on the open page: ${midRun.reasoning} characters, then ${later.reasoning}`,
  `the reasoning stood at ${midRun.reasoning} characters and was still ${later.reasoning} two seconds later`,
);

await page.screenshot({ path: shot('task-live-check.png'), fullPage: true });

// --- and it reaches the ending on its own ------------------------------------

/*
 * Keep looking until it is over. Reading the browser only - no reload, no
 * navigation, no GraphQL - so the only thing that can move any of this is the
 * stream.
 */
let ended = null;

/**
 * Whether a line landed while the page still said the task was running.
 *
 * The assertion this check exists for, and it is noted *inside* the loop rather
 * than sampled once. Not "the page ended up with more lines than it started
 * with", which a task that delivered everything in its dying moment would also
 * satisfy - but that a line was on the page at a moment when the page still
 * said the task was running. Read from the browser only, on a page that has not
 * reloaded and has no refresh control, so the stream is the only thing that can
 * have put it there.
 */
let grewWhileGoing = false;

/**
 * And whether the reasoning stopped before the answer was written.
 *
 * Issue #290, noted in this loop rather than waited for in one of its own so
 * that it costs the check no time and cannot eat the window the assertion above
 * is measuring.
 *
 * Nothing used to close a round's reasoning except a tool call or the end of
 * the turn, so a model that thought for ten seconds and then wrote for two
 * minutes left the block open for the whole two minutes: counting up, labelled
 * *Thinking*, and holding the reasoning wherever the last flush had left it -
 * which is a sentence that stops in the middle. It was read as the live view
 * having stopped delivering; it was the record having nothing more to deliver.
 *
 * The discriminating condition is that the answer is not on the page yet. A
 * block closed only by the end of the turn is closed *after* the answer has
 * been written down, so this can never be true of one; `reasoning-stub.py`
 * writes its answer over ten seconds so there is a stretch where it can be.
 */
let settledBeforeTheAnswer = null;

for (let look = 0; look < 600 && ended === null; look += 1) {
  const held = await readPage();
  if (held.lines > drawnAtFirst && !OVER.includes(held.state)) grewWhileGoing = true;
  if (
    settledBeforeTheAnswer === null &&
    held.thinking &&
    held.live === 'false' &&
    !held.answered &&
    !OVER.includes(held.state)
  ) {
    settledBeforeTheAnswer = held;
  }
  if (OVER.includes(held.state)) {
    ended = held.state;
    break;
  }
  await page.waitForTimeout(200);
}

check(
  ended !== null,
  `the page reached the ending on its own: "${ended}"`,
  'the page never showed the task ending, having neither been reloaded nor polled',
);

/*
 * A moment for the last of it to land before the page is measured.
 *
 * The state and the last few lines of a finished task arrive within
 * milliseconds of each other, and which the browser paints first is not a fact
 * about anything. Waiting is not touching the page: no reload, no navigation,
 * no query, and the marker below still has to survive.
 */
await page.waitForTimeout(1_500);
const drawnAtEnd = (await readPage()).lines;

check(
  grewWhileGoing,
  `a line arrived on the open page while the task was still running: ${drawnAtFirst} drawn, then more before it ended`,
  `nothing arrived while the task was running: the page held ${drawnAtFirst} lines throughout`,
);

check(
  settledBeforeTheAnswer !== null,
  `the thinking stopped saying it was arriving before the answer was written: ` +
    `${JSON.stringify(settledBeforeTheAnswer?.label ?? '')} on a task still reading ` +
    `"${settledBeforeTheAnswer?.state ?? ''}"`,
  'the block went on claiming to be arriving for the whole of the answer and stopped only once the ' +
    'turn was over, which is what somebody watching reads as the page having frozen',
);

check(
  drawnAtEnd > drawnAtFirst,
  `and the page grew without being touched: ${drawnAtFirst} when drawn, ${drawnAtEnd} at the end`,
  `the page never grew: it held ${drawnAtFirst} lines when drawn and ${drawnAtEnd} at the end`,
);

/*
 * And none of it was a reload. This is the assertion the ones above lean on:
 * without it "the page changed" could always have been "the page was rebuilt".
 */
const marker = await page.evaluate(() => window.__orknuxNeverReloaded === true);
check(
  marker,
  'the page never reloaded, so what appeared on it was streamed onto it',
  'the page reloaded at some point, so nothing above says anything about streaming',
);

/*
 * The page says so, too. A screen that promises what is on it is what is
 * happening has to be honest about having stopped, and a finished task is the
 * one case where "live" would be a lie for ever.
 */
const finished = await readPage();
check(
  finished.watching === 'Finished',
  'a finished task says it is finished rather than going on claiming to be live',
  `the page still says "${finished.watching}" on a task that has ended`,
);

/*
 * And the thinking settles rather than counting for ever. A block still saying
 * "Thinking" under a task that ended last week is the same lie in the other
 * direction.
 */
const settled = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('[data-testid="thinking"]')];
  return {
    blocks: blocks.length,
    live: blocks.some((block) => block.getAttribute('data-live') === 'true'),
    label: blocks[0]?.querySelector('button')?.textContent?.trim() ?? '',
  };
});
check(
  settled.blocks > 0 && !settled.live,
  `${settled.blocks} block(s) of thinking on the finished task, none still claiming to be arriving`,
  'a block still reads live on a task that has ended',
);
check(
  /second/i.test(settled.label) || /sekund/i.test(settled.label),
  `and each says how long it took (the first reads ${JSON.stringify(settled.label)})`,
  `the row reads ${JSON.stringify(settled.label)} and says no duration`,
);

// --- and it reads the same after the fact ------------------------------------

/*
 * A page that never saw any of it happen. Everything the first one was handed a
 * line at a time is in the session, so this must hold the same account - which
 * is the whole reason the stream relays a durable log rather than carrying the
 * work itself, and the reason the reasoning is written down rather than passed
 * on and forgotten.
 */
const afterwards = await context.newPage();
await afterwards.goto(`${BASE}/workspace/${WORKSPACE}/tasks/${taskId}`, { waitUntil: 'domcontentloaded' });
await afterwards.waitForSelector('[data-testid="task-log"]', { timeout: 20_000 });
await afterwards.waitForTimeout(1_000);
const read = await afterwards.evaluate(() => {
  const blocks = [...document.querySelectorAll('[data-testid="thinking"]')];
  return {
    lines: document.querySelectorAll('[data-testid="task-log"] [data-kind]').length,
    state: document.querySelector('[data-testid="task-state"]')?.textContent?.trim() ?? '',
    blocks: blocks.length,
    folded: blocks.every((block) => block.querySelector('button')?.getAttribute('aria-expanded') === 'false'),
    live: blocks.some((block) => block.getAttribute('data-live') === 'true'),
  };
});

check(
  read.lines === drawnAtEnd,
  `a page opened after the fact shows the same ${read.lines} lines, without having streamed any of them`,
  `the page that watched it holds ${drawnAtEnd} lines and one opened afterwards holds ${read.lines}`,
);

const laterHasPrompt = (await afterwards.locator(`[data-testid="task-log"] :text("${PROMPT}")`).count()) > 0;
record(laterHasPrompt, 'and it is the same account: what was asked is on it');

check(
  read.blocks === settled.blocks && !read.live,
  `and the same ${read.blocks} block(s) of thinking, none of them claiming to still be arriving`,
  `it holds ${read.blocks} block(s) where the page that watched held ${settled.blocks}, still live=${read.live}`,
);

/*
 * Folded, every one of them. The block that was open was open because it was
 * being written; a page opened afterwards has no such block, so it has no
 * business opening any of them.
 */
check(
  read.folded,
  'and every block of it is folded, because none of them is the one being written',
  'a block is drawn open on a page that watched none of it happen',
);

check(
  read.state === ended,
  `and the same ending: "${read.state}"`,
  `the ending reads "${read.state}" after the fact and read "${ended}" live`,
);

await afterwards.close();

// --- put it back the way it was ---------------------------------------------

await graphql(`mutation ($id: ID!) { deleteTask(id: $id) }`, { id: taskId }).catch(() => undefined);
await graphql(`mutation ($id: ID!) { deleteAgent(id: $id) }`, { id: worker.id }).catch(() => undefined);
await graphql(`mutation ($id: ID!) { removeModelProvider(id: $id) }`, { id: provider.id }).catch(() => undefined);

await finish(browser);
