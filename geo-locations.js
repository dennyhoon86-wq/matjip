const proj4 = require('proj4');

// 행정안전부 좌표제공 API: GRS80 UTM-K (EPSG:5179).
const UTM_K = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs';
const PROVINCES = [
  [/^서울특별시\s+/, '서울 '], [/^부산광역시\s+/, '부산 '], [/^대구광역시\s+/, '대구 '],
  [/^인천광역시\s+/, '인천 '], [/^광주광역시\s+/, '광주 '], [/^대전광역시\s+/, '대전 '],
  [/^울산광역시\s+/, '울산 '], [/^세종특별자치시\s+/, '세종 '],
  [/^경기도\s+/, '경기 '], [/^강원특별자치도\s+/, '강원 '], [/^강원도\s+/, '강원 '],
  [/^충청북도\s+/, '충북 '], [/^충청남도\s+/, '충남 '],
  [/^전북특별자치도\s+/, '전북 '], [/^전라북도\s+/, '전북 '], [/^전라남도\s+/, '전남 '],
  [/^경상북도\s+/, '경북 '], [/^경상남도\s+/, '경남 '],
  [/^제주특별자치도\s+/, '제주 '], [/^제주도\s+/, '제주 '],
];

function normalizeAddress(address) {
  let value = String(address || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of PROVINCES) value = value.replace(pattern, replacement);
  return value;
}

function exactAddressCandidate(address, candidates) {
  const wanted = normalizeAddress(address);
  if (!wanted) return null;
  const matched = (candidates || []).filter(row => normalizeAddress(row.jibunAddr) === wanted);
  if (!matched.length) return null;
  const buildingIds = new Set(matched.map(row => row.bdMgtSn || [row.admCd, row.rnMgtSn, row.udrtYn, row.buldMnnm, row.buldSlno].join('|')));
  return buildingIds.size === 1 ? matched[0] : null;
}

function toWgs84(x, y) {
  const east = Number(x), north = Number(y);
  if (!Number.isFinite(east) || !Number.isFinite(north) || east < 700000 || east > 1400000 || north < 1200000 || north > 2700000) return null;
  const [lon, lat] = proj4(UTM_K, 'WGS84', [east, north]);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat > 32 && lat < 40 && lon > 124 && lon < 132 ? { lat, lon } : null;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { normalizeAddress, exactAddressCandidate, toWgs84, distanceMeters };
