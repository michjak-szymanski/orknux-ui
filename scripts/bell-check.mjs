import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const signedIn = await context.request.post(`${BASE}/api/session`, {
  data: { username: 'alice', password: 'password' },
});
console.log('session', signedIn.status());

await page.route('**/graphql', async (route) => {
  const body = route.request().postData() ?? '';
  if (body.includes('Notification')) console.log('  saw:', body.slice(0, 120));
  if (body.includes('readMyNotifications')) {
    console.log('  BLOCKED the read mutation');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { readMyNotifications: 0 } }),
    });
    return;
  }
  await route.continue();
});

await page.goto(`${BASE}/workspace/9/issues`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const bells = await page.locator('button[aria-label^="Notifications"]').count();
console.log('bell buttons:', bells);
await page.click('button[aria-label^="Notifications"]');
await page.waitForTimeout(2500);
const panel = page.locator('div[role="dialog"][aria-label="Notifications"]');
console.log('panel count:', await panel.count());
if (await panel.count()) {
  console.log('panel text:', JSON.stringify((await panel.innerText()).slice(0, 300)));
  console.log('rows:', await panel.locator('a').count());
}
await browser.close();
