/**
 * Asking for the answer again, in voice mode, and hearing the one that comes back.
 *
 * Issue #314. The composer and the panel were two doors into the model and only
 * one of them was wired to the mouth: a turn held out loud read its answer
 * aloud, and *answer again* — pressed on that same answer, in that same
 * conversation — went straight to the server and came back in silence. The
 * panel had not been told a turn was happening, so it stayed listening while an
 * answer nobody would hear was written behind it.
 *
 * Four things this is here to catch, and none of them is a screenshot:
 *
 *   the sending     asking again while the panel is open goes through the panel
 *                   rather than round it, so exactly one regenerate leaves and
 *                   no second message is sent to the chat
 *   the phases      the panel says Thinking and then Speaking for it, the same
 *                   as for anything said out loud - a second take that leaves
 *                   the panel sitting on Listening is the bug
 *   the reading     the *second* answer is what is read, not the first one
 *                   again. The two stubbed answers are different sentences, and
 *                   what the speech model was handed is compared against them
 *   the transcript  what was heard stays on screen. The question has not
 *                   changed, so replacing it with an empty line would be the
 *                   panel forgetting what it is answering
 *
 * **The model, the ears and the mouth are all this check's own**, for the
 * reason `voice-queue-check` gives: a stubbed answer is what makes "the second
 * one" a sentence a test can name, and the microphone is a file Chromium is
 * told to believe. It speaks once and then stops, because a device that went on
 * talking would start a turn of its own in the middle of the one being
 * measured — it is transcribed to nothing after the first question, which is
 * the only quiet a fake device can be made to give. Everything else — the page,
 * the session, the chat, every GraphQL call — is the real thing.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const PREFIX = 'zzVoiceAgain';

/** How long a stubbed answer is held back: long enough to be seen, short enough to wait for. */
const ANSWERS_IN = 600;
/** How long the stubbed speech model takes over one piece. */
const SYNTH_MS = 600;

/** The two answers, which have to be told apart by the sentence and not the order. */
const FIRST = 'The first answer, which is the one being asked about again.';
const SECOND = 'The second answer, which is the one that has to be read aloud.';

/* ------------------------------------------------- a microphone to speak at */

/**
 * One burst of speech and then a long quiet, to open the conversation with.
 *
 * One burst rather than the several `voice-queue-check` uses, because this
 * check presses a button in the quiet after the first turn. The file is only
 * half of that quiet, though: the panel reopens the device between turns and
 * Chromium reads the file from the top when it does, so the silence that
 * actually holds is the transcriber's — see the stub.
 */
const SPEAKING_MS = 1_200;
const QUIET_MS = 90_000;
const RATE = 48_000;

function fakeMicrophone(path) {
  const frames = Math.round((RATE * (SPEAKING_MS + QUIET_MS)) / 1000);
  const body = Buffer.alloc(frames * 2);
  const speaking = Math.round((RATE * SPEAKING_MS) / 1000);
  for (let at = 0; at < speaking; at += 1) {
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

const MICROPHONE = fakeMicrophone(join(tmpdir(), 'orknux-voice-regenerate.wav'));

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
  ({ answersIn, synthMs, first, second }) => {
    /** Every message sent to the chat, every ask-again, and every piece read out. */
    const sent = [];
    const again = [];
    const spoken = [];
    const heard = [];
    window.__voice = { sent, again, spoken, heard };

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

    /** One answer, arriving as a stream the page reads exactly as it reads the real one. */
    function answering(text) {
      const encode = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          window.setTimeout(() => {
            controller.enqueue(encode.encode(`event: chunk\ndata: ${JSON.stringify({ text })}\n\n`));
            controller.enqueue(encode.encode('event: done\ndata: {"millis":1000}\n\n'));
            controller.close();
          }, answersIn);
        },
      });
    }

    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const address = typeof input === 'string' ? input : input.url;

      /*
       * One question, and then nothing whatever is heard again.
       *
       * The microphone is a file, and the panel reopens the device between
       * turns, so a browser told to read that file reads it from the top each
       * time - which is somebody who never stops talking, whatever the file
       * says. That is fine for a check about turn-taking and wrong for this
       * one: everything after the press has to be the press, and a turn that
       * started itself in the quiet would satisfy *the panel says it is
       * thinking* without the button having done anything at all.
       *
       * An empty transcript is where the panel already stops - it does not
       * trouble the model with one - so this is the quiet the fake device
       * cannot be made to give.
       */
      if (/\/api\/workspaces\/[^/]+\/transcription/.test(address)) {
        const first = heard.length === 0;
        heard.push({ at: Date.now() });
        return new Response(JSON.stringify({ text: first ? 'What went wrong with the sync' : '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      // Before the plain stream, because one address is a prefix of the other.
      if (/\/api\/chats\/[^/]+\/regenerate/.test(address)) {
        again.push({ at: Date.now() });
        return new Response(answering(second), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      if (/\/api\/chats\/[^/]+\/stream/.test(address)) {
        const said = JSON.parse(String(init?.body ?? '{}'));
        sent.push({ text: said.text ?? '', at: Date.now() });
        return new Response(answering(first), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
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
  { answersIn: ANSWERS_IN, synthMs: SYNTH_MS, first: FIRST, second: SECOND },
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
      heard: labelled('Heard'),
      // Whether the button that asks again is on screen to be pressed.
      offersAgain: document.querySelector('button[aria-label="Answer again"]') !== null,
      sent: window.__voice.sent.length,
      again: window.__voice.again.length,
      spoken: window.__voice.spoken.map((one) => one.text),
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

/** Whether anything read out so far carries this sentence. */
const read = (now, text) => now.spoken.some((one) => one.includes(text));

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
  if (!canHear) {
    await sweep();
    await finish(browser);
  }
}

if (!drew) await finish(browser);

await page.click('button[aria-label="Enter voice mode"]');
await page.waitForSelector('aside[aria-label="Voice mode"]', { timeout: 15_000 });

/* ---- one turn out loud, so there is an answer to ask about again ---- */

const answered = await until((now) => read(now, FIRST), 'the first answer to be read aloud', 45_000);
record(answered !== null, 'a turn held out loud is answered and the answer is read aloud');

if (answered === null) {
  await sweep();
  await finish(browser);
}

const heard = answered.heard;
record(
  heard !== null && heard.trim() !== '',
  `and what was heard is on the panel (${JSON.stringify(heard)})`,
);

/* ---- the press, which is the whole of the issue ---- */

/*
 * Pressed in the quiet after the first turn, once the panel has finished
 * reading and gone back to listening.
 *
 * Which is what somebody actually does — they hear the answer out and then
 * decide about it — and it is also the only moment at which the phases below
 * mean anything. Press while the first answer is still being read and *the
 * panel says it is speaking* is satisfied by the panel finishing that reading,
 * with the button having done nothing whatever.
 */
const offered = await until(
  (now) => now.offersAgain && now.caption === 'Listening',
  'the first turn to finish and offer an answer again button',
  45_000,
);
record(offered !== null, 'the answer carries an *answer again* button once the panel is listening again');

if (offered === null) {
  await sweep();
  await finish(browser);
}

const spokenBefore = offered.spoken.length;
/*
 * How many messages the chat had been sent by the time of the press.
 *
 * Every assertion after this is qualified by it, and that is not decoration.
 * The fake microphone reopens its file each turn, so it never truly goes quiet:
 * left unqualified, *the panel says it is thinking* is satisfied by the panel
 * thinking about something somebody said - which is exactly what it was doing
 * instead of the second take. Pinning the count says the phase belongs to the
 * press and not to a turn that started itself.
 */
const sentBefore = offered.sent;
await page.click('button[aria-label="Answer again"]');

const asked = await until((now) => now.again === 1, 'the second take to be asked for', 20_000);
record(asked !== null, 'pressing it asks the server for another answer');

record(
  asked !== null && asked.sent === 1,
  'and nothing was sent to the chat beside it: asking again is not a second message',
);

/* ---- the phases, which is what the panel used to skip entirely ---- */

const thinks = await until(
  (now) => now.caption === 'Thinking' && now.sent === sentBefore,
  'the panel to say it is thinking about the second take',
  10_000,
);
record(thinks !== null, 'the panel says it is thinking for the second take, rather than sitting on Listening');

const speaks = await until(
  (now) => now.caption === 'Speaking' && now.sent === sentBefore,
  'the panel to say it is speaking the second take',
  30_000,
);
record(speaks !== null, 'and then that it is speaking, which it only says once sound is coming out');

/* ---- the reading, which is the fix ---- */

const spoke = await until((now) => read(now, SECOND), 'the second answer to be read aloud', 30_000);
record(spoke !== null, 'the second answer is read aloud rather than arriving in silence');
record(
  spoke !== null && spoke.spoken.length > spokenBefore,
  `and it is a reading of its own rather than the first one still playing ` +
    `(${spokenBefore} pieces before the press, ${spoke?.spoken.length ?? 0} after)`,
);

await page.screenshot({ path: shot('voice-regenerate-speaking.png') });

/* ---- and the question it is answering is still on screen ---- */

record(
  spoke !== null && spoke.heard === heard,
  `what was heard is unchanged, because the question has not changed ` +
    `(${JSON.stringify(spoke?.heard ?? null)})`,
);

await sweep();
await finish(browser);
