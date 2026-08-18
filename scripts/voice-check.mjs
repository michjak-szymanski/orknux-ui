/**
 * Drives voice mode with a fake microphone, to see the loop actually turn.
 *
 * Chromium's own synthetic capture device stands in for a person talking, so
 * this never opens the machine's real microphone. Temporary: delete when the
 * feature has been looked at by a human.
 */
import { chromium } from 'playwright';

const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';

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

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(message.text().slice(0, 200));
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 200)}`));

/*
 * Voice mode needs a workspace with both a transcription model and a speech
 * model set, and the chat opens in whichever workspace was last used — which,
 * in a browser that has never been here, is simply the first one. Point it at
 * the workspace that has them.
 */
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate((id) => window.localStorage.setItem('orknux.lastWorkspace', id), process.env.ORKNUX_VOICE_WORKSPACE ?? '1');

await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('button[aria-label="Enter voice mode"]', { timeout: 20_000 });
await page.click('button[aria-label="Enter voice mode"]');

const panel = page.locator('aside[aria-label="Voice mode"]');
await panel.waitFor({ timeout: 10_000 });
console.log('panel opened');

// What it says it is doing, once a second, for long enough to see a turn end.
const seen = [];
for (let second = 0; second < 45; second += 1) {
  const caption = await panel.locator('p').first().innerText().catch(() => '?');
  if (seen[seen.length - 1] !== caption) {
    seen.push(caption);
    console.log(`${String(second).padStart(2, '0')}s ${caption}`);
  }
  await page.waitForTimeout(1000);
}

const heard = await panel.locator('[class*="heard"]').innerText().catch(() => null);
const failed = await panel.locator('[class*="error"]').innerText().catch(() => null);

// Out of the way of the manual's own pictures: this one is a debugging aid.
await page.screenshot({ path: '/tmp/voice-mode.png' });

console.log('\nstates seen:', seen.join(' -> '));
console.log('heard:', heard);
console.log('error shown:', failed);
console.log('console errors:', problems.length === 0 ? 'none' : problems.slice(0, 3));

await browser.close();
