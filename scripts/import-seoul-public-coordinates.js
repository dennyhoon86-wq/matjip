// One-time import of Seoul's openly licensed restaurant permit coordinates.
// Source: https://data.seoul.go.kr/dataList/OA-23056/S/1/datasetView.do
// Usage: node scripts/import-seoul-public-coordinates.js <downloaded CSV> [output DB]
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const iconv = require('iconv-lite');
const { parse } = require('@fast-csv/parse');
const proj4 = require('proj4');
const { normalizeAddress, distanceMeters } = require('../geo-locations');

const EPSG5174 = '+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342 +units=m +no_defs';
const EPSG5179 = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs';

function permitAddress(value) {
  return normalizeAddress(String(value || '').replace(/\s*\(.*$/, ''));
}

function point(x, y, projection) {
  const east = Number(String(x || '').trim());
  const north = Number(String(y || '').trim());
  if (!east || !north || !Number.isFinite(east) || !Number.isFinite(north)) return null;
  const [lon, lat] = proj4(projection, 'WGS84', [east, north]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 37.4 || lat > 37.75 || lon < 126.7 || lon > 127.25) return null;
  return { lat, lon };
}

function permitPoint(row) {
  const oldPoint = point(row['좌표정보(X)'], row['좌표정보(Y)'], EPSG5174);
  const newPoint = point(row['X좌표'], row['Y좌표'], EPSG5179);
  if (oldPoint && newPoint && distanceMeters(oldPoint.lat, oldPoint.lon, newPoint.lat, newPoint.lon) > 100) return null;
  return newPoint || oldPoint;
}

async function importCoordinates(csvPath, outputPath = path.join(__dirname, '../locations.db')) {
  if (!fs.existsSync(csvPath)) throw new Error(`CSV를 찾지 못했습니다: ${csvPath}`);
  const sourceDb = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  const targets = new Map();
  for (const row of sourceDb.prepare("SELECT DISTINCT address FROM restaurants WHERE status='영업' AND address LIKE '서울%' AND address IS NOT NULL").iterate()) {
    targets.set(normalizeAddress(row.address), null);
  }
  sourceDb.close();

  const conflicts = new Set();
  const stats = { csvRows: 0, matchingRows: 0, rowsWithCoordinates: 0, crossSourceConflicts: 0, addressConflicts: 0 };
  const parser = fs.createReadStream(csvPath).pipe(iconv.decodeStream('cp949')).pipe(parse({ headers: true, ignoreEmpty: true }));
  for await (const row of parser) {
    stats.csvRows++;
    const address = permitAddress(row['지번주소']);
    if (!targets.has(address) || conflicts.has(address)) continue;
    stats.matchingRows++;
    const oldPoint = point(row['좌표정보(X)'], row['좌표정보(Y)'], EPSG5174);
    const newPoint = point(row['X좌표'], row['Y좌표'], EPSG5179);
    if (oldPoint && newPoint && distanceMeters(oldPoint.lat, oldPoint.lon, newPoint.lat, newPoint.lon) > 100) {
      stats.crossSourceConflicts++;
      conflicts.add(address);
      targets.set(address, null);
      continue;
    }
    const location = newPoint || oldPoint;
    if (!location) continue;
    stats.rowsWithCoordinates++;
    const current = targets.get(address);
    if (current && distanceMeters(current.lat, current.lon, location.lat, location.lon) > 100) {
      conflicts.add(address);
      targets.set(address, null);
      stats.addressConflicts++;
    } else if (!current) targets.set(address, location);
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
      VALUES (?, ?, ?, 'ok', datetime('now'), 'Seoul Open Data OA-23056')
      ON CONFLICT(address_key) DO UPDATE SET lat=excluded.lat, lon=excluded.lon,
      status='ok', checked_at=excluded.checked_at, source=excluded.source`);
    const clearConflict = db.prepare("DELETE FROM locations WHERE address_key=? AND source='Seoul Open Data OA-23056'");
    const insertAll = db.transaction(() => {
      for (const address of conflicts) clearConflict.run(address);
      for (const [address, location] of targets) if (location && !conflicts.has(address)) save.run(address, location.lat, location.lon);
    });
    insertAll();
    db.pragma('wal_checkpoint(TRUNCATE)');
    stats.locatedAddresses = db.prepare("SELECT COUNT(*) n FROM locations WHERE status='ok'").get().n;
  } finally { db.close(); }
  stats.targetAddresses = targets.size;
  stats.unlocatedAddresses = targets.size - stats.locatedAddresses;
  return stats;
}

if (require.main === module) {
  importCoordinates(process.argv[2], process.argv[3]).then(stats => console.log(JSON.stringify(stats, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { permitAddress, permitPoint, importCoordinates, point, EPSG5174, EPSG5179 };
