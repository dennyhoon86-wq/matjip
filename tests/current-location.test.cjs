const test = require('node:test');
const assert = require('node:assert/strict');

test('current-location search stays within Seoul, validates radius and sorts by straight-line distance', async () => {
  process.env.AUTH_REQUIRED = 'false';
  const { app } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/restaurants/nearby`;
  const search = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const base = { latitude: 37.5665, longitude: 126.978, radius: 1000, page: '1', pageSize: '100' };
    const response = await search(base);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert(data.total > 0);
    assert.equal(data.nearby.mode, 'current');
    assert(data.rows.every(row => row.region === '서울' && row.status === '영업' && Number.isFinite(row.distance_m) && row.distance_m <= 1000));
    assert(data.rows.every((row, i) => i === 0 || data.rows[i - 1].distance_m <= row.distance_m));

    const wider = await (await search({ ...base, radius: 10000 })).json();
    assert(wider.total >= data.total);
    for (const invalid of [{ ...base, radius: 11000 }, { ...base, latitude: 100 }, { ...base, longitude: null }, { ...base, landmarkId: 'somewhere' }]) {
      assert.equal((await search(invalid)).status, 400);
    }
    assert.equal((await fetch(url)).status, 404, 'location coordinates must not be sent in a GET URL');
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete process.env.AUTH_REQUIRED;
  }
});
