/**
 * Measures the vertical placement of the composer's buttons.
 *
 * Issue #98: with voice mode on, the leave-voice-mode X reads as out of place
 * against the controls beside it. This prints each control's centre line, so
 * "out of place" is a number rather than an impression.
 *
 * Temporary: delete once it has been looked at.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const WORKSPACE = process.env.ORKNUX_VOICE_WORKSPACE ?? '1';

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['microphone'],
});
const page = await context.newPage();

const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: 'alice', password: 'password' },
});
if (!signedIn.ok()) {
  console.error('sign-in failed', signedIn.status());
  process.exit(1);
}

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate((id) => window.localStorage.setItem('orknux.lastWorkspace', id), WORKSPACE);
await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('button[aria-label="Enter voice mode"]', { timeout: 20_000 });
await page.click('button[aria-label="Enter voice mode"]');
await page.waitForSelector('button[aria-label="Leave voice mode"]', { timeout: 10_000 });
await page.waitForTimeout(500);

const controls = {
  box: '[class*="composerBox"]',
  textarea: '[class*="composerBox"] textarea',
  microphone: 'button[aria-label*="ictate"], button[aria-label*="icrophone"]',
  voice: 'button[aria-label="Leave voice mode"] , button[aria-label="Enter voice mode"]',
  leave: 'button[aria-label="Leave voice mode"]',
  send: 'button[type="submit"]',
};

// A grown box is the case a one-line box cannot show: the row is aligned to
// the end, so with several lines of draft the buttons leave the middle.
if (process.env.TALL === '1') {
  const box = page.locator('[class*="composerBox"] textarea');
  await box.click();
  for (let line = 0; line < 4; line += 1) {
    await box.type(`a draft long enough to wrap onto another line, number ${line} `);
  }
  await page.waitForTimeout(400);
}

const measured = {};
for (const [name, selector] of Object.entries(controls)) {
  const box = await page
    .locator(selector)
    .first()
    .boundingBox()
    .catch(() => null);
  measured[name] = box === null ? null : { top: box.y, height: box.height, middle: box.y + box.height / 2 };
}

for (const [name, at] of Object.entries(measured)) {
  console.log(at === null ? `${name.padEnd(11)} not found` : `${name.padEnd(11)} middle ${at.middle.toFixed(1)}  height ${at.height}`);
}

// The row the buttons should agree on. The box itself is taller than any of
// them, so its own middle is what "centred vertically" means here.
const spread = Object.entries(measured)
  .filter(([name, at]) => at !== null && name !== 'box' && name !== 'textarea')
  .map(([, at]) => at.middle);
const worst = Math.max(...spread) - Math.min(...spread);
console.log(`\nbuttons disagree by ${worst.toFixed(1)}px`);

await page.screenshot({ path: 'composer.png' });
await browser.close();
process.exit(worst <= 1 ? 0 : 1);
