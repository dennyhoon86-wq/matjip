const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { createAuth } = require('./auth');

const db = new Database(path.join(__dirname, 'matjip.db'), { readonly: true });
const app = express();
const PORT = process.env.PORT || 4000;
const auth = createAuth();

const GRADE_ORDER = ['A++', 'A+', 'A', 'B', 'C', 'D', 'E'];
const GRADE_CASE_SQL = `CASE grade ${GRADE_ORDER.map((g, i) => `WHEN '${g}' THEN ${i}`).join(' ')} ELSE 99 END`;

// ---- 스마트 검색: "강남쪽 돼지고기 먹고싶어" 같은 자연어를 구/분류 필터로 추론 ----
const GU_SET = new Set(db.prepare("SELECT DISTINCT gu FROM restaurants WHERE gu IS NOT NULL").all().map(r => r.gu));
const DONG_SET = new Set(db.prepare("SELECT DISTINCT dong FROM restaurants WHERE dong IS NOT NULL").all().map(r => r.dong));
const STATION_SET = new Set(db.prepare("SELECT DISTINCT subway FROM restaurants WHERE subway IS NOT NULL AND subway != ''").all().map(r => r.subway));
const CATEGORY_LIST = db.prepare("SELECT DISTINCT category FROM restaurants WHERE category IS NOT NULL").all().map(r => r.category);

// 흔한 동네 별칭 -> 실제 DB의 구 값. DB에 없는 별칭은 무시되도록 존재하는 것만 등록.
const GU_ALIAS_RAW = {
  '강남': '강남구', '역삼': '강남구', '삼성': '강남구', '청담': '강남구', '압구정': '강남구', '신사': '강남구', '논현': '강남구',
  '홍대': '마포구', '합정': '마포구', '연남': '마포구', '망원': '마포구', '상수': '마포구',
  '이태원': '용산구', '한남': '용산구', '용리단길': '용산구',
  '여의도': '영등포구', '문래': '영등포구',
  '건대': '광진구', '건대입구': '광진구',
  '잠실': '송파구', '송리단길': '송파구', '석촌': '송파구',
  '노량진': '동작구', '사당': '동작구',
  '신촌': '서대문구', '연희': '서대문구',
  '종로': '종로구', '익선동': '종로구', '삼청동': '종로구', '서촌': '종로구',
  '명동': '중구', '을지로': '중구', '동대문': '중구',
  '성수': '성동구', '왕십리': '성동구',
  '북촌': '종로구',
  '가로수길': '강남구',
};
const GU_ALIAS = {};
for (const [k, v] of Object.entries(GU_ALIAS_RAW)) if (GU_SET.has(v)) GU_ALIAS[k] = v;

const BADGE_SET = new Set();
for (const r of db.prepare("SELECT DISTINCT badges FROM restaurants WHERE badges IS NOT NULL AND badges != '[]'").all()) {
  try { JSON.parse(r.badges).forEach(b => BADGE_SET.add(b.name)); } catch {}
}
const BADGE_ALIAS_RAW = {
  '최신': '신규', '새로운': '신규', '새로': '신규', '최근': '신규', '뉴': '신규', '따끈따끈한': '신규',
};
const BADGE_ALIAS = {};
for (const [k, v] of Object.entries(BADGE_ALIAS_RAW)) if (BADGE_SET.has(v)) BADGE_ALIAS[k] = v;

// 문장형 검색에서 자주 쓰는 업종 표현을 장부 분류로 연결합니다.
const CATEGORY_ALIAS = {
  '한식': ['한식'], '일식': ['일식'], '스시': ['스시', '일식'], '오마카세': ['오마카세'],
  '중식': ['중식'], '중국집': ['중식'], '양식': ['양식', '이탈리아'], '파스타': ['파스타', '이탈리아'],
  '피자': ['피자'], '고기': ['육류'], '소고기': ['소고기'], '돼지고기': ['돼지고기'],
  '곱창': ['곱창'], '치킨': ['치킨'], '국밥': ['국밥'], '카페': ['카페'], '브런치': ['브런치'],
  '술': ['이자카야', '요리주점', '호프', '와인'], '술집': ['이자카야', '요리주점', '호프', '와인'],
};

const BADGE_COUNTS = {};
for (const name of BADGE_SET) {
  BADGE_COUNTS[name] = db.prepare('SELECT COUNT(*) c FROM restaurants WHERE badges LIKE ?').get(`%"name":"${name}"%`).c;
}

// 검색어에서 걸러낼 조사/군더더기 표현 (뒤에서부터 반복적으로 제거)
const FILLER_SUFFIX_RE = /(쪽에서|근처에서|주변에서|에서|근처|주변|쪽|의|에게|에|은|는|이|가|을|를)+$/;
const FILLER_WORDS = new Set([
  '먹고싶어', '먹고싶다', '먹고파', '먹고싶은데', '먹고 싶어', '먹고 싶다',
  '땡긴다', '땡기는데', '땡김', '먹으러', '먹으로', '먹고', '가고싶어',
  '갈만한', '갈만한곳', '먹을만한', '먹을만한곳', '괜찮은', '괜찮은곳', '있나요', '있을까', '있나',
  '추천', '추천해줘', '추천좀', '해줘', '좀', '알려줘', '데', '곳', '집', '맛집',
]);
const CONTEXT_WORDS = new Set([
  '근처', '주변', '쪽', '에서', '조용한', '조용히', '저녁', '점심', '아침', '밤', '식사', '식사로',
  '데이트', '회식', '모임', '부모님', '아이와', '혼밥', '혼자', '여럿', '명', '인', '인당', '위주', '곳', '집',
  '이상', '이하', '미만', '부터', '빼고', '제외', '제외하고', '신규', '평점', '등급',
]);

function stripFiller(token) {
  let t = token;
  for (let i = 0; i < 4; i++) {
    if (FILLER_WORDS.has(t)) { t = ''; break; }
    const stripped = t.replace(FILLER_SUFFIX_RE, '');
    if (stripped === t) break;
    t = stripped;
  }
  return t;
}

function parsePriceWon(raw) {
  const amount = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  if (/만/.test(raw)) return amount * 10000;
  if (/천/.test(raw)) return amount * 1000;
  return amount >= 1000 ? amount : amount * 10000;
}

function parseSmartQuery(q) {
  const raw = String(q || '').trim();
  const result = { gu: null, dong: null, station: null, categoryTerms: [], badge: null, gradeMin: null, avgMin: null, avgMax: null, priceMin: null, priceMax: null, excludeNew: false, leftoverTokens: [] };
  if (!raw) return result;

  const compact = raw.replace(/[，,\/]/g, ' ').replace(/\s+/g, ' ');
  const gradeMatch = compact.match(/(?:^|\s)(A\+\+|A\+|A|B|C|D|E)\s*(?:등급\s*)?(이상|부터)(?=\s|$)/i);
  if (gradeMatch && GRADE_ORDER.includes(gradeMatch[1].toUpperCase())) result.gradeMin = gradeMatch[1].toUpperCase();
  const ratingMatch = compact.match(/(\d(?:\.\d+)?)\s*(?:점|평점)?\s*(이상|부터|이하|미만)/);
  if (ratingMatch) {
    const rating = Number(ratingMatch[1]);
    if (rating >= 0 && rating <= 5) {
      if (['이상', '부터'].includes(ratingMatch[2])) result.avgMin = rating;
      else result.avgMax = rating;
    }
  }
  const rangePrice = compact.match(/(?:1인|인당)?\s*(\d+(?:\.\d+)?\s*(?:만|천)?원?)\s*(?:~|[-–])\s*(\d+(?:\.\d+)?\s*(?:만|천)?원?)/);
  if (rangePrice) { result.priceMin = parsePriceWon(rangePrice[1]); result.priceMax = parsePriceWon(rangePrice[2]); }
  const onePrice = compact.match(/(?:1인|인당)?\s*(\d+(?:\.\d+)?\s*(?:만|천)?원?)\s*(이하|미만|이상|부터)/);
  if (onePrice) {
    const price = parsePriceWon(onePrice[1]);
    if (['이하', '미만'].includes(onePrice[2])) result.priceMax = price;
    else result.priceMin = price;
  }
  if (/신규\s*(?:제외|빼고|빼|제외하고)/.test(compact)) result.excludeNew = true;

  const tokens = compact.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const stripped = stripFiller(tok.replace(/[()]/g, ''));
    if (!stripped) continue; // 순수 군더더기 표현이면 버림

    if (CONTEXT_WORDS.has(stripped) || /^\d+명?$/.test(stripped) || /^\d+(?:\.\d+)?(?:만|천)?원?$/.test(stripped) || /^(A\+\+|A\+|A|B|C|D|E)$/.test(stripped)) continue;

    if (!result.badge && BADGE_SET.has(stripped)) { result.badge = stripped; continue; }
    if (!result.badge && BADGE_ALIAS[stripped]) { result.badge = BADGE_ALIAS[stripped]; continue; }
    // "신논현역" 처럼 역 이름 뒤에 "역"이 붙어오는 경우가 흔해서 먼저 떼고 확인
    const stationCandidate = stripped.endsWith('역') && stripped.length > 1 ? stripped.slice(0, -1) : stripped;
    if (!result.station && STATION_SET.has(stationCandidate)) { result.station = stationCandidate; continue; }
    if (!result.station && STATION_SET.has(stripped)) { result.station = stripped; continue; }
    if (!result.gu && GU_SET.has(stripped)) { result.gu = stripped; continue; }
    if (!result.gu && GU_ALIAS[stripped]) { result.gu = GU_ALIAS[stripped]; continue; }
    if (!result.dong && DONG_SET.has(stripped)) { result.dong = stripped; continue; }

    const categoryTerms = CATEGORY_ALIAS[stripped] || (stripped.length >= 2 && CATEGORY_LIST.some(c => c.includes(stripped)) ? [stripped] : []);
    if (categoryTerms.length) {
      result.categoryTerms.push(...categoryTerms);
      continue;
    }

    result.leftoverTokens.push(stripped);
  }
  return result;
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

app.get('/api/auth/config', (req, res) => res.json(auth.config()));
app.get('/api/auth/me', async (req, res) => {
  try { res.json({ profile: await auth.identityFromRequest(req) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message || '인증 처리에 실패했습니다.' }); }
});

app.get('/api/personal-states', auth.requireApproved, async (req, res) => {
  try { res.json({ states: auth.required ? await auth.personalStates(req.identity.id) : [] }); }
  catch (error) { res.status(500).json({ error: '개인 기록을 불러오지 못했습니다.' }); }
});
app.post('/api/personal-states', auth.requireApproved, async (req, res) => {
  try { res.json({ states: auth.required ? await auth.setPersonalStates(req.identity.id, Array.isArray(req.body?.states) ? req.body.states : []) : [] }); }
  catch (error) { res.status(500).json({ error: '개인 기록을 저장하지 못했습니다.' }); }
});
app.delete('/api/personal-states', auth.requireApproved, async (req, res) => {
  try {
    if (auth.required) await auth.deletePersonalState(req.identity.id, String(req.body?.restaurant_key || ''));
    res.status(204).end();
  } catch (error) { res.status(500).json({ error: '개인 기록을 삭제하지 못했습니다.' }); }
});
app.get('/api/personal-records', auth.requireApproved, async (req, res) => {
  try { res.json({ records: auth.required ? await auth.personalRecords(req.identity.id) : [] }); }
  catch (error) { res.status(500).json({ error: '개인 메모를 불러오지 못했습니다.' }); }
});
app.post('/api/personal-records', auth.requireApproved, async (req, res) => {
  try { res.json({ records: auth.required ? await auth.setPersonalRecords(req.identity.id, Array.isArray(req.body?.records) ? req.body.records : []) : [] }); }
  catch (error) { res.status(500).json({ error: '개인 메모를 저장하지 못했습니다.' }); }
});
app.get('/api/admin/users', auth.requireOwner, async (req, res) => {
  try { res.json({ users: auth.required ? await auth.supabase('/rest/v1/profiles?select=id,email,full_name,role,created_at&order=created_at.desc') : [] }); }
  catch (error) { res.status(500).json({ error: '승인 목록을 불러오지 못했습니다.' }); }
});
app.patch('/api/admin/users/:id', auth.requireOwner, async (req, res) => {
  const role = String(req.body?.role || '');
  if (!['member', 'blocked'].includes(role)) return res.status(400).json({ error: '허용 또는 차단만 가능합니다.' });
  try {
    const users = await auth.supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ role }) });
    res.json({ user: users[0] });
  } catch (error) { res.status(500).json({ error: '권한을 변경하지 못했습니다.' }); }
});

app.get('/api/meta', auth.requireApproved, (req, res) => {
  const categories = db.prepare(`
    SELECT category, COUNT(*) c FROM restaurants
    WHERE category IS NOT NULL GROUP BY category ORDER BY c DESC
  `).all();
  const regions = db.prepare(`
    SELECT region, COUNT(*) c FROM restaurants GROUP BY region ORDER BY c DESC
  `).all();
  const total = db.prepare('SELECT COUNT(*) c FROM restaurants').get().c;
  const activeTotal = db.prepare("SELECT COUNT(*) c FROM restaurants WHERE status='영업'").get().c;
  const badges = Object.entries(BADGE_COUNTS).map(([name, c]) => ({ name, c })).sort((a, b) => b.c - a.c);
  const stations = db.prepare(`
    SELECT subway, COUNT(*) c FROM restaurants
    WHERE subway IS NOT NULL AND subway != '' GROUP BY subway ORDER BY c DESC
  `).all();
  res.json({ categories, regions, grades: GRADE_ORDER, badges, stations, total, activeTotal });
});

app.get('/api/gu', auth.requireApproved, (req, res) => {
  const { region } = req.query;
  let rows;
  if (region) {
    rows = db.prepare(`
      SELECT gu, COUNT(*) c FROM restaurants WHERE region = ? AND gu IS NOT NULL
      GROUP BY gu ORDER BY c DESC
    `).all(region);
  } else {
    rows = db.prepare(`
      SELECT gu, COUNT(*) c FROM restaurants WHERE gu IS NOT NULL
      GROUP BY gu ORDER BY c DESC
    `).all();
  }
  res.json(rows);
});

app.get('/api/restaurants', auth.requireApproved, (req, res) => {
  const {
    q = '', region = '', gu = '', category = '', grade = '', gradeMin = '', badge = '', station = '', excludeNew = '',
    status = '영업', sort = 'avg_desc', page = '1', pageSize = '30',
  } = req.query;

  const where = [];
  const params = {};
  let inferred = null;

  const trimmedQ = q.trim();
  if (trimmedQ) {
    const smart = parseSmartQuery(trimmedQ);
    const usedInference = (!gu && smart.gu) || (!gu && smart.dong) || (!station && smart.station) || (!category && smart.categoryTerms.length) || (!badge && smart.badge) || smart.gradeMin || smart.avgMin != null || smart.avgMax != null || smart.priceMin != null || smart.priceMax != null || smart.excludeNew;

    if (usedInference) {
      inferred = { gu: smart.gu, dong: smart.dong, station: station ? null : smart.station, categoryTerms: smart.categoryTerms, badge: badge ? null : smart.badge, gradeMin: smart.gradeMin, avgMin: smart.avgMin, avgMax: smart.avgMax, priceMin: smart.priceMin, priceMax: smart.priceMax, excludeNew: smart.excludeNew };
      if (!gu && smart.gu) { where.push('gu = @sgu'); params.sgu = smart.gu; }
      if (!gu && !smart.gu && smart.dong) { where.push('dong = @sdong'); params.sdong = smart.dong; }
      if (!station && smart.station) { where.push('subway = @sstation'); params.sstation = smart.station; }
      if (!category && smart.categoryTerms.length) {
        const catClauses = smart.categoryTerms.map((t, i) => {
          params[`scat${i}`] = `%${t}%`;
          return `category LIKE @scat${i}`;
        });
        where.push(`(${catClauses.join(' OR ')})`);
      }
      if (!badge && smart.badge) { where.push('badges LIKE @sbadge'); params.sbadge = `%"name":"${smart.badge}"%`; }
      if (smart.gradeMin) {
        const eligible = GRADE_ORDER.slice(0, GRADE_ORDER.indexOf(smart.gradeMin) + 1);
        where.push(`grade IN (${eligible.map((g, i) => { params[`sgrade${i}`] = g; return `@sgrade${i}`; }).join(', ')})`);
      }
      if (smart.avgMin != null) { where.push('avg >= @savgMin'); params.savgMin = smart.avgMin; }
      if (smart.avgMax != null) { where.push('avg <= @savgMax'); params.savgMax = smart.avgMax; }
      const priceLowSql = "CAST(REPLACE(SUBSTR(price_range, 1, INSTR(price_range, ' ~ ') - 1), ',', '') AS INTEGER)";
      const priceHighSql = "CAST(REPLACE(SUBSTR(price_range, INSTR(price_range, ' ~ ') + 3), ',', '') AS INTEGER)";
      if (smart.priceMin != null) { where.push(`price_range IS NOT NULL AND ${priceHighSql} >= @spriceMin`); params.spriceMin = smart.priceMin; }
      if (smart.priceMax != null) { where.push(`price_range IS NOT NULL AND ${priceLowSql} <= @spriceMax`); params.spriceMax = smart.priceMax; }
      if (smart.excludeNew) where.push(`badges NOT LIKE '%"name":"신규"%'`);
      const leftover = smart.leftoverTokens.join(' ').trim();
      if (leftover) {
        where.push('(name LIKE @q OR category LIKE @q OR address LIKE @q)');
        params.q = `%${leftover}%`;
      }
    } else {
      where.push('(name LIKE @q OR category LIKE @q OR address LIKE @q)');
      params.q = `%${trimmedQ}%`;
    }
  }
  if (region) { where.push('region = @region'); params.region = region; }
  if (gu) { where.push('gu = @gu'); params.gu = gu; }
  if (category) { where.push('category = @category'); params.category = category; }
  if (grade) { where.push('grade = @grade'); params.grade = grade; }
  if (gradeMin && GRADE_ORDER.includes(gradeMin)) {
    const eligible = GRADE_ORDER.slice(0, GRADE_ORDER.indexOf(gradeMin) + 1);
    where.push(`grade IN (${eligible.map((g, i) => { params[`gmin${i}`] = g; return `@gmin${i}`; }).join(', ')})`);
  }
  if (badge) { where.push('badges LIKE @badge'); params.badge = `%"name":"${badge}"%`; }
  if (excludeNew === 'true') where.push(`badges NOT LIKE '%"name":"신규"%'`);
  if (station) { where.push('subway = @station'); params.station = station; }
  if (status && status !== '전체') { where.push('status = @status'); params.status = status; }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  let orderSql = 'avg DESC';
  if (sort === 'avg_asc') orderSql = 'avg ASC';
  else if (sort === 'avg_desc') orderSql = 'avg DESC';
  else if (sort === 'grade') orderSql = `${GRADE_CASE_SQL} ASC, avg DESC`;
  else if (sort === 'name') orderSql = 'name COLLATE NOCASE ASC';
  else if (sort === 'new_first') orderSql = `(CASE WHEN badges LIKE '%"name":"신규"%' THEN 0 ELSE 1 END) ASC, avg DESC`;
  orderSql += ', id ASC';

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 30));
  const offset = (pageNum - 1) * size;

  const total = db.prepare(`SELECT COUNT(*) c FROM restaurants ${whereSql}`).get(params).c;

  const rows = db.prepare(`
    SELECT id, name, category, address, gu, dong, subway, price_range,
           source_raw, sources, badges, naver, google, daum, avg, note,
           grade, region, status
    FROM restaurants
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: size, offset }).map(r => ({
    ...r,
    sources: JSON.parse(r.sources || '[]'),
    badges: JSON.parse(r.badges || '[]'),
  }));

  res.json({ total, page: pageNum, pageSize: size, rows, inferred });
});

app.post('/api/personal-list', auth.requireApproved, (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.filter(x => typeof x === 'string').slice(0, 10000) : [];
  if (!keys.length) return res.json({ rows: [] });
  const wanted = new Set(keys);
  const rows = db.prepare(`
    SELECT id, name, category, address, gu, dong, subway, price_range,
           source_raw, sources, badges, naver, google, daum, avg, note,
           grade, region, status
    FROM restaurants
  `).all().filter(r => wanted.has(`${r.name}\u001f${r.address || ''}`)).map(r => ({
    ...r,
    sources: JSON.parse(r.sources || '[]'),
    badges: JSON.parse(r.badges || '[]'),
  }));
  res.json({ rows });
});

app.listen(PORT, () => {
  console.log(`미식장부 서버 실행 중: http://localhost:${PORT}`);
});
