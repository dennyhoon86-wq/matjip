const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeAddress } = require('../geo-locations');
const { LANDMARKS } = require('../seoul-landmarks');

test('static landmark selection applies a radius only to restaurants with verified coordinates', async () => {
  const ikea = LANDMARKS.find(place => place.id === '강동구:이케아 강동점');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'misik-nearby-'));
  const file = path.join(dir, 'locations.db');
  const restaurantDb = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  const samples = restaurantDb.prepare("SELECT DISTINCT address FROM restaurants WHERE status='영업' AND region='서울' AND address IS NOT NULL AND trim(address) != '' LIMIT 2").all();
  restaurantDb.close();
  assert.equal(samples.length, 2);
  const locationsDb = new Database(file);
  locationsDb.exec('CREATE TABLE locations(address_key TEXT PRIMARY KEY,lat REAL,lon REAL,status TEXT,checked_at TEXT)');
  locationsDb.prepare("INSERT INTO locations VALUES(?,?,?,?,datetime('now'))").run(normalizeAddress(samples[0].address), ikea.lat, ikea.lon, 'ok');
  locationsDb.prepare("INSERT INTO locations VALUES(?,?,?,?,datetime('now'))").run(normalizeAddress(samples[1].address), ikea.lat + 0.1, ikea.lon, 'ok');
  locationsDb.close();

  process.env.LOCATIONS_DB_PATH = file;
  process.env.AUTH_REQUIRED = 'false';
  process.env.NEARBY_ENABLED = 'true';
  const { app } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${base}/api/landmarks?q=${encodeURIComponent('강동 이케아')}`);
    assert.equal(response.status, 200);
    const matched = (await response.json()).places;
    assert.deepEqual(matched.map(place => place.id), [ikea.id]);
    assert.equal(matched[0].district, '강동구');
    assert.match(matched[0].address, /강동구/);

    response = await fetch(`${base}/api/landmark-guide`);
    assert.equal(response.status, 200);
    const guide = await response.json();
    assert.equal(guide.districts.length, 25);
    assert.equal(guide.landmarks.length, 82);

    response = await fetch(`${base}/api/restaurants?landmarkId=${encodeURIComponent(ikea.id)}&landmarkDistrict=${encodeURIComponent('강동구')}&radius=500`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert(result.total >= 1);
    assert(result.rows.every(row => normalizeAddress(row.address) === normalizeAddress(samples[0].address)));
    assert(result.rows.every(row => row.distance_m === 0));
    assert.equal(result.nearby.distanceType, '직선거리');
    assert.equal(response.headers.get('cache-control'), 'no-store');

    response = await fetch(`${base}/api/restaurants?landmarkId=not-listed&radius=500`);
    assert.equal(response.status, 409);
    response = await fetch(`${base}/api/restaurants?landmarkId=${encodeURIComponent(ikea.id)}&radius=99999`);
    assert.equal(response.status, 400);
    response = await fetch(`${base}/api/restaurants?landmarkId=${encodeURIComponent(ikea.id)}&landmarkDistrict=${encodeURIComponent('송파구')}&radius=500`);
    assert.equal(response.status, 409);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
    delete process.env.LOCATIONS_DB_PATH;
    delete process.env.AUTH_REQUIRED;
    delete process.env.NEARBY_ENABLED;
  }
});
