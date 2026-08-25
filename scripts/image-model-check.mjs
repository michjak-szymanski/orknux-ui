/**
 * A picture asked for in a chat, drawn, and still there afterwards.
 *
 * Issue #240. The server half is `ChatPictureTest` on both engines, and it
 * proves what a server can prove: the request goes to `/images/generations`, the
 * bytes are filed under the workspace, the exchange lands in the chat's history.
 * What no server test can say is whether a person can find any of it — whether
 * the button is in the composer, whether pressing it changes what Send is about
 * to do, and whether the answer bubble actually renders the picture rather than
 * printing the markdown that names it.
 *
 * So the assertions here are the ones that are about the screen:
 *
 *   - the picker on the Chat card offers image models and nothing else;
 *   - the picture button is in the composer, and pressing it turns Send into
 *     Draw and the placeholder into a description;
 *   - a description that is drawn comes back as a picture *inside the answer*,
 *     loaded, with real pixels in it - `naturalWidth` rather than the presence
 *     of an `<img>` tag, because a broken image is an `<img>` tag;
 *   - the cost line beside it says what the picture cost rather than $0.00.
 *
 * **It needs an image endpoint the server can reach**, which is why it is not in
 * CI. Everything else on this page is stubbed in the browser, and this one thing
 * cannot be: the drawing happens on the server, from a mutation, and a stub in
 * the page would be a check of the stub. `scripts/suite/image-stub.py` is a
 * dozen lines answering `/images/generations` with a red square, and where it is
 * goes in ORKNUX_IMAGE_STUB.
 *
 * It builds its own model and takes it away again, the way the two speech checks
 * do: a seeded installation has one chat model and nothing else, and a check
 * that left an image model behind would change what the next one sees.
 */
import { BASE, WORKSPACE, open, record, drawn, finish, shot } from './suite/harness.mjs';

const PREFIX = 'zzImageModel';

/** Where something answering `/images/generations` is, as the *server* sees it. */
const STUB = process.env.ORKNUX_IMAGE_STUB ?? 'http://localhost:8199';

/** What one picture is said to cost, which is what the cost line has to print. */
const PRICE = 0.04;

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------- the fixture */

/** Anything a previous run left behind, before this one adds to it. */
async function sweep() {
  const { workspace } = await graphql(`query($id: ID!) { workspace(id: $id) { imageModelId } }`, {
    id: WORKSPACE,
  });
  const { models } = await graphql(`query($w: ID!) { models(workspaceId: $w) { id name } }`, { w: WORKSPACE });
  const mine = models.filter((one) => one.name.startsWith(PREFIX));
  if (mine.some((one) => one.id === workspace.imageModelId)) {
    await graphql(`mutation($w: ID!) { setWorkspaceImageModel(workspaceId: $w, modelId: null) { id } }`, {
      w: WORKSPACE,
    }).catch(() => undefined);
  }
  for (const old of mine) {
    await graphql(`mutation($id: ID!) { removeModel(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept model ${old.name} (#${old.id})`);
  }

  const { modelProviders } = await graphql(`query($w: ID!) { modelProviders(workspaceId: $w) { id name } }`, {
    w: WORKSPACE,
  });
  for (const old of modelProviders.filter((one) => one.name.startsWith(PREFIX))) {
    await graphql(`mutation($id: ID!) { removeModelProvider(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept provider ${old.name} (#${old.id})`);
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
 * A provider of its own rather than the seed's, because the seed's points at an
 * Ollama and an Ollama is exactly what this feature refuses: it has no image
 * endpoint, and the refusal is a sentence rather than a call. OPENAI is the
 * shape the stub answers in.
 */
const provider = (
  await graphql(
    `mutation($input: CreateModelProviderInput!) { createModelProvider(input: $input) { id name } }`,
    {
      input: {
        workspaceId: WORKSPACE,
        name: `${PREFIX} provider`,
        type: 'OPENAI',
        endpoint: STUB,
        secret: 'sk-check',
      },
    },
  )
).createModelProvider;
console.log(`made provider ${provider.name} (#${provider.id}) at ${STUB}`);

const model = (
  await graphql(`mutation($input: CreateModelInput!) { createModel(input: $input) { id name } }`, {
    input: {
      providerId: provider.id,
      name: `${PREFIX} IMAGE`,
      modelId: `${PREFIX}-image`,
      kind: 'IMAGE',
      imageCostPerImage: PRICE,
    },
  })
).createModel;
console.log(`made model ${model.name} (#${model.id})`);

/* ------------------------------------------------- the picker on the card */

await page.goto(`${BASE}/workspace/${WORKSPACE}/settings`, { waitUntil: 'domcontentloaded' });
const picker = page.locator('#image-model');
await picker.waitFor({ state: 'visible', timeout: 20_000 });

// The catalogue arrives after the page does, so the option is waited for rather
// than read off a select that has only just been drawn.
await picker.locator(`option:has-text("${PREFIX}-image")`).waitFor({ state: 'attached', timeout: 20_000 })
  .catch(() => undefined);
const offered = await picker.locator('option').allTextContents();
record(
  offered.some((one) => one.includes(`${PREFIX}-image`)),
  `the Text-to-image picker offers the image model (it offers ${JSON.stringify(offered)})`,
);
/*
 * And only image models. The seed's chat model is the one that would slip
 * through a filter written the wrong way round, and a chat model chosen here is
 * a description sent to an endpoint that does not exist.
 */
record(
  !offered.some((one) => /ollama|llama|gpt-4|claude/i.test(one)),
  `the picker offers nothing that is not an image model (${JSON.stringify(offered)})`,
);

await picker.selectOption(String(model.id));
await page.waitForTimeout(700);
const saved = (await graphql(`query($id: ID!) { workspace(id: $id) { imageModelId } }`, { id: WORKSPACE }))
  .workspace.imageModelId;
record(String(saved) === String(model.id), `choosing it on the card saves it (the workspace holds ${saved})`);

/* ----------------------------------------------------------- the composer */

const chat = (
  await graphql(`mutation($input: StartChatInput!) { startChat(input: $input) { id title } }`, {
    input: { workspaceId: WORKSPACE, title: `${PREFIX} ${Date.now()}` },
  })
).startChat;

await page.goto(`${BASE}/chat/${chat.id}`, { waitUntil: 'domcontentloaded' });
await drawn(page, 'image-model-composer', { within: 20_000 });

const composer = page.locator('#chat-composer');
await composer.waitFor({ state: 'visible', timeout: 20_000 });

const button = page.locator('#chat-picture');
await button.waitFor({ state: 'visible', timeout: 20_000 });
record(await button.isVisible(), 'the picture button is in the composer where the workspace has a model');
record(
  (await button.getAttribute('aria-label')) === 'Draw a picture instead',
  'and says what it is for, so it is not an unlabelled icon',
);

const before = await composer.getAttribute('placeholder');
const sendBefore = (await page.locator('button[type="submit"]').first().innerText()).trim();

await button.click();
await page.waitForTimeout(300);

const after = await composer.getAttribute('placeholder');
const sendAfter = (await page.locator('button[type="submit"]').first().innerText()).trim();

/*
 * The whole of "obvious to somebody who has not read the manual" is here. A
 * toggle that changed nothing visible would be a button that silently sends the
 * next message somewhere else.
 */
record(after !== before, `pressing it changes what the box is asking for ("${before}" became "${after}")`);
record(/pictur|draw|obraz|rysu/i.test(after ?? ''), `and asks for a description ("${after}")`);
record(
  sendAfter !== sendBefore,
  `and the send button says what it is about to do ("${sendBefore}" became "${sendAfter}")`,
);
record(
  (await button.getAttribute('aria-pressed')) === 'true',
  'and the button reports itself as on, so it is readable by something other than colour',
);
record(
  (await button.getAttribute('aria-label')) === 'Send this as a message',
  'and says how to get back, rather than repeating what is already on',
);

/* -------------------------------------------------------------- the drawing */

await composer.fill('A red square');
await page.locator('button[type="submit"]').first().click();

// The provider is real, so this is a real wait rather than a settle.
const picture = page.locator('img[src^="/api/attachments/"]').first();
await picture.waitFor({ state: 'visible', timeout: 60_000 });

/*
 * Loaded, not merely present. A 404 is an `<img>` too, and an assertion that
 * counts tags passes on a chat full of broken pictures.
 */
const pixels = await picture.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
record(pixels.w > 0 && pixels.h > 0, `the picture is in the answer and has loaded (${pixels.w}x${pixels.h})`);

/* And it is inside the answer rather than in the file row above the composer. */
const inAnswer = await picture.evaluate((el) => {
  const markdown = el.closest('[class*="markdown"]');
  return markdown !== null;
});
record(inAnswer, 'it is rendered inside the answer, not only listed as a file');

// The markdown that names it is not what is on screen.
const shown = await page.locator('body').innerText();
record(
  !shown.includes('](/api/attachments/'),
  'the markdown behind it is rendered rather than printed',
);

/* ------------------------------------------------------------------ the cost */

/*
 * The one number this feature must never print is $0.00. It is only drawn where
 * the person has turned the cost line on, so that is turned on here and put back
 * afterwards.
 */
const costWas = (await graphql(`mutation { setChatCostShown(shown: true) { chatCostShown } }`))
  .setChatCostShown.chatCostShown;
record(costWas === true, 'the cost line can be turned on, which is what draws the number at all');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });
await page.locator('#chat-picture').click();
await page.locator('#chat-composer').fill('A blue square');
await page.locator('button[type="submit"]').first().click();
await page.locator('img[src^="/api/attachments/"]').nth(1).waitFor({ state: 'visible', timeout: 60_000 });
await page.waitForTimeout(500);

const thought = await page.locator('[class*="thought"]').first().innerText().catch(() => '');
record(
  thought.includes(`$${PRICE.toFixed(2)}`) || thought.includes('0.04'),
  `the line beside it says what the picture cost, at the price recorded (it says "${thought.trim()}")`,
);
record(
  !/\$0\.00\b/.test(thought),
  `and never $0.00, which is what a per-token price would have made of it ("${thought.trim()}")`,
);

await page.screenshot({ path: shot('image-model-check.png'), fullPage: false });

/* --------------------------------------------- a picture that has gone */

/*
 * What the chat shows for a picture whose bytes are no longer there.
 *
 * An attachment can be deleted, and an installation whose attachment directory
 * has been moved out from under it loses every one of them at once. The row
 * survives, the link 404s, and left alone the browser draws its broken-image
 * icon - which says this page is broken rather than that the file is gone.
 *
 * The 404 is made here rather than by deleting a file, because the file is on
 * the machine running the server and this is in a browser: what is being
 * asserted is what the page does with the answer, and the answer is the same
 * one either way. The server's half - a 404 rather than a 500 thrown while the
 * body was already being written - is `AttachmentAPI` asking the store whether
 * the bytes are there.
 */
await page.route('**/api/attachments/**', (route) => route.fulfill({ status: 404, body: '{}' }));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#chat-composer').waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(1500);

const gone = await page.locator('body').innerText();
record(
  /This picture is gone|Tego obrazu/.test(gone),
  'a picture whose bytes have gone reads as one line saying so',
);
/*
 * In the answer, which is where the picture is the point. The file row above
 * the composer still draws a thumbnail for it, and that is not this feature's
 * to change: every file ever attached to the chat is listed there, and how a
 * row of thumbnails should read when a file has gone is the same question for
 * an uploaded screenshot as for a drawn picture.
 */
record(
  (await page.locator('[class*="markdown"] img[src^="/api/attachments/"]').count()) === 0,
  'and the broken picture is not left standing in the answer',
);
await page.unroute('**/api/attachments/**');

/* ------------------------------------------------------------------ tidying */

/*
 * Back off again. It is a person's own preference and this check is signed in as
 * a person; leaving it on would be this check deciding what somebody's chat
 * looks like from now on.
 */
await graphql(`mutation { setChatCostShown(shown: false) { chatCostShown } }`).catch(() => undefined);
await sweep();

await finish(browser);
