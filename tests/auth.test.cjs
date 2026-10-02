const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuth } = require('../auth');
test('record edits change only requested fields and always scope them to the signed-in user', async () => {
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://isolated.test';
  process.env.SUPABASE_ANON_KEY = 'test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify([{ user_id: 'user-A', restaurant_key: 'branch-key', personal_rating: 5, visited_at: '2026-10-01' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await createAuth().setPersonalRecords('user-A', [{ user_id: 'user-B', restaurant_key: 'branch-key', patch: { personal_rating: 5, visited_at: '2026-10-01', forbidden: 'ignore' } }]);
    assert.equal(requests.length, 1); assert.equal(requests[0].options.method, 'PATCH');
    assert(requests[0].url.includes('user_id=eq.user-A'));
    assert.deepEqual(Object.keys(requests[0].body).sort(), ['personal_rating', 'updated_at', 'visited_at']);
    assert(!('map_target' in requests[0].body)); assert(!('memo' in requests[0].body));
  } finally { global.fetch = originalFetch; }
});
test('new record creation preserves a narrow patch and server timestamps', async () => {
  const originalFetch = global.fetch, requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(options.method === 'PATCH' ? [] : [JSON.parse(options.body)]), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await createAuth().setPersonalRecords('user-A', [{ restaurant_key: 'key', patch: { kakao_target: true } }]);
    assert.equal(requests.length, 2); assert.equal(requests[1].method, 'POST');
    assert.deepEqual(Object.keys(requests[1].body).sort(), ['kakao_target', 'restaurant_key', 'updated_at', 'user_id']);
    assert.equal(requests[1].body.user_id, 'user-A');
    requests.length = 0;
    await createAuth().setPersonalStates('user-A', [{ restaurant_key: 'key', status: '가봄' }]);
    assert(requests[0].body[0].updated_at);
    await assert.rejects(() => createAuth().setPersonalRecords('user-A', [{ restaurant_key: 'key', patch: { personal_rating: 6 } }]));
  } finally { global.fetch = originalFetch; }
});
