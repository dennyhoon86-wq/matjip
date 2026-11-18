// Recover Seoul parcels written without the numeric legal-dong suffix,
// notably 동작구 상도동 where public records use 상도1동.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parse } = require('@fast-csv/parse');
const { normalizeAddress, seoulParcelKey, distanceMeters } = require('../geo-locations');

const repo = path.join(__dirname, '..');
const cleanName = value => String(value || '').normalize('NFKC').replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();
const distance = (a, b) => distanceMeters(a.lat, a.lon, b.lat, b.lon);

function withoutDongNumber(key) {
  const parts = key.split(' ');
  if (parts.length !== 4 || !/^.+\d동$/.test(parts[2])) return null;
  parts[2] = parts[2].replace(/\d+동$/, '동');
  return parts.join(' ');
}

async function main(file, write) {
  const restaurants = new Database(path.join(repo, 'matjip.db'), { readonly: true });
  const locations = new Database(path.join(repo, 'locations.db'));
  try {
    const existing = new Set(locations.prepare("SELECT address_key FROM locations WHERE status='ok'").all().map(r => r.address_key));
    const targets = new Map();
    for (const row of restaurants.prepare("SELECT name,address FROM restaurants WHERE status='영업' AND address LIKE '서울 %'").iterate()) {
      const key = seoulParcelKey(row.address), address = normalizeAddress(row.address);
      if (!key || existing.has(key) || existing.has(address)) continue;
      const names = targets.get(key) || new Set();
      names.add(cleanName(row.name));
      targets.set(key, names);
    }
    const candidates = new Map();
    if (!fs.existsSync(file)) throw new Error(`CSV not found: ${file}`);
    for await (const row of fs.createReadStream(file).pipe(parse({ headers: true, ignoreEmpty: true }))) {
      const key = seoulParcelKey(row['지번주소'] || ''), short = key && withoutDongNumber(key);
      if (!short || !targets.has(short)) continue;
      const lat = Number(row['위도']), lon = Number(row['경도']);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 37.3 || lat > 37.8 || lon < 126.7 || lon > 127.3) continue;
      const list = candidates.get(short) || [];
      list.push({ key, lat, lon, name: cleanName(row['상호명']) });
      candidates.set(short, list);
    }
    const safe = new Map(), conflicts = [];
    for (const [short, points] of candidates) {
      if (new Set(points.map(point => point.key)).size !== 1) {
        conflicts.push({ short, reason: 'multiple legal parcels' }); continue;
      }
      if (points.every(point => distance(points[0], point) <= 50)) { safe.set(short, points[0]); continue; }
      const named = points.filter(point => targets.get(short).has(point.name));
      if (named.length && named.every(point => distance(named[0], point) <= 30)) {
        safe.set(short, named[0]); continue;
      }
      conflicts.push({ short, reason: 'coordinate spread' });
    }
    if (write) {
      const save = locations.prepare(`INSERT INTO locations(address_key,lat,lon,status,checked_at,source)
        VALUES (?, ?, ?, 'ok', datetime('now'), 'Small Enterprise public directory: exact Seoul parcel with legal-dong numeric suffix')
        ON CONFLICT(address_key) DO NOTHING`);
      locations.transaction(() => { for (const [key, point] of safe) save.run(key, point.lat, point.lon); })();
      locations.pragma('wal_checkpoint(TRUNCATE)');
    }
    console.log(JSON.stringify({ targets: targets.size, candidates: candidates.size, safe: safe.size,
      conflicts, wrote: write }, null, 2));
  } finally { restaurants.close(); locations.close(); }
}

if (require.main === module) main(process.argv[2], process.argv.includes('--write'))
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { withoutDongNumber };
