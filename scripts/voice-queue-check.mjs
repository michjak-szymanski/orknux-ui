/**
 * What happens to something said - or typed - while voice mode is busy.
 *
 * Issues #254 and #262, which are the same seam from three sides.
 *
 *   #254  the microphone closed between turns, so anything said while the model
 *         was thinking or the answer was being read went nowhere at all. Most
 *         of a conversation is that gap. It is held now and sent when the turn
 *         comes round, and the panel says so while it is waiting.
 *   #262  a person in voice mode could not type, "thinking" was shown only on
 *         the panel and never in the conversation itself, and the panel claimed
 *         to be speaking before any sound had come out of it.
 *
 * Four things this is here to catch, and the first is the only one a screenshot
 * would show:
 *
 *   the waiting     what is said into the gap is transcribed and shown as
 *                   waiting rather than dropped
 *   the appending   a second message while one is already waiting is added to
 *                   it - both were said to the same turn - and the pair is sent
 *                   as one when that turn ends, with nobody pressing anything
 *   the thinking    the conversation says the model is working, not only the
 *                   panel off to the side
 *   the speaking    the panel says it is speaking when sound starts, not when
 *                   the answer started arriving. The stubbed speech model takes
 *                   a known time over a clip, and the caption is watched across
 *                   that gap: before the fix it read Speaking through all of it
 *
 * And one that is a regression rather than a feature: **cutting in must not
 * silence the panel for the rest of the session.** That was a real bug once -
 * a flag left true across turns, the microphone still working, the answers
 * still arriving and nothing ever read aloud again - so the last phase
 * interrupts on purpose and then insists on hearing the next turn.
 *
 * **The model, the ears and the mouth are all this check's own.** Not to avoid
 * the server: a stubbed speech model is what makes "before any sound" a
 * measurement, a stubbed transcript is what makes two utterances two known
 * sentences, and a stubbed stream is what holds one answer back long enough for
 * somebody to talk over it. The microphone is a file Chromium is told to
 * believe. Everything else - the page, the session, the chat, every GraphQL
 * call the sends make - is the real thing.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const PREFIX = 'zzVoiceQueue';

/** How long the first stubbed answer is held back, which is the gap to talk into. */
const THINKS_FOR = 12_000;
/** And every answer after it, which only has to be long enough to be seen. */
const ANSWERS_IN = 800;
/** How long the stubbed speech model takes over one piece. */
const SYNTH_MS = 1_200;

/** What is typed into the composer while the panel is busy. */
const TYPED = 'And also please check the log';

/* ------------------------------------------------- a microphone to speak at */

/**
 * Somebody who speaks for a moment, waits, and speaks again.
 *
 * Several tones rather than one because the panel opens the device again
 * between utterances now, and a fake device that reads a file may or may not
 * start it over when it does. Either way there is another moment of speech
 * within a few seconds, which is what this needs; what it must never be is a
 * file that loops, since that would start talking in the middle of the pause
 * that ends a turn.
 */
const SPEAKING_MS = 1_200;
const QUIET_MS = 4_800;
const TURNS = 8;
const RATE = 48_000;

function fakeMicrophone(path) {
  const frames = Math.round((RATE * (SPEAKING_MS + QUIET_MS) * TURNS) / 1000);
  const body = Buffer.alloc(frames * 2);
  const speaking = Math.round((RATE * SPEAKING_MS) / 1000);
  const round = Math.round((RATE * (SPEAKING_MS + QUIET_MS)) / 1000);
  for (let at = 0; at < frames; at += 1) {
    if (at % round >= speaking) continue;
    // 220 Hz at half scale: periodic, so nothing on the way in mistakes it for
    // room noise and takes it away.
    body.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * at) / RATE) * 16_000), at * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + body.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(body.length, 40);

  writeFileSync(path, Buffer.concat([header, body]));
  return path;
}

const MICROPHONE = fakeMicrophone(join(tmpdir(), 'orknux-voice-queue.wav'));

/** What a browser needs to believe that file is somebody talking into it. */
const LISTENS = {
  launch: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${MICROPHONE}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  context: { permissions: ['microphone'] },
  viewport: { width: 1440, height: 1000 },
};

const { browser, context, page, graphql } = await open(LISTENS);

/* ------------------------------------------------------------- the stubs */

await context.addInitScript(
  ({ thinksFor, answersIn, synthMs }) => {
    const sent = [];
    const heard = [];
    const spoken = [];
    window.__voice = {
      sent,
      heard,
      spoken,
      playedAt: () => window.__playedAt ?? null,
      answeredAt: () => window.__answeredAt ?? null,
    };

    const play = window.HTMLMediaElement.prototype.play;
    window.HTMLMediaElement.prototype.play = function patched() {
      this.addEventListener(
        'playing',
        () => {
          window.__playedAt ??= Date.now();
        },
        { once: true },
      );
      return play.call(this);
    };

    /** Four hundred milliseconds of silence, which is a clip a browser will play. */
    function clip() {
      const rate = 22_050;
      const frames = Math.round(rate * 0.4);
      const bytes = new ArrayBuffer(44 + frames * 2);
      const view = new DataView(bytes);
      const write = (at, text) => [...text].forEach((one, by) => view.setUint8(at + by, one.charCodeAt(0)));
      write(0, 'RIFF');
      view.setUint32(4, 36 + frames * 2, true);
      write(8, 'WAVEfmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      write(36, 'data');
      view.setUint32(40, frames * 2, true);
      return bytes;
    }

    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const address = typeof input === 'string' ? input : input.url;

      if (/\/api\/workspaces\/[^/]+\/transcription/.test(address)) {
        const words = `Utterance number ${heard.length + 1}`;
        heard.push({ text: words, at: Date.now() });
        return new Response(JSON.stringify({ text: words }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (/\/api\/chats\/[^/]+\/stream/.test(address)) {
        const said = JSON.parse(String(init?.body ?? '{}'));
        const first = sent.length === 0;
        sent.push({ text: said.text ?? '', at: Date.now() });
        const holds = first ? thinksFor : answersIn;
        const encode = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            window.setTimeout(() => {
              controller.enqueue(
                encode.encode(
                  `event: chunk\ndata: ${JSON.stringify({
                    text: 'Here is a whole sentence of an answer, long enough to be worth reading aloud.',
                  })}\n\n`,
                ),
              );
              controller.enqueue(encode.encode('event: done\ndata: {"millis":1000}\n\n'));
              // When the model finished, which is what the caption must not
              // have been mistaking for sound coming out.
              window.__answeredAt = Date.now();
              controller.close();
            }, holds);
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }

      if (/\/api\/workspaces\/[^/]+\/speech/.test(address)) {
        const said = JSON.parse(String(init?.body ?? '{}'));
        spoken.push({ text: said.text ?? '', at: Date.now() });
        await new Promise((ready) => window.setTimeout(ready, synthMs));
        return new Response(clip(), { status: 200, headers: { 'content-type': 'audio/wav' } });
      }

      return real(input, init);
    };
  },
  { thinksFor: THINKS_FOR, answersIn: ANSWERS_IN, synthMs: SYNTH_MS },
);

/* ----------------------------------------------------------- the fixture */

async function sweep() {
  const { models } = await graphql(`query($w: ID!) { models(workspaceId: $w) { id name } }`, {
    w: WORKSPACE,
  });
  const { workspace } = await graphql(
    `query($id: ID!) { workspace(id: $id) { transcriptionModelId speechModelId } }`,
    { id: WORKSPACE },
  );
  const mine = models.filter((one) => one.name.startsWith(PREFIX));
  if (mine.some((one) => one.id === workspace.transcriptionModelId)) {
    await graphql(
      `mutation($w: ID!) { setWorkspaceTranscriptionModel(workspaceId: $w, modelId: null) { id } }`,
      { w: WORKSPACE },
    ).catch(() => undefined);
  }
  if (mine.some((one) => one.id === workspace.speechModelId)) {
    await graphql(`mutation($w: ID!) { setWorkspaceSpeechModel(workspaceId: $w, modelId: null) { id } }`, {
      w: WORKSPACE,
    }).catch(() => undefined);
  }
  for (const old of mine) {
    await graphql(`mutation($id: ID!) { removeModel(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept model ${old.name} (#${old.id})`);
  }

  const { chatSessions } = await graphql(`query($w: ID!) { chatSessions(workspaceId: $w) { id title } }`, {
    w: WORKSPACE,
  });
  for (const old of chatSessions.filter((one) => (one.title ?? '').startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { deleteChat(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept chat ${old.title} (#${old.id})`);
  }
}

await sweep();

const { modelProviders } = await graphql(`query($w: ID!) { modelProviders(workspaceId: $w) { id name } }`, {
  w: WORKSPACE,
});
const provider = modelProviders[0];
if (provider === undefined) {
  record(false, 'this workspace has no model provider, so voice mode cannot be offered at all');
  await finish(browser);
}

async function makeModel(kind) {
  const made = await graphql(`mutation($input: CreateModelInput!) { createModel(input: $input) { id name } }`, {
    input: {
      providerId: provider.id,
      name: `${PREFIX} ${kind}`,
      modelId: `${PREFIX}-${kind.toLowerCase()}`,
      kind,
    },
  });
  console.log(`made model ${made.createModel.name} (#${made.createModel.id})`);
  return made.createModel;
}

const ears = await makeModel('TRANSCRIPTION');
const mouth = await makeModel('SPEECH');
await graphql(
  `mutation($w: ID!, $m: ID) { setWorkspaceTranscriptionModel(workspaceId: $w, modelId: $m) { id } }`,
  { w: WORKSPACE, m: ears.id },
);
await graphql(`mutation($w: ID!, $m: ID) { setWorkspaceSpeechModel(workspaceId: $w, modelId: $m) { id } }`, {
  w: WORKSPACE,
  m: mouth.id,
});

const started = await graphql(`mutation($input: StartChatInput!) { startChat(input: $input) { id title } }`, {
  input: { workspaceId: WORKSPACE, title: `${PREFIX} ${Date.now()}` },
});
const CHAT = started.startChat.id;
console.log(`made chat ${started.startChat.title} (#${CHAT})`);

/* --------------------------------------------------------------- reading it */

/** What the panel and the conversation are saying, this instant. */
const READ = () =>
  page.evaluate(() => {
    const panel = document.querySelector('aside[aria-label="Voice mode"]');
    if (panel === null) return null;
    const boxes = [...panel.querySelectorAll('p')];
    const labelled = (word) => {
      const found = boxes.find((one) => (one.querySelector('span')?.textContent ?? '').trim() === word);
      return found === undefined ? null : found.textContent.replace(word, '').trim();
    };
    const caption =
      boxes.map((one) => one.textContent.trim()).find((text) => ['Listening', 'Thinking', 'Speaking'].includes(text)) ??
      null;
    return {
      at: Date.now(),
      caption,
      waiting: labelled('Waiting'),
      heard: labelled('Heard'),
      typed: labelled('Typed'),
      // What the conversation itself says the model is doing.
      working: document.body.innerText.includes('Waiting for'),
      sent: window.__voice.sent.map((one) => one.text),
      spoken: window.__voice.spoken.length,
      answeredAt: window.__voice.answeredAt(),
      playedAt: window.__voice.playedAt(),
    };
  });

/** Watches the panel until something is true of it, keeping every sample. */
const seen = [];
async function until(what, why, ms) {
  const stop = Date.now() + ms;
  for (;;) {
    const now = await READ().catch(() => null);
    if (now !== null) seen.push(now);
    if (now !== null && what(now)) return now;
    if (Date.now() > stop) {
      console.log(`gave up waiting for ${why}: ${JSON.stringify(seen[seen.length - 1])}`);
      return null;
    }
    await page.waitForTimeout(120);
  }
}

/* -------------------------------------------------------------- the drive */

await page.goto(`${BASE}/chat/${CHAT}`, { waitUntil: 'domcontentloaded' });

let drew = false;
if (await drawn(page, 'the chat')) {
  drew = await page
    .waitForSelector('button[aria-label="Enter voice mode"]', { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  record(drew, 'voice mode is offered on a chat whose workspace can hear and speak');
}

if (drew) {
  const canHear = await page.evaluate(() => window.isSecureContext && navigator.mediaDevices !== undefined);
  record(canHear, `${BASE} is a trustworthy origin, so a microphone is offered there at all`);
  if (!canHear) await finish(browser);
}

if (!drew) await finish(browser);

await page.click('button[aria-label="Enter voice mode"]');
await page.waitForSelector('aside[aria-label="Voice mode"]', { timeout: 15_000 });

/* ---- the first turn, which is a gap of twelve seconds to talk into ---- */

const thinking = await until((now) => now.caption === 'Thinking' && now.sent.length === 1, 'the first turn', 30_000);
record(thinking !== null, 'what was said was sent, and the panel says it is thinking');

if (thinking === null) {
  await sweep();
  await finish(browser);
}

/* ---- #262: the conversation says so too, not only the panel ---- */

const inTheLog = await until((now) => now.working, 'the conversation to say the model is working', 8_000);
record(
  inTheLog !== null,
  'and the conversation says it too, rather than leaving the transcript blank while the panel talks to itself',
);

/* ---- #262: typing, while the panel is busy ---- */

await page.fill('#chat-composer', TYPED);
await page.click('button[type="submit"]');

const typedWaiting = await until((now) => (now.waiting ?? '').includes(TYPED), 'the typed message to be held', 8_000);
record(
  typedWaiting !== null,
  'a message typed while it was busy is held rather than sent beside the turn in flight',
);
record(
  typedWaiting !== null && typedWaiting.caption === 'Thinking' && typedWaiting.sent.length === 1,
  'and nothing went out for it yet: one turn is in flight and it is still the first',
);
await page.screenshot({ path: shot('voice-queue-waiting.png') });

/* ---- #254: and something *said* while it is busy joins it ---- */

const bothWaiting = await until(
  (now) => (now.waiting ?? '').includes(TYPED) && /Utterance number/.test(now.waiting ?? ''),
  'the spoken message to join the typed one',
  25_000,
);
record(
  bothWaiting !== null,
  `what was said while it was busy was held too, and added to what was already waiting ` +
    `(${JSON.stringify(bothWaiting?.waiting ?? null)})`,
);

/* ---- #262: it does not claim to be speaking until sound comes out ---- */

const sounded = await until((now) => now.playedAt !== null, 'the first clip to play', 30_000);
record(sounded !== null, 'the answer was read aloud');

const early = seen.filter(
  (one) => one.caption === 'Speaking' && one.playedAt === null && one.answeredAt !== null,
);
record(
  early.length === 0,
  `it never said Speaking before there was sound (${early.length} such moments across ${seen.length})`,
);
const waited = seen.filter(
  (one) => one.answeredAt !== null && one.playedAt === null && one.caption === 'Thinking',
);
record(
  waited.length > 0,
  `and it did say Thinking across the gap between the answer arriving and the sound starting ` +
    `(${waited.length} moments)`,
);

/* ---- #254: the waiting message goes on its own, with nobody pressing ---- */

const flushed = await until((now) => now.sent.length > 1, 'the waiting message to be sent', 30_000);
record(flushed !== null, 'when the turn was over, what was waiting went out by itself');
record(
  flushed !== null && flushed.sent[1].includes(TYPED) && /Utterance number/.test(flushed.sent[1]),
  `and it went as one message holding both halves (${JSON.stringify(flushed?.sent[1] ?? null)})`,
);
record(
  flushed !== null && (flushed.waiting === null || flushed.waiting === ''),
  'and the panel stopped saying anything was waiting',
);

/* ---- and cutting in does not silence it for the rest of the session ---- */

const talking = await until((now) => now.caption === 'Speaking', 'the second answer to be spoken', 30_000);
record(talking !== null, 'the second turn was read aloud as well');

if (talking !== null) {
  const before = talking.spoken;
  await page.click('aside[aria-label="Voice mode"] button[aria-label="Stop this turn and listen"]');
  const back = await until((now) => now.caption === 'Listening', 'the panel to go back to listening', 8_000);
  record(back !== null, 'cutting in stops the answer and puts it back to listening');

  const again = await until((now) => now.spoken > before && now.sent.length > 2, 'a later turn to speak', 40_000);
  record(
    again !== null,
    `and a later turn is still read aloud, rather than the panel going silent for the session ` +
      `(${again === null ? 'nothing more was ever spoken' : `${again.spoken - before} more pieces`})`,
  );
}

await page.screenshot({ path: shot('voice-queue-panel.png') });

/* -------------------------------------------------- and the fixture is gone */

await sweep();
console.log('swept the models and the chat');

await finish(browser);
