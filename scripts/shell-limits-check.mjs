/**
 * A machine's own command timeout and output allowance, set from the screen.
 *
 * Both numbers used to live only in this installation's configuration, which
 * meant an administrator who wanted a build machine to be allowed more than a
 * minute had to redeploy the server to say so - and the shipped minute was one
 * an agent could not have caused and could not fix. They are fields on the
 * shell's own page now, and this drives them.
 *
 * What is measured, in the order it matters:
 *
 *   the placeholder    a shell with no limit of its own is not running without
 *                      one, it is running on the installation's, and the box
 *                      has to say which number that is. An empty box beside no
 *                      number at all would read as "no limit applies", which is
 *                      never true. This is the assertion most easily lost to a
 *                      refactor, because the field still works without it.
 *
 *   the round trip     typed, saved, and read back off a freshly opened page -
 *                      not off the form that was just filled in, which would
 *                      pass on a page that saved nothing.
 *
 *   the unit           the box is kibibytes and the wire is bytes. The value is
 *                      read back over GraphQL as well, because a page that
 *                      shows 1024 and stores 1024 is the bug this conversion
 *                      exists to avoid, and it is invisible on screen.
 *
 *   emptying it        the point of the whole arrangement: an empty box means
 *                      "whatever the installation says" and stores null, so
 *                      that changing the installation's number afterwards still
 *                      moves every machine that never asked for anything else.
 *                      A form that cleared to zero, or that kept the old value
 *                      because absent read as "unchanged", would fail here.
 *
 * Makes one shell of its own and removes it, and sweeps what a killed run left.
 * It points at 127.0.0.1 with no key: nothing ever connects to it, and the page
 * this check is about is reachable long before anything does.
 */
import { BASE, open, drawn, record, finish } from './suite/harness.mjs';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/* ----------------------------------------------------------------- fixture */

const MARK = 'shellLimitsCheck';

const KIB = 1024;

const FIELDS = 'id name commandTimeoutSeconds maxOutputBytes defaultCommandTimeoutSeconds defaultMaxOutputBytes';

const held = async () => {
  const found = await graphql(`query { shells { id name } }`);
  return found.shells.filter((one) => one.name.startsWith(MARK));
};

const sweep = async () => {
  for (const old of await held()) {
    await graphql(`mutation($id: ID!) { deleteShell(id: $id) }`, { id: old.id }).catch(() => undefined);
    console.log(`swept ${old.name}`);
  }
};

await sweep();

const name = `${MARK} ${Date.now()}`;
const made = await graphql(`mutation($input: ShellInput!) { createShell(input: $input) { ${FIELDS} } }`, {
  input: { name, host: '127.0.0.1', port: 22 },
});
const shell = made.createShell;
console.log(`made ${shell.name}`);

/* -------------------------------------------------------------- the rulers */

const timeout = page.locator('#shell-timeout');
const output = page.locator('#shell-output');

/** Open the machine's page, fresh, with everything on it taken from the server. */
async function openShell() {
  await page.goto(`${BASE}/admin/shell/${shell.id}`, { waitUntil: 'domcontentloaded' });
  if (!(await drawn(page, 'the shell settings page'))) return false;
  await timeout.waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
  return true;
}

/** Press Save and wait for the page to have left, which is how it says it took. */
async function save() {
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.waitForURL('**/admin/shell', { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

/** What the server holds for this machine, which is the half no screen shows. */
const stored = async () => {
  const found = await graphql(`query($id: ID!) { shell(id: $id) { ${FIELDS} } }`, { id: shell.id });
  return found.shell;
};

/* ------------------------------------- a machine with no limits of its own */

if (await openShell()) {
  record((await timeout.inputValue()) === '', 'a machine with no timeout of its own shows an empty box');
  record((await output.inputValue()) === '', 'and an empty output box');

  // The number it is actually running on, in the box that is empty. This is
  // what makes the empty box a choice rather than an absence.
  record(
    (await timeout.getAttribute('placeholder')) === String(shell.defaultCommandTimeoutSeconds),
    `the timeout box offers the installation's own ${shell.defaultCommandTimeoutSeconds} seconds`,
  );
  record(
    (await output.getAttribute('placeholder')) === String(Math.round(shell.defaultMaxOutputBytes / KIB)),
    `the output box offers the installation's own ${Math.round(shell.defaultMaxOutputBytes / KIB)} KiB`,
  );
}

/* --------------------------------------------- limits typed in and saved */

if (await openShell()) {
  await timeout.fill('1800');
  await output.fill('1024');
  await save();
}

if (await openShell()) {
  record((await timeout.inputValue()) === '1800', 'a timeout typed in comes back off a freshly opened page');
  record((await output.inputValue()) === '1024', 'and so does the output allowance');
}

const set = await stored();
record(set.commandTimeoutSeconds === 1800, `the server holds 1800 seconds (it holds ${set.commandTimeoutSeconds})`);
// The conversion, which is the half that cannot be seen on the page: 1024 in
// the box is 1048576 on the wire, and a form that stored the kibibytes would
// have cut this machine's output allowance to a kilobyte.
record(set.maxOutputBytes === 1024 * KIB, `1024 KiB in the box is ${set.maxOutputBytes} bytes on the wire`);

/* ------------------------------------- emptied again, back to the default */

if (await openShell()) {
  await timeout.fill('');
  await output.fill('');
  await save();
}

const cleared = await stored();
record(cleared.commandTimeoutSeconds === null, 'an emptied box stores nothing rather than zero');
record(cleared.maxOutputBytes === null, 'and so does the output box');

if (await openShell()) {
  record((await timeout.inputValue()) === '', 'and the page shows it empty again');
  record(
    (await timeout.getAttribute('placeholder')) === String(shell.defaultCommandTimeoutSeconds),
    'with the installation’s number offered underneath it once more',
  );
}

/* ------------------------------------------------------------------- tidy up */

await sweep();

await finish(browser);
