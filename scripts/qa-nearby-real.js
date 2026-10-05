// Read-only release check against the shipped restaurant and coordinate DBs.
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { LANDMARKS } = require('../seoul-landmarks');
const { normalizeAddress, distanceMeters } = require('../geo-locations');

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
    assert(meta.nearby.locatedRestaurants > 15000);
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
          const point = pointByAddress.get(normalizeAddress(restaurant.address));
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
    console.log(JSON.stringify({ landmarks: LANDMARKS.length, covered: meta.nearby.locatedRestaurants,
      total: meta.nearby.totalRestaurants, checkedResults, zeroCount }, null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { server.close(); }
});
