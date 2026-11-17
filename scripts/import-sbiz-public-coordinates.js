// Supplement missing restaurant parcel coordinates from the public Small Enterprise
// and Market Service business directory (2022-2026 releases, data.go.kr/data/15083033).
// Usage: node scripts/import-sbiz-public-coordinates.js <Seoul CSV> <Gyeonggi CSV> [--write]
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { parse } = require('@fast-csv/parse');
const { normalizeAddress, seoulParcelKey, gyeonggiParcelKey, distanceMeters } = require('../geo-locations');

async function main(files, write) {
  const restaurants = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  const locations = new Database(path.join(__dirname, '../locations.db'));
  try {
    const existing = new Set(locations.prepare("SELECT address_key FROM locations WHERE status='ok'").all().map(r => r.address_key));
    const targets = new Map();
    for (const row of restaurants.prepare("SELECT name,address,region FROM restaurants WHERE status='영업' AND address IS NOT NULL").iterate()) {
      const address = normalizeAddress(row.address);
      const region = address.split(' ')[0];
      const key = region === '서울' ? seoulParcelKey(address) : region === '경기' ? gyeonggiParcelKey(address) : null;
      if (!key || existing.has(address) || existing.has(key)) continue;
      const names = targets.get(key) || [];
      names.push(row.name);
      targets.set(key, names);
    }
    const points = new Map();
    const stats = { targets: targets.size, scanned: 0, matchingRows: 0, invalidCoordinates: 0 };
    for (const file of files) {
      if (!fs.existsSync(file)) throw new Error(`CSV not found: ${file}`);
      for await (const row of fs.createReadStream(file).pipe(parse({ headers: true, ignoreEmpty: true }))) {
        stats.scanned++;
        const raw = row['지번주소'];
        if (!raw) continue;
        const key = raw.startsWith('서울') ? seoulParcelKey(raw) : raw.startsWith('경기') ? gyeonggiParcelKey(raw) : null;
        if (!key || !targets.has(key)) continue;
        stats.matchingRows++;
        const lat = Number(row['위도']), lon = Number(row['경도']);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 36.8 || lat > 38.35 || lon < 126.35 || lon > 127.9) {
          stats.invalidCoordinates++;
          continue;
        }
        const candidates = points.get(key) || [];
        candidates.push({ lat, lon, name: row['상호명'] });
        points.set(key, candidates);
      }
    }
    const cleanName = value => String(value || '').normalize('NFKC').replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();
    const safe = new Map(), conflict = [], nameResolved = [];
    for (const [key, candidates] of points) {
      let maxDistance = 0;
      for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
        maxDistance = Math.max(maxDistance, distanceMeters(candidates[i].lat, candidates[i].lon, candidates[j].lat, candidates[j].lon));
      }
      if (maxDistance > 100) {
        const wantedNames = new Set(targets.get(key).map(cleanName).filter(Boolean));
        const named = candidates.filter(point => wantedNames.has(cleanName(point.name)));
        let namedSpread = 0;
        for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
          namedSpread = Math.max(namedSpread, distanceMeters(named[i].lat, named[i].lon, named[j].lat, named[j].lon));
        }
        if (named.length && namedSpread <= 30) { safe.set(key, named[0]); nameResolved.push(key); continue; }
        conflict.push({ key, candidates: candidates.length, maxDistance: Math.round(maxDistance) });
        continue;
      }
      safe.set(key, candidates[0]);
    }
    if (write) {
      const save = locations.prepare(`INSERT INTO locations(address_key,lat,lon,status,checked_at,source)
        VALUES (?, ?, ?, 'ok', datetime('now'), 'Small Enterprise and Market Service public business directory 2022-2026')
        ON CONFLICT(address_key) DO NOTHING`);
      locations.transaction(() => { for (const [key, point] of safe) save.run(key, point.lat, point.lon); })();
      locations.pragma('wal_checkpoint(TRUNCATE)');
    }
    console.log(JSON.stringify({ ...stats, matchedParcels: points.size, safeParcels: safe.size,
      nameResolvedParcels: nameResolved.length, conflictParcels: conflict.length, unresolvedParcels: targets.size - safe.size,
      conflictSample: conflict.slice(0, 15), wrote: write }, null, 2));
  } finally { restaurants.close(); locations.close(); }
}

if (require.main === module) main(process.argv.slice(2, 4), process.argv.includes('--write'))
  .catch(error => { console.error(error); process.exitCode = 1; });
