/**
 * The attribution is on screen, and says which version this is.
 *
 * `Attribution.tsx` explains at length why it exists: AGPL section 5(d) obliges
 * an interactive interface to display the notice, the section 7(b) term in
 * NOTICE carries it forward, and section 13 requires the offer of source from
 * anyone running a modified version for other people over a network. A term
 * about visible attribution means nothing if the attribution is not visible.
 *
 * Nothing checked that it was. The component was well argued and unwatched -
 * one `display: none` from a stylesheet it does not own, one shell that forgets
 * to draw it, and the obligation quietly stops being met with nothing failing.
 * That is exactly the shape this suite exists to catch, and this is the one
 * case where what breaks is not a bug but a licence term.
 *
 * The version was added because it is the first thing anybody is asked for in a
 * bug report and the footer did not say it. It is asserted against
 * `package.json` rather than against a number written here, so the two cannot
 * drift - and asserted to be *present*, so it cannot quietly become undefined
 * if the build stops defining it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, WORKSPACE, open, record, finish } from './suite/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const declared = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')).version;

record(/^\d+\.\d+\.\d+/.test(declared), `package.json declares a version (${declared})`);

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

const PAGES = [
  ['chat', '/chat'],
  ['workflows', `/workspace/${WORKSPACE}/workflows`],
  ['admin', '/admin'],
];

for (const [name, path] of PAGES) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);

  const notice = page.locator('p', { hasText: 'AGPL-3.0' }).last();
  const drawn = (await notice.count()) > 0;
  record(drawn, `${name}: the notice is drawn`);
  if (!drawn) continue;

  /*
   * Read off `innerText`, so a notice present in the markup and painted out of
   * sight fails exactly like one nobody rendered.
   */
  const says = (await notice.innerText()).replace(/\s+/g, ' ').trim();
  const box = await notice.boundingBox();

  record(box !== null && box.width > 0 && box.height > 0, `${name}: it takes up space on the page`);
  record(says.includes('Orknux'), `${name}: it names the product`);
  record(says.includes(declared), `${name}: it says which version (${declared}) - "${says}"`);
  record(/©\s*\d{4}/.test(says), `${name}: it carries a copyright line`);
  record(says.includes('AGPL-3.0'), `${name}: it names the licence`);
  record(says.includes('Source'), `${name}: it offers the source, which section 13 asks for`);

  const source = notice.locator('a', { hasText: 'Source' });
  const href = await source.getAttribute('href');
  record(
    (href ?? '').startsWith('https://'),
    `${name}: the source offer is a reachable address ("${href}")`,
  );
}

await finish(browser);
