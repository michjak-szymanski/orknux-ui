/**
 * Issue #220: the send button said "Sending…" for as long as the model took to
 * answer.
 *
 * It is one boolean drawn as one word. The press sets it, the end of the stream
 * clears it, and everything in between - which is nearly all of it - was
 * labelled as though the message were still going out. The message goes out in
 * a few hundred bytes and is written to the history before the stream even
 * opens; what the rest of the wait is, is a model thinking. Two minutes of
 * "Sending…" reads as a message that never left, and people press it again.
 *
 * The screen was already contradicting itself, which is the part that makes
 * this worth a check rather than a one-line edit: the conversation draws
 * "Waiting for Gemma 31B…" under the turn while the button beside it says the
 * message is still on its way. The label is derived from the same thing that
 * row is derived from now, so the check asserts they agree - not just that the
 * word changed.
 *
 * **The stream is this check's own.** Not to avoid the server, but because what
 * is being tested is *when* each word is shown, and that timing belongs to the
 * model: a real one answers in anything from half a second to two minutes, and
 * against a seeded installation - CI's, and any machine whose stored provider
 * keys cannot be read - it never answers at all. So `fetch` is replaced for the
 * one address the chat streams from, and it holds the answer back for a known
 * two seconds and then sends a known chunk. Everything else on the page,
 * including every GraphQL call the send makes afterwards, is the real thing.
 *
 * The labels are polled rather than sampled at three moments, because the
 * failure this is guarding against is a word appearing when it should not.
 * "Sending…" must not be among them at any point, and the check would rather
 * see it and say so than miss it between two waits.
 */
import { BASE, open, record, finish } from './suite/harness.mjs';

const { browser, context, page } = await open({ viewport: { width: 1440, height: 1000 } });

/** How long the stubbed model "thinks" before its first and only chunk. */
const THINKS_FOR = 2000;

await context.addInitScript((thinksFor) => {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const address = typeof input === 'string' ? input : input.url;
    if (!/\/api\/chats\/[^/]+\/stream/.test(address)) return real(input, init);
    const encode = new TextEncoder();
    /*
     * The response resolves at once, as the server's does - the message is
     * stored before the stream opens - and the answer follows later. That gap
     * is the whole of what this check is about.
     */
    const body = new ReadableStream({
      start(controller) {
        window.setTimeout(() => {
          controller.enqueue(encode.encode('event: chunk\ndata: {"text":"A stubbed answer."}\n\n'));
        }, thinksFor);
        window.setTimeout(() => {
          controller.enqueue(encode.encode(`event: done\ndata: {"millis":${thinksFor}}\n\n`));
          controller.close();
        }, thinksFor + 1200);
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}, THINKS_FOR);

await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' });
const composer = page.locator('#chat-composer');
await composer.waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(700);

const button = page.locator('form:has(#chat-composer) button[type="submit"]');
record(((await button.textContent()) ?? '').trim() === 'Send', 'the button says Send with nothing in flight');

await composer.click();
await page.keyboard.type('What does this button say while you think about it?');
await page.keyboard.press('Enter');

/*
 * Every label the button wore, with when it was worn and whether the
 * conversation was showing its own "Waiting for …" row at the time. One pass,
 * so the two are read of the same instant.
 */
const began = Date.now();
const seen = [];
for (let poll = 0; poll < 90; poll += 1) {
  const now = await page.evaluate(() => {
    const submit = document.querySelector('form button[type="submit"]');
    const waiting = [...document.querySelectorAll('p')].some((p) => /^Waiting for /.test(p.textContent ?? ''));
    return { label: (submit?.textContent ?? '').trim(), waiting };
  });
  const at = Date.now() - began;
  const last = seen[seen.length - 1];
  if (last === undefined || last.label !== now.label || last.waiting !== now.waiting) {
    seen.push({ ...now, from: at, to: at });
  } else {
    last.to = at;
  }
  if (seen.length > 1 && now.label === 'Send') break;
  await page.waitForTimeout(100);
}

for (const one of seen) console.log(`  ${one.from}-${one.to}ms: "${one.label}"${one.waiting ? ' (log says waiting)' : ''}`);

const labels = seen.map((one) => one.label);

record(
  !labels.includes('Sending…'),
  `it never claims to be sending a message that has gone: it said ${labels.map((one) => `"${one}"`).join(', ')}`,
);

const waited = seen.filter((one) => one.label === 'Waiting…');
record(waited.length > 0, 'while the model is thinking it says it is waiting');
if (waited.length > 0) {
  const held = Math.max(...waited.map((one) => one.to - one.from));
  record(
    held >= THINKS_FOR - 400,
    `and says it for the whole wait (${held}ms of the ${THINKS_FOR}ms the model took)`,
  );
  record(
    waited.every((one) => one.waiting),
    'and the conversation says the same thing under the turn at the same time',
  );
}

const answered = seen.filter((one) => one.label === 'Answering…');
record(answered.length > 0, 'once the answer starts arriving it says so');
if (answered.length > 0 && waited.length > 0) {
  record(
    Math.min(...answered.map((one) => one.from)) > Math.min(...waited.map((one) => one.from)),
    'in that order: waiting first, answering after',
  );
}

record(labels[labels.length - 1] === 'Send', `and it is a Send button again at the end (it says "${labels[labels.length - 1]}")`);

/*
 * Empty, it is drawn plainly inactive on purpose - a composer whose only
 * control disappears reads as a screen that is not ready - so "can be pressed
 * again" is asked with something in the box, which is the state somebody
 * pressing it would be in.
 */
await composer.click();
await page.keyboard.type('And again');
await page.waitForTimeout(200);
record(await button.isEnabled(), 'and can be pressed again');

await finish(browser);
