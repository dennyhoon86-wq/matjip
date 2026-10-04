const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeAddress } = require('../geo-locations');

test('장소를 다시 확인한 뒤 자체 식당 좌표에만 반경을 적용한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'misik-nearby-'));
  const file = path.join(dir, 'locations.db');
  const restaurantDb = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  const sample = restaurantDb.prepare("SELECT name,address FROM restaurants WHERE status='영업' AND address IS NOT NULL AND trim(address) != '' LIMIT 1").get();
  restaurantDb.close();
  const locationsDb = new Database(file);
  locationsDb.exec('CREATE TABLE locations(address_key TEXT PRIMARY KEY,lat REAL,lon REAL,status TEXT,checked_at TEXT)');
  locationsDb.prepare("INSERT INTO locations VALUES(?,?,?,?,datetime('now'))").run(normalizeAddress(sample.address), 37.55, 127.0, 'ok');
  locationsDb.close();

  process.env.LOCATIONS_DB_PATH = file;
  process.env.KAKAO_REST_API_KEY = 'test-only';
  process.env.NEARBY_ENABLED = 'true';
  const nativeFetch = global.fetch;
  global.fetch = async (input, options) => {
    if (String(input).startsWith('https://dapi.kakao.com/')) {
      assert.equal(options.headers.Authorization, 'KakaoAK test-only');
      return new Response(JSON.stringify({ documents: [{ id: 'test-place', place_name: '시험 장소', x: '127', y: '37.55', address_name: '서울 시험동 1' }] }), { status: 200 });
    }
    return nativeFetch(input, options);
  };
  const { app } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await nativeFetch(`${base}/api/landmarks?q=시험장소`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).places.map(place => place.id), ['test-place']);
    assert.equal(response.headers.get('cache-control'), 'no-store');

    response = await nativeFetch(`${base}/api/restaurants?landmarkQuery=시험장소&landmarkId=test-place&radius=500&q=${encodeURIComponent(sample.name)}`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert(result.total >= 1);
    assert(result.rows.every(row => normalizeAddress(row.address) === normalizeAddress(sample.address) && row.distance_m === 0));
    assert.equal(result.nearby.distanceType, '직선거리');
    assert.equal(response.headers.get('cache-control'), 'no-store');

    response = await nativeFetch(`${base}/api/restaurants?landmarkQuery=시험장소&landmarkId=wrong`);
    assert.equal(response.status, 409);
    response = await nativeFetch(`${base}/api/restaurants?landmarkQuery=시험장소&landmarkId=test-place&radius=99999`);
    assert.equal(response.status, 400);
  } finally {
    global.fetch = nativeFetch;
    await new Promise(resolve => server.close(resolve));
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
    delete process.env.LOCATIONS_DB_PATH;
    delete process.env.KAKAO_REST_API_KEY;
    delete process.env.NEARBY_ENABLED;
  }
});
