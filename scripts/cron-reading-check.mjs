/**
 * What a schedule says it does, read off the field as it is typed.
 *
 * A cron expression is the one thing this interface asks for where the thing
 * typed and the thing meant are in different languages, and issue #203 widened
 * the gap: six fields with seconds leading are now a schedule the server keeps
 * rather than one it merely accepts, and an expression that parses but never
 * comes round is refused on save. So the field reads itself back in English,
 * and this drives it.
 *
 * Four claims, and each of them has been wrong somewhere before:
 *
 *   1. The reading is right, for expressions of every shape the dialect has -
 *      seconds, a five-field expression read from the minute, a weekday range,
 *      a day of the month.
 *   2. It is *current*. The assertion that earns its place is the one that types
 *      rubbish onto the end of a good expression: a description that lags the
 *      field by a keystroke reads exactly like a description, and is a lie.
 *   3. It does not move the form. Measured as the top of the Timezone field
 *      below it, across the longest and shortest readings there are - a hint
 *      that grows and shrinks under the pointer is what makes a live one feel
 *      broken, and it is invisible in a screenshot of one state.
 *   4. Both surfaces say the same thing. The form is drawn in a modal while a
 *      trigger is being created and on a settings card once it exists, and a
 *      schedule that reads one way in one and another way in the other is worse
 *      than no reading at all.
 *
 * And the legend: six positions, in the (?) beside the field, in the order the
 * server parses them. Read out of `CRON_FIELDS` rather than retyped here, so
 * the check cannot drift from the thing it is checking - what it asserts is
 * that the note is drawn from that list and that the list is the server's
 * dialect, seconds first.
 */
import { BASE, WORKSPACE, open, record, drawn, shot, finish } from './suite/harness.mjs';
import { CRON_FIELDS } from '../src/components/cronText.ts';

const { browser, page, graphql } = await open({ viewport: { width: 1440, height: 1000 } });

/** Expression in, sentence out. The whole of what this is for. */
const READS = [
  ['*/10 * * * * *', 'Every 10 seconds'],
  ['0 0 3 * * MON-FRI', 'At 03:00, Monday to Friday'],
  ['0 30 9 1 * *', 'At 09:30 on the 1st of every month'],
  // Five fields, which the server reads from the minute by prepending a zero.
  ['0 2 * * *', 'At 02:00 every day'],
  ['0 0 9-17 * * *', 'Every hour from 09:00 to 17:00'],
  ['0 0 0 L * *', 'At 00:00 on the last day of every month'],
];

/** The two ways an expression is wrong, which the server also tells apart. */
const REFUSED = [
  ['0 0 30 2 *', 'This never comes round: February has no 30th.'],
  ['0 0 3 * * MOO', 'Not a schedule: "MOO" is not a day of week (0-7 or MON-SUN).'],
  ['* * * *', 'Not a schedule: 4 fields. A cron has six, seconds first, or five read from the minute.'],
];

const reading = () => page.locator('#trigger-cron-reading');

async function type(expression) {
  await page.fill('#trigger-cron', expression);
  // The reading is derived during render, so one frame is all it needs.
  await page.waitForTimeout(120);
  return (await reading().innerText()).trim();
}

/* ------------------------------------------------- the dialog a trigger starts in */

await page.goto(`${BASE}/workspace/${WORKSPACE}/triggers`, { waitUntil: 'domcontentloaded' });
if (!(await drawn(page, 'the triggers page'))) await finish(browser, false);

await page.getByRole('button', { name: '+ Create Trigger' }).click();
await page.waitForSelector('#trigger-type', { timeout: 10_000 });
await page.selectOption('#trigger-type', 'SCHEDULED');
await page.waitForSelector('#trigger-cron', { timeout: 10_000 });

record(await reading().isVisible(), 'the schedule field says what the schedule does');

const inDialog = new Map();
for (const [expression, expected] of READS) {
  const said = await type(expression);
  inDialog.set(expression, said);
  record(said === expected, `${JSON.stringify(expression)} reads as ${JSON.stringify(said)}`);
  if (said !== expected) console.log(`  expected ${JSON.stringify(expected)}`);
}

for (const [expression, expected] of REFUSED) {
  const said = await type(expression);
  record(said === expected, `${JSON.stringify(expression)} is refused: ${JSON.stringify(said)}`);
  if (said !== expected) console.log(`  expected ${JSON.stringify(expected)}`);
}

/* ------------------------------------------------------------ it does not lag */

/*
 * Good expression, then a character that ruins it. A reading held in state and
 * updated on a save, on a blur, or by an effect a render behind still shows the
 * old sentence here - which is the one moment somebody is reading it to decide
 * whether what they typed is right.
 */
const good = await type('0 0 3 * * MON-FRI');
await page.locator('#trigger-cron').press('End');
await page.locator('#trigger-cron').type(' 9');
await page.waitForTimeout(150);
const ruined = (await reading().innerText()).trim();
console.log(`after one more field: ${JSON.stringify(ruined)}`);
record(ruined !== good, 'a keystroke that ruins the expression changes what is said about it');
record(ruined.startsWith('Not a schedule:'), 'and it says so rather than showing the last good reading');

/* ------------------------------------------------------- and does not move the form */

/*
 * The Timezone field is directly underneath. Where its top edge is, is where
 * everything below the reading is - so if it moves between the shortest reading
 * and the longest, the reading is pushing the form around while somebody types.
 */
const below = page.locator('label[for="trigger-timezone"]');
const tops = [];
const heights = [];
for (const expression of ['0 2 * * *', '0 0 0 1 * MON', '', 'nonsense', '0 0 9-17 * * *']) {
  await type(expression);
  tops.push(Math.round((await below.boundingBox()).y));
  heights.push(Math.round((await reading().boundingBox()).height));
}
console.log(`the field below sat at y = ${tops.join(', ')}`);
console.log(`the reading was ${heights.join(', ')} tall`);
record(new Set(tops).size === 1, 'nothing below the reading moves as the reading changes');
record(new Set(heights).size === 1, 'because the reading is one line whatever it says');

await type('0 0 3 * * MON-FRI');
await page.screenshot({ path: shot('cron-reading.png') });

/* ---------------------------------------------------------------- the legend */

const hint = page.locator('button[data-hint="Schedule"]');
await hint.click();
await page.waitForTimeout(300);
const note = await page.locator(`#${await hint.getAttribute('aria-controls')}`).innerText();
console.log(`the note beside the field: ${JSON.stringify(note.replace(/\s+/g, ' '))}`);

record(CRON_FIELDS.length === 6, 'the legend names six positions');
record(
  CRON_FIELDS[0].label === 'second' && CRON_FIELDS[5].label === 'day of week',
  "and leads with the second, as the server's parser does",
);
for (const field of CRON_FIELDS) {
  record(note.includes(field.label), `the note names the ${field.label}`);
}
record(note.includes('7') && note.toLowerCase().includes('sunday'), 'and says that 7 is Sunday, which is Spring and not Quartz');

await page.screenshot({ path: shot('cron-legend.png') });
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

/* --------------------------------------------- and the same on the settings card */

/*
 * The other frame. Built here rather than taken from the seed because what is
 * being compared is one expression read on two surfaces, and the seed does not
 * promise a scheduled trigger with a known cron in it.
 */
const name = `cron reading ${Date.now()}`;
const built = await graphql(
  `mutation Build($input: CreateTriggerInput!) { createTrigger(input: $input) { id } }`,
  { input: { workspaceId: WORKSPACE, name, type: 'SCHEDULED', cron: '0 30 9 1 * *', timezone: 'UTC' } },
);
const id = built.createTrigger.id;

try {
  await page.goto(`${BASE}/workspace/${WORKSPACE}/triggers/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#trigger-cron', { timeout: 20_000 });
  await page.waitForTimeout(400);

  const onCard = (await reading().innerText()).trim();
  console.log(`the settings card reads: ${JSON.stringify(onCard)}`);
  record(
    onCard === inDialog.get('0 30 9 1 * *'),
    'the same expression reads the same on the settings card as in the dialog',
  );
  record(await page.locator('button[data-hint="Schedule"]').isVisible(), 'and the legend is beside the field there too');
} finally {
  await graphql(`mutation Scrap($id: ID!) { deleteTrigger(id: $id) }`, { id });
}

await finish(browser);
