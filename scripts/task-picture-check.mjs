/**
 * A picture a task produced, drawn in the outcome card rather than named in it.
 *
 * Issue #283. The server half is `TaskPictureTest` on both engines, and it
 * proves what a server can prove: the drawing tool is offered only where there
 * is something to draw with, the request goes to `/images/generations`, the
 * bytes are filed under the workspace, and the task's `outcome` comes back as
 * markdown carrying an image at `/api/task-pictures/{id}`.
 *
 * What no server test can say is whether anybody sees a picture. The outcome
 * card renders whatever the agent wrote, and until this feature the only thing
 * that could arrive there was prose — so the difference between working and
 * broken is entirely whether that markdown is *rendered*, whether the bytes
 * behind it load, and whether the picture stays inside the card it is in. Those
 * are the assertions here.
 *
 * **The task is fabricated in the browser, and the picture with it.** That is
 * deliberate and it is what lets this run in CI. Producing a real one takes a
 * model that answers, decides to draw, and calls a tool — which is
 * `task-live-check`'s territory and is never run unattended — and every one of
 * those steps is already pinned on the server. What is being checked here is
 * one screen given one answer, so the answer is supplied.
 *
 * The task is given no session, so the page opens no event stream and fetches
 * no log: a `state` frame arriving from a real stream carries a real task and
 * would quietly replace the one this check is about.
 */
import { crc32, deflateSync } from 'node:zlib';

import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

/** The task the page is given, and the id its picture is asked for by. */
const TASK = '99999901';
const PICTURE = '99999902';

const SUMMARY = 'I drew the diagram you asked for.';

/**
 * A picture, built here rather than carried as a blob.
 *
 * The same trick `scripts/suite/image-stub.py` plays for the chat's half of
 * this feature, in the other language: a PNG of one colour is a header, one
 * deflated block of filtered rows and an end marker, and writing it out is
 * shorter than three kilobytes of base64 would be.
 *
 * The size is the point. A drawing model answers with something a thousand
 * pixels or more across, and the assertion below is that such a picture stays
 * inside a card narrower than it - which a 64-pixel square would pass whether
 * or not anything capped its width.
 */
function png(width, height, colour = [220, 60, 60]) {
  const chunk = (kind, payload) => {
    const body = Buffer.concat([Buffer.from(kind, 'ascii'), payload]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, check]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Eight bits a channel, colour type 2, which is RGB with no palette.
  header.set([8, 2, 0, 0, 0], 8);

  // A filter byte then RGB triples, per row, which is filter type 0.
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => colour).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** What the endpoint answers with: as wide as a real drawing, and decodable. */
const DRAWING = png(1536, 512);

/** The task as the server would answer it: what the agent said, then what it drew. */
const task = {
  id: TASK,
  workspaceId: WORKSPACE,
  title: 'Illustrate the release notes',
  prompt: 'Write the notes and draw something to go with them.',
  agentId: null,
  agentName: 'Writer',
  modelId: null,
  status: 'DONE',
  // Null on purpose: with no session there is no log to fetch and no stream to
  // open, so nothing can arrive later and replace the answer below.
  sessionId: null,
  issueId: null,
  createdBy: 'alice',
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  turnsSpent: 2,
  turnsAllowed: 40,
  workedSeconds: 12,
  secondsAllowed: 7200,
  waitingUntil: null,
  outcome: `${SUMMARY}\n\n![A diagram of the release pipeline](/api/task-pictures/${PICTURE})`,
  endedBecause: 'finished',
  requests: [],
  grants: [],
};

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

/** Whether the picture's bytes are still there, which the last section turns off. */
let filed = true;

await page.route('**/graphql', async (route) => {
  const body = route.request().postData() ?? '';
  // Only the one query. Everything else on the page - the workspace, the
  // sidebar, whoever is signed in - is the real installation's answer.
  if (!body.includes('task(id: $id)')) return route.continue();
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { task } }),
  });
});

await page.route('**/api/task-pictures/**', async (route) => {
  if (!filed) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  return route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: DRAWING,
  });
});

await page.goto(`${BASE}/workspace/${WORKSPACE}/tasks/${TASK}`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the task page'))) await finish(browser);

const outcome = page.locator('[data-testid="task-outcome"]');
await outcome.waitFor({ state: 'visible', timeout: 20_000 });

/* ------------------------------------------------------- the picture itself */

const picture = outcome.locator('img[src^="/api/task-pictures/"]').first();
await picture.waitFor({ state: 'visible', timeout: 20_000 });

/*
 * Loaded, not merely present. A 404 is an `<img>` too, and an assertion that
 * counts tags passes on an outcome full of broken pictures.
 */
const pixels = await picture.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
record(
  pixels.w > 0 && pixels.h > 0,
  `the picture is in the outcome and has loaded (${pixels.w}x${pixels.h})`,
);

/*
 * And the markdown that names it is not what is on screen. This is the whole
 * failure mode the feature has: an outcome is text, and text saying
 * "![A red square](/api/task-pictures/12)" is a task that produced nothing as
 * far as anybody reading it can tell.
 */
const shown = await page.locator('body').innerText();
record(!shown.includes('](/api/task-pictures/'), 'the markdown behind it is rendered rather than printed');

/*
 * The summary is still there. A picture is added to what the agent said, never
 * instead of it - the server composes the two, and a card that drew only the
 * picture would have lost the account of what was done.
 */
record(shown.includes(SUMMARY), `what the agent said is still shown beside it ("${SUMMARY}")`);

/* --------------------------------------------------------------- the layout */

/*
 * Inside the card, and not wider than it.
 *
 * A drawn picture is a thousand pixels or more on its longest side and the
 * outcome card is a column, so an image with no cap on it pushes the card out
 * and takes the page's horizontal scrollbar with it. `.markdown img` caps the
 * width; this is what notices if that rule is ever narrowed to the manual.
 */
const fits = await outcome.evaluate((card) => {
  const image = card.querySelector('img[src^="/api/task-pictures/"]');
  if (image === null) return null;
  return { image: image.getBoundingClientRect().width, card: card.getBoundingClientRect().width };
});
record(
  fits !== null && fits.image <= fits.card + 1,
  `the picture is drawn inside the card rather than through it (${JSON.stringify(fits)})`,
);
record(
  await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  'and the page has not grown a horizontal scrollbar because of it',
);

await page.screenshot({ path: shot('task-picture-check.png'), fullPage: false });

/* ---------------------------------------------------------------- the zoom */

/*
 * It opens larger, which is why `zoomImages` is on here and nowhere else a
 * model's words are drawn. The picture is the thing that was asked for and the
 * card is narrower than it, which is issue #217's argument for the manual said
 * again about something a task made.
 */
// The label is built from the alt text and is deliberately not translated - it
// is a sentence plus somebody's description, and the description is whatever
// language it was written in.
const zoom = outcome.locator('button[aria-label^="Open larger"]').first();
const zoomable = await zoom.isVisible().catch(() => false);
record(zoomable, 'the picture is a control, so it is reachable by keyboard');

/*
 * Guarded rather than clicked regardless. A build where the outcome is no
 * longer zoomable has one thing wrong with it, and pressing a control that is
 * not there reports it as a thirty-second timeout with a stack trace - which
 * reads as the check being broken rather than as the page having changed.
 */
if (zoomable) {
  await zoom.click();
  await page.waitForTimeout(400);
  const opened = await page.locator('dialog[open]').count();
  record(opened === 1, `clicking it opens the picture over the page (${opened} dialogs open)`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  record((await page.locator('dialog[open]').count()) === 0, 'and Escape closes it again');
}

/* ------------------------------------------------ a picture that has gone */

/*
 * What the card shows for a picture whose bytes are no longer there.
 *
 * A task can be deleted, an attachment directory can be moved out from under an
 * installation, and either way the row survives and the link 404s. Left alone
 * the browser draws its broken-image icon, which says this page is broken
 * rather than that the file is gone. The 404 is forced here rather than made by
 * deleting a file, because what is being asserted is what the page does with
 * the answer, and the answer is the same one either way.
 */
filed = false;
await page.reload({ waitUntil: 'domcontentloaded' });
await outcome.waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(1500);

const gone = await page.locator('body').innerText();
record(/This picture is gone|Tego obrazu/.test(gone), 'a picture whose bytes have gone reads as one line saying so');
record(
  (await outcome.locator('img[src^="/api/task-pictures/"]').count()) === 0,
  'and the broken picture is not left standing in the outcome',
);
record(gone.includes(SUMMARY), 'while what the agent said is still there, because that is not what was lost');

await finish(browser);
