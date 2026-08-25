/**
 * The language picker, and what actually changes when it is pressed.
 *
 * ---------------------------------------------------------------------------
 * What this is checking, and why it is not a snapshot of Polish
 *
 * Asserting that Preferences says "Preferencje użytkownika" would be a test of
 * one entry in the catalogue - the sort of test that has to be edited every
 * time a word is improved, and that says nothing about whether the rest of the
 * product followed. So it asserts the mechanism instead, in four parts, each of
 * which was a way this could be broken:
 *
 *   1. The choice reaches the server. The picker applies it locally first so
 *      the screen changes at the press, and the round trip is what makes it
 *      survive to another machine. A picker that only wrote to the browser
 *      would pass every visual check and lose the setting on the next laptop.
 *
 *   2. The screen comes back in Polish. Choosing reloads the page, because `t`
 *      is usable in a module-level constant and about thirty lists in this
 *      application are exactly that - re-evaluating every module is the only
 *      thing that gets all of them. So this waits for the reload and reads the
 *      heading it lands on, and it reads the top bar's section names as well:
 *      those come out of `navigation.ts`, which is one of the lists a
 *      re-render alone would have left in English.
 *
 *   3. `<html lang>` follows. It is what a screen reader and the browser's own
 *      hyphenation read, and it is the one thing about a translated page that
 *      no amount of visible Polish makes true by itself.
 *
 *   4. A page nobody touched is Polish too, on a fresh visit and after a
 *      reload. That is the difference between a language switch and a page
 *      that happened to re-render: the sidebar's own words, on a different
 *      route, after the browser has thrown its memory away.
 *
 *   5. The layout survives it. Polish is longer than English almost
 *      everywhere, and a screen that fitted is not thereby a screen that fits.
 *
 * And then it puts English back, because every other check in this suite finds
 * its controls by their English accessible names and this one shares alice.
 *
 * ---------------------------------------------------------------------------
 * How the rest of the suite survives a translated product
 *
 * English is the default for anybody who has not chosen, and the fixture never
 * chooses. So the other checks see exactly what they saw before. This one is
 * the only check that ever sets the column, and it sets it back in a `finally`
 * - a run that dies half way through must not leave alice reading Polish, or
 * every check after it fails looking for a button called Save.
 */
import { BASE, open, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open();

/** What the server has recorded for whoever is signed in. */
async function recorded() {
  const held = await page.evaluate(async () => {
    const answer = await fetch('/api/session', { credentials: 'include' });
    return answer.ok ? await answer.json() : null;
  });
  return held?.language ?? null;
}

/** The words in the left-hand navigation, whatever they are. */
async function sidebar() {
  return page.evaluate(() =>
    [...document.querySelectorAll('nav a')].map((one) => one.innerText.trim()).filter(Boolean),
  );
}

try {
  await page.goto(`${BASE}/preferences`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  await page.waitForTimeout(400);

  const englishHeading = await page.locator('h1').first().innerText();
  const englishNav = await sidebar();
  record(
    englishHeading.trim() === 'User Preferences',
    `somebody who has chosen nothing reads English: the heading is ${JSON.stringify(englishHeading.trim())}`,
  );
  record(
    (await page.getAttribute('html', 'lang')) === 'en',
    'and <html lang> says so',
  );

  const picker = page.locator('[aria-labelledby="interface-language"] [role="radio"]');
  record((await picker.count()) === 2, `the picker offers ${await picker.count()} languages`);

  const polish = picker.filter({ hasText: 'Polski' });
  record(
    (await polish.count()) === 1,
    'and names each of them in itself: Polski, not Polish',
  );

  /* The mutation goes first and the reload follows it, so wait for the page. */
  await Promise.all([page.waitForLoadState('load'), polish.click()]);
  await page.waitForSelector('h1');
  await page.waitForTimeout(500);

  // 1 - it reached the server, not only the browser.
  const stored = await recorded();
  record(stored === 'pl', `the choice is recorded on the person: the session says ${JSON.stringify(stored)}`);

  // 2 - the page came back in Polish, chrome and all.
  const polishHeading = (await page.locator('h1').first().innerText()).trim();
  record(
    polishHeading !== englishHeading.trim() && /[ąćęłńóśźż]/i.test(polishHeading),
    `the screen came back in Polish: the heading is now ${JSON.stringify(polishHeading)}`,
  );
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label] a, nav a')]
      .map((one) => one.innerText.trim())
      .filter(Boolean),
  );
  record(
    sections.some((one) => /[ąćęłńóśźż]/i.test(one)),
    `the top bar's own sections followed, which a re-render alone would not have done: ${sections.slice(0, 6).join(', ')}`,
  );
  record(
    (await page
      .locator('[aria-labelledby="interface-language"] [role="radio"]')
      .filter({ hasText: 'Polski' })
      .getAttribute('aria-checked')) === 'true',
    'and the picker shows which one is in force',
  );

  // 3 - and the document says what language it is in.
  record((await page.getAttribute('html', 'lang')) === 'pl', '<html lang> follows the choice');

  // 4 - a page nobody touched, on a fresh load.
  await page.goto(`${BASE}/docs`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  await page.waitForTimeout(400);
  const polishNav = await sidebar();
  record(
    polishNav.length > 0 && polishNav.join('|') !== englishNav.join('|'),
    `a page nobody touched is Polish after a reload: ${polishNav.length} navigation items, and not the English ones`,
  );

  /*
   * The manual is not translated, so its pages say so rather than quietly
   * appearing in English. This is the whole of what "coherent" means here: the
   * reader is never left to wonder whether an English page is a bug.
   */
  const said = await page.evaluate(() => document.body.innerText);
  record(
    said.includes('Ta strona nie jest jeszcze przetłumaczona'),
    'and an untranslated manual page says it is untranslated, in Polish',
  );

  /*
   * 5 - and the layout survives it.
   *
   * Polish is longer than English almost everywhere - "Ustawienia przestrzeni
   * roboczej" against "Workspace Settings" - so a screen that fitted in English
   * is not thereby a screen that fits. Two things are measured, on every fixed
   * page in the product rather than on a chosen few:
   *
   *   the page does not scroll sideways, which is what a label too wide for its
   *   column does to a table;
   *
   *   and no control has been given more text than it can draw. A button whose
   *   content is wider than the button is a button whose label is cut off, and
   *   it is the failure a longer language produces that nothing else notices -
   *   the page looks fine, and one word in the middle of it says "Ustawi…".
   */
  const ROUTES = ['/preferences', '/admin', '/admin/users', '/admin/roles', '/admin/settings'];
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1');
    await page.waitForTimeout(500);

    const measured = await page.evaluate(() => {
      const clipped = [];
      for (const element of document.querySelectorAll('button, a, label, th, h1, h2')) {
        const box = element;
        // one line of text and nothing else: a wrapped paragraph is meant to be
        // taller, and only a single line can be cut off sideways.
        const style = window.getComputedStyle(box);
        if (style.whiteSpace !== 'nowrap' && style.textOverflow !== 'ellipsis') continue;
        if (box.scrollWidth > box.clientWidth + 1 && box.clientWidth > 0) {
          clipped.push(`${box.tagName.toLowerCase()} "${box.innerText.trim().slice(0, 40)}"`);
        }
      }
      return {
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clipped,
      };
    });

    record(measured.sideways <= 0, `${route} does not scroll sideways in Polish (${measured.sideways}px over)`);
    record(
      measured.clipped.length === 0,
      measured.clipped.length === 0
        ? `${route} draws every one-line control in full`
        : `${route} cuts off ${measured.clipped.length}: ${measured.clipped.slice(0, 4).join('; ')}`,
    );
  }
} finally {
  /*
   * Back to English before anything else runs. Through GraphQL rather than the
   * picker: this has to happen even when an assertion above threw, and a
   * mutation cannot be stopped by a screen that failed to draw.
   */
  await graphql('mutation { setMyLanguage(language: null) { id language } }').catch(() => {});
}

await finish(browser);
