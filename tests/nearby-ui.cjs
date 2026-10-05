// 실제 82개 정적 장소 검색과 거리 UI의 브라우저 흐름을 확인한다.
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
    await page.route('**/api/restaurants?**', async route => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has('landmarkId')) return route.continue();
      nearRequests.push(url);
      return route.fulfill({ json: { total: 1, page: 1, pageSize: 30, rows: [{ ...baseRestaurant, distance_m: 350 }], inferred: null, nearby: { name: '이케아 강동점', radius: Number(url.searchParams.get('radius')), distanceType: '직선거리' } } });
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    assert(await page.locator('#nearbyPanel').isVisible());
    assert.equal(await page.locator('#landmarkGuideCount').textContent(), '(82곳)');
    await page.locator('#nearbyPanel > summary').click();
    await page.locator('#landmarkGuide summary').click();
    await page.locator('#landmarkGuideDistrict').selectOption('강동구');
    assert.equal(await page.locator('#landmarkGuideOptions button').count(), 4);
    await page.locator('#landmarkGuideOptions button', { hasText: '이케아 강동점' }).click();
    await page.waitForFunction(() => document.querySelector('.near-distance')?.textContent.includes('350m'));
    assert.match(await page.locator('.near-distance').textContent(), /이케아 강동점에서 직선거리 350m/);
    assert.equal(nearRequests.at(-1).searchParams.get('landmarkDistrict'), '강동구');
    await page.locator('#clearLandmark').click();
    await page.locator('#landmarkQuery').fill('강동 이케아');
    await page.locator('#findLandmark').click();
    await page.waitForFunction(() => document.querySelectorAll('#landmarkCandidates button').length === 1);
    assert.equal(await page.locator('#landmarkCandidates button').count(), 1);
    await page.locator('#landmarkCandidates button').first().click();
    await page.waitForFunction(() => document.querySelector('.near-distance')?.textContent.includes('350m'));
    assert.equal(nearRequests.at(-1).searchParams.get('landmarkId'), '강동구:이케아 강동점');
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
    await page.waitForFunction(() => document.querySelectorAll('#landmarkCandidates button').length === 1);
    assert.equal(await page.locator('#landmarkQuery').inputValue(), '강동 이케아');
    assert.equal(await page.locator('#q').inputValue(), '한식');
    await page.locator('#landmarkCandidates button').first().click();
    await page.waitForFunction(() => document.querySelector('.near-distance')?.textContent.includes('350m'));
    assert.equal(nearRequests.at(-1).searchParams.get('q'), '한식');
    assert.match(await page.locator('#nearbyDistrictFallback').textContent(), /강동구 전체.*거리 조건 해제/);
    await page.locator('#nearbyDistrictFallback').click();
    await page.waitForFunction(() => document.querySelector('#gu')?.value === '강동구');
    assert.equal(await page.locator('#selectedLandmark').isVisible(), false);
    assert.equal(await page.locator('#region').inputValue(), '서울');
    assert.equal(await page.locator('#q').inputValue(), '한식');
    assert.deepEqual(errors, []);
    console.log('PASS nearby browser: candidate choice, sentence search, radius, distance, clear, 320px layout');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
