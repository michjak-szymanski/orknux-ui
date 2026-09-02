/**
 * The certificate authorities this installation trusts: the list, the page, and
 * what it says when the paste is wrong.
 *
 * Issue #322. The first version of this screen was a panel with two unpadded
 * boxes and a button reading "Trust it", which is not what any other list in
 * this product looks like, and a bad paste came back as an internal error.
 *
 * Six things this is here to catch:
 *
 *   the list      Networking lists the authorities in the same table shape the
 *                 proxy rules above it use, with the add button top right
 *   the page      a row opens a page of its own rather than an inline form
 *   the padding   the fields have the padding every other field on this product
 *                 has. Measured, because "looks unfinished" is not a thing a
 *                 check can be told
 *   the refusal   a paste that is not PEM is refused in words that say what to
 *                 do, not "No certificate data found" and not an internal error
 *   the round     added, renamed, and still there under the new name
 *   the removal   and gone when it is removed
 *
 * The certificate is made for the run rather than checked in, for the reason the
 * server-side test gives: a checked-in one expires and the check then fails for
 * a reason that has nothing to do with the code.
 */
import { BASE, open, record, drawn, finish } from './suite/harness.mjs';
import { selfSignedPem } from './suite/selfsigned.mjs';

const MARK = 'zzTrustedCa';
const NAME = `${MARK} ${Date.now()}`;
const RENAMED = `${NAME} renamed`;

/* ----------------------------------------------------------------- fixture */

/**
 * A certificate authority nothing has heard of, made for this run.
 *
 * In JavaScript because the container these checks run in has neither keytool
 * nor openssl - see `suite/selfsigned.mjs`.
 */
const PEM = selfSignedPem('zz-suite-internal-ca');

const { browser, page, graphql } = await open({ viewport: { width: 1600, height: 1000 } });

const sweep = async () => {
  const { trustedCertificates } = await graphql(`query { trustedCertificates { id name } }`);
  for (const old of trustedCertificates.filter((one) => one.name.startsWith(MARK))) {
    await graphql(`mutation($id: ID!) { untrustCertificate(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept ${old.name} (#${old.id})`);
  }
};

await sweep();

const clean = async () => {
  await sweep();
  await finish(browser);
};

/* -------------------------------------------------------------------- drive */

const LIST = `${BASE}/admin/networking`;
await page.goto(LIST, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the networking page'))) await clean();

const offered = await page
  .waitForSelector('text=Add Certificate Authority', { timeout: 25_000 })
  .then(() => true)
  .catch(() => false);
record(offered, 'Networking offers a way to add a certificate authority');
if (!offered) await clean();

/* ---- the page, reached by the button ---- */

await page.click('text=Add Certificate Authority');
await page.waitForURL('**/admin/networking/certificates/new', { timeout: 20_000 }).catch(() => undefined);
record(
  page.url().endsWith('/certificates/new'),
  `the button opens a page of its own rather than a form on the list (${page.url().replace(BASE, '')})`,
);

const drewForm = await page
  .waitForSelector('#certificate-name', { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
record(drewForm, 'and that page asks for a name and a certificate');
if (!drewForm) await clean();

/* ---- the padding, measured ---- */

const padding = await page.$$eval('#certificate-name, #certificate-pem', (found) =>
  found.map((one) => ({
    id: one.id,
    left: parseFloat(getComputedStyle(one).paddingLeft),
    top: parseFloat(getComputedStyle(one).paddingTop),
  })),
);
record(
  padding.length === 2 && padding.every((one) => one.left >= 8 && one.top >= 6),
  `the fields are padded rather than having their text against the border (${JSON.stringify(padding)})`,
);

/* ---- the refusal, which used to be an internal error ---- */

await page.fill('#certificate-name', NAME);
await page.fill('#certificate-pem', 'this is not a certificate');
await page.click('button[type="submit"]');

const refused = await page
  .waitForSelector('text=/does not look like PEM/i', { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
const said = await page.evaluate(() => document.body.innerText);
record(
  refused,
  `a paste that is not PEM is refused in words that say what to do ` +
    `(${JSON.stringify((said.match(/That does not look like PEM[^\n]*/) ?? ['nothing about PEM'])[0].slice(0, 90))})`,
);
record(
  !/internal error|INTERNAL_ERROR|Exception/i.test(said),
  'and not as an internal error, which is what it used to be',
);

/* ---- adding it for real ---- */

await page.fill('#certificate-pem', PEM);
await page.click('button[type="submit"]');

const added = await page
  .waitForURL(/\/admin\/networking\/certificates\/\d+$/, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
record(added, `adding it lands on the row that now exists (${page.url().replace(BASE, '')})`);

/* ---- renaming it, which is the other half of the page ---- */

if (added) {
  await page.fill('#certificate-name', RENAMED);
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Saved.', { timeout: 20_000 }).catch(() => undefined);

  const { trustedCertificates } = await graphql(`query { trustedCertificates { name subject } }`);
  const held = trustedCertificates.find((one) => one.name === RENAMED);
  record(held !== undefined, `the same page renames it (${JSON.stringify(held?.name ?? null)})`);
  record(
    held?.subject.includes('zz-suite-internal-ca') === true,
    `and it kept the certificate that was pasted (${JSON.stringify(held?.subject ?? null)})`,
  );

  /* ---- and it is on the list ---- */

  await page.goto(LIST, { waitUntil: 'domcontentloaded' });
  const listed = await page
    .waitForSelector(`text=${RENAMED}`, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  record(listed, 'the list shows it under the name it was given');

  /* ---- and removing it takes it off ---- */

  await page.click(`text=${RENAMED}`);
  await page.waitForSelector('text=Danger Zone', { timeout: 20_000 }).catch(() => undefined);
  await page.click('text=Remove');
  await page.waitForURL('**/admin/networking', { timeout: 20_000 }).catch(() => undefined);

  const after = await graphql(`query { trustedCertificates { name } }`);
  record(
    !after.trustedCertificates.some((one) => one.name === RENAMED),
    'and removing it takes it off the list',
  );
}

await clean();
