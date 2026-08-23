/**
 * What a workspace may decide about how voice mode ends a turn, and voice mode
 * actually ending one that way.
 *
 * Issue #256. Voice mode kept answering while somebody was still talking - "I
 * cannot finish my sentence", "it stops listening and sends message", and after
 * the first fix it cut the same person off again two minutes into an
 * explanation. The numbers behind that are a judgement about how people talk
 * rather than a fact about audio: a pause, how far above the room a sound has
 * to stand to be a voice, and how long an open microphone waits when nothing
 * ends the turn at all. So a workspace can move them.
 *
 * Four things this is here to catch, and only the first is about markup:
 *
 *   the card         the three boxes store, come back after a reload, and can
 *                    be emptied again one at a time - and empty really means
 *                    the workspace has decided nothing rather than zero
 *   the default      the empty box names voice mode's own value, read out of
 *                    VoiceMode.tsx rather than written down here. A settings
 *                    page carrying its own copy of 2.5 seconds goes on saying
 *                    2.5 seconds after that file says something else, which is
 *                    a form lying about the product it configures
 *   the refusal      each bound is the server's and is printed in the server's
 *                    own sentence, word for word, in the colour a refusal wears
 *   the wiring       a setting that is stored and not read is worse than no
 *                    setting. The panel is driven with a fake microphone that
 *                    speaks for a moment and then stops, and the turn is timed:
 *                    with nothing set it ends on voice mode's own pause, and
 *                    with a pause set it ends on that one instead
 *
 * The last is the assertion worth the whole check, and it is why this drives
 * audio at all. Everything above it would pass on a page that saved three
 * numbers nothing ever read.
 *
 * The other two settings travel down the same prop as the pause and are
 * asserted stored, cleared and bounded rather than heard: the sensitivity
 * cannot be defeated by a loud tone - a fixed level qualifies it on its own,
 * deliberately, so that a silent room is not absurdly sensitive - and the
 * unattended microphone's floor is five minutes, which is not a thing to sit in
 * front of. What can be measured about them is measured from the source
 * instead, below: the loop has to read all three off the workspace rather than
 * off a constant, and a constant put back in the middle of it fails here.
 *
 * The models, the chat and the settings themselves are put back afterwards,
 * including what a killed run left behind.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const PREFIX = 'zzVoiceTurnTaking';

/* ------------------------------------------------------- what is being set */

/** A pause, a sensitivity and a fuse, each well inside the server's bounds. */
const SET = { pauseSeconds: 4, overRoomPercent: 180, unattendedMinutes: 20 };

/** And the same three under the names, and in the units, the server keeps them in. */
const STORED = {
  voicePauseEndsTurnMs: SET.pauseSeconds * 1_000,
  voiceSpeechOverRoomPercent: SET.overRoomPercent,
  voiceUnattendedMicrophoneMs: SET.unattendedMinutes * 60_000,
};

/**
 * One value outside each bound, and the two companions that must be inside it.
 *
 * The server names the first of the three that is out of bounds, so reaching
 * the second refusal means the first setting has to be acceptable. Each case
 * therefore states all three, which is what the mutation takes anyway.
 */
const OUTSIDE = [
  { what: 'the pause', boxes: { pause: '0.5', overRoom: '250', unattended: '10' } },
  { what: 'the sensitivity', boxes: { pause: '3', overRoom: '900', unattended: '10' } },
  { what: 'the unattended microphone', boxes: { pause: '3', overRoom: '250', unattended: '2' } },
];

/** The pause the second half of this check sets, in seconds. */
const LONGER_PAUSE = 6;

/* -------------------------------------- what voice mode's own numbers are */

/**
 * The defaults, read out of the component that owns them.
 *
 * Not copied: the whole point of the assertion they feed is that the settings
 * page holds no copy either, so a check holding one would be asserting that two
 * copies agree while a third drifts.
 */
const VOICE_MODE_SOURCE = 'src/components/VoiceMode.tsx';

function constantIn(source, name) {
  const found = new RegExp(`const ${name} = ([0-9_.]+);`).exec(source);
  return found === null ? null : Number(found[1].replace(/_/g, ''));
}

const voiceSource = readFileSync(VOICE_MODE_SOURCE, 'utf8');
const SILENCE_MS = constantIn(voiceSource, 'SILENCE_MS');
const SPEECH_OVER_ROOM = constantIn(voiceSource, 'SPEECH_OVER_ROOM');
const LONGEST_TURN_MS = constantIn(voiceSource, 'LONGEST_TURN_MS');

/** The same rounding the page does, so "2.5" is not compared against "2.50". */
const asBox = (value) => String(Math.round(value * 100) / 100);

/* ------------------------------------------------- a microphone to speak at */

/**
 * A moment of speech and then nothing, as a file Chromium can pretend is a
 * microphone.
 *
 * A tone rather than noise, and a loud one: what Chrome does to a getUserMedia
 * stream on the way in - echo cancellation, noise suppression, a gain that
 * moves - is a thing this check has no control over and would rather not
 * depend on, and none of it turns half a second of half-scale tone into
 * something under the level that counts as somebody talking. The silence after
 * it is digital zero, which stays zero through all of that.
 *
 * `%noloop` is why the file is longer than any turn this drives: once it ends
 * the device feeds silence, and a file that looped would start talking again in
 * the middle of the pause being measured.
 */
const SPEAKING_MS = 1_200;
const RATE = 48_000;

function fakeMicrophone(path, quietMs) {
  const frames = Math.round((RATE * (SPEAKING_MS + quietMs)) / 1000);
  const speaking = Math.round((RATE * SPEAKING_MS) / 1000);
  const body = Buffer.alloc(frames * 2);
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

const MICROPHONE = fakeMicrophone(join(tmpdir(), 'orknux-voice-turn-taking.wav'), 40_000);

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

/* --------------------------------------------------------------- the source */

/*
 * What the browser cannot be asked and the source can: that the loop reads the
 * workspace's numbers rather than the constants beside them.
 *
 * The measurement below proves it of the pause, because the pause is the one of
 * the three that can be waited out. The other two would pass a page that piped
 * them into the panel and then ignored them, so they are read here - by what
 * the watching loop uses, not by what the file mentions.
 */
const watching = /const watch = \(\) => \{([\s\S]*?)\n    \};/.exec(voiceSource)?.[1] ?? '';
record(watching !== '', 'the loop that decides a turn has ended could be found in VoiceMode.tsx');

for (const [name, constant] of [
  ['the pause', 'SILENCE_MS'],
  ['the sensitivity', 'SPEECH_OVER_ROOM'],
  ['the unattended microphone', 'LONGEST_TURN_MS'],
]) {
  record(
    !watching.includes(constant),
    `${name} is not read off ${constant} inside the loop, which is where a setting stops being read`,
  );
}

for (const [name, held] of [
  ['the pause', 'pauseMs'],
  ['the sensitivity', 'overRoom'],
  ['the unattended microphone', 'unattendedMs'],
]) {
  record(watching.includes(held), `${name} is taken from what is in force this frame (${held})`);
}

const chatSource = readFileSync('src/pages/chat/ChatPage.tsx', 'utf8');
for (const field of [
  'voicePauseEndsTurnMs',
  'voiceSpeechOverRoomPercent',
  'voiceUnattendedMicrophoneMs',
]) {
  record(
    chatSource.includes(field),
    `the chat hands the panel the workspace's ${field}, or the panel is reading nothing`,
  );
}

/* --------------------------------------------------------------- the fixture */

const { browser, page, graphql } = await open(LISTENS);

/** The three, as the workspace really holds them. */
async function stored() {
  const { workspace } = await graphql(
    `query($id: ID!) {
       workspace(id: $id) {
         voicePauseEndsTurnMs voiceSpeechOverRoomPercent voiceUnattendedMicrophoneMs
       }
     }`,
    { id: WORKSPACE },
  );
  return workspace;
}

/** Sets them straight at the server, for the halves that are not about the form. */
async function setThem(pauseEndsTurnMs, speechOverRoomPercent, unattendedMicrophoneMs) {
  return graphql(
    `mutation($w: ID!, $p: Int, $s: Int, $u: Int) {
       setWorkspaceVoiceTurnTaking(
         workspaceId: $w, pauseEndsTurnMs: $p, speechOverRoomPercent: $s, unattendedMicrophoneMs: $u
       ) { voicePauseEndsTurnMs voiceSpeechOverRoomPercent voiceUnattendedMicrophoneMs }
     }`,
    { w: WORKSPACE, p: pauseEndsTurnMs, s: speechOverRoomPercent, u: unattendedMicrophoneMs },
  );
}

/** Why the server would refuse those three, in its own words, or null. */
async function refusalFor(pauseEndsTurnMs, speechOverRoomPercent, unattendedMicrophoneMs) {
  try {
    await setThem(pauseEndsTurnMs, speechOverRoomPercent, unattendedMicrophoneMs);
    return null;
  } catch (cause) {
    const errors = JSON.parse(String(cause.message ?? cause));
    return errors[0]?.message ?? null;
  }
}

async function sweep() {
  await setThem(null, null, null).catch(() => undefined);

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

/* ---------------------------------------------------------------- the card */

const SETTINGS = `${BASE}/workspace/${WORKSPACE}/settings`;
const BOXES = { pause: '#voice-pause', overRoom: '#voice-over-room', unattended: '#voice-unattended' };

/** What the Voice card is showing, box by box. */
async function shown() {
  return page.evaluate(() => {
    const read = (id) => {
      const box = document.getElementById(id);
      if (box === null) return null;
      return {
        value: box.value,
        placeholder: box.placeholder,
        // The unit is beside the control rather than under it: "4" means
        // nothing on its own, so it is part of the label and stays in the open.
        unit: (box.parentElement?.querySelector('span')?.textContent ?? '').trim(),
      };
    };
    const card = document.getElementById('voice-pause')?.closest('section') ?? null;
    const paragraphs = [...(card?.querySelectorAll('p') ?? [])].map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    const alerts = [...(card?.querySelectorAll('[role="alert"]') ?? [])].map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    return {
      heading: (card?.querySelector('h2')?.textContent ?? '').trim(),
      pause: read('voice-pause'),
      overRoom: read('voice-over-room'),
      unattended: read('voice-unattended'),
      alerts,
      saved: paragraphs.includes('Saved.'),
      // Everything in the open that is neither an alert nor the word a save
      // leaves behind. There should never be any: this card teaches behind the
      // (?) and prints nothing under a control.
      notes: paragraphs.filter((text) => !alerts.includes(text) && text !== 'Saved.'),
      // Which fields ask behind a (?), by the label each says it is about.
      hints: [...(card?.querySelectorAll('button[data-hint]') ?? [])].map((node) =>
        node.getAttribute('data-hint'),
      ),
    };
  });
}

/** What one of those (?) says when it is asked, read off the note it opens. */
async function asked(label) {
  await page.click(`button[data-hint="${label}"]`);
  await page.waitForSelector('[role="note"]', { timeout: 5_000 });
  const said = await page.evaluate(
    () => (document.querySelector('[role="note"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
  await page.click(`button[data-hint="${label}"]`);
  await page.waitForTimeout(200);
  return said;
}

/**
 * What colour the card said something in, and what a refusal is drawn in here.
 *
 * Read off the page rather than assumed, and as a distance rather than as "not
 * the same": a refusal that came out one shade off the ordinary text is a
 * refusal nobody sees, and every assertion of the form "the value differs"
 * passes on that.
 */
async function colours(text) {
  return page.evaluate((says) => {
    const card = document.getElementById('voice-pause')?.closest('section') ?? null;
    const said = [...(card?.querySelectorAll('p') ?? [])].find((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(says.slice(0, 40)),
    );
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

function apart(one, other) {
  const channels = (colour) => (colour?.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  const [a, b] = [channels(one), channels(other)];
  if (a.length < 3 || b.length < 3) return 0;
  return Math.max(...a.map((value, at) => Math.abs(value - b[at])));
}

async function type({ pause, overRoom, unattended }) {
  if (pause !== undefined) await page.fill(BOXES.pause, pause);
  if (overRoom !== undefined) await page.fill(BOXES.overRoom, overRoom);
  if (unattended !== undefined) await page.fill(BOXES.unattended, unattended);
}

async function save() {
  await page.locator('section:has(#voice-pause) button:has-text("Save")').click();
  await page.waitForTimeout(1_500);
}

await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });

let drew = false;
if (await drawn(page, 'the workspace settings page')) {
  drew = await page
    .waitForSelector(BOXES.pause, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  record(drew, 'the workspace settings page offers a Voice card');
  await page.waitForTimeout(800);
}

if (drew) {
  /* ---- a workspace that has decided nothing, which is every workspace ---- */

  const bare = await shown();
  // What a workspace that has decided nothing looks like, which is what most of
  // them look like: three empty boxes, each naming what it would do.
  await page.locator('section:has(#voice-pause)').screenshot({ path: shot('voice-turn-taking-default.png') });

  record(bare.heading === 'Voice', `the card is called Voice (${JSON.stringify(bare.heading)})`);
  record(
    bare.pause.value === '' && bare.overRoom.value === '' && bare.unattended.value === '',
    'every box is empty until somebody decides otherwise, which is not the same as zero',
  );
  record(
    bare.notes.length === 0,
    `and the card prints nothing under its controls, because it teaches behind the (?) ` +
      `(${JSON.stringify(bare.notes)})`,
  );

  /*
   * The assertion the whole "do not copy the defaults" rule rests on. Both
   * sides of it are read rather than written down: the constant out of
   * VoiceMode.tsx above, the placeholder off the real page here. A settings
   * page carrying its own 2.5 passes nothing.
   */
  record(
    SILENCE_MS !== null && SPEECH_OVER_ROOM !== null && LONGEST_TURN_MS !== null,
    `voice mode's own numbers were read out of ${VOICE_MODE_SOURCE} ` +
      `(${SILENCE_MS} ms, ${SPEECH_OVER_ROOM}× the room, ${LONGEST_TURN_MS} ms)`,
  );
  for (const [what, box, expected] of [
    ['the pause', bare.pause, asBox(SILENCE_MS / 1_000)],
    ['the sensitivity', bare.overRoom, asBox(SPEECH_OVER_ROOM * 100)],
    ['the unattended microphone', bare.unattended, asBox(LONGEST_TURN_MS / 60_000)],
  ]) {
    record(
      box.placeholder === `Default — ${expected}`,
      `the empty box for ${what} names voice mode's own value, in a person's units ` +
        `(${JSON.stringify(box.placeholder)}, wanted ${JSON.stringify(`Default — ${expected}`)})`,
    );
  }

  for (const [what, box, unit] of [
    ['the pause', bare.pause, 'seconds'],
    ['the sensitivity', bare.overRoom, '%'],
    ['the unattended microphone', bare.unattended, 'minutes'],
  ]) {
    record(box.unit === unit, `${what} says what it is typed in: ${JSON.stringify(box.unit)}`);
  }

  /*
   * And each of them explains itself behind the (?), which is where an
   * explanation goes on this product. The middle one is checked for the
   * sentence somebody actually needs rather than for the sentence the schema
   * uses: "how far above the room's noise" is what it does, and "turn this down
   * if it stops while you are still talking" is what to do about it.
   */
  for (const label of ['Voice', 'Pause Before It Answers', 'Voice Above The Room', 'Unattended Microphone']) {
    record(bare.hints.includes(label), `${JSON.stringify(label)} explains itself behind a (?)`);
  }

  const aboutSensitivity = await asked('Voice Above The Room');
  record(
    aboutSensitivity.toLowerCase().includes('turn this down if it stops while you are still talking'),
    `and the sensitivity says what to do about it in the words it was reported in ` +
      `(${JSON.stringify(aboutSensitivity.slice(0, 90))})`,
  );

  /* ---- set, stored in the server's units, and back after a reload ---- */

  await type({
    pause: String(SET.pauseSeconds),
    overRoom: String(SET.overRoomPercent),
    unattended: String(SET.unattendedMinutes),
  });
  await save();

  const kept = await stored();
  record((await shown()).saved === true, 'the card says it saved');
  for (const [field, wanted] of Object.entries(STORED)) {
    record(
      kept[field] === wanted,
      `${field} is stored in the server's own unit: ${kept[field]} (wanted ${wanted})`,
    );
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(BOXES.pause, { timeout: 20_000 });
  await page.waitForTimeout(800);

  const again = await shown();
  record(
    again.pause.value === String(SET.pauseSeconds) &&
      again.overRoom.value === String(SET.overRoomPercent) &&
      again.unattended.value === String(SET.unattendedMinutes),
    `and comes back in a person's units after a reload ` +
      `(${again.pause.value}, ${again.overRoom.value}, ${again.unattended.value})`,
  );

  // The card rather than the page: what is being looked at is three boxes
  // and what they say, and a screenshot of the whole column shows the two
  // cards above it instead.
  await page.locator('section:has(#voice-pause)').screenshot({ path: shot('voice-turn-taking-set.png') });

  /* ---- one emptied again, which is not the same as all three ---- */

  await type({ pause: '' });
  await save();

  const cleared = await stored();
  record(cleared.voicePauseEndsTurnMs === null, 'emptying the pause box puts that one back on the default');
  record(
    cleared.voiceSpeechOverRoomPercent === STORED.voiceSpeechOverRoomPercent &&
      cleared.voiceUnattendedMicrophoneMs === STORED.voiceUnattendedMicrophoneMs,
    'and leaves the two beside it exactly where they were',
  );
  record(
    (await shown()).pause.placeholder === `Default — ${asBox(SILENCE_MS / 1_000)}`,
    'and the box says what it went back to, rather than sitting empty and silent',
  );

  /* ---- each bound, refused in the server's own sentence ---- */

  for (const { what, boxes } of OUTSIDE) {
    const wouldBe = await refusalFor(
      Math.round(Number(boxes.pause) * 1_000),
      Number(boxes.overRoom),
      Math.round(Number(boxes.unattended) * 60_000),
    );
    record(wouldBe !== null, `the server refuses ${what} at that value (${wouldBe})`);
    if (wouldBe === null) continue;

    await type(boxes);
    await save();

    const refused = await shown();
    record(
      refused.alerts.includes(wouldBe),
      `the card prints that refusal word for word (${JSON.stringify(refused.alerts[0]?.slice(0, 80))})`,
    );
    record(refused.saved === false, 'and does not claim to have saved anything');

    const said = await colours(wouldBe);
    record(
      apart(said.colour, said.danger) === 0,
      `and says it in the colour a refusal wears (${said.colour} against ${said.danger})`,
    );

    const untouched = await stored();
    record(
      untouched.voicePauseEndsTurnMs === null &&
        untouched.voiceSpeechOverRoomPercent === STORED.voiceSpeechOverRoomPercent &&
        untouched.voiceUnattendedMicrophoneMs === STORED.voiceUnattendedMicrophoneMs,
      `and nothing was stored by the attempt (${JSON.stringify(untouched)})`,
    );
  }

  // The card rather than the page: what is being looked at is three boxes
  // and what they say, and a screenshot of the whole column shows the two
  // cards above it instead.
  await page.locator('section:has(#voice-pause)').screenshot({ path: shot('voice-turn-taking-refused.png') });
}

/* ------------------------------------------------ and the panel reading them */

/*
 * The half that makes the three above worth having.
 *
 * Voice mode is offered only where the workspace can both hear and speak, so
 * two models are made for it - neither is ever asked anything: the turn being
 * timed ends before a transcript is wanted, and the request that fails
 * afterwards is the panel going back to listening, which is what it should do.
 */
await setThem(null, null, null);

const { modelProviders } = await graphql(`query($w: ID!) { modelProviders(workspaceId: $w) { id name } }`, {
  w: WORKSPACE,
});
const provider = modelProviders[0];
if (provider === undefined) {
  record(false, 'this workspace has no model provider, so voice mode cannot be offered at all');
  await finish(browser);
}

async function makeModel(kind) {
  const made = await graphql(
    `mutation($input: CreateModelInput!) { createModel(input: $input) { id name } }`,
    {
      input: {
        providerId: provider.id,
        name: `${PREFIX} ${kind}`,
        modelId: `${PREFIX}-${kind.toLowerCase()}`,
        kind,
      },
    },
  );
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

const started = await graphql(
  `mutation($input: StartChatInput!) { startChat(input: $input) { id title } }`,
  { input: { workspaceId: WORKSPACE, title: `${PREFIX} ${Date.now()}` } },
);
const CHAT = started.startChat.id;
console.log(`made chat ${started.startChat.title} (#${CHAT})`);

/**
 * How long one turn takes, from the microphone opening to the turn being over.
 *
 * The fake microphone speaks for a moment and then stops, so what is being
 * timed is that moment plus whatever pause is in force. Measured from the panel
 * appearing rather than from the click, so the browser deciding to grant a
 * microphone is not counted as somebody talking.
 *
 * A fresh browser each time, because the fake device reads a file and a second
 * turn in the same one would not reliably start it again from the beginning -
 * which would be a measurement of where the file happened to be.
 */
async function turnLength() {
  const listening = await open(LISTENS);
  try {
    await listening.page.goto(`${BASE}/chat/${CHAT}`, { waitUntil: 'domcontentloaded' });

    /*
     * A microphone is only offered to a trustworthy origin, so on plain HTTP at
     * anything but localhost `navigator.mediaDevices` is simply not there - and
     * what that looks like from outside is a turn that never ends, which is
     * indistinguishable from the bug this half exists to catch. Said plainly
     * rather than measured wrongly. CI serves the whole thing on localhost,
     * which is trustworthy; so does the developer's vite.
     */
    const canHear = await listening.page.evaluate(
      () => window.isSecureContext && navigator.mediaDevices !== undefined,
    );
    if (!canHear) {
      return { ms: null, why: `${BASE} is not a trustworthy origin, so no microphone is offered there` };
    }

    const enter = await listening.page
      .waitForSelector('button[aria-label="Enter voice mode"]', { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    if (!enter) return { ms: null, why: 'voice mode was never offered on the chat' };

    await listening.page.click('button[aria-label="Enter voice mode"]');
    await listening.page.waitForSelector('aside[aria-label="Voice mode"]', { timeout: 15_000 });

    /*
     * The turn ending is timed by what it sends, not by what the panel says.
     *
     * The caption was the obvious thing to watch and it is the wrong one: the
     * transcription fails at once here - the model is a fixture pointing at
     * nothing - so Thinking can be over inside a poll's own interval, and a
     * missed one leaves the check timing the *second* turn and reporting twice
     * the figure. Which it did. The request goes out the moment the recorder
     * stops, and it cannot be missed.
     */
    const from = Date.now();
    const sent = await listening.page
      .waitForRequest((request) => request.url().includes('/transcription'), { timeout: 45_000 })
      .catch(() => null);
    return sent === null
      ? { ms: null, why: 'the turn never ended: nothing was ever sent to be transcribed' }
      : { ms: Date.now() - from, why: 'what it heard was sent' };
  } finally {
    await listening.browser.close().catch(() => {});
  }
}

const onItsOwn = await turnLength();
record(
  onItsOwn.ms !== null,
  `with nothing set, a turn ended by itself after ${onItsOwn.ms} ms (${onItsOwn.why})`,
);

await setThem(LONGER_PAUSE * 1_000, null, null);
const onTheWorkspace = await turnLength();
record(
  onTheWorkspace.ms !== null,
  `with a ${LONGER_PAUSE}s pause set, a turn ended after ${onTheWorkspace.ms} ms (${onTheWorkspace.why})`,
);

if (onItsOwn.ms !== null && onTheWorkspace.ms !== null) {
  /*
   * How far, not whether. A turn that merely took longer would pass on a
   * hundred milliseconds of a slow machine; what is asserted is that it took
   * longer by about the difference between the two settings, which nothing but
   * the setting being read can produce.
   */
  const wanted = LONGER_PAUSE * 1_000 - SILENCE_MS;
  const moved = onTheWorkspace.ms - onItsOwn.ms;
  record(
    Math.abs(moved - wanted) <= 1_200,
    `the turn ran ${moved} ms longer, which is the ${wanted} ms the workspace added to the pause ` +
      `(within 1200 ms)`,
  );
  record(
    Math.abs(onItsOwn.ms - (SILENCE_MS + SPEAKING_MS)) <= 1_500,
    `and with nothing set it ran on voice mode's own ${SILENCE_MS} ms after ${SPEAKING_MS} ms of ` +
      `speech: ${onItsOwn.ms} ms (within 1500 ms of ${SILENCE_MS + SPEAKING_MS})`,
  );
}

/* -------------------------------------------------- and the fixture is gone */

await sweep();
console.log('swept the models, the chat and the settings');

await finish(browser);
