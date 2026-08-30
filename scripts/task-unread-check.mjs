/**
 * A message a task never read, on a task that is over.
 *
 * It used to disappear. The whole "Say something" card - the box *and* the list
 * of what had been said and not yet read - was drawn only while the task was
 * running, so the moment the row went to DONE the card went with it and took
 * somebody's correction off the screen. Nothing anywhere said it had been typed;
 * the row was still in the database with nothing read against it, and the only
 * way to learn that was to ask the API. That is task 30 on the developer's own
 * installation, and it is the half of #280 that made the other half look like a
 * bug rather than a limit.
 *
 * The two rules this pins are deliberately not the same rule:
 *
 *   - **The box goes.** A task that has ended will read nothing, the server
 *     refuses a message to one, and a box that takes words nothing will ever
 *     read is worse than no box.
 *   - **What was said stays**, marked as never read. It is the only record that
 *     it happened, and it is the state of the thing being looked at rather than
 *     an explanation of it.
 *
 * A task that finished normally cannot have one - `TaskLoop` reads what is
 * waiting before it lets `task_done` through, which `TaskLoopTest` pins - so
 * this is the shape that survives: the task that failed, was stopped, or ran out
 * of turns with something still unread.
 *
 * Fabricated in the browser, as `task-picture-check` fabricates its own and for
 * the same reason. Producing this state for real means a task that fails at the
 * exact moment somebody types, which is not a thing a check can arrange; what is
 * being checked is one screen given one answer, so the answer is supplied.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const TASK = '99999905';

const SAID = 'Actually, make it about hobbits.';

/** Stopped with something still unread, which is the state that can survive. */
const task = {
  id: TASK,
  workspaceId: WORKSPACE,
  title: 'Write a poem about lizards',
  prompt: 'Write a poem about lizards and draw something to go with it.',
  agentId: null,
  agentName: 'Poet',
  modelId: null,
  status: 'STOPPED',
  // No session, so the page opens no stream and fetches no log: a `state` frame
  // from a real one would carry a real task and quietly replace this.
  sessionId: null,
  issueId: null,
  createdBy: 'alice',
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  turnsSpent: 1,
  turnsAllowed: 40,
  workedSeconds: 58,
  secondsAllowed: 7200,
  waitingUntil: null,
  outcome: null,
  endedBecause: 'stopped',
  requests: [],
  grants: [],
  messages: [
    { id: '1', saidBy: 'alice', body: SAID, sentAt: new Date().toISOString(), readAt: null },
  ],
};

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

await page.route('**/graphql', async (route) => {
  const body = route.request().postData() ?? '';
  if (!body.includes('task(id: $id)')) return route.continue();
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { task } }),
  });
});

await page.goto(`${BASE}/workspace/${WORKSPACE}/tasks/${TASK}`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the task page'))) await finish(browser);
await page.waitForTimeout(900);

/** The card, the box inside it, and what it says, in one pass. */
const read = () =>
  page.evaluate(() => {
    const card = document.querySelector('[data-testid="task-message"]');
    const pending = document.querySelector('[data-testid="task-message-pending"]');
    return {
      card: card !== null,
      typing: card?.querySelector('input') != null,
      lines: pending?.querySelectorAll('li').length ?? 0,
      said: pending?.textContent ?? '',
      body: document.body.innerText,
    };
  });

const over = await read();

record(over.card, 'a message that was never read is still on the page after the task ended');
record(
  !over.typing,
  'and the box is gone, because a task that has ended will read nothing typed into it',
);
record(over.lines === 1, `what was said is listed, once (${over.lines})`);
record(over.said.includes(SAID), `in the words it was typed in ("${SAID}")`);
record(
  /never read|nigdy nie przeczytane/i.test(over.said),
  `and it says it was never read rather than that it is waiting ("${over.said.trim()}")`,
);
record(
  !/not read yet|jeszcze nie przeczytane/i.test(over.said),
  'not "not read yet", which on a task that is over would be a page promising something that cannot happen',
);

await page.screenshot({ path: shot('task-unread.png') });

/* ---------------------------------------- and nothing left over when it was read */

/*
 * The other half of the same rule, on the same page. A task that ended with
 * everything read has nothing to show and no box either, so the card is absent
 * altogether - which is what stops this becoming an empty panel on every
 * finished task anybody opens.
 */
task.messages = [{ ...task.messages[0], readAt: new Date().toISOString() }];
await page.reload({ waitUntil: 'domcontentloaded' });
await drawn(page, 'the task page again');
await page.waitForTimeout(900);

const settled = await read();
record(!settled.card, 'a task that ended with everything read shows no card at all');

await finish(browser);
