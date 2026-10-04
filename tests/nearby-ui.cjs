// 키 없이도 장소 선택/거리 표시/해제의 브라우저 흐름을 확인한다.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/MM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = 'http://127.0.0.1:4320';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, AUTH_REQUIRED: 'false', PORT: '4320' }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(origin + '/api/meta')).ok) break; } catch {} await pause(200); }
    const baseRestaurant = (await (await fetch(origin + '/api/restaurants?pageSize=1')).json()).rows[0];
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    const nearRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/meta', async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.nearby = { ready: true, locatedAddresses: 1 };
      await route.fulfill({ json: data });
    });
    await page.route('**/api/landmarks?**', async route => route.fulfill({ json: { places: [
      { id: 'ikea-gangdong', name: '이케아 강동점', address: '서울 강동구' },
      { id: 'ikea-other', name: '이케아 다른점', address: '다른 도시' },
    ] } }));
    await page.route('**/api/restaurants?**', async route => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has('landmarkId')) return route.continue();
      nearRequests.push(url);
      return route.fulfill({ json: { total: 1, page: 1, pageSize: 30, rows: [{ ...baseRestaurant, distance_m: 350 }], inferred: null, nearby: { name: '이케아 강동점', radius: Number(url.searchParams.get('radius')), distanceType: '직선거리' } } });
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    assert(await page.locator('#nearbyPanel').isVisible());
    await page.locator('#landmarkQuery').fill('강동 이케아');
    await page.locator('#findLandmark').click();
    assert.equal(await page.locator('#landmarkCandidates button').count(), 2);
    await page.locator('#landmarkCandidates button').first().click();
    await page.waitForFunction(() => document.querySelector('.near-distance')?.textContent.includes('350m'));
    assert.equal(nearRequests.at(-1).searchParams.get('landmarkId'), 'ikea-gangdong');
    await page.locator('#nearbyRadius').selectOption('2000');
    await page.waitForFunction(() => document.querySelector('#selectedLandmark')?.textContent.includes('2km'));
    for (let i = 0; i < 20 && nearRequests.at(-1)?.searchParams.get('radius') !== '2000'; i++) await pause(100);
    assert.equal(nearRequests.at(-1).searchParams.get('radius'), '2000');
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await page.locator('#clearLandmark').click();
    await page.waitForFunction(() => !document.querySelector('.near-distance'));
    assert.equal(await page.locator('#selectedLandmark').isVisible(), false);
    await page.locator('#q').fill('강동 이케아 근처 한식');
    await page.waitForFunction(() => document.querySelectorAll('#landmarkCandidates button').length === 2);
    assert.equal(await page.locator('#landmarkQuery').inputValue(), '강동 이케아');
    assert.equal(await page.locator('#q').inputValue(), '한식');
    await page.locator('#landmarkCandidates button').first().click();
    await page.waitForFunction(() => document.querySelector('.near-distance')?.textContent.includes('350m'));
    assert.equal(nearRequests.at(-1).searchParams.get('q'), '한식');
    assert.deepEqual(errors, []);
    console.log('PASS nearby browser: candidate choice, sentence search, radius, distance, clear, 320px layout');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
