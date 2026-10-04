const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { normalizeAddress } = require('../geo-locations');
const file = path.join(__dirname, '../locations.db');
if (!fs.existsSync(file)) { console.log('아직 locations.db가 없습니다.'); process.exit(0); }
const locationDb = new Database(file, { readonly: true });
const restaurantDb = new Database(path.join(__dirname, '../matjip.db'), { readonly: true });
const good = new Set(locationDb.prepare("SELECT address_key FROM locations WHERE status='ok'").all().map(r => r.address_key));
const rows = restaurantDb.prepare("SELECT address FROM restaurants WHERE status='영업'").all();
const stats = new Map();
for (const row of rows) {
  const address = normalizeAddress(row.address);
  const region = address.split(' ')[0] || '주소없음';
  const item = stats.get(region) || { region, total: 0, located: 0 };
  item.total++;
  if (good.has(address)) item.located++;
  stats.set(region, item);
}
const coverage = item => ({ ...item, coverage: `${(item.located / item.total * 100).toFixed(1)}%` });
console.table([...stats.values()].sort((a, b) => b.total - a.total).map(coverage));
console.log('좌표 변환 상태:', locationDb.prepare('SELECT status,COUNT(*) count FROM locations GROUP BY status').all());
locationDb.close(); restaurantDb.close();
