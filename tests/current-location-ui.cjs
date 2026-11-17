const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/MM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const origin = 'http://127.0.0.1:4329';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser;
async function settled(page) {
  await page.waitForFunction(() => !document.querySelector('#metaCount').textContent.includes('검색 중'), { timeout: 10000 });
}

(async () => {
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, AUTH_REQUIRED: 'false', PORT: '4329' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(origin + '/api/meta')).ok) break; } catch {} await pause(200); }
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 37.5665, longitude: 126.978, accuracy: 40 } });
  const page = await context.newPage();
  const errors = [];
  const urls = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/restaurants/nearby')) urls.push({ url: request.url(), method: request.method() }); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('.card').first().waitFor();
  assert(await page.locator('#useCurrentLocation').isVisible());
  assert(await page.locator('#currentLocationPanel').isHidden());
  const firstSearch = page.waitForResponse(response => response.url().endsWith('/api/restaurants/nearby') && response.request().method() === 'POST');
  await page.locator('#useCurrentLocation').click();
  await page.waitForFunction(() => document.querySelector('#currentLocationStatus').textContent.includes('2km 이내'));
  await firstSearch;
  await settled(page);
  assert(await page.locator('#currentLocationPanel').isVisible());
  const firstKmSearch = page.waitForResponse(response => response.url().endsWith('/api/restaurants/nearby') && response.request().method() === 'POST');
  await page.locator('#currentLocationRadius').selectOption('1000');
  await firstKmSearch;
  await settled(page);
  const firstRows = await page.locator('.card').evaluateAll(cards => cards.map(card => card.__restaurant));
  assert(firstRows.length > 0);
  assert(firstRows.every(row => row.region === '서울' && row.distance_m <= 1000));
  assert(firstRows.every((row, i) => i === 0 || firstRows[i - 1].distance_m <= row.distance_m));
  assert(urls.length > 0 && urls.every(request => request.method === 'POST' && !request.url.includes('37.5665')));
  const firstTotal = Number((await page.locator('#metaCount').textContent()).match(/[\d,]+/)[0].replaceAll(',', ''));

  const secondSearch = page.waitForResponse(response => response.url().endsWith('/api/restaurants/nearby') && response.request().method() === 'POST');
  await page.locator('#currentLocationRadius').selectOption('2000');
  await secondSearch;
  await settled(page);
  const secondTotal = Number((await page.locator('#metaCount').textContent()).match(/[\d,]+/)[0].replaceAll(',', ''));
  assert(secondTotal >= firstTotal);
  const browsingSearch = page.waitForResponse(response => response.url().includes('/api/restaurants?') && response.request().method() === 'GET');
  await page.locator('#clearCurrentLocation').click();
  await browsingSearch;
  await settled(page);
  assert.equal(await page.locator('#region').inputValue(), '');
  assert(await page.locator('#clearCurrentLocation').isHidden());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  const deniedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await deniedContext.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_, error) => error({ code: 1 }) } });
  });
  const deniedPage = await deniedContext.newPage();
  await deniedPage.goto(origin, { waitUntil: 'networkidle' });
  await deniedPage.locator('#useCurrentLocation').click();
  assert((await deniedPage.locator('#currentLocationStatus').textContent()).includes('위치 권한이 거부됐어요'));
  assert.deepEqual(errors, []);
  console.log('PASS current location: 1–10km search, distance order, private POST, reset, denial, 390px layout');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  server?.kill();
});
