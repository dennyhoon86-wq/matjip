// 행안부 주소검색 + 좌표제공 API로 우리 식당 주소만 변환한다.
// npm run geocode -- --limit 100 [--region 서울] [--retry-missing]
const path = require('node:path');
const Database = require('better-sqlite3');
const { normalizeAddress } = require('../geo-locations');
const { geocode } = require('../juso-client');

const ADDRESS_KEY = process.env.JUSO_ADDRESS_KEY;
const COORD_KEY = process.env.JUSO_COORD_KEY;
if (!ADDRESS_KEY || !COORD_KEY) {
  console.error('JUSO_ADDRESS_KEY와 JUSO_COORD_KEY가 필요합니다. 승인키를 코드나 Git에 넣지 마세요.');
  process.exit(1);
}

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const limit = Math.min(60000, Math.max(1, Number(arg('--limit', '100')) || 100));
const region = arg('--region');
const retryMissing = args.includes('--retry-missing');
const restaurantDb = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
const locationDb = new Database(path.join(__dirname, '../locations.db'));
locationDb.pragma('journal_mode = WAL');
locationDb.exec(`CREATE TABLE IF NOT EXISTS locations (
  address_key TEXT PRIMARY KEY,
  lat REAL,
  lon REAL,
  status TEXT NOT NULL,
  checked_at TEXT NOT NULL
);`);
const read = locationDb.prepare('SELECT status FROM locations WHERE address_key = ?');
const write = locationDb.prepare(`INSERT INTO locations(address_key,lat,lon,status,checked_at)
  VALUES(?,?,?,?,datetime('now')) ON CONFLICT(address_key) DO UPDATE SET
  lat=excluded.lat,lon=excluded.lon,status=excluded.status,checked_at=excluded.checked_at`);

const clause = region ? "WHERE status='영업' AND address LIKE ?" : "WHERE status='영업'";
const addresses = restaurantDb.prepare(`SELECT DISTINCT address FROM restaurants ${clause} AND address IS NOT NULL AND trim(address) != '' ORDER BY address`)
  .all(...(region ? [`${region}%`] : [])).map(r => normalizeAddress(r.address));
const targets = [...new Set(addresses)].filter(address => {
  const previous = read.get(address);
  return !previous || (retryMissing && previous.status !== 'ok');
}).slice(0, limit);

async function main() {
  const counts = {};
  console.log(`대상 고유 주소 ${targets.length}건 · 지역 ${region || '전체'} · 제한 ${limit}건`);
  for (const [i, address] of targets.entries()) {
    try {
      const result = await geocode(address, { addressKey: ADDRESS_KEY, coordKey: COORD_KEY });
      write.run(address, result.lat ?? null, result.lon ?? null, result.status);
      counts[result.status] = (counts[result.status] || 0) + 1;
    } catch (error) {
      counts.error = (counts.error || 0) + 1;
      console.error(`${i + 1}/${targets.length}: ${error.message}`);
      if (/HTTP 429|API E0001|API E0005/.test(error.message)) break;
    }
    if ((i + 1) % 25 === 0) console.log(`${i + 1}/${targets.length}`, counts);
    // 좌표제공 API의 공식 제한(5초 10건)을 넉넉히 지킨다.
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  console.log('완료', counts);
  locationDb.close(); restaurantDb.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
