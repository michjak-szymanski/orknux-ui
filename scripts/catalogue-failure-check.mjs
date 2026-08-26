/**
 * A catalogue that could not be fetched saying so, instead of saying it is empty.
 *
 * Issue 139. Pickers all over the app were filled the same way -
 * `fetch(...).then(setX).catch(() => setX([]))` - so a fetch that failed
 * arrived as a list with nothing in it, and the panel printed its empty state:
 * *No tools in this workspace yet*, *No roles are defined yet. Add one on the
 * Roles screen*. That is an invitation to go and make what the installation
 * already has, said to somebody whose session has just expired.
 *
 * Both directions matter, so both are measured, on three screens that answer an
 * empty list with a sentence of their own:
 *
 *   - a workspace's own Settings, whose speech fields say no transcription or
 *     speech model has been added yet;
 *   - a workspace's Settings under Admin, which sends somebody to the Roles
 *     screen when there are no roles;
 *   - an agent's Settings, which draws three catalogues at once - the memory
 *     catalogs, skill catalogs and tools it may be granted.
 *
 * Each catalogue is asked for twice. Answered with an empty list, the page must
 * say the thing has none, in the words it always used. Answered with an error,
 * it must say it could not list them, say what to do about it, and must NOT say
 * there are none. The second half is what fails against the old code; the first
 * half is why it cannot be passed by deleting the empty state.
 *
 * The failure is forced at the network rather than by stopping the server, so
 * the status is chosen and the wording that turns on it can be read: 500 says
 * try again, 401 says sign in again. Only the catalogue queries of the screen
 * being read are touched, so the screen itself still loads - a page that did
 * not render is a page this cannot measure.
 */
import { BASE, WORKSPACE, open, record, finish, shot } from './suite/harness.mjs';

const { browser, page, graphql } = await open();

/*
 * Whichever agent the workspace has. An id written in here would tie the check
 * to one database; what it needs is any agent at all, and the seed makes two.
 */
const found = await graphql(
  `query ($workspaceId: ID!) {
     workspaceAgents(workspaceId: $workspaceId, page: 0, size: 1) { content { id name } }
   }`,
  { workspaceId: WORKSPACE },
);
const agent = found.workspaceAgents.content[0];
if (agent === undefined) {
  console.log(`FAIL: workspace ${WORKSPACE} has no agent whose settings to read`);
  await finish(browser, false);
}

/**
 * The screens, and for each the catalogues it fills itself from: the query that
 * fetches one, what an answer holding nothing looks like, the words the failure
 * sentence names it by, and what the screen says when it really has none.
 */
const SCREENS = [
  {
    name: 'the workspace settings',
    path: `/workspace/${WORKSPACE}/settings`,
    ready: 'Speech-to-text Model',
    catalogues: [
      {
        query: 'query Models(',
        nothing: { data: { models: [] } },
        what: 'models in this workspace',
        // One catalogue, three fields, so three lines say so and three say it
        // failed: what hears, what speaks, and what draws.
        notes: 3,
        empty: [
          'No transcription model has been added yet.',
          'No speech model has been added yet.',
          'No image model has been added yet.',
        ],
      },
    ],
  },
  {
    name: "the admin's workspace settings",
    path: `/admin/workspaces/${WORKSPACE}/settings`,
    ready: '+ Add Role',
    catalogues: [
      {
        query: 'query Roles',
        nothing: { data: { roles: [] } },
        what: 'roles',
        notes: 1,
        empty: ['No roles are defined yet. Add one on the'],
      },
    ],
  },
  {
    name: "the agent's settings",
    path: `/workspace/${WORKSPACE}/agents/${agent.id}/settings`,
    ready: 'Memory Catalogs',
    catalogues: [
      {
        query: 'memoryCatalogs(',
        nothing: { data: { memoryCatalogs: [] } },
        what: 'memory catalogs',
        notes: 1,
        empty: ['No catalogs in this workspace yet.'],
      },
      {
        query: 'skillCatalogs(',
        nothing: { data: { skillCatalogs: [] } },
        what: 'skill catalogs',
        notes: 1,
        empty: ['No skill catalogs in this workspace yet.'],
      },
      {
        query: 'workspaceTools(',
        nothing: { data: { workspaceTools: { content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 } } },
        what: 'tools',
        notes: 1,
        empty: ['No tools in this workspace yet.'],
      },
    ],
  },
];

/**
 * How the catalogue queries are answered next time they are asked.
 *
 * 'empty'  - a real answer holding nothing, which is a thing with none.
 * a number - that HTTP status, which is a fetch that failed.
 * 'real'   - out of the way; the server answers.
 */
let answering = 'empty';
/** Whose queries are worth interfering with; the rest of the app is left alone. */
let reading = SCREENS[0];

await page.route('**/graphql', async (route) => {
  const body = route.request().postData() ?? '';
  const catalogue = reading.catalogues.find((one) => body.includes(one.query));

  if (catalogue === undefined || answering === 'real') return route.continue();

  if (answering === 'empty') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogue.nothing),
    });
  }

  return route.fulfill({
    status: answering,
    contentType: 'application/json',
    body: JSON.stringify({ errors: [{ message: `forced ${answering}` }] }),
  });
});

/** Everything a screen has to say, once it has stopped changing its mind. */
async function words(screen) {
  await page.goto(`${BASE}${screen.path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`text=${screen.ready}`, { timeout: 20_000 });
  await page.waitForTimeout(800);
  return page.locator('body').innerText();
}

/** Every empty sentence a screen has, across all of its catalogues. */
const emptiness = (screen) => screen.catalogues.flatMap((one) => one.empty);
/** How many *Try again* lines a screen shows when all of it has failed. */
const retries = (screen) => screen.catalogues.reduce((total, one) => total + one.notes, 0);

for (const screen of SCREENS) {
  reading = screen;

  // ------------------------------------------- nothing to list, and it said so

  answering = 'empty';
  let seen = await words(screen);

  for (const sentence of emptiness(screen)) {
    record(seen.includes(sentence), `${screen.name}: an empty catalogue still says "${sentence}"`);
  }
  record(
    !seen.includes('could not be listed') && !seen.includes('The server failed while listing'),
    `${screen.name}: an empty catalogue does not claim anything failed`,
  );
  record(
    (await page.locator('button:has-text("Try again")').count()) === 0,
    `${screen.name}: an empty catalogue offers nothing to retry`,
  );

  // -------------------------------------------------- a server that answered 500

  answering = 500;
  seen = await words(screen);

  for (const catalogue of screen.catalogues) {
    record(
      seen.includes(`The server failed while listing the ${catalogue.what} (HTTP 500). Its log will say why.`),
      `${screen.name}: a failed fetch names what did not arrive - the ${catalogue.what} - and where to look`,
    );
  }

  /*
   * The issue itself, in one assertion. Under the old code these sentences were
   * all on screen, because a failure and an empty list had become the same
   * thing.
   */
  for (const sentence of emptiness(screen)) {
    record(!seen.includes(sentence), `${screen.name}: a failed catalogue does not say "${sentence}"`);
  }
  record(
    (await page.locator('button:has-text("Try again")').count()) === retries(screen),
    `${screen.name}: every failed line offers a way to ask again`,
  );
  await page.screenshot({ path: shot(`catalogue-failed-${screen.catalogues[0].what.split(' ')[0]}.png`) });

  // ------------------------------------------------- a session that had ended

  answering = 401;
  seen = await words(screen);

  for (const catalogue of screen.catalogues) {
    record(
      seen.includes(
        `Your session has ended, so the ${catalogue.what} could not be listed. Sign in again to see them.`,
      ),
      `${screen.name}: an expired session is told to sign in again about the ${catalogue.what}`,
    );
  }
  record(
    !seen.includes('The server failed while listing') && !seen.includes('(HTTP'),
    `${screen.name}: an expired session is not told the server failed instead`,
  );
  for (const sentence of emptiness(screen)) {
    record(!seen.includes(sentence), `${screen.name}: an expired session does not say "${sentence}"`);
  }

  // ---------------------------------------------------- and asking again works

  answering = 'real';
  await page.locator('button:has-text("Try again")').first().click();
  await page.waitForTimeout(1500);
  seen = await page.locator('body').innerText();

  record(
    (await page.locator('button:has-text("Try again")').count()) === retries(screen) - screen.catalogues[0].notes,
    `${screen.name}: Try again asks for that catalogue only, and leaves the others as they were`,
  );
  record(
    !seen.includes(`the ${screen.catalogues[0].what} could not be listed`),
    `${screen.name}: Try again clears the failure it was under`,
  );
}

await finish(browser);
