/**
 * What is sent to be read aloud, and when the first of it is asked for.
 *
 * Issues #255 and #263, which are one seam looked at from two sides: what the
 * speech model is handed, and how much of the answer has to exist before it is
 * handed anything.
 *
 *   #255  it was handed the markdown. Models write markdown whether or not
 *         anything renders it, so an answer read aloud pronounced the
 *         asterisks, the backticks, the hashes in front of a heading, the
 *         pipes between a table's cells and the address inside every link.
 *         What is on screen is the rendered document; what is spoken has to be
 *         the same document.
 *   #263  it was handed all of it, once, at the end. A speech model takes
 *         seconds over a long answer, so the wait before the first word was the
 *         wait for the last one to be synthesised - the longer the answer, the
 *         longer the silence, which is exactly backwards.
 *
 * **Both stubs are this check's own, and for opposite reasons.** The chat's
 * stream is replaced because what is being tested is the text, and a real model
 * writes something different every time - against a seeded installation it
 * writes nothing at all. The speech endpoint is replaced because what is being
 * tested is *when* each request is made: it answers a known clip after a known
 * delay, which is what makes "the first sentence was already playing before the
 * last one was asked for" a measurement rather than a hope. Everything else on
 * the page is real.
 *
 * The assertions that earn this its place are the last three. Anything that
 * merely strips a character passes the first few; only a reader that pipelines
 * passes "playing before the last request", and only one that pipelines *with a
 * lid on* passes "never more than two in flight" - asking for every piece at
 * once would put a burst on a provider for audio nobody may ever hear.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const PREFIX = 'zzSpokenAnswer';

/** How long the stubbed speech model takes over one piece. */
const SYNTH_MS = 700;

/**
 * An answer with one of everything a model writes.
 *
 * Long enough to be cut into several pieces, because a single-piece answer
 * would pass the timing assertions by having nothing to be late for.
 */
const ANSWER = [
  '## What changed',
  '',
  'The **cache** is warmed by a `startup` hook now, and the [release notes](https://example.com/notes) explain the reason for it.',
  '',
  '```kotlin',
  'val warmed = mapOf("cache" to true)',
  'println(warmed)',
  '```',
  '',
  '| Setting | Value |',
  '| ------- | ----- |',
  '| Timeout | Thirty seconds |',
  '',
  '- The first item, which is long enough to be worth saying on its own.',
  '- The second item, which is also long enough to stand as a sentence.',
  '',
  'The warming runs once, on the first request after a restart, and takes a little',
  'under a second on the machines we have measured it on. Nothing waits for it.',
  '',
  'If it fails there is a line in the log saying so, and the request it was warming',
  'for is served from the database instead, which is what used to happen every time.',
  '',
  'That is *everything* worth knowing, and it took about a minute to work out.',
].join('\n');

const { browser, context, page, graphql } = await open({
  launch: { args: ['--autoplay-policy=no-user-gesture-required'] },
  viewport: { width: 1440, height: 1000 },
});

/* ------------------------------------------------------------- the stubs */

await context.addInitScript(
  ({ answer, synthMs }) => {
    /** Every piece the page asked to have read, with when it asked. */
    const asked = [];
    let inFlight = 0;
    let mostInFlight = 0;
    window.__spoken = { asked, most: () => mostInFlight, playedAt: () => window.__playedAt ?? null };

    /* When sound actually started, taken from the element rather than the page. */
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

      if (/\/api\/chats\/[^/]+\/stream/.test(address)) {
        const encode = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            // In pieces, as a model writes it: what the reader does with a
            // half-written answer is half of what is being tested.
            const parts = answer.match(/[\s\S]{1,60}/g) ?? [];
            parts.forEach((part, at) => {
              window.setTimeout(() => {
                controller.enqueue(encode.encode(`event: chunk\ndata: ${JSON.stringify({ text: part })}\n\n`));
              }, 60 * at);
            });
            window.setTimeout(() => {
              controller.enqueue(encode.encode('event: done\ndata: {"millis":1000}\n\n'));
              controller.close();
            }, 60 * parts.length + 60);
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }

      if (/\/api\/workspaces\/[^/]+\/speech/.test(address)) {
        const said = JSON.parse(String(init?.body ?? '{}'));
        const piece = { text: said.text ?? '', at: Date.now(), made: null };
        asked.push(piece);
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((ready) => window.setTimeout(ready, synthMs));
        inFlight -= 1;
        piece.made = Date.now();
        return new Response(clip(), { status: 200, headers: { 'content-type': 'audio/wav' } });
      }

      return real(input, init);
    };
  },
  { answer: ANSWER, synthMs: SYNTH_MS },
);

/* ----------------------------------------------------------- the fixture */

async function sweep() {
  const { models } = await graphql(`query($w: ID!) { models(workspaceId: $w) { id name } }`, {
    w: WORKSPACE,
  });
  const { workspace } = await graphql(`query($id: ID!) { workspace(id: $id) { speechModelId } }`, {
    id: WORKSPACE,
  });
  const mine = models.filter((one) => one.name.startsWith(PREFIX));
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

/*
 * A speech model, so the speaker is offered at all. It is never asked
 * anything - the stub above answers before the request leaves the page - but
 * the button is drawn on the workspace having one, and a check that turned it
 * on by reaching into the component would be testing the wrong screen.
 */
const { modelProviders } = await graphql(`query($w: ID!) { modelProviders(workspaceId: $w) { id name } }`, {
  w: WORKSPACE,
});
const provider = modelProviders[0];
if (provider === undefined) {
  record(false, 'this workspace has no model provider, so no speech model can be made');
  await finish(browser);
}

const made = await graphql(`mutation($input: CreateModelInput!) { createModel(input: $input) { id name } }`, {
  input: {
    providerId: provider.id,
    name: `${PREFIX} SPEECH`,
    modelId: `${PREFIX}-speech`,
    kind: 'SPEECH',
  },
});
console.log(`made model ${made.createModel.name} (#${made.createModel.id})`);
await graphql(`mutation($w: ID!, $m: ID) { setWorkspaceSpeechModel(workspaceId: $w, modelId: $m) { id } }`, {
  w: WORKSPACE,
  m: made.createModel.id,
});

const started = await graphql(`mutation($input: StartChatInput!) { startChat(input: $input) { id title } }`, {
  input: { workspaceId: WORKSPACE, title: `${PREFIX} ${Date.now()}` },
});
const CHAT = started.startChat.id;
console.log(`made chat ${started.startChat.title} (#${CHAT})`);

/* -------------------------------------------------------------- the drive */

await page.goto(`${BASE}/chat/${CHAT}`, { waitUntil: 'domcontentloaded' });

let drew = false;
if (await drawn(page, 'the chat')) {
  drew = await page
    .waitForSelector('#chat-composer', { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  record(drew, 'the chat opened with a composer to type in');
}

if (!drew) await finish(browser);

/** Types a message and sends it, the way somebody does. */
await page.fill('#chat-composer', 'Say something with markdown in it');
await page.click('button[type="submit"]');

/*
 * Until the whole answer is there. The speaker appears on the first token, and
 * pressing it then would be reading whatever had arrived - a real thing
 * somebody can do, and not the thing this check is about.
 */
const spoke = await page
  .waitForFunction(
    () =>
      document.body.innerText.includes('to work out.') &&
      document.querySelector('button[aria-label="Read this answer aloud"]') !== null,
    { timeout: 30_000 },
  )
  .then(() => true)
  .catch(() => false);
record(spoke, 'the answer arrived in full, with a speaker under it');

if (!spoke) await finish(browser);

/*
 * What the page is showing is still the rendered markdown, which is the half of
 * #255 that must not move: reading an answer aloud is not a licence to draw it
 * differently.
 */
const drawnCode = await page.evaluate(() => document.querySelectorAll('pre code').length);
record(drawnCode > 0, `the answer is still drawn as markdown, code block and all (${drawnCode} of them)`);

const pressedAt = Date.now();
await page.click('button[aria-label="Read this answer aloud"]');

/*
 * Until it has read the whole answer. The end of the reading is the button
 * going back to offering to read - it says "Stop reading" while it is talking.
 */
const talking = await page
  .waitForSelector('button[aria-label="Stop reading"]', { timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
record(talking, 'the speaker says it is talking once it is, and offers to stop');
await page.screenshot({ path: shot('spoken-answer-reading.png') });
// And until the whole answer has been read, which is the button offering to
// read again rather than to stop.
await page
  .waitForFunction(() => document.querySelector('button[aria-label="Stop reading"]') === null, {
    timeout: 60_000,
  })
  .catch(() => undefined);

const spokenAt = await page.evaluate(() => ({
  asked: window.__spoken.asked,
  most: window.__spoken.most(),
  playedAt: window.__spoken.playedAt(),
}));

await page.screenshot({ path: shot('spoken-answer.png') });

/* ------------------------------------------------------- what was spoken */

const said = spokenAt.asked.map((one) => one.text);
const all = said.join(' ');
console.log(`asked for ${said.length} piece(s): ${JSON.stringify(said)}`);

record(said.length > 0, 'the answer was sent to be read aloud at all');

for (const [what, mark] of [
  ['asterisks', '*'],
  ['backticks', '`'],
  ['heading hashes', '#'],
  ['table pipes', '|'],
  ['link syntax', ']('],
]) {
  record(!all.includes(mark), `no ${what} were sent to be pronounced`);
}

record(
  all.includes('release notes') && !all.includes('example.com'),
  'a link is read as its text and not as its address',
);
record(
  all.includes('What changed'),
  'a heading is read as its words rather than as its hashes',
);
record(
  !all.includes('val warmed') && !all.includes('println'),
  'the code inside a fenced block is not read out line by line',
);
record(
  /code block/i.test(all),
  'but the block is announced, so the answer does not refer to something never mentioned',
);
record(
  all.includes('Timeout') && all.includes('Thirty seconds'),
  "a table's cells are read as words, in the order they are drawn in",
);

/* ------------------------------------------------ and when it was asked for */

record(said.length > 1, `the answer was read in pieces rather than in one request (${said.length})`);

if (said.length > 1 && spokenAt.playedAt !== null) {
  const last = spokenAt.asked[spokenAt.asked.length - 1];
  record(
    spokenAt.playedAt < last.at,
    `sound started ${last.at - spokenAt.playedAt} ms before the last piece was even asked for`,
  );
  record(
    spokenAt.playedAt - pressedAt < SYNTH_MS * 2,
    `and ${spokenAt.playedAt - pressedAt} ms after the press, which is about one piece ` +
      `(${SYNTH_MS} ms) rather than the ${SYNTH_MS * said.length} ms the whole answer takes`,
  );
} else {
  record(spokenAt.playedAt !== null, 'sound started at all (nothing ever played)');
}

record(
  spokenAt.most <= 2,
  `never more than two pieces were being made at once (${spokenAt.most}): one playing, one ahead`,
);

/* -------------------------------------------------- and the fixture is gone */

await sweep();
console.log('swept the model and the chat');

await finish(browser);
