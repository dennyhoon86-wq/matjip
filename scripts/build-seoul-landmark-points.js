// Reviewed, one-time conversion of research candidates into shipped static data.
// Never use Nominatim as a runtime search service.
const fs = require('node:fs');
const path = require('node:path');
const { DISTRICTS } = require('../seoul-landmarks');

const candidates = require('../landmark-candidates.json');
const source = 'OpenStreetMap contributors';
const osm = (lat, lon, label) => ({ lat, lon, source, sourceUrl: 'https://www.openstreetmap.org/copyright', pointLabel: label });
const selectedIndex = {
  '성동구:서울숲': 1,
  '성동구:디뮤지엄': 1,
  '성동구:한양대학교병원': 1,
  '은평구:은평성모병원': 1,
  '영등포구:국회의사당': 1,
  '강남구:봉은사': 1,
  '강동구:중앙보훈병원': 1,
  '서초구:예술의전당': 2,
};
// Sites whose first geocoder hit was a subway stop, bus stop, a tenant, an old
// location, or a namesake outside the district have independently checked anchors.
const reviewed = {
  '종로구:경복궁 광화문': osm(37.576072552, 126.976804239, '경복궁 광화문'),
  '종로구:창덕궁 돈화문': osm(37.5779, 126.989969, '창덕궁 돈화문'),
  '용산구:아이파크몰 용산점': osm(37.5292503, 126.9641779, '아이파크몰 디지털전문점'),
  '용산구:리움미술관': osm(37.5381679, 126.9986538, '리움미술관'),
  '성북구:성신여자대학교': osm(37.5913559, 127.0222074, '성신여자대학교 서울캠퍼스'),
  '강북구:북서울꿈의숲': osm(37.6209409, 127.0419756, '북서울꿈의숲 공원'),
  '도봉구:서울시립 사진미술관': {
    lat: 37.655407132, lon: 127.048946313, source: '서울시 지도',
    sourceUrl: 'https://map.seoul.go.kr/smgis2/poiViewMap?ti=100021&pi=art_si_007&lang=ko',
    pointLabel: '서울시립 사진미술관',
  },
  '노원구:서울시립 북서울미술관': osm(37.6408003, 127.0667787, '서울시립 북서울미술관'),
  '노원구:화랑대 철도공원': osm(37.6242884, 127.0933069, '화랑대역사관'),
  '은평구:롯데몰 은평점': osm(37.6371777, 126.9179672, '롯데몰 은평'),
  '양천구:현대백화점 목동점': osm(37.52652, 126.8752476, '현대백화점 목동점'),
  '양천구:목동종합운동장': osm(37.5305582, 126.8808949, '목동주경기장'),
  '강서구:롯데몰 김포공항점': {
    lat: 37.5621960337, lon: 126.8015844987, source: '한국관광공사',
    sourceUrl: 'https://data.visitkorea.or.kr/linkedview/1535690',
    pointLabel: '롯데몰 김포공항점',
  },
  '금천구:서울시립 서서울미술관': osm(37.4577864, 126.895604, '서울시립 서서울미술관'),
  '영등포구:IFC몰': osm(37.5252799, 126.925761, 'IFC Seoul Mall'),
  '관악구:서울시립 남서울미술관': osm(37.4760266, 126.9794812, '서울시립 남서울미술관 건물'),
  '서초구:센트럴시티': osm(37.5038414, 127.0062828, '센트럴시티 파미에스테이션'),
  '강남구:스타필드 코엑스몰': osm(37.5118733, 127.0591105, '코엑스 복합시설'),
  '송파구:가락몰': osm(37.4953575, 127.1156921, '가락몰 업무동'),
};
const aliases = {
  '강동구:이케아 강동점': '강동 이케아 IKEA',
  '강남구:스타필드 코엑스몰': '코엑스 COEX',
  '영등포구:더현대 서울': '더현대 여의도',
  '중구:동대문디자인플라자': 'DDP 동대문',
  '강서구:김포공항 국내선청사': '김포공항 국내선',
  '노원구:화랑대 철도공원': '화랑대역 철도공원',
  '성북구:성신여자대학교': '성신여대',
  '서대문구:이화여자대학교': '이화여대',
  '마포구:홍익대학교': '홍익대 홍대',
};
const oldName = {
  '성북구:성신여자대학교': '성북구:성신여자대학교 정문',
  '서대문구:이화여자대학교': '서대문구:이화여자대학교 정문',
  '마포구:홍익대학교': '마포구:홍익대학교 정문',
};

const points = {};
for (const [district, names] of DISTRICTS) for (const name of names) {
  const key = `${district}:${name}`;
  let point = reviewed[key];
  if (!point) {
    const candidate = candidates[oldName[key] || key]?.candidates?.[selectedIndex[key] || 0];
    if (!candidate) throw new Error(`No reviewed point: ${key}`);
    if (!candidate.displayName.includes(district)) throw new Error(`Wrong district: ${key} => ${candidate.displayName}`);
    if (['bus_stop', 'stop', 'beauty', 'hairdresser', 'restaurant', 'fast_food', 'bicycle_rental'].includes(candidate.type)) {
      throw new Error(`Unreviewed unrelated feature: ${key} => ${candidate.type}`);
    }
    point = {
      lat: candidate.lat, lon: candidate.lon, pointLabel: candidate.name || name,
      source, sourceUrl: `https://www.openstreetmap.org/${candidate.osmType}/${candidate.osmId}`,
    };
  }
  if (!(point.lat > 37.4 && point.lat < 37.7 && point.lon > 126.7 && point.lon < 127.2)) throw new Error(`Coordinate out of Seoul: ${key}`);
  points[key] = { ...point, aliases: aliases[key] || '' };
}
if (Object.keys(points).length !== 82) throw new Error(`Expected 82 points, got ${Object.keys(points).length}`);
fs.writeFileSync(path.join(__dirname, '../seoul-landmark-points.json'), JSON.stringify(points, null, 2) + '\n');
console.log(`Reviewed ${Object.keys(points).length} static Seoul landmarks.`);
