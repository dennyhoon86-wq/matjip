// Supplement exact matches with verified parcel matches from Seoul's permit CSV.
// Source: https://data.seoul.go.kr/dataList/OA-23056/S/1/datasetView.do
// Usage: node scripts/import-seoul-parcel-coordinates.js <downloaded CSV> [output DB] [dataset ID]
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const iconv = require('iconv-lite');
const { parse } = require('@fast-csv/parse');
const { normalizeAddress, seoulParcelKey, distanceMeters } = require('../geo-locations');
const { permitPoint } = require('./import-seoul-public-coordinates');

async function importCoordinates(csvPath, outputPath = path.join(__dirname, '../locations.db'), datasetId = 'OA-23056') {
  if (!fs.existsSync(csvPath)) throw new Error(`CSV를 찾지 못했습니다: ${csvPath}`);
  const restaurants = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  const locations = new Database(outputPath);
  try {
    const existing = new Set(locations.prepare("SELECT address_key FROM locations WHERE status='ok'").all().map(row => row.address_key));
    const targets = new Set();
    for (const row of restaurants.prepare("SELECT DISTINCT address FROM restaurants WHERE status='영업' AND address LIKE '서울%' AND address IS NOT NULL").iterate()) {
      const key = seoulParcelKey(row.address);
      if (key && !existing.has(normalizeAddress(row.address)) && !existing.has(key)) targets.add(key);
    }
    const found = new Map(), conflicts = new Set();
    const stats = { csvRows: 0, targetParcels: targets.size, matchingRows: 0, rowsWithCoordinates: 0, addressConflicts: 0 };
    const parser = fs.createReadStream(csvPath).pipe(iconv.decodeStream('cp949')).pipe(parse({ headers: true, ignoreEmpty: true }));
    for await (const row of parser) {
      stats.csvRows++;
      const key = seoulParcelKey(row['지번주소']);
      if (!key || !targets.has(key) || conflicts.has(key)) continue;
      stats.matchingRows++;
      const point = permitPoint(row);
      if (!point) continue;
      stats.rowsWithCoordinates++;
      const current = found.get(key);
      if (current && distanceMeters(current.lat, current.lon, point.lat, point.lon) > 100) {
        conflicts.add(key); found.delete(key); stats.addressConflicts++;
      } else if (!current) found.set(key, point);
    }
    const save = locations.prepare(`INSERT INTO locations (address_key,lat,lon,status,checked_at,source)
      VALUES (?, ?, ?, 'ok', datetime('now'), ?)
      ON CONFLICT(address_key) DO UPDATE SET lat=excluded.lat, lon=excluded.lon,
      status='ok', checked_at=excluded.checked_at, source=excluded.source`);
    locations.transaction(() => { for (const [key, point] of found) save.run(key, point.lat, point.lon, `Seoul Open Data ${datasetId} parcel match`); })();
    locations.pragma('wal_checkpoint(TRUNCATE)');
    stats.locatedParcels = found.size;
    stats.unlocatedParcels = targets.size - found.size;
    return stats;
  } finally { restaurants.close(); locations.close(); }
}

if (require.main === module) importCoordinates(process.argv[2], process.argv[3], process.argv[4])
  .then(stats => console.log(JSON.stringify(stats, null, 2)))
  .catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { importCoordinates };
