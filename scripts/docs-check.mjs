import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await context.request.post(`${BASE}/api/session`, { data: { username: 'alice', password: 'password' } });

const missing = [];
page.on('response', (r) => {
  if (r.url().includes('/screens/') && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
});

await page.goto(`${BASE}/docs/issues`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const nav = await page.locator('nav[aria-label="Primary"]').innerText();
console.log('contents:\n' + nav);
await page.waitForTimeout(2000);
console.log('broken images:', missing.length ? missing : 'none');

// Every image the manual asks for, and whether it resolved.
const imgs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('article img')).map((i) => ({
    src: new URL(i.getAttribute('src'), location.href).pathname,
    ok: i.naturalWidth > 0,
  })),
);
console.log('images:', imgs.filter((i) => !i.ok).length === 0 ? `${imgs.length} all loaded` : imgs.filter((i) => !i.ok));

await page.screenshot({ path: '/tmp/docs-issues.png', fullPage: false });
await browser.close();
