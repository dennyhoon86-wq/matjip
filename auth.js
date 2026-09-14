const VALID_STATES = new Set(['가고싶음', '가봄', '재방문', '별로였음']);

function createAuth() {
  const required = process.env.AUTH_REQUIRED === 'true';
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const ownerEmail = (process.env.OWNER_EMAIL || 'dennyhoon86@gmail.com').trim().toLowerCase();
  const configured = Boolean(url && anonKey && serviceKey);

  function config() {
    return { enabled: required, configured, supabaseUrl: required && configured ? url : '', supabaseAnonKey: required && configured ? anonKey : '' };
  }

  async function supabase(path, options = {}, service = true) {
    const response = await fetch(`${url}${path}`, {
      ...options,
      headers: {
        apikey: service ? serviceKey : anonKey,
        Authorization: `Bearer ${service ? serviceKey : anonKey}`,
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase ${response.status}: ${detail}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function identityFromRequest(req) {
    if (!required) return { id: 'local', email: 'local@browser', fullName: '로컬 사용자', role: 'member', allowed: true };
    if (!configured) {
      const err = new Error('로그인 설정이 아직 완료되지 않았습니다.');
      err.status = 503;
      throw err;
    }
    const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) { const err = new Error('로그인이 필요합니다.'); err.status = 401; throw err; }
    const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!response.ok) { const err = new Error('로그인 정보가 만료되었습니다.'); err.status = 401; throw err; }
    const user = await response.json();
    const email = String(user.email || '').trim().toLowerCase();
    const fullName = String(user.user_metadata?.full_name || user.user_metadata?.name || '').trim() || email;
    const existing = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,full_name,role`);
    let profile = existing[0];
    if (!profile) {
      const role = email === ownerEmail ? 'owner' : 'pending';
      const created = await supabase('/rest/v1/profiles?on_conflict=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ id: user.id, email, full_name: fullName, role }),
      });
      profile = created[0];
    } else if (email === ownerEmail && profile.role !== 'owner') {
      const updated = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ email, full_name: fullName, role: 'owner' }),
      });
      profile = updated[0];
    }
    return { id: user.id, email, fullName, role: profile.role, allowed: profile.role === 'owner' || profile.role === 'member' };
  }

  async function requireApproved(req, res, next) {
    try {
      const identity = await identityFromRequest(req);
      if (!identity.allowed) return res.status(403).json({ error: '승인 대기 중입니다.', profile: identity });
      req.identity = identity;
      next();
    } catch (error) { res.status(error.status || 500).json({ error: error.message || '인증 처리에 실패했습니다.' }); }
  }

  async function requireOwner(req, res, next) {
    try {
      const identity = await identityFromRequest(req);
      if (identity.role !== 'owner') return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
      req.identity = identity;
      next();
    } catch (error) { res.status(error.status || 500).json({ error: error.message || '인증 처리에 실패했습니다.' }); }
  }

  async function personalStates(userId) {
    return supabase(`/rest/v1/personal_states?user_id=eq.${encodeURIComponent(userId)}&select=restaurant_key,status,updated_at`);
  }

  async function setPersonalStates(userId, states) {
    const rows = states.filter(s => typeof s?.restaurant_key === 'string' && s.restaurant_key.length <= 1000 && VALID_STATES.has(s.status))
      .slice(0, 10000).map(s => ({ user_id: userId, restaurant_key: s.restaurant_key, status: s.status }));
    if (!rows.length) return [];
    return supabase('/rest/v1/personal_states?on_conflict=user_id,restaurant_key', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows),
    });
  }

  async function deletePersonalState(userId, restaurantKey) {
    return supabase(`/rest/v1/personal_states?user_id=eq.${encodeURIComponent(userId)}&restaurant_key=eq.${encodeURIComponent(restaurantKey)}`, { method: 'DELETE' });
  }

  async function personalRecords(userId) {
    return supabase(`/rest/v1/personal_records?user_id=eq.${encodeURIComponent(userId)}&select=restaurant_key,map_target,memo,personal_rating,updated_at`);
  }

  async function setPersonalRecords(userId, records) {
    const rows = records.filter(r => typeof r?.restaurant_key === 'string' && r.restaurant_key.length <= 1000)
      .slice(0, 10000).map(r => ({
        user_id: userId,
        restaurant_key: r.restaurant_key,
        map_target: Boolean(r.map_target),
        memo: String(r.memo || '').slice(0, 2000),
        personal_rating: r.personal_rating == null || r.personal_rating === '' ? null : Number(r.personal_rating),
      })).filter(r => r.personal_rating == null || (Number.isFinite(r.personal_rating) && r.personal_rating >= 0 && r.personal_rating <= 5));
    if (!rows.length) return [];
    return supabase('/rest/v1/personal_records?on_conflict=user_id,restaurant_key', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows),
    });
  }

  return { config, required, identityFromRequest, requireApproved, requireOwner, personalStates, setPersonalStates, deletePersonalState, personalRecords, setPersonalRecords, supabase };
}

module.exports = { createAuth };
