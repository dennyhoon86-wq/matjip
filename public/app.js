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
const badgeEl = document.getElementById('badge');
const sortEl = document.getElementById('sort');
const includeClosedEl = document.getElementById('includeClosed');
const personalFilterEl = document.getElementById('personalFilter');

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
const copyWantBtn = document.getElementById('copyWant');
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
const PERSONAL_STATES = ['가고싶음', '가봄', '재방문', '별로였음'];
const selectedKeys = new Set();
let personal = {};
let authConfig = { enabled: false };
let supabaseClient = null;
let currentProfile = null;

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

function updatePersonalSummary() {
  const entries = Object.values(personal);
  const wanted = entries.filter(x => x.state === '가고싶음').length;
  personalSummaryEl.textContent = `내 기록 ${entries.length.toLocaleString()}곳 · 가고싶음 ${wanted.toLocaleString()}곳`;
}

function updateSelectionBar() {
  const count = selectedKeys.size;
  selectionBarEl.style.display = count ? 'flex' : 'none';
  selectionCountEl.textContent = `${count.toLocaleString()}곳 선택`;
}

function naverSearchUrl(d) {
  return `https://map.naver.com/p/search/${encodeURIComponent(`${d.name} ${d.address || ''}`.trim())}`;
}

function copyLine(d) {
  return `${d.name} | ${d.address || '-'} | ${naverSearchUrl(d)}`;
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
        </div>
        <div class="addr">${addrParts.join('<span class="dot">·</span>')}</div>
        <div class="card-actions">
          ${actions}
          <button class="map-action" data-action="copy">복사</button>
          <a class="map-action" href="${naverSearchUrl(d)}" target="_blank" rel="noopener">네이버지도</a>
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
  if (badgeEl.value) p.set('badge', badgeEl.value);
  p.set('sort', sortEl.value);
  p.set('status', includeClosedEl.checked ? '전체' : '영업');
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

  if (data.inferred && (data.inferred.gu || data.inferred.dong || data.inferred.station || data.inferred.categoryTerms.length || data.inferred.badge)) {
    const parts = [];
    if (data.inferred.gu) parts.push(data.inferred.gu);
    if (data.inferred.dong) parts.push(data.inferred.dong);
    if (data.inferred.station) parts.push(data.inferred.station + '역');
    if (data.inferred.categoryTerms.length) parts.push(data.inferred.categoryTerms.join(', '));
    if (data.inferred.badge) parts.push(data.inferred.badge + ' 태그');
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
  const keys = keysForPersonalState(filter);
  const rows = await fetchPersonalRows(keys);
  state.total = rows.length;
  const startIdx = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(startIdx, startIdx + state.pageSize);
  renderRows(pageRows);
  emptyEl.style.display = pageRows.length ? 'none' : 'block';
  const shownStart = pageRows.length ? startIdx + 1 : 0;
  const shownEnd = startIdx + pageRows.length;
  metaEl.textContent = `내 ${filter} ${rows.length.toLocaleString()}건 중 ${pageRows.length ? `${shownStart.toLocaleString()}-${shownEnd.toLocaleString()}` : '0'}건 표시`;
  tallyShownEl.textContent = rows.length.toLocaleString();
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  pagerEl.style.display = rows.length > state.pageSize ? 'flex' : 'none';
  pageInfoEl.textContent = `${state.page} / ${totalPages} 페이지`;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = state.page >= totalPages;
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
badgeEl.addEventListener('change', () => triggerSearch());
sortEl.addEventListener('change', () => triggerSearch());
includeClosedEl.addEventListener('change', () => triggerSearch());
personalFilterEl.addEventListener('change', () => triggerSearch());
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
      if (personalFilterEl.value && personalFilterEl.value !== personalStateFor(d)) triggerSearch(false);
      else renderRows(Array.from(listEl.children).map(el => el.__restaurant).filter(Boolean));
    } catch (error) { metaEl.textContent = error.message; }
  }
  if (button.dataset.action === 'copy') await copyText(copyLine(d), `${d.name} 네이버지도용 정보 복사됨`);
});

listEl.addEventListener('change', (event) => {
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

copyWantBtn.addEventListener('click', async () => {
  const rows = await fetchPersonalRows(keysForPersonalState('가고싶음'));
  await copyText(rows.map(copyLine).join('\n'), `가고싶음 ${rows.length.toLocaleString()}곳 네이버지도용 정보 복사됨`);
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
  await loadMeta();
  await loadGuOptions('');
  updatePersonalSummary();
  await search();
})();
