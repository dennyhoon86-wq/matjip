// Fill Gyeonggi parcel coordinates where source addresses omit a gu/eup/myeon.
// Candidate parcels must be unique within their city and coordinate-consistent.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parse } = require('@fast-csv/parse');
const { normalizeAddress, gyeonggiParcelKey, distanceMeters } = require('../geo-locations');

const repo = path.join(__dirname, '..');
const cleanName = value => String(value || '').normalize('NFKC').replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();
const city = address => normalizeAddress(address).split(' ').slice(0, 2).join(' ');
const distance = (a, b) => distanceMeters(a.lat, a.lon, b.lat, b.lon);

function shortVariants(key) {
  const parts = key.split(' ');
  const removable = [];
  for (let i = 2; i < parts.length - 2; i++) {
    if (parts[i].endsWith('구') && parts[i - 1].endsWith('시')) removable.push(i);
    if (/[읍면]$/.test(parts[i]) && parts[i + 1].endsWith('리')) removable.push(i);
  }
  const output = new Set();
  for (let mask = 1; mask < 1 << removable.length; mask++) {
    output.add(parts.filter((_, i) => !removable.some((index, bit) => index === i && (mask & (1 << bit)))).join(' '));
  }
  return [...output];
}

async function main(files, write) {
  const restaurants = new Database(path.join(repo, 'matjip.db'), { readonly: true });
  const locations = new Database(path.join(repo, 'locations.db'));
  try {
    const existing = new Set(locations.prepare("SELECT address_key FROM locations WHERE status='ok'").all().map(r => r.address_key));
    const targets = new Map();
    for (const row of restaurants.prepare("SELECT name,address FROM restaurants WHERE status='영업' AND address LIKE '경기 %'").iterate()) {
      const key = gyeonggiParcelKey(row.address), address = normalizeAddress(row.address);
      if (!key || existing.has(key) || existing.has(address)) continue;
      const names = targets.get(key) || new Set();
      names.add(cleanName(row.name));
      targets.set(key, names);
    }
    const candidates = new Map(), parents = new Map(), guParents = new Map();
    let scanned = 0;
    for (const file of files) {
      if (!fs.existsSync(file)) throw new Error(`CSV not found: ${file}`);
      for await (const row of fs.createReadStream(file).pipe(parse({ headers: true, ignoreEmpty: true }))) {
        scanned++;
        const key = gyeonggiParcelKey(row['지번주소'] || '');
        if (!key) continue;
        const parts = key.split(' '), last = parts.at(-2), parent = parts.at(-3);
        if (last.endsWith('리') && /[읍면]$/.test(parent)) {
          const id = `${city(key)}|${last}`;
          (parents.get(id) || parents.set(id, new Set()).get(id)).add(parent);
        }
        if (last.endsWith('동') && parts[2]?.endsWith('구')) {
          const id = `${city(key)}|${last}`;
          (guParents.get(id) || guParents.set(id, new Set()).get(id)).add(parts[2]);
        }
        for (const short of shortVariants(key)) {
          if (!targets.has(short)) continue;
          const lat = Number(row['위도']), lon = Number(row['경도']);
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 36.8 || lat > 38.35 || lon < 126.35 || lon > 127.9) continue;
          const list = candidates.get(short) || [];
          list.push({ key, lat, lon, name: cleanName(row['상호명']) });
          candidates.set(short, list);
        }
      }
    }
    const safe = new Map(), conflicts = [];
    for (const [short, points] of candidates) {
      const parts = short.split(' '), dong = parts.at(-2);
      if (dong.endsWith('리') && (parents.get(`${city(short)}|${dong}`)?.size || 0) !== 1) continue;
      if (dong.endsWith('동') && !parts[2]?.endsWith('구') &&
        (guParents.get(`${city(short)}|${dong}`)?.size || 0) !== 1) continue;
      const distinctParcels = new Set(points.map(point => point.key));
      if (distinctParcels.size !== 1) { conflicts.push({ short, reason: 'multiple parcels' }); continue; }
      const maxSpread = Math.max(...points.map(point => distance(points[0], point)));
      if (maxSpread <= 50) { safe.set(short, points[0]); continue; }
      const named = points.filter(point => targets.get(short).has(point.name));
      if (named.length && named.every(point => distance(named[0], point) <= 30)) {
        safe.set(short, named[0]); continue;
      }
      conflicts.push({ short, reason: `spread ${Math.round(maxSpread)}m` });
    }
    if (write) {
      const save = locations.prepare(`INSERT INTO locations(address_key,lat,lon,status,checked_at,source)
        VALUES (?, ?, ?, 'ok', datetime('now'), 'Small Enterprise public directory: unique full Gyeonggi parcel from abbreviated address')
        ON CONFLICT(address_key) DO NOTHING`);
      locations.transaction(() => { for (const [key, point] of safe) save.run(key, point.lat, point.lon); })();
      locations.pragma('wal_checkpoint(TRUNCATE)');
    }
    console.log(JSON.stringify({ targets: targets.size, scanned, candidateParcels: candidates.size,
      safeParcels: safe.size, conflicts: conflicts.length, conflictSample: conflicts.slice(0, 12), wrote: write }, null, 2));
  } finally { restaurants.close(); locations.close(); }
}

if (require.main === module) main(process.argv.slice(2).filter(x => x !== '--write'), process.argv.includes('--write'))
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { shortVariants };
