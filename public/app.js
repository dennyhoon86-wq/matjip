const GRADE_COLOR = {
  "A++":"var(--stamp-a-plus-plus)",
  "A+":"var(--stamp-a-plus)",
  "A":"var(--stamp-a)",
  "B":"var(--stamp-b)",
  "C":"var(--stamp-c)",
  "D":"var(--stamp-d)",
  "E":"var(--stamp-e)",
};

const qEl = document.getElementById('q');
const smartHintEl = document.getElementById('smartHint');
const regionEl = document.getElementById('region');
const guEl = document.getElementById('gu');
const catEl = document.getElementById('cat');
const catList = document.getElementById('catList');
const gradeEl = document.getElementById('grade');
const gradeMinEl = document.getElementById('gradeMin');
const badgeEl = document.getElementById('badge');
const sortEl = document.getElementById('sort');
const includeClosedEl = document.getElementById('includeClosed');
const personalFilterEl = document.getElementById('personalFilter');
const excludeNewEl = document.getElementById('excludeNew');

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('emptyState');
const metaEl = document.getElementById('metaCount');
const tallyShownEl = document.getElementById('tallyShown');
const tallyTotalEl = document.getElementById('tallyTotal');
const tallyActiveEl = document.getElementById('tallyActive');
const footTotalEl = document.getElementById('footTotal');
const pagerEl = document.getElementById('pager');
const pageInfoEl = document.getElementById('pageInfo');
const prevBtn = document.getElementById('prevPage');
const nextBtn = document.getElementById('nextPage');
const personalSummaryEl = document.getElementById('personalSummary');
const selectionBarEl = document.getElementById('selectionBar');
const selectionCountEl = document.getElementById('selectionCount');
const copySelectedBtn = document.getElementById('copySelected');
const clearSelectedBtn = document.getElementById('clearSelected');
const openLedgerBtn = document.getElementById('openLedger');
const closeLedgerBtn = document.getElementById('closeLedger');
const ledgerAllBtn = document.getElementById('ledgerAll');
const ledgerDashboardEl = document.getElementById('ledgerDashboard');
const ledgerStatsEl = document.getElementById('ledgerStats');
const ledgerToolsEl = document.getElementById('ledgerTools');
const ledgerMapRecentEl = document.getElementById('ledgerMapRecent');
const ledgerPersonalRecentEl = document.getElementById('ledgerPersonalRecent');
const authGateEl = document.getElementById('authGate');
const authTitleEl = document.getElementById('authTitle');
const authMessageEl = document.getElementById('authMessage');
const googleLoginBtn = document.getElementById('googleLogin');
const signOutBtn = document.getElementById('signOut');
const accountNameEl = document.getElementById('accountName');
const logoutButton = document.getElementById('logoutButton');
const adminButton = document.getElementById('adminButton');
const adminPanel = document.getElementById('adminPanel');
const adminUsersEl = document.getElementById('adminUsers');

let state = { page: 1, pageSize: 30, total: 0 };
const PERSONAL_STORAGE_KEY = 'misik-jangbu-personal-v1';
const PERSONAL_RECORD_STORAGE_KEY = 'misik-jangbu-personal-records-v1';
const PERSONAL_STATES = ['가고싶음', '가봄', '재방문', '별로였음'];
const selectedKeys = new Set();
let personal = {};
let personalRecords = {};
let authConfig = { enabled: false };
let supabaseClient = null;
let currentProfile = null;
let ledgerLoadVersion = 0;
let ledgerPreviousView = null;

function restaurantKey(d) {
  return `${d.name}\u001f${d.address || ''}`;
}

function loadPersonal() {
  try { return JSON.parse(localStorage.getItem(PERSONAL_STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function savePersonal(personal) {
  localStorage.setItem(PERSONAL_STORAGE_KEY, JSON.stringify(personal));
  updatePersonalSummary();
}

function personalStateFor(d) {
  return personal[restaurantKey(d)]?.state || '';
}

function personalRecordFor(d) {
  return personalRecords[restaurantKey(d)] || { mapTarget: false, mapSaved: false, mapSavedAt: '', kakaoTarget: false, kakaoSaved: false, kakaoSavedAt: '', memo: '', personalRating: '' };
}

function loadPersonalRecords() {
  try { return JSON.parse(localStorage.getItem(PERSONAL_RECORD_STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function savePersonalRecords(records) {
  personalRecords = records;
  localStorage.setItem(PERSONAL_RECORD_STORAGE_KEY, JSON.stringify(records));
  updatePersonalSummary();
}

async function setPersonalRecord(d, patch) {
  const key = restaurantKey(d);
  const before = personalRecordFor(d);
  const next = { ...before, ...patch };
  personalRecords[key] = next;
  savePersonalRecords(personalRecords);
  if (!authConfig.enabled) return;
  try {
    await apiFetch('/api/personal-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [{ restaurant_key: key, map_target: next.mapTarget, map_saved: next.mapSaved, map_saved_at: next.mapSavedAt || null, kakao_target: next.kakaoTarget, kakao_saved: next.kakaoSaved, kakao_saved_at: next.kakaoSavedAt || null, memo: next.memo, personal_rating: next.personalRating }] }) });
  } catch (error) {
    personalRecords[key] = before;
    savePersonalRecords(personalRecords);
    throw error;
  }
}

async function setPersonalState(d, nextState) {
  const key = restaurantKey(d);
  const previous = personal[key];
  if (previous?.state === nextState) delete personal[key];
  else personal[key] = { state: nextState, updatedAt: Date.now() };
  savePersonal(personal);
  if (!authConfig.enabled) return;
  try {
    if (previous?.state === nextState) await apiFetch('/api/personal-states', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurant_key: key }) });
    else await apiFetch('/api/personal-states', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: [{ restaurant_key: key, status: nextState }] }) });
  } catch (error) {
    if (previous) personal[key] = previous; else delete personal[key];
    savePersonal(personal);
    throw error;
  }
}

function keysForPersonalState(filter = '') {
  return Object.entries(personal)
    .filter(([, value]) => !filter || value.state === filter)
    .map(([key]) => key);
}

function isLedgerRecord(value) {
  return Boolean(value && (
    value.mapTarget || value.mapSaved || value.kakaoTarget || value.kakaoSaved ||
    value.personalRating !== '' && value.personalRating != null ||
    (value.memo || '').trim()
  ));
}

function keysForLedger() {
  return Array.from(new Set([
    ...Object.keys(personal),
    ...Object.entries(personalRecords).filter(([, value]) => isLedgerRecord(value)).map(([key]) => key),
  ]));
}

function updatePersonalSummary() {
  const entries = Object.values(personal);
  const wanted = entries.filter(x => x.state === '가고싶음').length;
  const mapTargets = Object.values(personalRecords).filter(x => x.mapTarget).length;
  const saved = Object.values(personalRecords).filter(x => x.mapTarget && x.mapSaved).length;
  const pending = mapTargets - saved;
  const kakaoTargets = Object.values(personalRecords).filter(x => x.kakaoTarget).length;
  const kakaoSaved = Object.values(personalRecords).filter(x => x.kakaoTarget && x.kakaoSaved).length;
  personalSummaryEl.textContent = `내 기록 ${entries.length.toLocaleString()}곳 · 가고싶음 ${wanted.toLocaleString()}곳 · 네이버 대기 ${pending.toLocaleString()} / 완료 ${saved.toLocaleString()} · 카카오 대기 ${(kakaoTargets - kakaoSaved).toLocaleString()} / 완료 ${kakaoSaved.toLocaleString()}`;
  renderLedgerStats();
}

function personalStateCount(stateName) {
  return Object.values(personal).filter(value => value.state === stateName).length;
}

function renderLedgerStats() {
  if (!ledgerStatsEl) return;
  const mapTargets = Object.values(personalRecords).filter(value => value.mapTarget).length;
  const mapSaved = Object.values(personalRecords).filter(value => value.mapTarget && value.mapSaved).length;
  const kakaoTargets = Object.values(personalRecords).filter(value => value.kakaoTarget).length;
  const kakaoSaved = Object.values(personalRecords).filter(value => value.kakaoTarget && value.kakaoSaved).length;
  const pending = mapTargets - mapSaved;
  const stat = (label, count, filter, detail) => `
    <button class="ledger-stat" data-ledger-filter="${filter || ''}" ${filter ? '' : 'disabled'}>
      <strong>${count.toLocaleString()}</strong><span>${label}</span>${detail ? `<small>${detail}</small>` : ''}
    </button>`;
  ledgerStatsEl.innerHTML = [
    stat('네이버 저장 대기', pending, '지도 저장 대기', '지금 네이버에 옮길 곳'),
    stat('카카오 저장 대기', kakaoTargets - kakaoSaved, '카카오 저장 대기', '지금 카카오에 옮길 곳'),
    stat('가고싶음', personalStateCount('가고싶음'), '가고싶음', '다음 약속 후보'),
    stat('가봄', personalStateCount('가봄'), '가봄', '방문 기록'),
    stat('재방문', personalStateCount('재방문'), '재방문', '또 갈 곳'),
    stat('별로였음', personalStateCount('별로였음'), '별로였음', '추천에서 제외'),
    stat('네이버 저장 완료', mapSaved, '지도 저장 완료', '네이버에 보관됨'),
    stat('카카오 저장 완료', kakaoSaved, '카카오 저장 완료', '카카오에 보관됨'),
  ].join('');
}

function recentKeys(source, limit = 5) {
  const updatedAt = value => typeof value === 'number' ? value : (Date.parse(value || '') || 0);
  return Object.entries(source)
    .sort((a, b) => updatedAt(b[1].mapSavedAt || b[1].updatedAt) - updatedAt(a[1].mapSavedAt || a[1].updatedAt))
    .slice(0, limit)
    .map(([key]) => key);
}

function renderLedgerMiniList(target, rows, emptyMessage) {
  target.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'ledger-empty';
    empty.textContent = emptyMessage;
    target.appendChild(empty);
    return;
  }
  rows.forEach(d => {
    const row = document.createElement('button');
    row.className = 'ledger-mini-row';
    const stateName = personalStateFor(d);
    const record = personalRecordFor(d);
    const meta = [d.category, d.gu || d.region, d.avg != null ? `평점 ${d.avg.toFixed(2)}` : null].filter(Boolean).join(' · ');
    row.innerHTML = '<span class="ledger-mini-name"></span><span class="ledger-mini-meta"></span>';
    row.querySelector('.ledger-mini-name').textContent = d.name;
    row.querySelector('.ledger-mini-meta').textContent = `${stateName ? stateName + ' · ' : ''}${record.mapSaved ? '지도 저장 완료 · ' : ''}${meta}`;
    row.addEventListener('click', () => {
      qEl.value = d.name;
      personalFilterEl.value = '내 장부 전체';
      triggerSearch();
      window.setTimeout(() => listEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 280);
    });
    target.appendChild(row);
  });
}

async function loadLedgerDashboard() {
  renderLedgerStats();
  const version = ++ledgerLoadVersion;
  ledgerMapRecentEl.innerHTML = '<p class="ledger-empty">최근 저장 완료를 불러오는 중...</p>';
  ledgerPersonalRecentEl.innerHTML = '<p class="ledger-empty">최근 기록을 불러오는 중...</p>';
  const mapKeys = recentKeys(Object.fromEntries(Object.entries(personalRecords).filter(([, value]) => value.mapTarget && value.mapSaved)));
  const personalKeys = recentKeys(personal);
  try {
    const [mapRows, personalRows] = await Promise.all([fetchPersonalRows(mapKeys), fetchPersonalRows(personalKeys)]);
    if (version !== ledgerLoadVersion) return;
    const orderRows = (rows, keys) => {
      const byKey = new Map(rows.map(row => [restaurantKey(row), row]));
      return keys.map(key => byKey.get(key)).filter(Boolean);
    };
    renderLedgerMiniList(ledgerMapRecentEl, orderRows(mapRows, mapKeys), '아직 네이버 저장 완료한 맛집이 없어요.');
    renderLedgerMiniList(ledgerPersonalRecentEl, orderRows(personalRows, personalKeys), '카드에서 가고싶음·가봄 등을 눌러 기록을 시작해보세요.');
  } catch (error) {
    if (version !== ledgerLoadVersion) return;
    renderLedgerMiniList(ledgerMapRecentEl, [], '최근 저장 완료 목록을 불러오지 못했습니다.');
    renderLedgerMiniList(ledgerPersonalRecentEl, [], '최근 개인 기록을 불러오지 못했습니다.');
  }
}

function openLedgerDashboard() {
  if (ledgerDashboardEl.style.display !== 'none') return closeLedgerDashboard();
  ledgerPreviousView = { q: qEl.value, personalFilter: personalFilterEl.value };
  ledgerDashboardEl.style.display = '';
  openLedgerBtn.classList.add('active');
  qEl.value = '';
  personalFilterEl.value = '내 장부 전체';
  triggerSearch();
  loadLedgerDashboard();
}

function closeLedgerDashboard() {
  ledgerDashboardEl.style.display = 'none';
  openLedgerBtn.classList.remove('active');
  if (ledgerPreviousView) {
    qEl.value = ledgerPreviousView.q;
    personalFilterEl.value = ledgerPreviousView.personalFilter;
    ledgerPreviousView = null;
  } else {
    qEl.value = '';
    personalFilterEl.value = '';
  }
  triggerSearch();
}

function updateSelectionBar() {
  const count = selectedKeys.size;
  selectionBarEl.style.display = count ? 'flex' : 'none';
  selectionCountEl.textContent = `${count.toLocaleString()}곳 선택`;
}

function naverSearchUrl(d) {
  return `https://map.naver.com/p/search/${encodeURIComponent(`${d.name} ${d.address || ''}`.trim())}`;
}

function kakaoSearchUrl(d) {
  return `https://map.kakao.com/?q=${encodeURIComponent(`${d.name} ${d.address || ''}`.trim())}`;
}

function copyLine(d) {
  return `${d.name} | ${d.address || '-'} | ${naverSearchUrl(d)}`;
}

function kakaoCopyLine(d) {
  return `${d.name} | ${d.address || '-'} | ${kakaoSearchUrl(d)}`;
}

async function copyText(text, successMessage) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  metaEl.textContent = successMessage;
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (authConfig.enabled && supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  }
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '요청을 처리하지 못했습니다.');
  }
  return response;
}

function showAuthGate(title, message, { login = false, signout = false } = {}) {
  document.body.classList.add('auth-pending');
  authTitleEl.textContent = title;
  authMessageEl.textContent = message;
  googleLoginBtn.style.display = login ? '' : 'none';
  signOutBtn.style.display = signout ? '' : 'none';
}

async function loadSupabaseClient() {
  if (window.supabase) return window.supabase.createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey);
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = resolve; script.onerror = () => reject(new Error('로그인 모듈을 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
  return window.supabase.createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey);
}

async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) showAuthGate('로그인을 시작하지 못했습니다', error.message, { login: true });
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  window.location.reload();
}

async function syncPersonalRecords() {
  const local = loadPersonal();
  const response = await apiFetch('/api/personal-states');
  const remote = await response.json();
  const merged = {};
  (remote.states || []).forEach(s => { merged[s.restaurant_key] = { state: s.status, updatedAt: Date.parse(s.updated_at) || Date.now() }; });
  const missing = Object.entries(local).filter(([key]) => !merged[key]).map(([restaurant_key, value]) => ({ restaurant_key, status: value.state }));
  if (missing.length) await apiFetch('/api/personal-states', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: missing }) });
  Object.assign(merged, local);
  personal = merged;
  savePersonal(personal);

  const localRecords = loadPersonalRecords();
  const recordResponse = await apiFetch('/api/personal-records');
  const remoteRecords = await recordResponse.json();
  const mergedRecords = {};
  (remoteRecords.records || []).forEach(r => { mergedRecords[r.restaurant_key] = { mapTarget: Boolean(r.map_target), mapSaved: Boolean(r.map_saved), mapSavedAt: r.map_saved_at || '', kakaoTarget: Boolean(r.kakao_target), kakaoSaved: Boolean(r.kakao_saved), kakaoSavedAt: r.kakao_saved_at || '', memo: r.memo || '', personalRating: r.personal_rating ?? '' }; });
  const missingRecords = Object.entries(localRecords).filter(([key]) => !mergedRecords[key]).map(([restaurant_key, value]) => ({ restaurant_key, map_target: value.mapTarget, map_saved: value.mapSaved, map_saved_at: value.mapSavedAt || null, kakao_target: value.kakaoTarget || false, kakao_saved: value.kakaoSaved || false, kakao_saved_at: value.kakaoSavedAt || null, memo: value.memo || '', personal_rating: value.personalRating || null }));
  if (missingRecords.length) await apiFetch('/api/personal-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: missingRecords }) });
  Object.entries(localRecords).forEach(([key, value]) => {
    mergedRecords[key] = { ...(mergedRecords[key] || {}), ...value };
  });
  savePersonalRecords(mergedRecords);
}

async function loadAdminUsers() {
  const response = await apiFetch('/api/admin/users');
  const { users } = await response.json();
  adminUsersEl.innerHTML = '';
  if (!users.length) { adminUsersEl.textContent = '승인 요청이 아직 없습니다.'; return; }
  users.forEach(user => {
    const row = document.createElement('div'); row.className = 'admin-user';
    const info = document.createElement('div');
    const name = document.createElement('b'); name.textContent = user.full_name || '(이름 없음)';
    const email = document.createElement('span'); email.textContent = user.email;
    const status = document.createElement('small'); status.textContent = user.role === 'pending' ? '승인 대기' : user.role === 'member' ? '열람 허용' : user.role === 'owner' ? '관리자' : '차단됨';
    info.append(name, email, status); row.appendChild(info);
    if (user.role !== 'owner') {
      const actions = document.createElement('div');
      [['member', '허용', ''], ['blocked', '차단', 'block']].forEach(([role, label, className]) => {
        const button = document.createElement('button'); button.dataset.user = user.id; button.dataset.role = role; button.textContent = label; button.className = className; actions.appendChild(button);
      });
      row.appendChild(actions);
    }
    adminUsersEl.appendChild(row);
  });
}

async function initAuthentication() {
  const response = await fetch('/api/auth/config');
  authConfig = await response.json();
  if (!authConfig.enabled) { document.body.classList.remove('auth-pending'); return true; }
  if (!authConfig.configured) { showAuthGate('로그인 설정 중', '관리자가 로그인 연결을 마무리하고 있습니다. 잠시 후 다시 시도해 주세요.'); return false; }
  try {
    supabaseClient = await loadSupabaseClient();
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) { showAuthGate('미식장부에 들어오려면', 'Google 계정으로 로그인한 뒤 관리자의 열람 승인을 받아야 합니다.', { login: true }); return false; }
    const me = await apiFetch('/api/auth/me');
    const { profile } = await me.json();
    currentProfile = profile;
    if (!profile.allowed) { showAuthGate('열람 승인 대기 중', `${profile.fullName} · ${profile.email} 계정으로 요청되었습니다. 관리자가 승인하면 이용할 수 있습니다.`, { signout: true }); return false; }
    document.body.classList.remove('auth-pending');
    accountNameEl.textContent = profile.fullName;
    logoutButton.style.display = '';
    if (profile.role === 'owner') adminButton.style.display = '';
    await syncPersonalRecords();
    return true;
  } catch (error) { showAuthGate('로그인을 확인하지 못했습니다', error.message, { login: true, signout: true }); return false; }
}

async function fetchPersonalRows(keys) {
  if (!keys.length) return [];
  const res = await apiFetch('/api/personal-list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  });
  if (!res.ok) throw new Error('개인 목록을 불러오지 못했습니다.');
  const data = await res.json();
  return data.rows || [];
}

async function loadMeta() {
  const res = await apiFetch('/api/meta');
  const meta = await res.json();

  meta.regions.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.region; opt.textContent = `${r.region} (${r.c.toLocaleString()})`;
    regionEl.appendChild(opt);
  });

  meta.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.category;
    catList.appendChild(opt);
  });

  meta.grades.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    gradeEl.appendChild(opt);
  });

  meta.badges.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.name; opt.textContent = `${b.name} (${b.c.toLocaleString()})`;
    badgeEl.appendChild(opt);
  });

  tallyTotalEl.textContent = meta.total.toLocaleString();
  tallyActiveEl.textContent = meta.activeTotal.toLocaleString();
  footTotalEl.textContent = meta.total.toLocaleString();
}

async function loadGuOptions(region) {
  const url = region ? `/api/gu?region=${encodeURIComponent(region)}` : '/api/gu';
  const res = await apiFetch(url);
  const rows = await res.json();
  guEl.innerHTML = '<option value="">전체</option>';
  rows.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.gu; opt.textContent = `${r.gu} (${r.c.toLocaleString()})`;
    guEl.appendChild(opt);
  });
}

function ratingLine(d) {
  const parts = [];
  if (d.naver != null) parts.push('네이버 ' + d.naver.toFixed(2));
  if (d.google != null) parts.push('구글 ' + d.google.toFixed(2));
  if (d.daum != null) parts.push('다음 ' + d.daum.toFixed(2));
  return parts.join(' · ') || (d.sources[0] || '-');
}

function badgeClass(name) {
  if (name === '미슐랭') return 'badge-michelin';
  if (name === '블루리본') return 'badge-blueribbon';
  if (name === '신규' || name === '최신') return 'badge-new';
  return 'badge-other';
}

function badgeTags(d) {
  return d.badges.map(b => {
    const stars = b.stars > 0 ? '★'.repeat(b.stars) : '';
    return `<span class="tag badge-tag ${badgeClass(b.name)}">${b.name}${stars}</span>`;
  }).join('');
}

function personalTag(stateName) {
  return stateName ? `<span class="tag personal-tag state-${stateName}">${stateName}</span>` : '';
}

function personalRatingOptions(value) {
  const current = value === '' || value == null ? '' : String(value);
  const options = ['<option value="">내 평점</option>'];
  for (let rating = 0.5; rating <= 5; rating += 0.5) {
    const label = rating.toFixed(1);
    options.push(`<option value="${label}" ${current === label ? 'selected' : ''}>내 평점 ${label}</option>`);
  }
  return options.join('');
}

function renderRows(rows) {
  listEl.innerHTML = '';
  rows.forEach(d => {
    const card = document.createElement('div');
    card.className = 'card' + (d.status === '폐업' ? ' closed' : '');
    const stampClass = d.grade ? '' : ' no-grade';
    const stampBg = d.grade ? `background:${GRADE_COLOR[d.grade]};` : '';
    const stampLabel = d.grade || '무등급';
    const avgHtml = d.avg != null
      ? `${d.avg.toFixed(2)}<span>/5.0</span>`
      : `<span class="none">평점 없음</span>`;
    const addrParts = [d.address, d.subway ? d.subway + '역' : null].filter(Boolean);
    const currentState = personalStateFor(d);
    const record = personalRecordFor(d);
    const key = restaurantKey(d);
    const actions = PERSONAL_STATES.map(stateName => `
      <button class="personal-action ${currentState === stateName ? 'active' : ''}" data-action="personal" data-state="${stateName}">${stateName}</button>
    `).join('');
    card.innerHTML = `
      <div class="stamp${stampClass}" style="${stampBg}">${stampLabel}</div>
      <div class="info">
        <div class="name">${d.name}
          <span class="tag">${d.category || '분류없음'}</span>
          ${d.status === '폐업' ? '<span class="tag closed-tag">폐업</span>' : ''}
          ${badgeTags(d)}
          ${personalTag(currentState)}
          ${record.mapTarget ? '<span class="tag map-target-tag">네이버 저장</span>' : ''}
          ${record.mapTarget && record.mapSaved ? '<span class="tag map-saved-tag">네이버 완료</span>' : ''}
          ${record.kakaoTarget ? '<span class="tag kakao-target-tag">카카오 저장</span>' : ''}
          ${record.kakaoTarget && record.kakaoSaved ? '<span class="tag kakao-saved-tag">카카오 완료</span>' : ''}
        </div>
        <div class="addr">${addrParts.join('<span class="dot">·</span>')}</div>
        <div class="card-actions">
          ${actions}
          <button class="map-action" data-action="copy">복사</button>
          <a class="map-action" href="${naverSearchUrl(d)}" target="_blank" rel="noopener">네이버지도</a>
          <button class="map-action ${record.mapTarget ? 'active' : ''}" data-action="map-target">${record.mapTarget ? '네이버 저장 해제' : '네이버 저장 대상'}</button>
          ${record.mapTarget ? `<button class="map-action ${record.mapSaved ? 'active' : ''}" data-action="map-saved">${record.mapSaved ? '네이버 완료 취소' : '네이버 저장 완료'}</button>` : ''}
          <a class="kakao-action" href="${kakaoSearchUrl(d)}" target="_blank" rel="noopener">카카오맵</a>
          <button class="kakao-action ${record.kakaoTarget ? 'active' : ''}" data-action="kakao-target">${record.kakaoTarget ? '카카오 저장 해제' : '카카오 저장 대상'}</button>
          ${record.kakaoTarget ? `<button class="kakao-action ${record.kakaoSaved ? 'active' : ''}" data-action="kakao-saved">${record.kakaoSaved ? '카카오 완료 취소' : '카카오 저장 완료'}</button>` : ''}
          <select class="personal-rating-select" data-action="rating">${personalRatingOptions(record.personalRating)}</select>
          <label class="select-action"><input type="checkbox" data-action="select" ${selectedKeys.has(key) ? 'checked' : ''}> 선택</label>
        </div>
      </div>
      <div class="ratings">
        <div class="avg">${avgHtml}</div>
        <div class="src">${ratingLine(d)}</div>
      </div>
    `;
    card.__restaurant = d;
    listEl.appendChild(card);
  });
  updateSelectionBar();
}

function buildParams() {
  const p = new URLSearchParams();
  if (qEl.value.trim()) p.set('q', qEl.value.trim());
  if (regionEl.value) p.set('region', regionEl.value);
  if (guEl.value) p.set('gu', guEl.value);
  if (catEl.value.trim()) p.set('category', catEl.value.trim());
  if (gradeEl.value) p.set('grade', gradeEl.value);
  if (gradeMinEl.value) p.set('gradeMin', gradeMinEl.value);
  if (badgeEl.value) p.set('badge', badgeEl.value);
  p.set('sort', sortEl.value);
  p.set('status', includeClosedEl.checked ? '전체' : '영업');
  if (excludeNewEl.checked) p.set('excludeNew', 'true');
  p.set('page', state.page);
  p.set('pageSize', state.pageSize);
  return p;
}

async function search() {
  metaEl.textContent = '검색 중...';
  if (personalFilterEl.value) return searchPersonal();
  const params = buildParams();
  const res = await apiFetch('/api/restaurants?' + params.toString());
  const data = await res.json();
  state.total = data.total;

  if (data.inferred && (data.inferred.gu || data.inferred.dong || data.inferred.station || data.inferred.categoryTerms.length || data.inferred.badge || data.inferred.gradeMin || data.inferred.avgMin != null || data.inferred.avgMax != null || data.inferred.priceMin != null || data.inferred.priceMax != null || data.inferred.excludeNew)) {
    const parts = [];
    if (data.inferred.gu) parts.push(data.inferred.gu);
    if (data.inferred.dong) parts.push(data.inferred.dong);
    if (data.inferred.station) parts.push(data.inferred.station + '역');
    if (data.inferred.categoryTerms.length) parts.push(data.inferred.categoryTerms.join(', '));
    if (data.inferred.badge) parts.push(data.inferred.badge + ' 태그');
    if (data.inferred.gradeMin) parts.push(`${data.inferred.gradeMin} 이상`);
    if (data.inferred.avgMin != null) parts.push(`평점 ${data.inferred.avgMin} 이상`);
    if (data.inferred.avgMax != null) parts.push(`평점 ${data.inferred.avgMax} 이하`);
    if (data.inferred.priceMin != null || data.inferred.priceMax != null) {
      const won = value => `${(value / 10000).toLocaleString()}만원`;
      parts.push(data.inferred.priceMin != null && data.inferred.priceMax != null ? `${won(data.inferred.priceMin)}~${won(data.inferred.priceMax)}` : data.inferred.priceMin != null ? `${won(data.inferred.priceMin)} 이상` : `${won(data.inferred.priceMax)} 이하`);
    }
    if (data.inferred.excludeNew) parts.push('신규 제외');
    smartHintEl.textContent = `🔎 "${parts.join(' · ')}"(으)로 해석해서 검색 중`;
    smartHintEl.style.display = 'block';
  } else {
    smartHintEl.style.display = 'none';
  }

  renderRows(data.rows);
  emptyEl.style.display = data.rows.length ? 'none' : 'block';

  const startIdx = data.rows.length ? (state.page - 1) * state.pageSize + 1 : 0;
  const endIdx = startIdx + data.rows.length - 1;
  metaEl.textContent = data.total.toLocaleString() + '건 중 ' + (data.rows.length ? `${startIdx.toLocaleString()}-${endIdx.toLocaleString()}` : '0') + '건 표시';
  tallyShownEl.textContent = data.total.toLocaleString();

  const totalPages = Math.max(1, Math.ceil(data.total / state.pageSize));
  pagerEl.style.display = data.total > state.pageSize ? 'flex' : 'none';
  pageInfoEl.textContent = `${state.page} / ${totalPages} 페이지`;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = state.page >= totalPages;
}

async function searchPersonal() {
  const filter = personalFilterEl.value;
  const keys = filter === '내 장부 전체'
    ? keysForLedger()
    : ['지도 저장 대상', '지도 저장 대기', '지도 저장 완료'].includes(filter)
    ? Object.entries(personalRecords).filter(([, value]) => value.mapTarget && (filter === '지도 저장 대상' || (filter === '지도 저장 대기' ? !value.mapSaved : value.mapSaved))).map(([key]) => key)
    : ['카카오 저장 대상', '카카오 저장 대기', '카카오 저장 완료'].includes(filter)
      ? Object.entries(personalRecords).filter(([, value]) => value.kakaoTarget && (filter === '카카오 저장 대상' || (filter === '카카오 저장 대기' ? !value.kakaoSaved : value.kakaoSaved))).map(([key]) => key)
    : keysForPersonalState(filter);
  const rows = filterPersonalRows(await fetchPersonalRows(keys));
  state.total = rows.length;
  const startIdx = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(startIdx, startIdx + state.pageSize);
  renderRows(pageRows);
  emptyEl.style.display = pageRows.length ? 'none' : 'block';
  const shownStart = pageRows.length ? startIdx + 1 : 0;
  const shownEnd = startIdx + pageRows.length;
  const filterLabel = filter === '내 장부 전체' ? '내 장부' : `내 ${filter}`;
  metaEl.textContent = `${filterLabel} ${rows.length.toLocaleString()}건 중 ${pageRows.length ? `${shownStart.toLocaleString()}-${shownEnd.toLocaleString()}` : '0'}건 표시`;
  tallyShownEl.textContent = rows.length.toLocaleString();
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  pagerEl.style.display = rows.length > state.pageSize ? 'flex' : 'none';
  pageInfoEl.textContent = `${state.page} / ${totalPages} 페이지`;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = state.page >= totalPages;
}

function filterPersonalRows(rows) {
  const gradeOrder = ['A++', 'A+', 'A', 'B', 'C', 'D', 'E'];
  const q = qEl.value.trim().toLowerCase();
  return rows.filter(d => {
    const haystack = `${d.name || ''} ${d.category || ''} ${d.address || ''}`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (regionEl.value && d.region !== regionEl.value) return false;
    if (guEl.value && d.gu !== guEl.value) return false;
    if (catEl.value.trim() && d.category !== catEl.value.trim()) return false;
    if (gradeEl.value && d.grade !== gradeEl.value) return false;
    if (gradeMinEl.value && (!d.grade || gradeOrder.indexOf(d.grade) > gradeOrder.indexOf(gradeMinEl.value))) return false;
    if (badgeEl.value && !(d.badges || []).some(b => b.name === badgeEl.value)) return false;
    if (excludeNewEl.checked && (d.badges || []).some(b => b.name === '신규')) return false;
    if (!includeClosedEl.checked && d.status !== '영업') return false;
    return true;
  });
}

let debounceTimer;
function triggerSearch(resetPage = true) {
  if (resetPage) state.page = 1;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(search, 250);
}

qEl.addEventListener('input', () => triggerSearch());
catEl.addEventListener('input', () => triggerSearch());
gradeEl.addEventListener('change', () => triggerSearch());
gradeMinEl.addEventListener('change', () => triggerSearch());
badgeEl.addEventListener('change', () => triggerSearch());
sortEl.addEventListener('change', () => triggerSearch());
includeClosedEl.addEventListener('change', () => triggerSearch());
excludeNewEl.addEventListener('change', () => triggerSearch());
personalFilterEl.addEventListener('change', () => {
  // 장부를 연 상태에서는 일반 전체 검색으로 빠지지 않게 한다.
  if (ledgerDashboardEl.style.display !== 'none' && !personalFilterEl.value) {
    personalFilterEl.value = '내 장부 전체';
  }
  triggerSearch();
});
regionEl.addEventListener('change', () => {
  loadGuOptions(regionEl.value);
  guEl.value = '';
  triggerSearch();
});
guEl.addEventListener('change', () => triggerSearch());

prevBtn.addEventListener('click', () => {
  if (state.page > 1) { state.page--; search(); window.scrollTo({top:0, behavior:'smooth'}); }
});
nextBtn.addEventListener('click', () => {
  state.page++; search(); window.scrollTo({top:0, behavior:'smooth'});
});

listEl.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.dataset.action === 'select') return;
  const card = button.closest('.card');
  const d = card?.__restaurant;
  if (!d) return;
  if (button.dataset.action === 'personal') {
    try {
      await setPersonalState(d, button.dataset.state);
      const savedState = personalStateFor(d);
      if (savedState) {
        // 개인 상태를 찍은 직후에는 해당 개인 목록으로 전환한다.
        // 같은 상호의 다른 지점이 일반 검색 결과에 남아 혼동되는 것을 막는다.
        personalFilterEl.value = savedState;
        triggerSearch();
      } else if (personalFilterEl.value) {
        triggerSearch(false);
      } else {
        renderRows(Array.from(listEl.children).map(el => el.__restaurant).filter(Boolean));
      }
    } catch (error) { metaEl.textContent = error.message; }
  }
  if (button.dataset.action === 'map-target') {
    try {
      const nextTarget = !personalRecordFor(d).mapTarget;
      await setPersonalRecord(d, { mapTarget: nextTarget, mapSaved: nextTarget ? personalRecordFor(d).mapSaved : false, mapSavedAt: nextTarget ? personalRecordFor(d).mapSavedAt : '' });
      if ((['지도 저장 대상', '지도 저장 대기', '지도 저장 완료'].includes(personalFilterEl.value) || personalFilterEl.value === '내 장부 전체') && !personalRecordFor(d).mapTarget) triggerSearch(false);
      else renderRows(Array.from(listEl.children).map(el => el.__restaurant).filter(Boolean));
    } catch (error) { metaEl.textContent = error.message; }
  }
  if (button.dataset.action === 'map-saved') {
    try {
      const nextSaved = !personalRecordFor(d).mapSaved;
      await setPersonalRecord(d, { mapSaved: nextSaved, mapSavedAt: nextSaved ? new Date().toISOString() : '' });
      if ((personalFilterEl.value === '지도 저장 대기' && nextSaved) || (personalFilterEl.value === '지도 저장 완료' && !nextSaved)) triggerSearch(false);
      else renderRows(Array.from(listEl.children).map(el => el.__restaurant).filter(Boolean));
    } catch (error) { metaEl.textContent = error.message; }
  }
  if (button.dataset.action === 'kakao-target') {
    try {
      const nextTarget = !personalRecordFor(d).kakaoTarget;
      await setPersonalRecord(d, { kakaoTarget: nextTarget, kakaoSaved: nextTarget ? personalRecordFor(d).kakaoSaved : false, kakaoSavedAt: nextTarget ? personalRecordFor(d).kakaoSavedAt : '' });
      if ((['카카오 저장 대상', '카카오 저장 대기', '카카오 저장 완료'].includes(personalFilterEl.value) || personalFilterEl.value === '내 장부 전체') && !personalRecordFor(d).kakaoTarget) triggerSearch(false);
      else renderRows(Array.from(listEl.children).map(el => el.__restaurant).filter(Boolean));
    } catch (error) { metaEl.textContent = error.message; }
  }
  if (button.dataset.action === 'kakao-saved') {
    try {
      const nextSaved = !personalRecordFor(d).kakaoSaved;
      await setPersonalRecord(d, { kakaoSaved: nextSaved, kakaoSavedAt: nextSaved ? new Date().toISOString() : '' });
      if ((personalFilterEl.value === '카카오 저장 대기' && nextSaved) || (personalFilterEl.value === '카카오 저장 완료' && !nextSaved)) triggerSearch(false);
      else renderRows(Array.from(listEl.children).map(el => el.__restaurant).filter(Boolean));
    } catch (error) { metaEl.textContent = error.message; }
  }
  if (button.dataset.action === 'copy') await copyText(copyLine(d), `${d.name} 네이버지도용 정보 복사됨`);
});

listEl.addEventListener('change', (event) => {
  if (event.target.dataset.action === 'rating') {
    const d = event.target.closest('.card')?.__restaurant;
    if (!d) return;
    setPersonalRecord(d, { personalRating: event.target.value === '' ? '' : Number(event.target.value) })
      .then(() => { metaEl.textContent = `${d.name}의 내 평점을 저장했습니다.`; })
      .catch(error => { metaEl.textContent = error.message; });
    return;
  }
  if (event.target.dataset.action !== 'select') return;
  const d = event.target.closest('.card')?.__restaurant;
  if (!d) return;
  const key = restaurantKey(d);
  if (event.target.checked) selectedKeys.add(key);
  else selectedKeys.delete(key);
  updateSelectionBar();
});

copySelectedBtn.addEventListener('click', async () => {
  const rows = await fetchPersonalRows(Array.from(selectedKeys));
  await copyText(rows.map(copyLine).join('\n'), `${rows.length.toLocaleString()}곳 네이버지도용 정보 복사됨`);
});

clearSelectedBtn.addEventListener('click', () => {
  selectedKeys.clear();
  renderRows(Array.from(listEl.children).map(el => el.__restaurant).filter(Boolean));
});

openLedgerBtn.addEventListener('click', openLedgerDashboard);
closeLedgerBtn.addEventListener('click', closeLedgerDashboard);
ledgerAllBtn.addEventListener('click', () => {
  qEl.value = '';
  personalFilterEl.value = '내 장부 전체';
  triggerSearch();
  window.setTimeout(() => listEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 280);
});
ledgerStatsEl.addEventListener('click', event => {
  const button = event.target.closest('[data-ledger-filter]');
  if (!button?.dataset.ledgerFilter) return;
  personalFilterEl.value = button.dataset.ledgerFilter;
  triggerSearch();
  window.setTimeout(() => listEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 280);
});
ledgerToolsEl.addEventListener('click', async event => {
  const button = event.target.closest('[data-ledger-copy]');
  if (!button) return;
  const kind = button.dataset.ledgerCopy;
  const isKakao = kind === 'kakao';
  const keys = kind === 'want'
    ? keysForPersonalState('가고싶음')
    : Object.entries(personalRecords)
      .filter(([, value]) => isKakao ? value.kakaoTarget && !value.kakaoSaved : value.mapTarget && !value.mapSaved)
      .map(([key]) => key);
  const rows = await fetchPersonalRows(keys);
  const label = kind === 'want' ? '가고싶음' : isKakao ? '카카오 저장 대기' : '네이버 저장 대기';
  await copyText(rows.map(isKakao ? kakaoCopyLine : copyLine).join('\n'), `${label} ${rows.length.toLocaleString()}곳 정보 복사됨`);
});

const rubricToggle = document.getElementById('rubricToggle');
const rubricPanel = document.getElementById('rubricPanel');
rubricToggle.addEventListener('click', () => {
  const open = rubricPanel.classList.toggle('open');
  rubricToggle.textContent = open ? '등급 기준 닫기 ▴' : '등급 기준 보기 ▾';
});

googleLoginBtn.addEventListener('click', signInWithGoogle);
signOutBtn.addEventListener('click', signOut);
logoutButton.addEventListener('click', signOut);
adminButton.addEventListener('click', async () => {
  const opening = adminPanel.style.display === 'none';
  adminPanel.style.display = opening ? '' : 'none';
  if (opening) await loadAdminUsers();
});
adminUsersEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-user]');
  if (!button) return;
  await apiFetch(`/api/admin/users/${encodeURIComponent(button.dataset.user)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: button.dataset.role }) });
  await loadAdminUsers();
});

(async function init() {
  if (!(await initAuthentication())) return;
  personal = loadPersonal();
  personalRecords = loadPersonalRecords();
  await loadMeta();
  await loadGuOptions('');
  updatePersonalSummary();
  await search();
})();
