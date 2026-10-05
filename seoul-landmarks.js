// Curated Seoul landmarks. Coordinates live in a separately reviewed, openly
// attributed data file; no third-party place search runs during user requests.
const fs = require('node:fs');
const path = require('node:path');
const DISTRICTS = [
  ['종로구', ['경복궁 광화문', '창덕궁 돈화문', '세종문화회관', '국립현대미술관 서울', '광장시장', '통인시장', '서울대학교병원']],
  ['중구', ['동대문디자인플라자', '남대문시장', '명동성당', '서울역', '서울시립미술관 서소문본관', '장충체육관']],
  ['용산구', ['국립중앙박물관', '아이파크몰 용산점', '전쟁기념관', '리움미술관', '서울중앙성원']],
  ['성동구', ['서울숲', '디뮤지엄', '한양대학교병원']],
  ['광진구', ['서울어린이대공원', '건국대학교병원']],
  ['동대문구', ['경동시장', '경희의료원']],
  ['중랑구', ['서울의료원']],
  ['성북구', ['고려대학교 안암병원', '성신여자대학교']],
  ['강북구', ['북서울꿈의숲']],
  ['도봉구', ['서울시립 사진미술관', '서울로봇인공지능과학관']],
  ['노원구', ['서울시립 북서울미술관', '화랑대 철도공원']],
  ['은평구', ['롯데몰 은평점', '은평성모병원']],
  ['서대문구', ['세브란스병원', '서대문형무소역사관', '이화여자대학교']],
  ['마포구', ['서울월드컵경기장', '망원시장', '홍익대학교']],
  ['양천구', ['이대목동병원', '현대백화점 목동점', '목동종합운동장']],
  ['강서구', ['김포공항 국내선청사', '롯데몰 김포공항점', '서울식물원', 'LG아트센터 서울', '이대서울병원']],
  ['구로구', ['고척스카이돔', '고려대학교 구로병원']],
  ['금천구', ['마리오아울렛', '서울시립 서서울미술관']],
  ['영등포구', ['더현대 서울', 'IFC몰', '타임스퀘어', '국회의사당']],
  ['동작구', ['노량진수산시장', '중앙대학교병원']],
  ['관악구', ['서울시립 남서울미술관', '낙성대공원']],
  ['서초구', ['예술의전당', '서울성모병원', '센트럴시티', 'aT센터', '국립중앙도서관']],
  ['강남구', ['스타필드 코엑스몰', '삼성서울병원', '봉은사', '도산공원', 'SETEC']],
  ['송파구', ['롯데월드몰', '롯데월드 어드벤처', 'KSPO DOME', '석촌호수', '서울아산병원', '가락몰', '잠실야구장']],
  ['강동구', ['이케아 강동점', '강동경희대학교병원', '중앙보훈병원', '강동아트센터']],
];

const pointsPath = path.join(__dirname, 'seoul-landmark-points.json');
const points = fs.existsSync(pointsPath) ? JSON.parse(fs.readFileSync(pointsPath, 'utf8')) : {};
const LANDMARKS = Object.freeze(DISTRICTS.flatMap(([district, names]) => names.map(name => {
  const id = `${district}:${name}`;
  return Object.freeze({ id, district, name, ...points[id] });
})));

function findLandmarks(query, district = '') {
  const tokens = String(query || '').normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return LANDMARKS.filter(place => !district || place.district === district)
    .filter(place => {
      const searchable = `${place.name} ${place.district} ${place.aliases || ''}`.toLowerCase();
      return tokens.every(token => searchable.includes(token));
    })
    .sort((a, b) => {
      const aExact = a.name === query ? 0 : 1;
      const bExact = b.name === query ? 0 : 1;
      return aExact - bExact || a.name.localeCompare(b.name, 'ko');
    }).slice(0, 12);
}

module.exports = { DISTRICTS, LANDMARKS, findLandmarks };
