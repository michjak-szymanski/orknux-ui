/**
 * Four status lines that were trimmed, and the sentences that had to go
 * somewhere.
 *
 * The rules file's test for a status: *if the sentence would still be true and
 * worth saying when the thing is full, it is not status.* Four lines failed it
 * - a bell, an issue's attachments, and the two trigger logs - each keeping one
 * sentence of state and one of teaching. And the corollary is the mistake the
 * trim invites: **do not delete the elaboration, move it.** A sentence said only
 * in a status line and then cut is a thing the product no longer says anywhere.
 *
 * So this is written the way that corollary asks for. For each of the four it
 * asserts both halves: the state is still printed in the open, and the sentence
 * that left the open is inside a `FieldHint` in the same file. Deleting the
 * second half rather than moving it fails here, and that is the whole reason
 * this check exists - `hint-prose-check` would be perfectly happy with a
 * deletion, since what it looks for is prose that is still in the open.
 *
 * The source half covers all four. The browser half covers the one of them that
 * can be reached without building or destroying anything: a new issue has no
 * attachments by definition. The bell's empty panel needs an account with no
 * notifications and the two trigger logs need a workspace nothing has ever
 * fired in, and manufacturing either against a real database means changing
 * somebody's data. That is said out loud here rather than left as three
 * assertions this file appears to make and does not.
 */
import { readFileSync } from 'node:fs';

import { BASE, WORKSPACE, open, record, drawn, finish } from './suite/harness.mjs';

/** What each of the four keeps in the open, and what it moved behind the (?). */
const SPLIT = [
  {
    file: 'src/components/NotificationBell.tsx',
    state: 'Nothing yet.',
    moved: 'Anything on your issues will appear here',
  },
  {
    file: 'src/pages/workspace/WorkspaceIssuePage.tsx',
    state: 'Nothing attached yet.',
    moved: 'A screenshot is worth a paragraph of description',
  },
  {
    file: 'src/pages/workspace/WorkspaceTriggersPage.tsx',
    state: 'Nothing yet.',
    moved: 'no matching event has arrived',
  },
  {
    file: 'src/pages/workspace/WorkspaceTriggersPage.tsx',
    state: 'Nothing has fired here yet.',
    moved: 'leaves no entry',
  },
];

/**
 * Every `<FieldHint …>…</FieldHint>` in one file, as text.
 *
 * Crude on purpose. What is being asked is "does the product still say this,
 * behind the control", and the cheapest honest answer is whether the words are
 * inside one of those elements rather than beside one. JSX wraps prose across
 * lines, so whitespace is flattened before anything is looked for.
 */
function notesIn(source) {
  const found = source.match(/<FieldHint\b[\s\S]*?<\/FieldHint>/g) ?? [];
  return found.map((one) => one.replace(/\s+/g, ' ')).join('\n');
}

for (const { file, state, moved } of SPLIT) {
  const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const flat = source.replace(/\s+/g, ' ');
  record(flat.includes(state), `${file}: "${state}" is still printed in the open`);
  record(
    notesIn(source).includes(moved),
    `${file}: "${moved}" is inside a FieldHint - moved, not deleted`,
  );
}

const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });

/*
 * The one that can be driven without touching anybody's data. A new issue has
 * no attachments, so the empty state is what the page draws.
 */
await page.goto(`${BASE}/workspace/${WORKSPACE}/issues/new`, { waitUntil: 'domcontentloaded' });
if (await drawn(page, 'the new issue form')) {
  /*
   * Wait for the section, then read the page.
   *
   * `drawn()` answers as soon as the form is up, and the attachments section is
   * not part of it yet: it renders behind `attachmentsAllowed`, which arrives
   * with the workspace's settings a moment later. Reading `body` on the instant
   * therefore read a page with no attachments section in it at all, and both
   * assertions below failed - the line missing and the (?) missing, which reads
   * exactly like the feature having been removed.
   *
   * It surfaced on 2026-08-22 in a full-suite run and not in three runs of this
   * check alone, which is the signature of a race rather than a defect: alone
   * the settings query wins, under load it does not.
   *
   * The wait is on the section's own label rather than on "Nothing attached
   * yet." Waiting for the thing being asserted would make the assertion say
   * nothing - it could only pass or time out.
   */
  await page.getByText('Attachments', { exact: true }).first().waitFor({ timeout: 20_000 });
  const body = await page.locator('body').innerText();
  record(body.includes('Nothing attached yet.'), 'the attachments line says the state');
  record(
    !body.includes('A screenshot is worth a paragraph of description'),
    'and the argument for attaching one is no longer in the open beside it',
  );

  const hint = page.locator('[data-hint="Nothing attached yet"]');
  record((await hint.count()) === 1, 'there is a (?) beside that line');
  if ((await hint.count()) === 1) {
    await hint.first().hover();
    await page.waitForTimeout(400);
    const note = page.locator('[role="note"]');
    const said = (await note.count()) > 0 ? await note.first().innerText() : '';
    record(
      said.includes('A screenshot is worth a paragraph of description'),
      'and the note beside it is where the argument went',
    );
  }
}

console.log(
  'NOTE: the bell and the two trigger logs are asserted from source only. Their empty states need ' +
    'an account with no notifications and a workspace nothing has ever fired in, and making either ' +
    "on a real database means changing somebody's data.",
);

await finish(browser);
