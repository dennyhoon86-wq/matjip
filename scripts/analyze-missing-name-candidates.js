const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parse } = require('@fast-csv/parse');
const { normalizeAddress, seoulParcelKey, gyeonggiParcelKey, distanceMeters } = require('../geo-locations');

const cleanName = value => String(value || '').normalize('NFKC').replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();
const parcelKey = address => address.startsWith('서울 ') ? seoulParcelKey(address) : gyeonggiParcelKey(address);
const city = address => {
  const parts = normalizeAddress(address).split(' ');
  return parts[0] === '서울' ? parts.slice(0, 2).join(' ') : parts.slice(0, 2).join(' ');
};
const compatibleRegion = (target, candidate) => {
  const wanted = target.split(' '), actual = candidate.split(' ');
  return city(target) === city(candidate) &&
    (!wanted[2]?.endsWith('구') || actual[2] === wanted[2]);
};

async function main() {
  const restaurants = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
  const locations = new Database(path.join(__dirname, '../locations.db'), { readonly: true });
  const existing = new Set(locations.prepare("SELECT address_key FROM locations WHERE status='ok'").all().map(r => r.address_key));
  const targets = new Map();
  for (const row of restaurants.prepare("SELECT name,address FROM restaurants WHERE status='영업' AND address IS NOT NULL").iterate()) {
    const address = normalizeAddress(row.address);
    if (!['서울', '경기'].includes(address.split(' ')[0])) continue;
    const key = parcelKey(address);
    if (existing.has(address) || (key && existing.has(key))) continue;
    const name = cleanName(row.name);
    const list = targets.get(name) || [];
    list.push({ name: row.name, address, key });
    targets.set(name, list);
  }
  const candidates = new Map();
  for (const file of process.argv.slice(2).filter(arg => arg !== '--write')) {
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
    for await (const row of fs.createReadStream(file).pipe(parse({ headers: true, ignoreEmpty: true }))) {
      const name = cleanName(row['상호명']);
      if (!targets.has(name)) continue;
      const address = normalizeAddress(row['지번주소']);
      const matches = targets.get(name).filter(target => compatibleRegion(target.address, address));
      if (!matches.length) continue;
      const lat = Number(row['위도']), lon = Number(row['경도']);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      for (const target of matches) {
        const targetId = `${name}|${target.address}`;
        const list = candidates.get(targetId) || [];
        list.push({ source: path.basename(file), name: row['상호명'], address, lat, lon,
          administrativeDong: row['행정동명'], legalDong: row['법정동명'],
          sameLot: target.key?.split(' ').at(-1) === parcelKey(address)?.split(' ').at(-1),
          sameDistrict: target.key?.split(' ').slice(0, -2).join(' ') === parcelKey(address)?.split(' ').slice(0, -2).join(' ') });
        candidates.set(targetId, list);
      }
    }
  }
  const output = [...targets.values()].flat().map(target => ({ ...target, candidates: candidates.get(`${cleanName(target.name)}|${target.address}`) || [] }));
  const safeByAddress = new Map();
  const conflicts = new Set();
  for (const target of output) {
    if (!target.key) continue;
    const sourceDong = target.key.split(' ').at(-2);
    const exact = target.candidates.filter(candidate => candidate.sameLot &&
      (sourceDong === candidate.administrativeDong || sourceDong === candidate.legalDong));
    if (!exact.length) continue;
    const first = exact[0];
    if (exact.some(candidate => distanceMeters(first.lat, first.lon, candidate.lat, candidate.lon) > 30)) {
      conflicts.add(target.address); continue;
    }
    const prior = safeByAddress.get(target.address);
    if (prior && distanceMeters(prior.lat, prior.lon, first.lat, first.lon) > 30) {
      conflicts.add(target.address); continue;
    }
    safeByAddress.set(target.address, first);
  }
  for (const address of conflicts) safeByAddress.delete(address);
  if (process.argv.includes('--write')) {
    const writable = new Database(path.join(__dirname, '../locations.db'));
    try {
      const save = writable.prepare(`INSERT INTO locations(address_key,lat,lon,status,checked_at,source)
        VALUES (?, ?, ?, 'ok', datetime('now'), 'Small Enterprise public directory: exact business name, lot, administrative/legal dong')
        ON CONFLICT(address_key) DO NOTHING`);
      writable.transaction(() => { for (const [address, point] of safeByAddress) save.run(address, point.lat, point.lon); })();
      writable.pragma('wal_checkpoint(TRUNCATE)');
    } finally { writable.close(); }
  }
  const stats = { total: output.length, withCandidate: output.filter(x => x.candidates.length).length,
    sameLot: output.filter(x => x.candidates.some(c => c.sameLot)).length,
    safeAddresses: safeByAddress.size, conflicts: conflicts.size, wrote: process.argv.includes('--write') };
  console.log(JSON.stringify({ stats, rows: output.filter(x => x.candidates.length) }, null, 2));
  restaurants.close(); locations.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
