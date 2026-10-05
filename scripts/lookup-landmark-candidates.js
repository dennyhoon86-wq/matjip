// One-time, single-threaded research only; never call Nominatim from the site.
// Follow https://operations.osmfoundation.org/policies/nominatim/ (<=1 request/s,
// identifying User-Agent, local cache, attribution). The output needs human QA.
const fs = require('node:fs');
const path = require('node:path');
const { LANDMARKS } = require('../seoul-landmarks');

const output = path.join(__dirname, '../landmark-candidates.json');
const cached = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : {};
const aliases = {
  '경복궁 광화문': 'Gwanghwamun',
  '창덕궁 돈화문': 'Donhwamun',
  '이케아 강동점': 'IKEA Gangdong Seoul',
  '성신여자대학교 정문': 'Sungshin Womens University Seoul',
  '이화여자대학교 정문': 'Ewha Womans University Seoul',
  '홍익대학교 정문': 'Hongik University Seoul',
  '서울시립미술관 서소문본관': 'Seoul Museum of Art',
  '서울중앙성원': 'Seoul Central Mosque',
  '한양대학교병원': 'Hanyang University Hospital',
  '서울시립 사진미술관': 'Seoul Museum of Photography',
  '서울시립 북서울미술관': 'Buk Seoul Museum of Art',
  '화랑대 철도공원': 'Hwarangdae Railway Park',
  '김포공항 국내선청사': 'Gimpo International Airport domestic terminal',
  '롯데몰 김포공항점': 'Lotte Mall Gimpo Airport',
  '고려대학교 구로병원': 'Korea University Guro Hospital',
  '서울시립 서서울미술관': 'Seoseoul Museum of Art',
  '서울시립 남서울미술관': 'Namseoul Museum of Art',
  '스타필드 코엑스몰': 'Starfield COEX Mall',
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let previousRequest = 0;

async function lookup(query) {
  const elapsed = Date.now() - previousRequest;
  if (elapsed < 1200) await pause(1200 - elapsed);
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  previousRequest = Date.now();
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MisikJangbuLandmarkResearch/1.0 (https://github.com/dennyhoon86-wq/matjip)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  return (await response.json()).map(item => ({
    name: item.name || '', displayName: item.display_name, lat: Number(item.lat), lon: Number(item.lon),
    category: item.category, type: item.type, osmType: item.osm_type, osmId: item.osm_id,
    address: item.address,
  }));
}

async function main() {
  for (const [i, item] of LANDMARKS.entries()) {
    const key = `${item.district}:${item.name}`;
    if (cached[key]?.candidates?.length) continue;
    const query = aliases[item.name] || `${item.name} 서울`;
    let candidates = await lookup(query);
    if (!candidates.length && !aliases[item.name]) candidates = await lookup(item.name);
    cached[key] = { query, candidates };
    fs.writeFileSync(output, JSON.stringify(cached, null, 2));
    console.log(`${i + 1}/${LANDMARKS.length} ${key}: ${candidates.length}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
