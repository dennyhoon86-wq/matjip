const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuth } = require('../auth');

test('approved identity is reused briefly, and an admin role change invalidates it', async () => {
  const previous = {
    AUTH_REQUIRED: process.env.AUTH_REQUIRED,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = global.fetch;
  Object.assign(process.env, {
    AUTH_REQUIRED: 'true', SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  });
  let calls = 0;
  let role = 'member';
  global.fetch = async url => {
    calls++;
    if (String(url).endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'member-1', email: 'member@example.com' }) };
    if (String(url).includes('/rest/v1/profiles?')) return { ok: true, json: async () => [{ id: 'member-1', role }] };
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
    const req = { headers: { authorization: `Bearer ${token}` } };
    const auth = createAuth();
    const [first, second] = await Promise.all([auth.identityFromRequest(req), auth.identityFromRequest(req)]);
    assert.equal(first.role, 'member');
    assert.equal(second.role, 'member');
    assert.equal(calls, 2);
    assert.equal((await auth.identityFromRequest(req)).role, 'member');
    assert.equal(calls, 2);
    role = 'blocked';
    auth.invalidateIdentity('member-1');
    assert.equal((await auth.identityFromRequest(req)).allowed, false);
    assert.equal(calls, 4);
    await auth.identityFromRequest(req);
    assert.equal(calls, 6, 'blocked users must not be cached');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
