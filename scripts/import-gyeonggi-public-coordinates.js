// Import parcel coordinates from Gyeonggi Data Dream's licensed restaurant permits.
// Source: https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=PCLA9AX1WQGYL7DNY5RE21793910&infSeq=1
// Usage: node scripts/import-gyeonggi-public-coordinates.js <downloaded CSV> [output DB]
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const iconv = require('iconv-lite');
const { parse } = require('@fast-csv/parse');
const { gyeonggiParcelKey: parcelKey, distanceMeters } = require('../geo-locations');

function sourcePoint(row) {
  const lat = Number(row['위도']), lon = Number(row['경도']);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 36.8 || lat > 38.35 || lon < 126.35 || lon > 127.9) return null;
  return { lat, lon };
}

async function importCoordinates(csvPath, outputPath = path.join(__dirname, '../locations.db')) {
  if (!fs.existsSync(csvPath)) throw new Error(`CSV를 찾지 못했습니다: ${csvPath}`);
  const sourceDb = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  const targets = new Set();
  for (const row of sourceDb.prepare("SELECT DISTINCT address FROM restaurants WHERE status='영업' AND address LIKE '경기 %' AND address IS NOT NULL").iterate()) {
    const key = parcelKey(row.address);
    if (key) targets.add(key);
  }
  sourceDb.close();

  const found = new Map(), conflicts = new Set();
  const stats = { csvRows: 0, targetAddresses: targets.size, matchingRows: 0, rowsWithCoordinates: 0, addressConflicts: 0 };
  const parser = fs.createReadStream(csvPath).pipe(iconv.decodeStream('cp949')).pipe(parse({ headers: true, ignoreEmpty: true }));
  for await (const row of parser) {
    stats.csvRows++;
    const key = parcelKey(row['소재지지번주소']);
    if (!key || !targets.has(key) || conflicts.has(key)) continue;
    stats.matchingRows++;
    const point = sourcePoint(row);
    if (!point) continue;
    stats.rowsWithCoordinates++;
    const current = found.get(key);
    if (current && distanceMeters(current.lat, current.lon, point.lat, point.lon) > 100) {
      conflicts.add(key); found.delete(key); stats.addressConflicts++;
    } else if (!current) found.set(key, point);
  }

  const db = new Database(outputPath);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS locations (
      address_key TEXT PRIMARY KEY, lat REAL, lon REAL, status TEXT NOT NULL, checked_at TEXT NOT NULL,
      adm_cd TEXT, rn_mgt_sn TEXT, udrt_yn TEXT, buld_mnnm TEXT, buld_slno TEXT, source TEXT
    )`);
    if (!db.pragma('table_info(locations)').some(row => row.name === 'source')) db.exec('ALTER TABLE locations ADD COLUMN source TEXT');
    const save = db.prepare(`INSERT INTO locations (address_key,lat,lon,status,checked_at,source)
      VALUES (?, ?, ?, 'ok', datetime('now'), 'Gyeonggi Data Dream restaurant permits')
      ON CONFLICT(address_key) DO UPDATE SET lat=excluded.lat, lon=excluded.lon,
      status='ok', checked_at=excluded.checked_at, source=excluded.source`);
    db.transaction(() => { for (const [key, point] of found) save.run(key, point.lat, point.lon); })();
    db.pragma('wal_checkpoint(TRUNCATE)');
    stats.locatedAddresses = found.size;
    stats.unlocatedAddresses = targets.size - found.size;
  } finally { db.close(); }
  return stats;
}

if (require.main === module) importCoordinates(process.argv[2], process.argv[3])
  .then(stats => console.log(JSON.stringify(stats, null, 2)))
  .catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { parcelKey, sourcePoint, importCoordinates };
