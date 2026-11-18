// Match reviewed restaurant road addresses to coordinates in the public
// Small Enterprise business directory, without accepting district centroids.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parse } = require('@fast-csv/parse');
const { normalizeAddress, distanceMeters } = require('../geo-locations');
const reviews = require('./geo-reviewed-roads.json');

const cleanName = value => String(value || '').normalize('NFKC').replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const distance = (a, b) => distanceMeters(a.lat, a.lon, b.lat, b.lon);

async function main(file, write) {
  if (!fs.existsSync(file)) throw new Error(`CSV not found: ${file}`);
  const restaurants = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  const locations = new Database(path.join(__dirname, '../locations.db'));
  try {
    const exists = restaurants.prepare("SELECT 1 FROM restaurants WHERE status='영업' AND name=? AND address=? LIMIT 1");
    const targets = reviews.map(review => {
      if (!exists.get(review.name, review.source)) throw new Error(`Restaurant mismatch: ${review.name}`);
      if (!/^https:\/\//.test(review.evidence)) throw new Error(`Missing evidence: ${review.name}`);
      const city = normalizeAddress(review.source).split(' ')[1];
      return { ...review, city, regex: new RegExp(`(?:^|\\s)${escape(review.road)}(?=$|[\\s(,])`), points: [] };
    });
    for await (const row of fs.createReadStream(file).pipe(parse({ headers: true, ignoreEmpty: true }))) {
      const road = normalizeAddress(row['도로명주소'] || '');
      const lat = Number(row['위도']), lon = Number(row['경도']);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 36.8 || lat > 38.35 || lon < 126.35 || lon > 127.9) continue;
      for (const target of targets) {
        if (road.includes(` ${target.city} `) && target.regex.test(road)) {
          target.points.push({ lat, lon, name: cleanName(row['상호명']) });
        }
      }
    }
    const save = locations.prepare(`INSERT INTO locations(address_key,lat,lon,status,checked_at,source)
      VALUES (?, ?, ?, 'ok', datetime('now'), ?)
      ON CONFLICT(address_key) DO UPDATE SET lat=excluded.lat,lon=excluded.lon,status='ok',
        checked_at=excluded.checked_at,source=excluded.source WHERE locations.status!='ok'`);
    const unresolved = [], selected = [];
    for (const target of targets) {
      const targetName = cleanName(target.name);
      const named = target.points.filter(point => point.name === targetName ||
        (point.name.length >= 6 && targetName.startsWith(point.name)));
      const points = named.length ? named : target.points;
      if (!points.length) { unresolved.push({ name: target.name, reason: 'no road record' }); continue; }
      const spread = Math.max(...points.map(point => distance(points[0], point)));
      if (spread > 150) { unresolved.push({ name: target.name, reason: `road spread ${Math.round(spread)}m` }); continue; }
      const point = points.reduce((best, item) => {
        const cost = points.reduce((sum, other) => sum + distance(item, other), 0);
        return !best || cost < best.cost ? { ...item, cost } : best;
      }, null);
      selected.push({ name: target.name, lat: point.lat, lon: point.lon, spread: Math.round(spread), matchedBusiness: named.length > 0 });
      if (write) save.run(normalizeAddress(target.source), point.lat, point.lon,
        `Reviewed road address, Small Enterprise public directory: ${target.evidence}`);
    }
    if (write) locations.pragma('wal_checkpoint(TRUNCATE)');
    console.log(JSON.stringify({ reviewed: targets.length, matched: selected.length, selected, unresolved, wrote: write }, null, 2));
  } finally { restaurants.close(); locations.close(); }
}

if (require.main === module) main(process.argv.find(arg => arg.endsWith('.csv')), process.argv.includes('--write'))
  .catch(error => { console.error(error); process.exitCode = 1; });
