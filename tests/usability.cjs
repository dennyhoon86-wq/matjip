// Isolated browser scenarios. No production accounts or personal records are modified.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/MM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = 'http://127.0.0.1:4318';
const pause = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let server, browser;
const errors = [];
async function criterion(name, points, fn) {
  try { await fn(); results.push({ name, points, passed: true }); console.log('PASS', name, points); }
  catch (error) { results.push({ name, points, passed: false, error: error.message }); console.error('FAIL', name, error); }
}
async function settled(page) { await pause(400); await page.waitForFunction(() => !document.querySelector('#metaCount').textContent.includes('검색 중'), { timeout: 10000 }); }
async function query(page, text) { await page.locator('#q').fill(text); await settled(page); }
async function details(card) { if (!(await card.locator('details').getAttribute('open') != null)) await card.locator('summary').click(); }
async function localPage(context) {
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin, { waitUntil: 'networkidle' }); await page.locator('.card').first().waitFor(); return page;
}
(async () => {
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, AUTH_REQUIRED: 'false', PORT: '4318' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(origin + '/api/meta')).ok) break; } catch {} await pause(200); }
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const meta = await (await fetch(origin + '/api/meta')).json();
  const restaurants = (await (await fetch(origin + '/api/restaurants?q=' + encodeURIComponent('수숯불직화꼬치바베큐'))).json()).rows;
  const songpa = restaurants.find(r => r.gu === '송파구');
  const key = d => `${d.name}\u001f${d.address}`;
  const baseContext = await browser.newContext({ viewport: { width: 1365, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await localPage(baseContext);

  await criterion('Search: locations, names, ratings, budgets, sentences and shared ledger matching', 20, async () => {
    const S = require('../public/search-query');
    for (const text of ['서울 중식', '강남 돼지고기', '한식 4.6 이상', '부모님 모시고 갈 조용한 한식', '서울 중식 3~5만원', '한식 5만원 이하', '송파구 수숯불']) {
      const data = await (await fetch(origin + '/api/restaurants?q=' + encodeURIComponent(text) + '&pageSize=100')).json();
      const smart = S.parse(text, meta.vocabulary);
      assert(data.rows.every(r => S.matches(r, smart)), text + ' differs between global and ledger');
      if (!text.includes('만원')) assert(data.total > 0, text + ' unexpectedly empty');
      if (text.startsWith('서울')) { assert.equal(data.inferred.region, '서울'); assert.equal(data.inferred.station, null); }
      if (text === '강남 돼지고기') assert.equal(data.inferred.gu, '강남구');
      if (text === '한식 4.6 이상') { assert.equal(data.inferred.priceMin, null); assert(data.total > 100); }
      if (text.includes('만원')) assert(data.rows.every(r => r.price_range));
    }
    await query(page, '부모님 모시고 갈 조용한 한식');
    assert((await page.locator('#smartHint').innerText()).includes('지도에서 확인'));
    let failed = true;
    await page.route('**/api/restaurants?**', async r => failed ? r.fulfill({ status: 503, json: { error: 'isolated failure' } }) : r.continue());
    await query(page, '부산 국밥'); assert(await page.locator('#searchError').isVisible()); assert.equal(await page.locator('.card').count(), 0);
    failed = false; await page.locator('#retrySearch').click(); await settled(page); assert(!(await page.locator('#searchError').isVisible()));
    await page.unroute('**/api/restaurants?**');
  });

  await criterion('Recording: branch-specific saves preserve browsing, date/rating/copy and reload', 10, async () => {
    await query(page, '수숯불직화꼬치바베큐'); assert.equal(await page.locator('.card').count(), 2);
    const target = page.locator('.card').filter({ hasText: songpa.address });
    await target.getByRole('button', { name: '가봄', exact: true }).click(); await pause(100);
    assert.equal(await page.locator('#personalFilter').inputValue(), ''); assert.equal(await page.locator('.card').count(), 2);
    assert.equal(await page.locator('.personal-tag').count(), 1);
    assert(await page.locator('#saveFeedback').isVisible());
    await target.locator('[data-action="rating"]').selectOption('5.0'); await pause(100);
    await target.locator('[data-action="visited-at"]').fill('2026-10-01'); await pause(100);
    assert((await target.innerText()).includes('방문 2026.10.01'));
    await target.getByRole('button', { name: '복사', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${songpa.name} ${songpa.address}`);
    await page.reload({ waitUntil: 'networkidle' }); await query(page, songpa.name);
    await details(page.locator('.card').filter({ hasText: songpa.address }));
    assert.equal(await page.locator('.card').filter({ hasText: songpa.address }).locator('[data-action="rating"]').inputValue(), '5.0');
    assert.equal(await page.locator('.card').filter({ hasText: songpa.address }).locator('[data-action="visited-at"]').inputValue(), '2026-10-01');
    await page.locator('.card').filter({ hasText: songpa.address }).locator('[data-action="visited-at"]').fill(''); await pause(100);
    assert.equal(await page.locator('.visited-at-tag').count(), 0);
  });

  await criterion('Ledger: full saved list, complete search restoration, five sorts and map queues', 15, async () => {
    await page.locator('.card').filter({ hasText: '광진구' }).getByRole('button', { name: '가고싶음', exact: true }).click(); await pause(100);
    await page.locator('#gu').selectOption('부산'); await settled(page);
    await page.locator('#sort').selectOption('avg_asc'); await settled(page);
    await page.locator('#openLedger').click(); await settled(page);
    assert.equal(await page.locator('#gu').inputValue(), ''); assert.equal(await page.locator('#q').inputValue(), '');
    assert.equal(await page.locator('.card').count(), 2);
    for (const sort of ['avg_desc', 'avg_asc', 'grade', 'name', 'new_first']) {
      await page.locator('#sort').selectOption(sort); await settled(page);
      const expected = [...restaurants].sort(require('../public/search-query').compare(sort)).map(r => r.address);
      const actual = await page.locator('.card').evaluateAll(cards => cards.map(c => c.__restaurant.address)); assert.deepEqual(actual, expected, sort);
    }
    await query(page, '송파구 수숯불'); assert.equal(await page.locator('.card').count(), 1);
    const card = page.locator('.card').first(); await details(card);
    await card.getByRole('button', { name: '지도에 옮기기', exact: true }).click();
    await page.locator('#mapCandidate').click(); await settled(page);
    await page.locator('[data-map-provider="kakao"]').click();
    await page.locator('#mapCandidate').click(); await settled(page);
    await page.locator('[data-map-provider="naver"]').click();
    await page.locator('#mapComplete').click(); await settled(page);
    await page.locator('#closeMapTransfer').click();
    await page.locator('[data-ledger-filter="저장 대기"]').click(); await settled(page);
    assert.equal(await page.locator('.kakao-target-tag').count(), 1);
    await page.locator('#closeLedger').click(); await settled(page);
    assert.equal(await page.locator('#gu').inputValue(), '부산'); assert.equal(await page.locator('#sort').inputValue(), 'avg_asc'); assert.equal(await page.locator('#q').inputValue(), songpa.name);
  });

  await criterion('Accounts: isolation, authoritative cloud state, narrow saves, rollback and deleted-state persistence', 20, async () => {
    const cloud = { A: { states: [{ restaurant_key: key(songpa), status: '가봄', updated_at: '2026-10-03T00:00:00Z' }], records: [{ restaurant_key: key(songpa), personal_rating: 5, visited_at: '2026-10-02', kakao_target: true }] }, B: { states: [], records: [] } };
    const writes = []; let failNextRecord = false;
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addInitScript(key => {
      if (!localStorage.getItem('qa-account')) localStorage.setItem('qa-account', 'A');
      localStorage.setItem('misik-jangbu-personal-v1', JSON.stringify({ [key]: { state: '가고싶음', updatedAt: Date.now() } }));
      localStorage.setItem('misik-jangbu-personal-records-v1', JSON.stringify({ [key]: { personalRating: 1 } }));
      localStorage.setItem('misik-jangbu-personal-v1:A', JSON.stringify({ [key]: { state: '가고싶음', updatedAt: Date.now() } }));
      window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'qa-' + localStorage.getItem('qa-account'), user: { id: localStorage.getItem('qa-account') } } } }), onAuthStateChange: () => {}, signOut: async () => {} } }) };
    }, key(songpa));
    await context.route('**/api/auth/config', r => r.fulfill({ json: { enabled: true, configured: true, supabaseUrl: 'https://qa.invalid', supabaseAnonKey: 'qa-only' } }));
    await context.route('**/api/auth/me', r => { const account = r.request().headers().authorization.slice(-1); return r.fulfill({ json: { profile: { id: account, fullName: account, role: 'member', allowed: true } } }); });
    await context.route(/\/api\/personal-(states|records)$/, async r => {
      const request = r.request(), account = request.headers().authorization.slice(-1), type = request.url().endsWith('states') ? 'states' : 'records';
      if (request.method() !== 'GET') {
        const body = request.postDataJSON(); writes.push({ account, type, body });
        if (type === 'records' && failNextRecord) { failNextRecord = false; return r.fulfill({ status: 500, json: { error: '저장 실패 시험' } }); }
        if (request.method() === 'DELETE') cloud[account].states = cloud[account].states.filter(s => s.restaurant_key !== body.restaurant_key);
        else if (type === 'records') for (const record of body.records) {
          let row = cloud[account].records.find(x => x.restaurant_key === record.restaurant_key);
          if (!row) { row = { restaurant_key: record.restaurant_key }; cloud[account].records.push(row); }
          Object.assign(row, record.patch);
        } else for (const state of body.states) {
          cloud[account].states = cloud[account].states.filter(s => s.restaurant_key !== state.restaurant_key);
          cloud[account].states.push({ restaurant_key: state.restaurant_key, status: state.status });
        }
      }
      return r.fulfill({ json: { [type]: cloud[account][type] } });
    });
    const p = await localPage(context); assert.equal(writes.length, 0, 'login uploaded old browser data');
    await p.locator('#openLedger').click(); await settled(p); assert((await p.locator('.card').first().innerText()).includes('가봄')); assert((await p.locator('.card').first().innerText()).includes('내 평점 5.0'));
    await details(p.locator('.card').first());
    await p.locator('[data-action="rating"]').selectOption('4.5'); await pause(200);
    assert.deepEqual(writes.at(-1).body.records[0].patch, { personal_rating: 4.5 });
    assert.equal(cloud.A.records[0].visited_at, '2026-10-02'); assert.equal(cloud.A.records[0].kakao_target, true);
    await p.locator('.card').first().getByRole('button', { name: '지도에 옮기기', exact: true }).click();
    await p.locator('[data-map-provider="kakao"]').click(); failNextRecord = true;
    await p.locator('#mapComplete').click(); await settled(p);
    assert(await p.locator('#saveFeedback.error').isVisible()); assert((await p.locator('#mapTransferStatus').innerText()).includes('저장 대기')); assert(!cloud.A.records[0].kakao_saved);
    await p.locator('#mapComplete').click(); await settled(p);
    assert.equal(cloud.A.records[0].personal_rating, 4.5); assert.equal(cloud.A.records[0].visited_at, '2026-10-02'); assert(cloud.A.records[0].kakao_saved);
    assert.deepEqual(Object.keys(writes.at(-1).body.records[0].patch).sort(), ['kakao_saved', 'kakao_saved_at', 'kakao_target']);
    await p.locator('#closeMapTransfer').click();
    failNextRecord = true; await p.locator('[data-action="visited-at"]').fill('2026-10-01'); await settled(p);
    assert(await p.locator('#saveFeedback.error').isVisible()); assert.equal(await p.locator('[data-action="visited-at"]').inputValue(), '2026-10-02');
    await p.locator('.card').first().getByRole('button', { name: '가봄', exact: true }).click(); await settled(p); assert.equal(cloud.A.states.length, 0);
    await p.reload({ waitUntil: 'networkidle' }); await p.locator('#openLedger').click(); await settled(p); assert.equal(await p.locator('.personal-tag').count(), 0);
    const before = writes.length;
    await p.evaluate(() => localStorage.setItem('qa-account', 'B')); await p.reload({ waitUntil: 'networkidle' });
    await p.locator('#openLedger').click(); await settled(p); assert.equal(await p.locator('.card').count(), 0); assert.equal(writes.length, before);
    await p.evaluate(() => localStorage.setItem('qa-account', 'A')); cloud.A.records[0].personal_rating = 3.5;
    await p.reload({ waitUntil: 'networkidle' }); await p.locator('#openLedger').click(); await settled(p); assert((await p.locator('.card').first().innerText()).includes('내 평점 3.5'));
    await context.close();
  });

  await criterion('Mobile: 320/390px compact first results, 44px touch targets, expandable filters and records, no overflow', 10, async () => {
    for (const width of [320, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
      const p = await localPage(context);
      const before = await p.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, firstTop: document.querySelector('.card').getBoundingClientRect().top, advanced: document.querySelector('#advancedFilters').open }));
      console.log('MOBILE', width, before);
      assert.equal(before.width, before.scrollWidth); assert(before.firstTop < 844); assert.equal(before.advanced, false);
      await p.screenshot({ path: path.join(os.tmpdir(), `misik-mobile-initial-${width}-20261003.png`) });
      const card = p.locator('.card').first();
      for (const control of await card.locator('button,summary').all()) if (await control.isVisible()) assert((await control.boundingBox()).height >= 44);
      await details(card); assert(await card.getByRole('button', { name: '지도에 옮기기', exact: true }).isVisible());
      for (const control of await card.locator('button,a,select').all()) if (await control.isVisible()) assert((await control.boundingBox()).height >= 44);
      await card.screenshot({ path: path.join(os.tmpdir(), `misik-mobile-card-${width}-20261003.png`) });
      await card.getByRole('button', { name: '지도에 옮기기', exact: true }).click();
      assert(await p.locator('#mapTransferDialog').isVisible());
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), width);
      for (const control of await p.locator('#mapTransferDialog button,#mapTransferDialog a').all()) if (await control.isVisible()) assert((await control.boundingBox()).height >= 44);
      await p.locator('#mapTransferDialog').screenshot({ path: path.join(os.tmpdir(), `misik-map-dialog-${width}-20261003b.png`) });
      await p.keyboard.press('Escape'); assert(!(await p.locator('#mapTransferDialog').isVisible()));
      await p.locator('#advancedFilters summary').click(); assert(await p.locator('#sort').isVisible());
      assert.equal(await p.evaluate(() => innerWidth), await p.evaluate(() => document.documentElement.scrollWidth));
      await p.screenshot({ path: path.join(os.tmpdir(), `misik-mobile-${width}-20261003.png`) });
      await context.close();
    }
    const tablet = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const p = await localPage(tablet); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 768); await tablet.close();
  });

  await criterion('Recovery: zero results, location widening, removable conditions and empty ledger escape', 5, async () => {
    await page.locator('#resetFilters').click(); await settled(page);
    await query(page, songpa.name); await page.locator('#gu').selectOption('강남구'); await settled(page);
    assert(await page.locator('#emptyState').isVisible()); assert(await page.locator('#widenLocation').isVisible());
    await page.locator('[data-remove-filter="gu"]').click(); await settled(page); assert.equal(await page.locator('.card').count(), 2);
    await query(page, `강남구 ${songpa.name} 4.5 이상`); assert.equal(await page.locator('.card').count(), 0);
    await page.locator('#widenLocation').click(); await settled(page);
    assert.equal(await page.locator('#q').inputValue(), `${songpa.name} 4.5 이상`); assert.equal(await page.locator('.card').count(), 1);
    await query(page, '식당없음QA테스트'); assert(await page.locator('#emptyReset').isVisible());
    await page.locator('#emptyReset').click(); await settled(page); assert.equal(await page.locator('#q').inputValue(), ''); assert(await page.locator('.card').count() > 0);
    const blank = await browser.newContext(); const p = await localPage(blank);
    await p.locator('#openLedger').click(); await settled(p); assert.equal(await p.locator('.card').count(), 0);
    assert((await p.locator('#emptyMessage').innerText()).includes('아직 내 장부'));
    await p.locator('#emptyBrowse').click(); await settled(p); assert(await p.locator('.card').count() > 0); assert(!(await p.locator('#ledgerDashboard').isVisible()));
    await blank.close();
  });

  await criterion('Review scale: labels differ from taste scores and original grading data stays intact', 5, async () => {
    assert.equal(await page.locator('label[for="grade"]').innerText(), '리뷰 규모');
    assert.equal(await page.locator('label[for="gradeMin"]').innerText(), '최소 리뷰 규모');
    for (const card of await page.locator('.card').all()) {
      assert((await card.locator('.review-scale').innerText()).includes('리뷰 규모'));
      assert.equal(await card.locator('.rating-label').innerText(), '평균 평점');
      assert((await card.locator('.rating-evidence').innerText()).includes('추천 순위 아님'));
      assert.equal(await card.locator('.stamp').innerText(), await card.evaluate(el => el.__restaurant.grade || '무등급'));
    }
    await page.locator('#rubricToggle').click(); assert((await page.locator('#rubricPanel').innerText()).includes('기존 분류 값과 기준은 그대로'));
    await page.locator('#rubricToggle').click();
  });

  await criterion('Map workflow: provider isolation, legacy state preservation, manual completion and clean copy', 10, async () => {
    await query(page, songpa.name);
    const card = page.locator('.card').filter({ hasText: songpa.address });
    const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem('misik-jangbu-personal-records-v1:local'))[key], key(songpa));
    const before = await stored(); assert(before.mapSaved && before.kakaoTarget && !before.kakaoSaved);
    await card.getByRole('button', { name: '지도에 옮기기', exact: true }).click();
    assert((await page.locator('#mapTransferStatus').innerText()).includes('저장 완료'));
    assert((await page.locator('#mapTransferHelp').innerText()).includes('자동 저장되지는'));
    assert((await page.locator('#mapSearchLink').getAttribute('href')).startsWith('https://map.naver.com/p/search/'));
    await page.locator('[data-map-provider="kakao"]').click(); assert((await page.locator('#mapTransferStatus').innerText()).includes('저장 대기'));
    assert((await page.locator('#mapSearchLink').getAttribute('href')).startsWith('https://map.kakao.com/?q='));
    assert.deepEqual(await stored(), before, 'opening or switching provider changed saved records');
    await page.locator('#mapCopy').click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${songpa.name} ${songpa.address}`);
    await page.locator('#mapComplete').click(); await settled(page); let record = await stored(); assert(record.mapSaved && record.kakaoSaved && record.kakaoSavedAt); assert.equal(record.personalRating, 5);
    await page.locator('#mapComplete').click(); await settled(page); record = await stored(); assert(record.mapSaved && record.kakaoTarget && !record.kakaoSaved);
    await page.locator('#mapRemove').click(); await settled(page); record = await stored(); assert(record.mapTarget && record.mapSaved && !record.kakaoTarget);
    await page.locator('#mapCandidate').click(); await settled(page);
    await baseContext.route('https://map.kakao.com/**', r => r.fulfill({ body: 'Isolated map link test' }));
    const popupPromise = page.waitForEvent('popup'); await page.locator('#mapSearchLink').click(); const popup = await popupPromise;
    await popup.close(); await settled(page); assert(!(await stored()).kakaoSaved, 'opening map marked it complete');
    await page.locator('#closeMapTransfer').click();
    assert.equal(await page.locator('.card').count(), 2); assert.equal(await page.locator('#personalFilter').inputValue(), '');
    await page.reload({ waitUntil: 'networkidle' }); await query(page, songpa.name);
    await page.locator('.card').filter({ hasText: songpa.address }).getByRole('button', { name: '지도에 옮기기', exact: true }).click();
    assert((await page.locator('#mapTransferStatus').innerText()).includes('저장 완료'));
    await page.keyboard.press('Escape');
  });

  await criterion('First-use: plain search example and no browser exceptions', 5, async () => {
    const placeholder = await page.locator('#q').getAttribute('placeholder');
    assert.equal(placeholder, '예: 성수 한식, 송파 수숯불'); assert(!/A|4\.6|신규/.test(placeholder));
    assert.equal(await page.locator('label[for="q"]').innerText(), '식당 찾기');
    await page.locator('#resetFilters').click(); await settled(page); assert.equal(await page.locator('#q').inputValue(), ''); assert.equal(await page.locator('#gu').inputValue(), '');
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(os.tmpdir(), 'misik-desktop-20261003.png') });
  });
  const score = results.filter(r => r.passed).reduce((sum, r) => sum + r.points, 0);
  console.log(JSON.stringify({ score, results, browserErrors: errors, note: 'Internal scenario gate; live Google OAuth and real-device testing are separate.' }, null, 2));
  if (score < 95 || results.some(r => !r.passed)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) server.kill(); });
