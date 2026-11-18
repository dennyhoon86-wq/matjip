const path = require('node:path');
const Database = require('better-sqlite3');
const { normalizeAddress } = require('../geo-locations');
const points = require('./geo-reviewed-points.json');

const restaurants = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
const locations = new Database(path.join(__dirname, '../locations.db'));
try {
  const exists = restaurants.prepare("SELECT 1 FROM restaurants WHERE status='영업' AND name=? AND address=? LIMIT 1");
  const save = locations.prepare(`INSERT INTO locations(address_key,lat,lon,status,checked_at,source)
    VALUES (?, ?, ?, 'ok', datetime('now'), ?)
    ON CONFLICT(address_key) DO UPDATE SET lat=excluded.lat, lon=excluded.lon,
      status='ok', checked_at=excluded.checked_at, source=excluded.source
    WHERE locations.status!='ok'`);
  for (const point of points) {
    if (!exists.get(point.name, point.source)) throw new Error(`Restaurant mismatch: ${point.name}`);
    if (!(point.lat > 36.8 && point.lat < 38.35 && point.lon > 126.35 && point.lon < 127.9)) {
      throw new Error(`Invalid coordinate: ${point.name}`);
    }
    if (!/^https:\/\//.test(point.evidence)) throw new Error(`Missing evidence: ${point.name}`);
  }
  if (process.argv.includes('--write')) {
    locations.transaction(() => {
      for (const point of points) save.run(normalizeAddress(point.source), point.lat, point.lon,
        `Reviewed public business location: ${point.evidence}`);
    })();
    locations.pragma('wal_checkpoint(TRUNCATE)');
  }
  console.log(JSON.stringify({ reviewed: points.length, wrote: process.argv.includes('--write') }));
} finally {
  restaurants.close();
  locations.close();
}
