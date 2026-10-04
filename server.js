const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { createAuth } = require('./auth');
const fs = require('node:fs');
const { normalizeAddress, distanceMeters } = require('./geo-locations');

const db = new Database(path.join(__dirname, 'matjip.db'), { readonly: true });
const app = express();
const PORT = process.env.PORT || 4000;
const auth = createAuth();
const locationPath = process.env.LOCATIONS_DB_PATH || path.join(__dirname, 'locations.db');
const locations = new Map();
if (fs.existsSync(locationPath)) {
  const locationDb = new Database(locationPath, { readonly: true });
  try {
    for (const row of locationDb.prepare("SELECT address_key,lat,lon FROM locations WHERE status='ok'").iterate()) {
      if (Number.isFinite(row.lat) && Number.isFinite(row.lon)) locations.set(row.address_key, row);
    }
  } finally { locationDb.close(); }
}
const nearbyReady = process.env.NEARBY_ENABLED === 'true' && Boolean(process.env.KAKAO_REST_API_KEY) && locations.size > 0;
db.function('near_distance', (address, lat, lon) => {
  const point = locations.get(normalizeAddress(address));
  return point ? Math.round(distanceMeters(point.lat, point.lon, Number(lat), Number(lon))) : null;
});

async function kakaoPlaces(query) {
  if (!process.env.KAKAO_REST_API_KEY) { const error = new Error('장소 검색 승인키가 아직 설정되지 않았습니다.'); error.status = 503; throw error; }
  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
  url.searchParams.set('query', query);
  url.searchParams.set('size', '15');
  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) { const error = new Error(response.status === 429 ? '오늘의 무료 장소 검색 한도를 초과했습니다.' : '장소를 조회하지 못했습니다.'); error.status = response.status === 429 ? 429 : 502; throw error; }
  const body = await response.json();
  return Array.isArray(body.documents) ? body.documents : [];
}

const GRADE_ORDER = ['A++', 'A+', 'A', 'B', 'C', 'D', 'E'];
const GRADE_CASE_SQL = `CASE grade ${GRADE_ORDER.map((g, i) => `WHEN '${g}' THEN ${i}`).join(' ')} ELSE 99 END`;

const RestaurantSearch = require('./public/search-query');
db.function('quick_score', (avg, grade, naver, google, daum, category, mealIntent) =>
  RestaurantSearch.quickScore({ avg, grade, naver, google, daum, category }, mealIntent));
db.function('price_matches', (origin_sheet, price_range, min, max, exclusive) =>
  Number(RestaurantSearch.priceMatches({ origin_sheet, price_range }, { priceMin: min, priceMax: max, priceMaxExclusive: Boolean(exclusive) })));
const stationAreas = {};
for (const row of db.prepare(`SELECT subway, region, gu, dong, COUNT(*) c FROM restaurants
  WHERE status='영업' AND subway IS NOT NULL AND subway != '' AND region IS NOT NULL AND gu IS NOT NULL AND dong IS NOT NULL
  GROUP BY subway, region, gu, dong ORDER BY c DESC`).all()) {
  (stationAreas[row.subway] ||= []).push(row);
}
const vocabulary = {
  gu: db.prepare("SELECT DISTINCT gu FROM restaurants WHERE gu IS NOT NULL").all().map(r => r.gu),
  dong: db.prepare("SELECT DISTINCT dong FROM restaurants WHERE dong IS NOT NULL").all().map(r => r.dong),
  stations: db.prepare("SELECT DISTINCT subway FROM restaurants WHERE subway IS NOT NULL AND subway != ''").all().map(r => r.subway),
  regions: db.prepare("SELECT DISTINCT region FROM restaurants").all().map(r => r.region),
  categories: db.prepare("SELECT DISTINCT category FROM restaurants WHERE category IS NOT NULL").all().map(r => r.category),
  badges: [],
};
const BADGE_COUNTS = {};
for (const r of db.prepare("SELECT badges FROM restaurants WHERE badges IS NOT NULL AND badges != '[]'").all()) {
  try { JSON.parse(r.badges).forEach(b => { BADGE_COUNTS[b.name] = (BADGE_COUNTS[b.name] || 0) + 1; }); } catch {}
}
vocabulary.badges = Object.keys(BADGE_COUNTS);
function parseSmartQuery(q) { return RestaurantSearch.parse(q, vocabulary); }

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
  res.json({ categories, regions, grades: GRADE_ORDER, badges, stations, total, activeTotal, vocabulary, stationAreas,
    nearby: { ready: nearbyReady, locatedAddresses: locations.size } });
});

app.get('/api/landmarks', auth.requireApproved, async (req, res) => {
  if (!nearbyReady) return res.status(503).json({ error: '장소 근처 검색이 아직 준비되지 않았습니다.' });
  const query = String(req.query.q || '').trim();
  if (query.length < 2 || query.length > 80) return res.status(400).json({ error: '장소 이름을 2~80자로 입력해 주세요.' });
  try {
    const places = await kakaoPlaces(query);
    res.set('Cache-Control', 'no-store');
    res.json({ places: places.map(place => ({ id: place.id, name: place.place_name, address: place.road_address_name || place.address_name })) });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
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

app.get('/api/restaurants', auth.requireApproved, async (req, res) => {
  const {
    q = '', region = '', gu = '', category = '', grade = '', gradeMin = '', badge = '', station = '', excludeNew = '',
    status = '영업', sort = 'recommended', locationScope = 'exact', page = '1', pageSize = '30',
  } = req.query;

  const where = [];
  const params = {};
  let inferred = null;
  let nearby = null;
  const landmarkQuery = String(req.query.landmarkQuery || '').trim();
  const landmarkId = String(req.query.landmarkId || '').trim();
  if (landmarkQuery || landmarkId) {
    if (!nearbyReady) return res.status(503).json({ error: '장소 근처 검색이 아직 준비되지 않았습니다.' });
    if (!landmarkQuery || !landmarkId || landmarkQuery.length > 80 || landmarkId.length > 40) return res.status(400).json({ error: '장소를 다시 선택해 주세요.' });
    if (!locations.size) return res.status(503).json({ error: '식당 위치자료가 아직 준비되지 않았습니다.' });
    const radius = Number(req.query.radius || 1000);
    if (![500, 1000, 2000, 3000].includes(radius)) return res.status(400).json({ error: '검색 반경이 올바르지 않습니다.' });
    let place;
    try { place = (await kakaoPlaces(landmarkQuery)).find(item => item.id === landmarkId); }
    catch (error) { return res.status(error.status || 502).json({ error: error.message }); }
    if (!place) return res.status(409).json({ error: '장소 검색 결과가 바뀌었습니다. 다시 선택해 주세요.' });
    const lat = Number(place.y), lon = Number(place.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(502).json({ error: '장소 좌표를 읽지 못했습니다.' });
    params.nearLat = lat; params.nearLon = lon; params.nearRadius = radius;
    where.push('near_distance(address, @nearLat, @nearLon) <= @nearRadius');
    nearby = { name: place.place_name, radius, distanceType: '직선거리' };
  }

  const trimmedQ = q.trim();
  if (trimmedQ) {
    const smart = parseSmartQuery(trimmedQ);
    const usedInference = true;

    if (usedInference) {
      inferred = { ...smart, region: region ? null : smart.region, gu: gu ? null : smart.gu, dong: gu ? null : smart.dong, categoryTerms: category ? [] : smart.categoryTerms, badge: badge ? null : smart.badge };
      if (!region && smart.region) { where.push('region = @sregion'); params.sregion = smart.region; }
      if (!gu && smart.gu) { where.push('gu = @sgu'); params.sgu = smart.gu; }
      if (!gu && smart.dong) { where.push('dong = @sdong'); params.sdong = smart.dong; }
      if (!station && smart.station) {
        const areas = stationAreas[smart.station] || [];
        const scope = ['neighborhood', 'district'].includes(locationScope) ? locationScope : 'exact';
        const clauses = ['subway = @sstation']; params.sstation = smart.station;
        for (const [i, area] of areas.entries()) {
          if (scope === 'exact') break;
          params[`areaRegion${i}`] = area.region; params[`areaGu${i}`] = area.gu;
          if (scope === 'neighborhood') {
            params[`areaDong${i}`] = area.dong;
            clauses.push(`(region=@areaRegion${i} AND gu=@areaGu${i} AND dong=@areaDong${i})`);
          } else clauses.push(`(region=@areaRegion${i} AND gu=@areaGu${i})`);
        }
        where.push(`(${clauses.join(' OR ')})`);
        inferred.locationScope = scope;
      }
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
      if (smart.avgMax != null) { where.push(`avg ${smart.avgMaxExclusive ? '<' : '<='} @savgMax`); params.savgMax = smart.avgMax; }
      if (smart.priceMin != null || smart.priceMax != null) {
        if (RestaurantSearch.priceBandSelection(smart) === null) where.push('0 = 1');
        else {
          where.push('price_matches(origin_sheet, price_range, @spriceMin, @spriceMax, @spriceExclusive) = 1');
          params.spriceMin = smart.priceMin; params.spriceMax = smart.priceMax; params.spriceExclusive = Number(smart.priceMaxExclusive);
        }
      }
      if (smart.excludeNew) where.push(`badges NOT LIKE '%"name":"신규"%'`);
      smart.leftoverTokens.forEach((token, i) => {
        where.push(`(name LIKE @token${i} OR category LIKE @token${i} OR address LIKE @token${i})`);
        params[`token${i}`] = `%${token}%`;
      });
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
  if (sort === 'recommended') {
    const mealIntent = inferred?.mealIntent === 'lunch' ? 'lunch' : inferred?.mealIntent === 'dinner' ? 'dinner' : '';
    orderSql = `quick_score(avg, grade, naver, google, daum, category, '${mealIntent}') DESC, avg IS NULL, avg DESC`;
  }
  else if (sort === 'avg_asc') orderSql = 'avg IS NULL, avg ASC';
  else if (sort === 'avg_desc') orderSql = 'avg IS NULL, avg DESC';
  else if (sort === 'grade') orderSql = `${GRADE_CASE_SQL} ASC, avg DESC`;
  else if (sort === 'name') orderSql = 'name COLLATE NOCASE ASC';
  else if (sort === 'new_first') orderSql = `(CASE WHEN badges LIKE '%"name":"신규"%' THEN 0 ELSE 1 END) ASC, avg DESC`;
  if (nearby) orderSql += ', near_distance(address, @nearLat, @nearLon) ASC';
  orderSql += ', id ASC';

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 30));
  const offset = (pageNum - 1) * size;

  const total = db.prepare(`SELECT COUNT(*) c FROM restaurants ${whereSql}`).get(params).c;

  const rows = db.prepare(`
    SELECT id, name, category, address, gu, dong, subway, price_range, origin_sheet,
           source_raw, sources, badges, naver, google, daum, avg, note,
           grade, region, status${nearby ? ', near_distance(address, @nearLat, @nearLon) AS distance_m' : ''}
    FROM restaurants
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: size, offset }).map(r => ({
    ...r,
    sources: JSON.parse(r.sources || '[]'),
    badges: JSON.parse(r.badges || '[]'),
  }));

  if (nearby) res.set('Cache-Control', 'no-store');
  res.json({ total, page: pageNum, pageSize: size, rows, inferred, nearby });
});

app.post('/api/personal-list', auth.requireApproved, (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.filter(x => typeof x === 'string').slice(0, 10000) : [];
  if (!keys.length) return res.json({ rows: [] });
  const wanted = new Set(keys);
  const rows = db.prepare(`
    SELECT id, name, category, address, gu, dong, subway, price_range, origin_sheet,
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

if (require.main === module) app.listen(PORT, () => {
  console.log(`미식장부 서버 실행 중: http://localhost:${PORT}`);
});
module.exports = { app };
