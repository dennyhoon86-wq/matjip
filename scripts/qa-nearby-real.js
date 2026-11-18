// Read-only release check against the shipped restaurant and coordinate DBs.
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { LANDMARKS } = require('../seoul-landmarks');
const { normalizeAddress, seoulParcelKey, gyeonggiParcelKey, distanceMeters } = require('../geo-locations');

process.env.AUTH_REQUIRED = 'false';
const { app } = require('../server');
const coordinates = new Database(require('node:path').join(__dirname, '../locations.db'), { readonly: true });
const pointByAddress = new Map(coordinates.prepare("SELECT address_key, lat, lon FROM locations WHERE status='ok'").all().map(row => [row.address_key, row]));
coordinates.close();

const server = app.listen(0, '127.0.0.1');
server.once('listening', async () => {
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    const meta = await (await fetch(`${root}/api/meta`)).json();
    assert.equal(meta.nearby.ready, true);
    const seoul = meta.nearby.areas.find(area => area.name === '서울');
    const gyeonggi = meta.nearby.areas.find(area => area.name === '경기');
    assert(seoul.locatedRestaurants > 19000);
    assert(gyeonggi.locatedRestaurants > 7000);
    assert.equal(seoul.locatedRestaurants, seoul.totalRestaurants, 'Seoul coordinate coverage incomplete');
    assert.equal(gyeonggi.locatedRestaurants, gyeonggi.totalRestaurants, 'Gyeonggi coordinate coverage incomplete');
    const markers = ['강동구:이케아 강동점', '강남구:스타필드 코엑스몰', '송파구:롯데월드몰'];
    let checkedResults = 0;
    let zeroCount = 0;
    for (const landmark of LANDMARKS) {
      const radii = markers.includes(landmark.id) ? [500, 1000, 2000, 3000] : [1000];
      let previousTotal = -1;
      for (const radius of radii) {
        const url = `${root}/api/restaurants?region=${encodeURIComponent('서울')}&landmarkId=${encodeURIComponent(landmark.id)}&radius=${radius}&pageSize=100`;
        const response = await fetch(url);
        if (response.status !== 200) throw new Error(`${landmark.id}: ${response.status} ${await response.text()}`);
        const body = await response.json();
        assert(body.total >= previousTotal, `${landmark.id}: total should increase with radius`);
        previousTotal = body.total;
        if (!body.total) zeroCount++;
        let last = -1;
        for (const restaurant of body.rows) {
          const point = pointByAddress.get(normalizeAddress(restaurant.address)) || pointByAddress.get(seoulParcelKey(restaurant.address));
          assert(point, `missing coordinate: ${restaurant.name}`);
          const actual = Math.round(distanceMeters(point.lat, point.lon, landmark.lat, landmark.lon));
          assert.equal(restaurant.distance_m, actual);
          assert(actual <= radius, `${landmark.id}: ${restaurant.name} beyond ${radius}m`);
          assert(actual >= last, `${landmark.id}: unsorted distance`);
          last = actual;
          checkedResults++;
        }
      }
    }
    assert.equal(zeroCount, 0, 'some landmarks have no located restaurants within 1km');
    const nearby = await (await fetch(`${root}/api/restaurants/nearby`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: 37.2636, longitude: 127.0286, radius: 2000, pageSize: '100' }) })).json();
    assert(nearby.total > 0);
    for (const restaurant of nearby.rows) {
      const point = pointByAddress.get(gyeonggiParcelKey(restaurant.address));
      assert(point, `missing Gyeonggi coordinate: ${restaurant.name}`);
      assert.equal(restaurant.distance_m, Math.round(distanceMeters(point.lat, point.lon, 37.2636, 127.0286)));
    }
    console.log(JSON.stringify({ landmarks: LANDMARKS.length, areas: meta.nearby.areas,
      checkedResults, gyeonggiResults: nearby.total, zeroCount }, null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { server.close(); }
});
