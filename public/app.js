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

let state = { page: 1, pageSize: 30, total: 0 };

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
  if (name === '최신') return 'badge-new';
  return 'badge-other';
}

function badgeTags(d) {
  return d.badges.map(b => {
    const stars = b.stars > 0 ? '★'.repeat(b.stars) : '';
    return `<span class="tag badge-tag ${badgeClass(b.name)}">${b.name}${stars}</span>`;
  }).join('');
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
    card.innerHTML = `
      <div class="stamp${stampClass}" style="${stampBg}">${stampLabel}</div>
      <div class="info">
        <div class="name">${d.name}
          <span class="tag">${d.category || '분류없음'}</span>
          ${d.status === '폐업' ? '<span class="tag closed-tag">폐업</span>' : ''}
          ${badgeTags(d)}
        </div>
        <div class="addr">${addrParts.join('<span class="dot">·</span>')}</div>
      </div>
      <div class="ratings">
        <div class="avg">${avgHtml}</div>
        <div class="src">${ratingLine(d)}</div>
      </div>
    `;
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
  if (badgeEl.value) p.set('badge', badgeEl.value);
  p.set('sort', sortEl.value);
  p.set('status', includeClosedEl.checked ? '전체' : '영업');
  p.set('page', state.page);
  p.set('pageSize', state.pageSize);
  return p;
}

async function search() {
  metaEl.textContent = '검색 중...';
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

const rubricToggle = document.getElementById('rubricToggle');
const rubricPanel = document.getElementById('rubricPanel');
rubricToggle.addEventListener('click', () => {
  const open = rubricPanel.classList.toggle('open');
  rubricToggle.textContent = open ? '등급 기준 닫기 ▴' : '등급 기준 보기 ▾';
});

(async function init() {
  await loadMeta();
  await loadGuOptions('');
  await search();
})();
