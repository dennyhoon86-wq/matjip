const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parse } = require('@fast-csv/parse');
const { normalizeAddress, distanceMeters } = require('../geo-locations');

const aliases = require('./geo-reviewed-aliases.json');
const cleanName = value => String(value || '').normalize('NFKC').replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();

async function main(files, write) {
  const repo = path.join(__dirname, '..');
  const restaurants = new Database(path.join(repo, 'matjip.db'), { readonly: true });
  const locations = new Database(path.join(repo, 'locations.db'));
  try {
    const candidates = new Map();
    const expected = new Map();
    const exists = restaurants.prepare("SELECT 1 FROM restaurants WHERE status='영업' AND name=? AND address=? LIMIT 1");
    for (const alias of aliases) {
      if (!exists.get(alias.name, alias.source)) throw new Error(`Restaurant mismatch: ${alias.name}`);
      expected.set(normalizeAddress(alias.verified), alias);
    }
    for (const file of files) {
      if (!fs.existsSync(file)) throw new Error(`CSV not found: ${file}`);
      for await (const row of fs.createReadStream(file).pipe(parse({ headers: true, ignoreEmpty: true }))) {
        const key = normalizeAddress(row['지번주소']);
        if (!expected.has(key)) continue;
        const lat = Number(row['위도']), lon = Number(row['경도']);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 36.8 || lat > 38.35 || lon < 126.35 || lon > 127.9) continue;
        const list = candidates.get(key) || [];
        list.push({ lat, lon, name: cleanName(row['상호명']) });
        candidates.set(key, list);
      }
    }
    const save = locations.prepare(`INSERT INTO locations(address_key,lat,lon,status,checked_at,source)
      VALUES (?, ?, ?, 'ok', datetime('now'), 'Small Enterprise public directory: reviewed business/address correction')
      ON CONFLICT(address_key) DO UPDATE SET
        lat=excluded.lat, lon=excluded.lon, status='ok', checked_at=excluded.checked_at,
        source=excluded.source
      WHERE locations.status!='ok'`);
    const unresolved = [];
    for (const [key, alias] of expected) {
      const points = candidates.get(key) || [];
      const targetName = cleanName(alias.name);
      const named = points.filter(point => point.name === targetName ||
        (point.name.length >= 6 && targetName.startsWith(point.name)));
      const selected = named.length ? named : points;
      if (!selected.length || selected.some(point => distanceMeters(selected[0].lat, selected[0].lon, point.lat, point.lon) > 50)) {
        unresolved.push(alias); continue;
      }
      if (write) save.run(normalizeAddress(alias.source), selected[0].lat, selected[0].lon);
    }
    if (write) locations.pragma('wal_checkpoint(TRUNCATE)');
    console.log(JSON.stringify({ reviewed: aliases.length, matched: aliases.length - unresolved.length,
      unresolved, wrote: write }, null, 2));
  } finally { restaurants.close(); locations.close(); }
}

main(process.argv.slice(2).filter(x => x !== '--write'), process.argv.includes('--write'))
  .catch(error => { console.error(error); process.exitCode = 1; });
