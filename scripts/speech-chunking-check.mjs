/**
 * How many requests one answer costs to read aloud, under each of the three
 * things a workspace can say about where it may be cut.
 *
 * Issue #263 made reading pipelined: an answer is cut at sentence ends and the
 * next piece is made while the current one is in the air, so the wait before
 * the first word stopped being the wait for the last one to be synthesised.
 * That was one shape for everybody, and it is a listening preference rather
 * than a fact - somebody holding a hands-free conversation wants the first word
 * as early as it can be had, and somebody listening to a written answer hears
 * the join between every sentence and pays for a request behind each one. So
 * the workspace says which, and this is what proves the saying reaches the
 * speech provider.
 *
 * **Requests are the assertion, not the stored value.** Reading the setting
 * back off the API proves it persisted, which is a thing the server's own test
 * already says and which every version of this feature that does nothing at all
 * would also pass. What cannot be faked is the count on the wire: the same
 * answer, read three times, has to cost one request under None, one per
 * paragraph under Paragraph, and more than that under Sentence. A page that
 * saved the setting and went on cutting at sentence ends fails here and nowhere
 * else.
 *
 * The second assertion is that all three say the same words. A mode is a
 * decision about where to cut, never about what to read: a chunking that
 * dropped a paragraph, or read one twice, would otherwise pass on its count.
 *
 * Both stubs are this check's own, for the reasons `spoken-answer-check` gives
 * - the answer has to be a known text, and the speech endpoint has to be
 * something that can be counted. Everything else on the page is real, including
 * the setting, which is saved through the API and read by the chat exactly as a
 * person's would be.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const PREFIX = 'zzSpeechChunking';

/** How long the stubbed speech model takes over one piece. */
const SYNTH_MS = 250;

/**
 * Three paragraphs, and each of them longer than one breath.
 *
 * Written as plain prose with no markdown in it, because what is being counted
 * is where the cuts fall and a heading or a table would put block boundaries in
 * the middle of the measurement. Each paragraph is one line and several
 * sentences: long enough that Sentence has to cut inside it, so the three
 * counts cannot come out the same by accident.
 */
const PARAGRAPHS = [
  'The cache is warmed by a startup hook now, and the release notes explain why that turned out ' +
    'to matter more than anybody expected. It runs once, on the first request after a restart, ' +
    'and takes a little under a second on every machine we have measured it on. Nothing waits for ' +
    'it and nothing depends on it having finished. If it fails there is a line in the log saying ' +
    'so, and the request it was warming for is served from the database instead.',
  'That is what used to happen on every request, which is the whole of the reason this exists at ' +
    'all. The database is not slow, but it is not free either, and the same handful of rows were ' +
    'being fetched several hundred times a minute for no reason anybody could name. Warming them ' +
    'once costs a second and saves the rest of the day. The measurement is in the notes, and the ' +
    'shape of it is not subtle.',
  'There is one thing to watch, and it is worth saying plainly rather than leaving in a footnote. ' +
    'A restart under load warms the cache while requests are already arriving, so the first few ' +
    'of them are served the old way and the numbers for that minute look wrong. They are not ' +
    'wrong. They are the warming being measured alongside the thing it warms, which is exactly ' +
    'what you would expect if you thought about it for a moment.',
];

const ANSWER = PARAGRAPHS.join('\n\n');

/** The last words of it, which is how the page says the answer has all arrived. */
const ENDING = 'for a moment.';

const { browser, context, page, graphql } = await open({
  launch: { args: ['--autoplay-policy=no-user-gesture-required'] },
  viewport: { width: 1440, height: 1000 },
});

/* ------------------------------------------------------------- the stubs */

await context.addInitScript(
  ({ answer, synthMs }) => {
    /** Every piece this page asked to have read, in the order it asked. */
    const asked = [];
    window.__spoken = { asked };

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
            const parts = answer.match(/[\s\S]{1,80}/g) ?? [];
            parts.forEach((part, at) => {
              window.setTimeout(() => {
                controller.enqueue(encode.encode(`event: chunk\ndata: ${JSON.stringify({ text: part })}\n\n`));
              }, 20 * at);
            });
            window.setTimeout(() => {
              controller.enqueue(encode.encode('event: done\ndata: {"millis":1000}\n\n'));
              controller.close();
            }, 20 * parts.length + 40);
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }

      if (/\/api\/workspaces\/[^/]+\/speech/.test(address)) {
        const said = JSON.parse(String(init?.body ?? '{}'));
        asked.push(said.text ?? '');
        await new Promise((ready) => window.setTimeout(ready, synthMs));
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
 * What this workspace was set to before any of this, so it goes back to it. A
 * check that leaves a workspace reading its answers differently has changed the
 * product to measure it.
 */
const before = (await graphql(`query($id: ID!) { workspace(id: $id) { voiceSpeechChunking } }`, {
  id: WORKSPACE,
})).workspace.voiceSpeechChunking;
console.log(`this workspace was on ${before}`);

record(
  before === 'SENTENCE' || ['NONE', 'PARAGRAPH'].includes(before),
  `the workspace reports one of the three rather than nothing (${before})`,
);

/*
 * A speech model, so the speaker is offered at all. It is never asked anything
 * - the stub above answers before the request leaves the page - but the button
 * is drawn on the workspace having one.
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

/* -------------------------------------------------------------- the drive */

/**
 * One whole reading of the same answer, on one setting: a chat of its own, a
 * fresh load of the page so the setting is read the way a person's browser
 * reads it, and the pieces that reached the speech endpoint.
 *
 * A chat each rather than three turns in one, because the speaker under an
 * answer is per answer and a page holding three of them makes "the answer" an
 * ambiguous thing to press.
 */
async function readOn(chunking) {
  await graphql(
    `mutation($w: ID!, $c: SpeechChunking!) {
       setWorkspaceVoiceSpeechChunking(workspaceId: $w, chunking: $c) { voiceSpeechChunking }
     }`,
    { w: WORKSPACE, c: chunking },
  );

  const started = await graphql(`mutation($input: StartChatInput!) { startChat(input: $input) { id title } }`, {
    input: { workspaceId: WORKSPACE, title: `${PREFIX} ${chunking} ${Date.now()}` },
  });
  const chat = started.startChat.id;

  await page.goto(`${BASE}/chat/${chat}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, `the chat on ${chunking}`))) return null;

  const composer = await page
    .waitForSelector('#chat-composer', { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  if (!composer) {
    record(false, `${chunking}: the chat opened with a composer to type in`);
    return null;
  }

  await page.fill('#chat-composer', 'Tell me what changed');
  await page.click('button[type="submit"]');

  const arrived = await page
    .waitForFunction(
      (ending) =>
        document.body.innerText.includes(ending) &&
        document.querySelector('button[aria-label="Read this answer aloud"]') !== null,
      ENDING,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!arrived) {
    record(false, `${chunking}: the answer arrived in full, with a speaker under it`);
    return null;
  }

  await page.click('button[aria-label="Read this answer aloud"]');
  // Until the whole answer has been read, which is the button offering to read
  // again rather than to stop.
  await page
    .waitForSelector('button[aria-label="Stop reading"]', { timeout: 30_000 })
    .catch(() => undefined);
  await page
    .waitForFunction(() => document.querySelector('button[aria-label="Stop reading"]') === null, {
      timeout: 90_000,
    })
    .catch(() => undefined);

  const asked = await page.evaluate(() => window.__spoken.asked);
  console.log(`${chunking}: ${asked.length} request(s)`);
  return asked;
}

const none = await readOn('NONE');
const sentence = await readOn('SENTENCE');
const paragraph = await readOn('PARAGRAPH');
await page.screenshot({ path: shot('speech-chunking.png') });

/* ------------------------------------------------------- what it cost to read */

const heard = none !== null && sentence !== null && paragraph !== null;
record(heard, 'all three settings were read out and counted');

if (heard) {
  record(
    none.length === 1,
    `None is one request for the whole answer (${none.length})`,
  );
  record(
    paragraph.length === PARAGRAPHS.length,
    `Paragraph is one request per paragraph (${paragraph.length} for ${PARAGRAPHS.length})`,
  );
  record(
    sentence.length > paragraph.length,
    `Sentence is more than that, because it cuts inside a paragraph ` +
      `(${sentence.length} against ${paragraph.length})`,
  );
  record(
    none.length < paragraph.length && paragraph.length < sentence.length,
    `and the three come out in that order: None ${none.length}, ` +
      `Paragraph ${paragraph.length}, Sentence ${sentence.length}`,
  );

  /*
   * The single request under None really is the whole answer, rather than the
   * first piece of one with the rest never asked for. One request is also what
   * a reader that gave up after the first sentence would produce.
   */
  record(
    none[0].includes(PARAGRAPHS[0].slice(0, 30)) && none[0].includes(ENDING),
    'the one request under None carries the answer from its first words to its last',
  );

  /*
   * Every paragraph piece is one paragraph: it opens where a paragraph opens
   * and holds no blank line, which is a cut inside one spelled the other way.
   */
  const whole = paragraph.every((piece, at) => piece.startsWith(PARAGRAPHS[at].slice(0, 30)));
  record(whole, 'each request under Paragraph begins where a paragraph begins');
  record(
    paragraph.every((piece) => !/\n\s*\n/.test(piece)),
    'and none of them has a paragraph break inside it',
  );

  /*
   * The same words, three times. A mode decides where an answer is cut and
   * never what is read: dropping a paragraph, or reading one twice, would sail
   * through every count above.
   */
  const words = (pieces) => pieces.join(' ').replace(/\s+/g, ' ').trim();
  record(
    words(none) === words(sentence) && words(sentence) === words(paragraph),
    'all three read the same words, in the same order',
  );
}

/* -------------------------------------------------- and the fixture is gone */

await graphql(
  `mutation($w: ID!, $c: SpeechChunking!) {
     setWorkspaceVoiceSpeechChunking(workspaceId: $w, chunking: $c) { voiceSpeechChunking }
   }`,
  { w: WORKSPACE, c: before },
).catch(() => undefined);
await sweep();
console.log(`swept the model and the chats, and put the workspace back on ${before}`);

await finish(browser);
