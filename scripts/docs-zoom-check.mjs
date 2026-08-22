/**
 * A picture in the manual opens larger when it is clicked.
 *
 * Issue #217. The manual is forty-six screenshots of this application, drawn
 * into a column some seven hundred pixels wide - so a picture of a screen 1440
 * across arrives at about half size, and the field names it was taken to show
 * are unreadable. There was nothing to do about it but open the file in a tab
 * by hand, which loses the page the picture was explaining.
 *
 * What is measured is the size, because that is the whole request. The picture
 * on the page is measured, clicked, and the picture in the viewer is measured:
 * a viewer that opens and draws the same 700px picture has not zoomed anything.
 * The alt text is asserted to travel with it, since that sentence is the
 * caption saying what is being looked at, and Escape is asserted to close it -
 * a `<dialog>` gives that for free, and a div over the page does not.
 */
import { BASE, open, record, finish } from './suite/harness.mjs';

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

await page.goto(`${BASE}/docs/workflows`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('article img, main img[src*="/screens/"]', { timeout: 20_000 });

/** The first screenshot in the prose, which is the editor. */
const inline = page.locator('img[src*="/screens/"]').first();
await inline.scrollIntoViewIfNeeded();

/*
 * Waited on until the bytes are there, not until the element is. An `<img>`
 * that has not decoded yet has no intrinsic size and therefore no width, so
 * every measurement below would be taken against a zero-wide picture and would
 * read exactly like the layout being broken.
 */
await page
  .waitForFunction(
    () => {
      const image = document.querySelector('img[src*="/screens/"]');
      return image !== null && image.complete && image.naturalWidth > 0;
    },
    { timeout: 20_000 },
  )
  .catch(() => record(false, 'the first screenshot loaded'));

const onPage = await inline.boundingBox();
record(onPage !== null && onPage.width > 0, `the manual draws a screenshot (${Math.round(onPage?.width ?? 0)}px wide)`);

const alt = (await inline.getAttribute('alt')) ?? '';
record(alt.trim() !== '', 'the screenshot says what it is');

/*
 * It has to look like something that can be pressed before anybody presses it.
 * A picture that opens on click and gives no sign of it is a feature nobody
 * finds.
 */
const pointer = await inline.evaluate((image) => {
  const clickable = image.closest('button, [role="button"]') ?? image;
  return getComputedStyle(clickable).cursor;
});
record(pointer === 'pointer' || pointer === 'zoom-in', `the picture says it can be opened (cursor: ${pointer})`);

await inline.click();
await page.waitForTimeout(500);

const openDialog = await page.evaluate(() => document.querySelector('dialog[open]') !== null);
record(openDialog, 'clicking it opens a viewer over the page');

const zoomed = page.locator('dialog[open] img').first();
const shown = (await zoomed.count()) > 0 ? await zoomed.boundingBox() : null;
record(shown !== null, 'the viewer holds the picture');

record(
  shown !== null && onPage !== null && shown.width > onPage.width * 1.3,
  `the picture is bigger than it was on the page (${Math.round(onPage?.width ?? 0)}px → ${Math.round(shown?.width ?? 0)}px)`,
);

const sameFile = (await zoomed.count()) > 0 ? ((await zoomed.getAttribute('src')) ?? '') : '';
const wanted = (await inline.getAttribute('src')) ?? 'x';
record(sameFile === wanted, 'it is the picture that was clicked');

const caption = openDialog
  ? (await page.locator('dialog[open]').first().innerText()).replace(/\s+/g, ' ')
  : '';
record(caption.includes(alt.split(':')[0].slice(0, 20)), 'the viewer says which picture this is');

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
record(
  await page.evaluate(() => document.querySelector('dialog[open]') === null),
  'Escape puts it away again',
);

/*
 * And the light theme, which is where the same forty-six pictures were being
 * put through `brightness(0.42)` - the rule that keeps the stroked icon files
 * readable on white, matched against `img` itself. A manual illustrated with
 * screenshots taken at dusk is what the zoom would otherwise have opened
 * larger, so it is measured here rather than left to somebody's eye.
 */
await page.evaluate(() => window.localStorage.setItem('orknux.theme', 'light'));
await page.goto(`${BASE}/docs/workflows`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('img[src*="/screens/"]', { timeout: 20_000 });

const inLight = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  filter: getComputedStyle(document.querySelector('img[src*="/screens/"]')).filter,
}));
record(inLight.theme === 'light', 'the light theme is the one being read');
record(inLight.filter === 'none', `a screenshot keeps its own colours on white (filter: ${inLight.filter})`);
await page.evaluate(() => window.localStorage.setItem('orknux.theme', 'dark'));

await finish(browser);
