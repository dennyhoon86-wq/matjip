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
const PERSONAL_STATES = ['가고싶음', '가봄', '별로였음'];
let personal = {};
let personalRecords = {};
let authConfig = { enabled: false };
let supabaseClient = null;
let currentProfile = null;
let ledgerLoadVersion = 0;
let ledgerPreviousView = null;
let searchVocabulary = {};
let searchVersion = 0;
let toastTimer;
let recordVersion = 0;
let guLoadVersion = 0;
const pendingWrites = new Set();
const expandedRecords = new Set();
const mapDialog = document.getElementById('mapTransferDialog');
let mapTransfer = null;
document.getElementById('advancedFilters').open = window.matchMedia('(min-width:641px)').matches;
document.getElementById('resetFilters').addEventListener('click', () => { clearView(ledgerDashboardEl.style.display !== 'none'); triggerSearch(); });
document.getElementById('retrySearch').addEventListener('click', () => search());
document.getElementById('emptyReset').addEventListener('click', () => { clearView(ledgerDashboardEl.style.display !== 'none'); triggerSearch(); });
document.getElementById('emptyBrowse').addEventListener('click', closeLedgerDashboard);
document.getElementById('widenLocation').addEventListener('click', () => {
  qEl.value = RestaurantSearch.withoutLocation(qEl.value, searchVocabulary);
  regionEl.value = ''; guEl.value = '';
  loadGuOptions('').catch(error => showToast(error.message, true));
  triggerSearch(); showToast('지역 조건만 해제했어요. 나머지 조건은 유지됩니다.');
});

const filterControls = { q: qEl, region: regionEl, gu: guEl, category: catEl, grade: gradeEl, gradeMin: gradeMinEl, badge: badgeEl, personal: personalFilterEl, excludeNew: excludeNewEl, includeClosed: includeClosedEl };
document.getElementById('activeFilters').addEventListener('click', event => {
  const key = event.target.closest('[data-remove-filter]')?.dataset.removeFilter;
  if (!key || !filterControls[key]) return;
  const control = filterControls[key];
  if (control.type === 'checkbox') control.checked = false;
  else control.value = key === 'personal' && ledgerDashboardEl.style.display !== 'none' ? '내 장부 전체' : '';
  if (key === 'region') { guEl.value = ''; loadGuOptions('').catch(error => showToast(error.message, true)); }
  triggerSearch();
});

function storageKey(base) { return authConfig.enabled ? `${base}:${currentProfile?.id || 'signed-out'}` : `${base}:local`; }
function showToast(message, error = false) {
  const toast = document.getElementById('saveFeedback');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 6000 : 3000);
}

async function writeForRestaurant(d, operation) {
  const key = restaurantKey(d);
  if (pendingWrites.has(key)) return;
  recordVersion++;
  pendingWrites.add(key);
  if (mapDialog.open && mapTransfer && restaurantKey(mapTransfer.restaurant) === key) renderMapTransfer();
  const card = Array.from(listEl.children).find(el => restaurantKey(el.__restaurant) === key);
  card?.querySelectorAll('button,select,input').forEach(el => { el.disabled = true; });
  try { await operation(); showToast(`${d.name} · 저장됨`); }
  catch (error) { refreshAfterRecord(); showToast(error.message || '저장하지 못했습니다. 다시 시도해 주세요.', true); }
  finally {
    pendingWrites.delete(key);
    Array.from(listEl.children).find(el => restaurantKey(el.__restaurant) === key)?.querySelectorAll('button,select,input').forEach(el => { el.disabled = false; });
    if (ledgerDashboardEl.style.display !== 'none') loadLedgerDashboard();
    if (mapTransfer && restaurantKey(mapTransfer.restaurant) === key && mapDialog.open) renderMapTransfer();
  }
}

function restaurantKey(d) {
  return `${d.name}\u001f${d.address || ''}`;
}

function loadPersonal() {
  try { return JSON.parse(localStorage.getItem(storageKey(PERSONAL_STORAGE_KEY)) || '{}'); }
  catch { return {}; }
}

function savePersonal(personal) {
  localStorage.setItem(storageKey(PERSONAL_STORAGE_KEY), JSON.stringify(personal));
  updatePersonalSummary();
}

function personalStateFor(d) {
  return personal[restaurantKey(d)]?.state || '';
}

function personalRecordFor(d) {
  return personalRecords[restaurantKey(d)] || { mapTarget: false, mapSaved: false, mapSavedAt: '', kakaoTarget: false, kakaoSaved: false, kakaoSavedAt: '', memo: '', personalRating: '', visitedAt: '' };
}

function loadPersonalRecords() {
  try { return JSON.parse(localStorage.getItem(storageKey(PERSONAL_RECORD_STORAGE_KEY)) || '{}'); }
  catch { return {}; }
}

function savePersonalRecords(records) {
  personalRecords = records;
  localStorage.setItem(storageKey(PERSONAL_RECORD_STORAGE_KEY), JSON.stringify(records));
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
    const fields = { mapTarget: 'map_target', mapSaved: 'map_saved', mapSavedAt: 'map_saved_at', kakaoTarget: 'kakao_target', kakaoSaved: 'kakao_saved', kakaoSavedAt: 'kakao_saved_at', personalRating: 'personal_rating', visitedAt: 'visited_at' };
    const remotePatch = Object.fromEntries(Object.entries(patch).filter(([field]) => fields[field]).map(([field, value]) => [fields[field], value === '' ? null : value]));
    const response = await apiFetch('/api/personal-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [{ restaurant_key: key, patch: remotePatch }] }) });
    const saved = await response.json();
    if (saved.records?.[0]) { personalRecords[key] = recordFromRemote(saved.records[0]); savePersonalRecords(personalRecords); }
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
    value.visitedAt ||
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
  const mapPending = Object.values(personalRecords).filter(value => (value.mapTarget && !value.mapSaved) || (value.kakaoTarget && !value.kakaoSaved)).length;
  const mapComplete = Object.values(personalRecords).filter(value => (value.mapTarget && value.mapSaved) || (value.kakaoTarget && value.kakaoSaved)).length;
  personalSummaryEl.textContent = `내 장부 ${keysForLedger().length.toLocaleString()}곳 · 가고싶음 ${wanted.toLocaleString()}곳 · 지도 대기 ${mapPending.toLocaleString()} / 완료 ${mapComplete.toLocaleString()}`;
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
  const pending = Object.values(personalRecords).filter(value => (value.mapTarget && !value.mapSaved) || (value.kakaoTarget && !value.kakaoSaved)).length;
  const completed = Object.values(personalRecords).filter(value => (value.mapTarget && value.mapSaved) || (value.kakaoTarget && value.kakaoSaved)).length;
  const stat = (label, count, filter, detail) => `
    <button class="ledger-stat" data-ledger-filter="${filter || ''}" ${filter ? '' : 'disabled'}>
      <strong>${count.toLocaleString()}</strong><span>${label}</span>${detail ? `<small>${detail}</small>` : ''}
    </button>`;
  ledgerStatsEl.innerHTML = [
    stat('저장 대기', pending, '저장 대기', '네이버·카카오에 옮길 곳'),
    stat('가고싶음', personalStateCount('가고싶음'), '가고싶음', '다음 약속 후보'),
    stat('가봄', personalStateCount('가봄'), '가봄', '방문 기록'),
    stat('별로였음', personalStateCount('별로였음'), '별로였음', '추천에서 제외'),
    stat('저장 완료', completed, '저장 완료', '지도에 보관됨'),
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
    const savedMaps = [record.mapTarget && record.mapSaved ? '네이버 완료' : '', record.kakaoTarget && record.kakaoSaved ? '카카오 완료' : ''].filter(Boolean).join(' · ');
    row.querySelector('.ledger-mini-meta').textContent = `${stateName ? stateName + ' · ' : ''}${savedMaps ? savedMaps + ' · ' : ''}${meta}`;
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
  const mapKeys = recentKeys(Object.fromEntries(Object.entries(personalRecords).filter(([, value]) => (value.mapTarget && value.mapSaved) || (value.kakaoTarget && value.kakaoSaved))));
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

function captureView() {
  return { q: qEl.value, region: regionEl.value, gu: guEl.value, category: catEl.value, grade: gradeEl.value, gradeMin: gradeMinEl.value, badge: badgeEl.value, sort: sortEl.value, personalFilter: personalFilterEl.value, excludeNew: excludeNewEl.checked, includeClosed: includeClosedEl.checked };
}

function clearView(ledger = false) {
  qEl.value = ''; regionEl.value = ''; guEl.value = ''; catEl.value = '';
  gradeEl.value = ''; gradeMinEl.value = ''; badgeEl.value = ''; sortEl.value = 'avg_desc';
  excludeNewEl.checked = false; includeClosedEl.checked = ledger;
  personalFilterEl.value = ledger ? '내 장부 전체' : '';
  loadGuOptions('').catch(error => showToast(error.message, true));
}

async function openLedgerDashboard() {
  if (ledgerDashboardEl.style.display !== 'none') return closeLedgerDashboard();
  ledgerPreviousView = captureView();
  ledgerDashboardEl.style.display = '';
  openLedgerBtn.classList.add('active');
  clearView(true);
  triggerSearch();
  loadLedgerDashboard();
}

async function closeLedgerDashboard() {
  ledgerDashboardEl.style.display = 'none';
  openLedgerBtn.classList.remove('active');
  if (ledgerPreviousView) {
    qEl.value = ledgerPreviousView.q;
    personalFilterEl.value = ledgerPreviousView.personalFilter;
    regionEl.value = ledgerPreviousView.region;
    await loadGuOptions(ledgerPreviousView.region);
    guEl.value = ledgerPreviousView.gu; catEl.value = ledgerPreviousView.category;
    gradeEl.value = ledgerPreviousView.grade; gradeMinEl.value = ledgerPreviousView.gradeMin;
    badgeEl.value = ledgerPreviousView.badge; sortEl.value = ledgerPreviousView.sort;
    excludeNewEl.checked = ledgerPreviousView.excludeNew; includeClosedEl.checked = ledgerPreviousView.includeClosed;
    ledgerPreviousView = null;
  } else {
    qEl.value = '';
    personalFilterEl.value = '';
  }
  triggerSearch();
}

function naverSearchUrl(d) {
  return `https://map.naver.com/p/search/${encodeURIComponent(`${d.name} ${d.address || ''}`.trim())}`;
}

function kakaoSearchUrl(d) {
  return `https://map.kakao.com/?q=${encodeURIComponent(`${d.name} ${d.address || ''}`.trim())}`;
}

function openMapTransfer(d) {
  mapTransfer = { restaurant: d, provider: 'naver' };
  renderMapTransfer();
  if (!mapDialog.open) mapDialog.showModal();
}

function renderMapTransfer() {
  if (!mapTransfer) return;
  const { restaurant: d, provider } = mapTransfer;
  const record = personalRecordFor(d), naver = provider === 'naver';
  const target = naver ? record.mapTarget : record.kakaoTarget;
  const saved = naver ? record.mapSaved : record.kakaoSaved;
  const name = naver ? '네이버' : '카카오';
  document.getElementById('mapRestaurantName').textContent = d.name;
  document.getElementById('mapRestaurantAddress').textContent = d.address || '주소 정보 없음';
  document.getElementById('mapTransferStatus').textContent = `${name} · ${saved ? '저장 완료로 표시됨' : target ? '저장 대기' : '아직 저장 후보가 아니에요'}`;
  const link = document.getElementById('mapSearchLink');
  link.href = naver ? naverSearchUrl(d) : kakaoSearchUrl(d);
  link.textContent = naver ? '네이버지도에서 검색' : '카카오맵에서 검색';
  document.getElementById('mapCandidate').hidden = Boolean(target || saved);
  document.getElementById('mapComplete').textContent = saved ? '완료 표시 취소' : '저장 완료로 표시';
  document.getElementById('mapRemove').hidden = !target && !saved;
  mapDialog.querySelectorAll('[data-map-provider]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mapProvider === provider)));
  const busy = pendingWrites.has(restaurantKey(d));
  mapDialog.querySelectorAll('button:not(#closeMapTransfer)').forEach(button => { button.disabled = busy; });
  link.setAttribute('aria-disabled', String(busy));
}

async function updateMapTransfer(action) {
  if (!mapTransfer) return;
  const { restaurant: d, provider } = mapTransfer;
  await writeForRestaurant(d, async () => {
    const record = personalRecordFor(d), naver = provider === 'naver';
    const saved = naver ? record.mapSaved : record.kakaoSaved;
    let patch;
    if (action === 'remove') patch = naver ? { mapTarget: false, mapSaved: false, mapSavedAt: '' } : { kakaoTarget: false, kakaoSaved: false, kakaoSavedAt: '' };
    else if (action === 'complete') patch = naver ? { mapTarget: true, mapSaved: !saved, mapSavedAt: !saved ? new Date().toISOString() : '' } : { kakaoTarget: true, kakaoSaved: !saved, kakaoSavedAt: !saved ? new Date().toISOString() : '' };
    else patch = naver ? { mapTarget: true } : { kakaoTarget: true };
    await setPersonalRecord(d, patch); refreshAfterRecord();
  });
}

document.getElementById('closeMapTransfer').addEventListener('click', () => mapDialog.close());
mapDialog.addEventListener('close', () => { mapTransfer = null; });
mapDialog.querySelectorAll('[data-map-provider]').forEach(button => button.addEventListener('click', () => {
  mapTransfer.provider = button.dataset.mapProvider; renderMapTransfer();
}));
document.getElementById('mapCopy').addEventListener('click', () => mapTransfer && copyText(copyLine(mapTransfer.restaurant), '상호·주소 복사됨'));
document.getElementById('mapCandidate').addEventListener('click', () => updateMapTransfer('candidate'));
document.getElementById('mapComplete').addEventListener('click', () => updateMapTransfer('complete'));
document.getElementById('mapRemove').addEventListener('click', () => updateMapTransfer('remove'));
document.getElementById('mapSearchLink').addEventListener('click', event => {
  if (!mapTransfer || pendingWrites.has(restaurantKey(mapTransfer.restaurant))) { event.preventDefault(); return; }
  updateMapTransfer('candidate');
});

function copyLine(d) {
  return `${d.name} ${d.address || ''}`.trim();
}

function kakaoCopyLine(d) {
  return `${d.name} ${d.address || ''}`.trim();
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
  showToast(successMessage);
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (authConfig.enabled && supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    if (currentProfile && data.session?.user?.id && data.session.user.id !== currentProfile.id) throw new Error('계정이 변경되었습니다. 새로고침해 주세요.');
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
  personal = {}; personalRecords = {}; currentProfile = null;
  document.body.classList.add('auth-pending');
  if (supabaseClient) await supabaseClient.auth.signOut();
  window.location.reload();
}

function recordFromRemote(r) {
  return { mapTarget: Boolean(r.map_target), mapSaved: Boolean(r.map_saved), mapSavedAt: r.map_saved_at || '', kakaoTarget: Boolean(r.kakao_target), kakaoSaved: Boolean(r.kakao_saved), kakaoSavedAt: r.kakao_saved_at || '', memo: r.memo || '', personalRating: r.personal_rating ?? '', visitedAt: r.visited_at || '', updatedAt: r.updated_at || '' };
}

async function syncPersonalRecords() {
  const accountId = currentProfile?.id;
  const version = recordVersion;
  if (!accountId || pendingWrites.size) return;
  const [stateResponse, recordResponse] = await Promise.all([apiFetch('/api/personal-states'), apiFetch('/api/personal-records')]);
  const [remote, records] = await Promise.all([stateResponse.json(), recordResponse.json()]);
  if (currentProfile?.id !== accountId || pendingWrites.size || version !== recordVersion) return;
  personal = Object.fromEntries((remote.states || []).filter(s => PERSONAL_STATES.includes(s.status)).map(s => [s.restaurant_key, { state: s.status, updatedAt: Date.parse(s.updated_at) || 0 }]));
  personalRecords = Object.fromEntries((records.records || []).map(r => [r.restaurant_key, recordFromRemote(r)]));
  savePersonal(personal);
  savePersonalRecords(personalRecords);
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
    personal = {}; personalRecords = {};
    if (!profile.allowed) { showAuthGate('열람 승인 대기 중', `${profile.fullName} · ${profile.email} 계정으로 요청되었습니다. 관리자가 승인하면 이용할 수 있습니다.`, { signout: true }); return false; }
    document.body.classList.remove('auth-pending');
    accountNameEl.textContent = profile.fullName;
    logoutButton.style.display = '';
    if (profile.role === 'owner') adminButton.style.display = '';
    await syncPersonalRecords();
    supabaseClient.auth.onAuthStateChange?.((event, session) => {
      if (event === 'SIGNED_OUT' || (session?.user?.id && session.user.id !== currentProfile?.id)) {
        personal = {}; personalRecords = {};
        document.body.classList.add('auth-pending');
        window.location.reload();
      }
    });
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
  searchVocabulary = meta.vocabulary || {};

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
  const version = ++guLoadVersion;
  const url = region ? `/api/gu?region=${encodeURIComponent(region)}` : '/api/gu';
  const res = await apiFetch(url);
  const rows = await res.json();
  if (version !== guLoadVersion) return;
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

function visibleMapTags(record) {
  const filter = personalFilterEl.value;
  if (filter === '저장 대기') {
    return `${record.mapTarget && !record.mapSaved ? '<span class="tag map-target-tag">네이버 대기</span>' : ''}${record.kakaoTarget && !record.kakaoSaved ? '<span class="tag kakao-target-tag">카카오 대기</span>' : ''}`;
  }
  if (filter === '저장 완료') {
    return `${record.mapTarget && record.mapSaved ? '<span class="tag map-saved-tag">네이버 완료</span>' : ''}${record.kakaoTarget && record.kakaoSaved ? '<span class="tag kakao-saved-tag">카카오 완료</span>' : ''}`;
  }
  return '';
}

function personalRatingOptions(value) {
  const current = value === '' || value == null || Number.isNaN(Number(value)) ? '' : Number(value).toFixed(1);
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
    const actions = ['가고싶음', '가봄'].map(stateName => `
      <button class="personal-action ${currentState === stateName ? 'active' : ''}" data-action="personal" data-state="${stateName}">${stateName}</button>
    `).join('');
    card.innerHTML = `
      <div class="review-scale" title="리뷰 규모 분류 · 맛 점수나 순위가 아닙니다"><div class="stamp${stampClass}" style="${stampBg}">${stampLabel}</div><span>리뷰 규모</span></div>
      <div class="info">
        <div class="name">${d.name}
          <span class="tag">${d.category || '분류없음'}</span>
          ${d.status === '폐업' ? '<span class="tag closed-tag">폐업</span>' : ''}
          ${badgeTags(d)}
          ${personalTag(currentState)}
          ${record.personalRating !== '' && record.personalRating != null ? `<span class="tag personal-rating-tag">내 평점 ${Number(record.personalRating).toFixed(1)}</span>` : ''}
          ${currentState === '가봄' && record.visitedAt ? `<span class="tag visited-at-tag">방문 ${record.visitedAt.replaceAll('-', '.')}</span>` : ''}
          ${visibleMapTags(record)}
        </div>
        <div class="addr">${addrParts.join('<span class="dot">·</span>')}</div>
        ${d.price_range ? `<div class="price-range">등록 가격대 ${d.price_range}원</div>` : ''}
        <div class="card-actions">
          ${actions}
          <button class="map-action map-transfer-button" data-action="map-transfer">지도에 옮기기</button>
          <details class="record-details" ${expandedRecords.has(restaurantKey(d)) ? 'open' : ''}>
          <summary>기록</summary>
          <div class="record-tools">
          <button class="personal-action ${currentState === '별로였음' ? 'active' : ''}" data-action="personal" data-state="별로였음">별로였음</button>
          <button class="map-action" data-action="copy">복사</button>
          <select class="personal-rating-select" data-action="rating">${personalRatingOptions(record.personalRating)}</select>
          ${currentState === '가봄' ? `<label class="visited-at-input">방문일 <input type="date" data-action="visited-at" value="${record.visitedAt || ''}"></label>` : ''}
          </div></details>
        </div>
      </div>
      <div class="ratings">
        <div class="rating-label">평균 평점</div>
        <div class="avg">${avgHtml}</div>
        <div class="rating-evidence">${d.avg == null ? '평점 자료 없음' : `평점 출처 ${[d.naver, d.google, d.daum].filter(value => value != null).length}곳 · 추천 순위 아님`}</div>
        <div class="src">${ratingLine(d)}</div>
      </div>
    `;
    card.__restaurant = d;
    card.querySelector('.record-details').addEventListener('toggle', event => {
      if (!event.target.isConnected) return;
      if (event.target.open) expandedRecords.add(restaurantKey(d));
      else expandedRecords.delete(restaurantKey(d));
    });
    if (pendingWrites.has(restaurantKey(d))) card.querySelectorAll('button,select,input').forEach(el => { el.disabled = true; });
    listEl.appendChild(card);
  });
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

function showSearchHint(smart) {
  const parts = [];
  if (smart) {
    [smart.region, smart.gu, smart.dong, smart.station ? `${smart.station}역` : ''].filter(Boolean).forEach(x => parts.push(x));
    if (smart.categoryTerms?.length) parts.push(smart.categoryTerms.join(' / '));
    if (smart.badge) parts.push(smart.badge);
    if (smart.gradeMin) parts.push(`리뷰 규모 ${smart.gradeMin} 이상`);
    if (smart.avgMin != null) parts.push(`평점 ${smart.avgMin} 이상`);
    if (smart.avgMax != null) parts.push(`평점 ${smart.avgMax} ${smart.avgMaxExclusive ? '미만' : '이하'}`);
    const won = x => `${Number(x).toLocaleString()}원`;
    if (smart.priceMin != null && smart.priceMax != null) parts.push(`${won(smart.priceMin)}~${won(smart.priceMax)}`);
    else if (smart.priceMin != null) parts.push(`${won(smart.priceMin)} 이상`);
    else if (smart.priceMax != null) parts.push(`${won(smart.priceMax)} ${smart.priceMaxExclusive ? '미만' : '이하'}`);
    if (smart.excludeNew) parts.push('신규 제외');
  }
  smartHintEl.textContent = [parts.length ? `검색 조건: ${parts.join(' · ')}` : '', ...(smart?.notices || [])].filter(Boolean).join(' — ');
  smartHintEl.style.display = smartHintEl.textContent ? 'block' : 'none';
  renderActiveFilters();
}

function renderActiveFilters() {
  const container = document.getElementById('activeFilters');
  const labels = { q: '검색어', region: '지역', gu: '도시·구', category: '분류', grade: '리뷰 규모', gradeMin: '최소 리뷰 규모', badge: '태그', personal: '내 기록', excludeNew: '신규 제외', includeClosed: '폐업 포함' };
  container.replaceChildren();
  for (const [key, control] of Object.entries(filterControls)) {
    const value = control.type === 'checkbox' ? control.checked : control.value.trim();
    if (!value || key === 'personal' && value === '내 장부 전체') continue;
    const button = document.createElement('button');
    button.className = 'filter-chip'; button.dataset.removeFilter = key;
    const label = control.type === 'checkbox' ? labels[key] : `${labels[key]}: ${value}${key === 'gradeMin' ? ' 이상' : ''}`;
    button.textContent = `${label} ×`; button.setAttribute('aria-label', `${label} 조건 해제`);
    container.appendChild(button);
  }
  container.hidden = !container.children.length;
}

function renderEmptyState(hasRows) {
  emptyEl.style.display = hasRows ? 'none' : 'block';
  if (hasRows) return;
  const ledger = Boolean(personalFilterEl.value), noRecords = ledger && keysForLedger().length === 0;
  document.getElementById('emptyMessage').textContent = noRecords ? '아직 내 장부에 기록한 식당이 없어요. 식당 목록에서 가고싶음·가봄을 눌러 시작해 보세요.' : ledger ? '내 기록 중 검색 조건에 맞는 식당이 없어요.' : '검색 조건에 맞는 식당이 없어요.';
  document.getElementById('emptyReset').hidden = noRecords;
  document.getElementById('emptyReset').textContent = ledger ? '내 장부 전체 보기' : '조건 지우기';
  const smart = RestaurantSearch.parse(qEl.value, searchVocabulary);
  document.getElementById('widenLocation').hidden = noRecords || !(regionEl.value || guEl.value || smart.region || smart.gu || smart.dong || smart.station);
  document.getElementById('emptyBrowse').hidden = ledgerDashboardEl.style.display === 'none';
}

async function search() {
  const version = ++searchVersion;
  document.getElementById('searchError').hidden = true;
  try { await runSearch(version); }
  catch (error) {
    if (version !== searchVersion) return;
    listEl.innerHTML = ''; pagerEl.style.display = 'none'; emptyEl.style.display = 'none';
    metaEl.textContent = '검색하지 못했습니다.';
    document.getElementById('searchError').hidden = false;
  }
}

async function runSearch(version) {
  metaEl.textContent = '검색 중...';
  emptyEl.style.display = 'none';
  renderActiveFilters();
  if (personalFilterEl.value) return searchPersonal(version);
  const params = buildParams();
  const res = await apiFetch('/api/restaurants?' + params.toString());
  const data = await res.json();
  if (version !== searchVersion) return;
  state.total = data.total;

  showSearchHint(data.inferred);

  renderRows(data.rows);
  renderEmptyState(data.rows.length);

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

async function searchPersonal(version) {
  const filter = personalFilterEl.value;
  const entries = Object.entries(personalRecords);
  let keys;
  if (filter === '내 장부 전체') keys = keysForLedger();
  else if (filter === '저장 대기') keys = entries.filter(([, value]) => (value.mapTarget && !value.mapSaved) || (value.kakaoTarget && !value.kakaoSaved)).map(([key]) => key);
  else if (filter === '저장 완료') keys = entries.filter(([, value]) => (value.mapTarget && value.mapSaved) || (value.kakaoTarget && value.kakaoSaved)).map(([key]) => key);
  else if (filter === '지도 저장 대상') keys = entries.filter(([, value]) => value.mapTarget).map(([key]) => key);
  else if (filter === '카카오 저장 대상') keys = entries.filter(([, value]) => value.kakaoTarget).map(([key]) => key);
  else keys = keysForPersonalState(filter);
  const fetched = await fetchPersonalRows(keys);
  if (version !== searchVersion) return;
  const rows = filterPersonalRows(fetched);
  state.page = Math.min(state.page, Math.max(1, Math.ceil(rows.length / state.pageSize)));
  state.total = rows.length;
  const startIdx = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(startIdx, startIdx + state.pageSize);
  renderRows(pageRows);
  renderEmptyState(pageRows.length);
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
  const smart = RestaurantSearch.parse(qEl.value, searchVocabulary);
  const explicit = { region: regionEl.value, gu: guEl.value, category: catEl.value.trim(), badge: badgeEl.value };
  showSearchHint({ ...smart, region: explicit.region ? null : smart.region, gu: explicit.gu ? null : smart.gu, dong: explicit.gu ? null : smart.dong, categoryTerms: explicit.category ? [] : smart.categoryTerms, badge: explicit.badge ? null : smart.badge });
  return rows.filter(d => {
    if (!RestaurantSearch.matches(d, smart, explicit)) return false;
    if (regionEl.value && d.region !== regionEl.value) return false;
    if (guEl.value && d.gu !== guEl.value) return false;
    if (catEl.value.trim() && d.category !== catEl.value.trim()) return false;
    if (gradeEl.value && d.grade !== gradeEl.value) return false;
    if (gradeMinEl.value && (!d.grade || RestaurantSearch.grades.indexOf(d.grade) > RestaurantSearch.grades.indexOf(gradeMinEl.value))) return false;
    if (badgeEl.value && !(d.badges || []).some(b => b.name === badgeEl.value)) return false;
    if (excludeNewEl.checked && (d.badges || []).some(b => b.name === '신규')) return false;
    if (!includeClosedEl.checked && d.status !== '영업') return false;
    return true;
  }).sort(RestaurantSearch.compare(sortEl.value));
}

let debounceTimer;
function triggerSearch(resetPage = true) {
  searchVersion++;
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

function refreshAfterRecord() {
  if (personalFilterEl.value) triggerSearch(false);
  else renderRows(Array.from(listEl.children).map(el => el.__restaurant).filter(Boolean));
}

listEl.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  const d = button?.closest('.card')?.__restaurant;
  if (!d) return;
  if (button.dataset.action === 'map-transfer') return openMapTransfer(d);
  if (button.dataset.action === 'copy') return copyText(copyLine(d), `${d.name} · 검색어 복사됨`);
  await writeForRestaurant(d, async () => {
    if (button.dataset.action === 'personal') {
      await setPersonalState(d, button.dataset.state);
      if (personalStateFor(d) === '가봄') expandedRecords.add(restaurantKey(d));
    }
    refreshAfterRecord();
  });
});

listEl.addEventListener('change', event => {
  const action = event.target.dataset.action;
  const d = event.target.closest('.card')?.__restaurant;
  if (!d || !['rating', 'visited-at'].includes(action)) return;
  const value = event.target.value;
  const patch = action === 'rating' ? { personalRating: value === '' ? '' : Number(value) } : { visitedAt: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '' };
  writeForRestaurant(d, async () => {
    await setPersonalRecord(d, patch);
    refreshAfterRecord();
  });
});


openLedgerBtn.addEventListener('click', openLedgerDashboard);
closeLedgerBtn.addEventListener('click', closeLedgerDashboard);
ledgerAllBtn.addEventListener('click', () => {
  clearView(true);
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
  const keys = kind === 'want'
    ? keysForPersonalState('가고싶음')
    : Object.entries(personalRecords)
      .filter(([, value]) => (value.mapTarget && !value.mapSaved) || (value.kakaoTarget && !value.kakaoSaved))
      .map(([key]) => key);
  const rows = await fetchPersonalRows(keys);
  const label = kind === 'want' ? '가고싶음' : '저장 대기';
  await copyText(rows.map(copyLine).join('\n'), `${label} ${rows.length.toLocaleString()}곳 지도 검색어 복사됨`);
});

const rubricToggle = document.getElementById('rubricToggle');
const rubricPanel = document.getElementById('rubricPanel');
rubricToggle.addEventListener('click', () => {
  const open = rubricPanel.classList.toggle('open');
  rubricToggle.textContent = open ? '리뷰 규모 기준 닫기 ▴' : '리뷰 규모 기준 ▾';
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

window.addEventListener('focus', async () => {
  if (!authConfig.enabled || !currentProfile?.allowed || pendingWrites.size || document.body.classList.contains('auth-pending')) return;
  try {
    await syncPersonalRecords();
    refreshAfterRecord();
    if (ledgerDashboardEl.style.display !== 'none') loadLedgerDashboard();
  } catch (error) { showToast('최근 기록을 불러오지 못했어요. 연결을 확인하고 새로고침해 주세요.', true); }
});
