// Resolve only exact parcel addresses still missing from the public location DB.
// Requires SGIS_CONSUMER_KEY and SGIS_CONSUMER_SECRET environment variables.
// SGIS docs: https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/addressBoundary.html
const path = require('node:path');
const Database = require('better-sqlite3');
const { normalizeAddress, seoulParcelKey, gyeonggiParcelKey } = require('../geo-locations');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const province = { 서울: '서울특별시', 경기: '경기도' };
const nullish = value => value && value !== 'null' ? String(value).trim() : '';

function exactPoint(result, key) {
  if (!result || String(result.matching) !== '0') return null;
  const matches = [];
  const compact = value => String(value || '').replace(/\s+/g, '');
  for (const item of result.resultdata || []) {
    if (String(item.addr_type) !== '6') continue;
    const region = String(item.sido_nm).startsWith('서울') ? '서울' : String(item.sido_nm).startsWith('경기') ? '경기' : '';
    const lot = `${nullish(item.jibun_main_no)}${Number(item.jibun_sub_no) ? `-${Number(item.jibun_sub_no)}` : ''}`;
    const address = [region, nullish(item.sgg_nm), nullish(item.leg_nm), nullish(item.ri_nm), lot].filter(Boolean).join(' ');
    const actualKey = region === '서울' ? seoulParcelKey(address) : region === '경기' ? gyeonggiParcelKey(address) : null;
    // SGIS joins city and district names (e.g. 수원시영통구), while source
    // addresses usually separate them (수원시 영통구).
    if (compact(actualKey) !== compact(key)) continue;
    const lat = Number(item.y), lon = Number(item.x);
    if (lat > 36.8 && lat < 38.35 && lon > 126.35 && lon < 127.9) matches.push({ lat, lon });
  }
  if (!matches.length) return null;
  return matches.every(point => Math.abs(point.lat - matches[0].lat) < 0.0001 &&
    Math.abs(point.lon - matches[0].lon) < 0.0001) ? matches[0] : null;
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`SGIS HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const key = process.env.SGIS_CONSUMER_KEY, secret = process.env.SGIS_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('SGIS_CONSUMER_KEY and SGIS_CONSUMER_SECRET are required');
  const auth = new URL('https://sgisapi.mods.go.kr/OpenAPI3/auth/authentication.json');
  auth.searchParams.set('consumer_key', key);
  auth.searchParams.set('consumer_secret', secret);
  const authBody = await json(auth);
  if (Number(authBody.errCd) !== 0 || !authBody.result?.accessToken) throw new Error(`SGIS auth failed: ${authBody.errMsg || authBody.errCd}`);
  const token = authBody.result.accessToken;
  const restaurants = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  const locations = new Database(path.join(__dirname, '../locations.db'));
  try {
    const existing = new Set(locations.prepare("SELECT address_key FROM locations WHERE status='ok'").all().map(r => r.address_key));
    const targets = new Set();
    for (const row of restaurants.prepare("SELECT address FROM restaurants WHERE status='영업' AND address IS NOT NULL").iterate()) {
      const address = normalizeAddress(row.address);
      const region = address.split(' ')[0];
      const parcel = region === '서울' ? seoulParcelKey(address) : region === '경기' ? gyeonggiParcelKey(address) : null;
      if (parcel && !existing.has(address) && !existing.has(parcel)) targets.add(parcel);
    }
    const save = locations.prepare(`INSERT INTO locations(address_key,lat,lon,status,checked_at,source)
      VALUES (?, ?, ?, 'ok', datetime('now'), 'SGIS exact parcel geocode')
      ON CONFLICT(address_key) DO NOTHING`);
    const stats = { total: targets.size, exact: 0, noExact: 0, errors: 0 };
    const unresolved = [];
    for (const [index, parcel] of [...targets].entries()) {
      const region = parcel.split(' ')[0];
      const query = parcel.replace(new RegExp(`^${region} `), `${province[region]} `);
      const url = new URL('https://sgisapi.mods.go.kr/OpenAPI3/addr/geocodewgs84.json');
      url.searchParams.set('accessToken', token);
      url.searchParams.set('address', query);
      url.searchParams.set('resultcount', '10');
      try {
        const body = await json(url);
        if (Number(body.errCd) !== 0) throw new Error(`SGIS ${body.errCd}: ${body.errMsg}`);
        const point = exactPoint(body.result, parcel);
        if (point) { save.run(parcel, point.lat, point.lon); stats.exact++; }
        else { stats.noExact++; unresolved.push({ parcel, reason: 'no_exact_match' }); }
      } catch (error) {
        stats.errors++;
        unresolved.push({ parcel, reason: String(error.message).slice(0, 100) });
        if (/HTTP 429|SGIS -401|SGIS -403/.test(error.message)) break;
      }
      if ((index + 1) % 50 === 0) console.log(JSON.stringify({ processed: index + 1, ...stats }));
      await sleep(250);
    }
    locations.pragma('wal_checkpoint(TRUNCATE)');
    const reasons = unresolved.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({ ...stats, reasons, unresolved }, null, 2));
  } finally { restaurants.close(); locations.close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { exactPoint };
