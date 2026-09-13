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

let state = { page: 1, pageSize: 30, total: 0 };
const PERSONAL_STORAGE_KEY = 'misik-jangbu-personal-v1';
const PERSONAL_STATES = ['가고싶음', '가봄', '재방문', '별로였음'];
const selectedKeys = new Set();

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
  return loadPersonal()[restaurantKey(d)]?.state || '';
}

function setPersonalState(d, nextState) {
  const personal = loadPersonal();
  const key = restaurantKey(d);
  if (personal[key]?.state === nextState) delete personal[key];
  else personal[key] = { state: nextState, updatedAt: Date.now() };
  savePersonal(personal);
}

function keysForPersonalState(filter = '') {
  return Object.entries(loadPersonal())
    .filter(([, value]) => !filter || value.state === filter)
    .map(([key]) => key);
}

function updatePersonalSummary() {
  const entries = Object.values(loadPersonal());
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

async function fetchPersonalRows(keys) {
  if (!keys.length) return [];
  const res = await fetch('/api/personal-list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  });
  if (!res.ok) throw new Error('개인 목록을 불러오지 못했습니다.');
  const data = await res.json();
  return data.rows || [];
}

async function loadMeta() {
  const res = await fetch('/api/meta');
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
  const res = await fetch(url);
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
  const res = await fetch('/api/restaurants?' + params.toString());
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
    setPersonalState(d, button.dataset.state);
    if (personalFilterEl.value && personalFilterEl.value !== personalStateFor(d)) triggerSearch(false);
    else renderRows(Array.from(listEl.children).map(el => el.__restaurant).filter(Boolean));
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

(async function init() {
  await loadMeta();
  await loadGuOptions('');
  updatePersonalSummary();
  await search();
})();
