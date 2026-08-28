/**
 * Issue #299: interrupting stopped the listening and stopped nothing else.
 *
 * Pressing the big circle in voice mode moved the turn on, silenced the reading
 * and put the panel back to Listening — and left the request exactly where it
 * was. The model went on composing an answer nobody would ever hear, every word
 * of it was charged for, and the next thing said raced a turn that had never
 * ended. Everything on screen said it had stopped, which is why it went
 * unnoticed for so long: the only place the bug is visible is the request.
 *
 * So that is where this looks, and it looks at the browser's own network layer
 * rather than at a `fetch` replaced inside the page. A stub can report that
 * somebody handed it a signal; what has to be true is that the request was
 * really let go of, and `requestfailed` carrying `net::ERR_ABORTED` is the
 * browser itself saying so. That is also the event the server sees as the
 * connection closing, which is what `ReaderWatch` on the other side reads as
 * nobody being left to answer.
 *
 * **The stream is held open and never answered.** The chat's own endpoint is
 * intercepted and simply not replied to, which is the state a person is in when
 * they decide they have heard enough: the model is thinking and there is
 * nothing on screen yet. A real model either answers before anybody could press
 * anything or, against a seeded installation with no provider that responds,
 * never answers at all — and neither of those is the moment being tested.
 *
 * Both doors are driven, because the two must not disagree. The composer's Stop
 * is the one somebody typing uses and the circle is the one somebody talking
 * uses; underneath they are the same interruption, or they are two bugs
 * waiting.
 *
 * **The microphone is deliberately not granted.** The panel opens one on mount
 * and says so when it cannot, which is a line on screen and nothing more — a
 * turn typed into the composer while voice mode is open is handed to the panel
 * and answered by it exactly as a spoken one is. That keeps the drive
 * deterministic: two known messages, sent when this check sends them, rather
 * than whatever a fake device is heard to say.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const PREFIX = 'zzInterrupt';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ------------------------------------------------------- holding it open */

const STREAM = /\/api\/chats\/[^/]+\/stream/;

/** Every stream the page opened, and every one the browser then let go of. */
const opened = [];
const abandoned = [];

page.on('request', (request) => {
  if (STREAM.test(request.url())) opened.push(request);
});
page.on('requestfailed', (request) => {
  if (!STREAM.test(request.url())) return;
  abandoned.push({ at: opened.indexOf(request), why: request.failure()?.errorText ?? '' });
});

/*
 * Intercepted and never answered. Left unfulfilled the request stays open for
 * as long as the page holds it, which is the model thinking - and the page
 * letting go of it is the whole of what this check is about.
 */
await page.route(STREAM, () => undefined);

/* ----------------------------------------------------------- the fixture */

async function sweep() {
  const { models } = await graphql('query($w: ID!) { models(workspaceId: $w) { id name } }', { w: WORKSPACE });
  const { workspace } = await graphql(
    'query($id: ID!) { workspace(id: $id) { transcriptionModelId speechModelId } }',
    { id: WORKSPACE },
  );
  const mine = models.filter((one) => one.name.startsWith(PREFIX));
  if (mine.some((one) => one.id === workspace.transcriptionModelId)) {
    await graphql('mutation($w: ID!) { setWorkspaceTranscriptionModel(workspaceId: $w, modelId: null) { id } }', {
      w: WORKSPACE,
    }).catch(() => undefined);
  }
  if (mine.some((one) => one.id === workspace.speechModelId)) {
    await graphql('mutation($w: ID!) { setWorkspaceSpeechModel(workspaceId: $w, modelId: null) { id } }', {
      w: WORKSPACE,
    }).catch(() => undefined);
  }
  for (const old of mine) {
    await graphql('mutation($id: ID!) { removeModel(id: $id) }', { id: old.id }).catch(() => undefined);
    console.log(`swept model ${old.name} (#${old.id})`);
  }

  const { chatSessions } = await graphql('query($w: ID!) { chatSessions(workspaceId: $w) { id title } }', {
    w: WORKSPACE,
  });
  for (const old of chatSessions.filter((one) => (one.title ?? '').startsWith(PREFIX))) {
    await graphql('mutation($id: ID!) { deleteChat(id: $id) }', { id: old.id }).catch(() => undefined);
    console.log(`swept chat ${old.title} (#${old.id})`);
  }
}

await sweep();

const { modelProviders } = await graphql('query($w: ID!) { modelProviders(workspaceId: $w) { id name } }', {
  w: WORKSPACE,
});
const provider = modelProviders[0];
if (provider === undefined) {
  record(false, 'this workspace has no model provider, so there is no chat to interrupt');
  await finish(browser);
}

/**
 * A transcription model and a speech model, because voice mode is offered only
 * to a workspace that can both hear and speak. Neither is ever called: no
 * microphone is granted and no answer is ever completed to be read aloud.
 */
async function makeModel(kind) {
  const made = await graphql('mutation($input: CreateModelInput!) { createModel(input: $input) { id name } }', {
    input: { providerId: provider.id, name: `${PREFIX} ${kind}`, modelId: `${PREFIX}-${kind.toLowerCase()}`, kind },
  });
  console.log(`made model ${made.createModel.name} (#${made.createModel.id})`);
  return made.createModel;
}

const ears = await makeModel('TRANSCRIPTION');
const mouth = await makeModel('SPEECH');
await graphql('mutation($w: ID!, $m: ID) { setWorkspaceTranscriptionModel(workspaceId: $w, modelId: $m) { id } }', {
  w: WORKSPACE,
  m: ears.id,
});
await graphql('mutation($w: ID!, $m: ID) { setWorkspaceSpeechModel(workspaceId: $w, modelId: $m) { id } }', {
  w: WORKSPACE,
  m: mouth.id,
});

const started = await graphql('mutation($input: StartChatInput!) { startChat(input: $input) { id title } }', {
  input: { workspaceId: WORKSPACE, title: `${PREFIX} ${Date.now()}` },
});
const CHAT = started.startChat.id;
console.log(`made chat ${started.startChat.title} (#${CHAT})`);

/* --------------------------------------------------------------- reading it */

/** What the panel and the composer say, this instant. */
const READ = () =>
  page.evaluate(() => {
    const panel = document.querySelector('aside[aria-label="Voice mode"]');
    const lines = panel === null ? [] : [...panel.querySelectorAll('p')].map((one) => one.textContent.trim());
    return {
      caption: lines.find((text) => ['Listening', 'Thinking', 'Speaking'].includes(text)) ?? null,
      send: (document.querySelector('form button[type="submit"]')?.textContent ?? '').trim(),
      stopOffered: [...document.querySelectorAll('form button')].some(
        (one) => (one.textContent ?? '').trim() === 'Stop',
      ),
    };
  });

/** Watches until something is true of the page, or gives up and says what it saw. */
async function until(what, why, ms) {
  const stop = Date.now() + ms;
  for (;;) {
    const now = await READ()
      .then((seen) => ({ ...seen, opened: opened.length, abandoned: [...abandoned] }))
      .catch(() => null);
    if (now !== null && what(now)) return now;
    if (Date.now() > stop) {
      console.log(`gave up waiting for ${why}: ${JSON.stringify(now)}`);
      return null;
    }
    await page.waitForTimeout(120);
  }
}

/* --------------------------------------------------- the composer's Stop */

await page.goto(`${BASE}/chat/${CHAT}`, { waitUntil: 'domcontentloaded' });

if (!(await drawn(page, 'the chat'))) {
  await sweep();
  await finish(browser);
}

await page.waitForSelector('#chat-composer', { state: 'visible', timeout: 25_000 });
await page.waitForTimeout(500);

await page.fill('#chat-composer', 'Take your time thinking about this one');
await page.keyboard.press('Enter');

const waiting = await until((now) => now.opened === 1, 'the turn to go out', 15_000);
record(waiting !== null, 'a typed turn opens a stream and the model is thinking');

const offered = await until((now) => now.stopOffered, 'a Stop control in the composer', 8_000);
record(offered !== null, 'a Stop is offered while the model is working');
record(
  offered !== null && ['Waiting…', 'Answering…'].includes(offered.send),
  `and the send button still says what is happening (it says "${offered?.send ?? '-'}")`,
);
await page.screenshot({ path: shot('chat-interrupt-composer.png') });

if (offered !== null) {
  await page.click('form button:text-is("Stop")');

  const stopped = await until((now) => now.abandoned.length === 1, 'the request to be let go of', 6_000);
  record(
    stopped !== null,
    `pressing it lets go of the request rather than merely looking away from it ` +
      `(${JSON.stringify(stopped?.abandoned ?? abandoned)})`,
  );
  record(
    stopped !== null && /aborted/i.test(stopped.abandoned[0].why),
    'and the browser reports it as aborted, which is the connection closing under the server',
  );

  const back = await until((now) => now.send === 'Send' && !now.stopOffered, 'the composer to settle', 8_000);
  record(back !== null, 'and the composer goes back to Send with nothing in flight');

  const complained = await page.evaluate(() =>
    [...document.querySelectorAll('p')].some((one) => /did not answer|could not answer/i.test(one.textContent ?? '')),
  );
  record(!complained, 'stopping is not reported as a failure: nothing is put on screen in red for it');
}

/* ------------------------------------------------------ the voice circle */

const enters = await page
  .waitForSelector('button[aria-label="Enter voice mode"]', { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
record(enters, 'voice mode is offered on a chat whose workspace can hear and speak');

if (!enters) {
  await sweep();
  await finish(browser);
}

await page.click('button[aria-label="Enter voice mode"]');
await page.waitForSelector('aside[aria-label="Voice mode"]', { timeout: 15_000 });

/*
 * Typed rather than spoken, and handed to the panel by the composer exactly as
 * a spoken turn is handed to it by the microphone. See the note at the top:
 * what is being measured is the interruption, and a fake device would decide
 * for itself when a turn began.
 */
await page.fill('#chat-composer', 'And this one as well, at length');
await page.keyboard.press('Enter');

const thinking = await until((now) => now.opened === 2 && now.caption === 'Thinking', 'the spoken turn', 15_000);
record(thinking !== null, 'a turn taken in voice mode goes out, and the panel says it is thinking');
await page.screenshot({ path: shot('chat-interrupt-voice.png') });

if (thinking !== null) {
  await page.click('aside[aria-label="Voice mode"] button[aria-label="Stop this turn and listen"]');

  /*
   * The assertion this whole check exists for. Before the fix the caption below
   * went back to Listening within a frame and this stayed at one for ever.
   */
  const cut = await until((now) => now.abandoned.length === 2, 'the circle to stop the turn', 6_000);
  record(
    cut !== null,
    `pressing the circle lets go of the turn in flight, rather than only stopping listening to it ` +
      `(${JSON.stringify(cut?.abandoned ?? abandoned)})`,
  );
  record(
    cut !== null && /aborted/i.test(cut.abandoned[1].why),
    'and the browser reports that one as aborted too, so the server can hang up on the provider',
  );

  const listening = await until((now) => now.caption === 'Listening', 'the panel to go back to listening', 6_000);
  record(listening !== null, 'and the panel goes back to listening, which is what the press asked for');
}

await sweep();
await finish(browser);
