const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('node:path');

test('local API keeps neighborhood results local and returns one card per saved place', async () => {
  process.env.AUTH_REQUIRED = 'false';
  const { app } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const db = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  try {
    const response = await fetch(`${base}/api/restaurants?q=${encodeURIComponent('성수 점심 한식')}&pageSize=100`);
    assert.equal(response.status, 200);
    const search = await response.json();
    assert(search.total > 0);
    assert.equal(search.inferred.neighborhood, '성수');
    assert(search.rows.every(row => row.gu === '성동구' && row.dong.startsWith('성수동')));

    const duplicated = db.prepare("SELECT name,address,COUNT(*) c FROM restaurants WHERE name='성북동섭지코지' GROUP BY name,address").get();
    assert(duplicated.c > 1);
    const keys = [
      `${duplicated.name}\u001f${duplicated.address}`,
      '갈리나데이지\u001f서울 종로구 통인동 118-8',
      ...db.prepare("SELECT name,address FROM restaurants WHERE name='수숯불직화꼬치바베큐' GROUP BY name,address").all()
        .map(row => `${row.name}\u001f${row.address}`),
    ];
    const savedResponse = await fetch(`${base}/api/personal-list`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }),
    });
    assert.equal(savedResponse.status, 200);
    const saved = (await savedResponse.json()).rows;
    assert.equal(saved.length, keys.length);
    assert.equal(new Set(saved.map(row => `${row.name}\u001f${row.address}`)).size, keys.length);
    assert.equal(saved.find(row => row.name === '갈리나데이지').status, '확인 필요');
    assert.equal(saved.find(row => row.name === '갈리나데이지').statusConflict, true);
    assert.equal(saved.filter(row => row.name === '수숯불직화꼬치바베큐').length, 2);
  } finally {
    db.close();
    await new Promise(resolve => server.close(resolve));
    delete process.env.AUTH_REQUIRED;
  }
});
