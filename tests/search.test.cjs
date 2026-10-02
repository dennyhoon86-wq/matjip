const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const search = require('../public/search-query');
const db = new Database(require('node:path').join(__dirname, '../matjip.db'), { readonly: true });
const v = {
  gu: db.prepare('select distinct gu from restaurants').all().map(x => x.gu),
  dong: db.prepare('select distinct dong from restaurants').all().map(x => x.dong),
  stations: db.prepare('select distinct subway from restaurants').all().map(x => x.subway),
  categories: db.prepare('select distinct category from restaurants').all().map(x => x.category),
  regions: ['서울', '지방', '제주'], badges: ['신규', '블루리본'],
};
test('regions, districts and explicit station names remain distinct', () => {
  for (const name of ['서울', '서울특별시']) { assert.equal(search.parse(`${name} 중식`, v).region, '서울'); assert.equal(search.parse(`${name} 중식`, v).station, null); }
  assert.equal(search.parse('강남 돼지고기', v).gu, '강남구');
  assert.equal(search.parse('강남역 돼지고기', v).station, '강남');
  assert.equal(search.parse('성수 한식', v).gu, '성동구');
  assert.equal(search.parse('성수역 한식', v).station, '성수');
  assert.equal(search.parse('경기도 수원 한식', v).gu, '경기');
});
test('ratings never become a budget', () => {
  for (const q of ['한식 4.6 이상', '한식 4.6점 이상', '한식 평점 4.6 이상']) {
    const s = search.parse(q, v); assert.equal(s.avgMin, 4.6); assert.equal(s.priceMin, null); assert.equal(s.priceMax, null); assert.deepEqual(s.leftoverTokens, []);
  }
  const s = search.parse('4.6점 미만 한식', v); assert.equal(s.avgMax, 4.6); assert.equal(s.avgMaxExclusive, true);
});
test('prices have units, ranges and strict upper bounds', () => {
  for (const q of ['서울 중식 3~5만원', '서울 중식 3만원~5만원']) { const s = search.parse(q, v); assert.equal(s.priceMin, 30000); assert.equal(s.priceMax, 50000); assert.equal(s.avgMin, null); assert.deepEqual(s.leftoverTokens, []); }
  assert.equal(search.parse('한식 5만원 이하', v).priceMax, 50000);
  assert.equal(search.parse('한식 50,000원 미만', v).priceMaxExclusive, true);
  assert.equal(search.parse('한식 5만원대', v).priceMin, 50000);
  assert.equal(search.parse('한식 5만원대', v).priceMax, 60000);
});
test('ordinary sentences preserve supported conditions and explain unsupported ones', () => {
  let s = search.parse('부모님 모시고 갈 조용한 한식', v);
  assert.deepEqual(s.categoryTerms, ['한식']); assert.deepEqual(s.leftoverTokens, []); assert.equal(s.notices.length, 1);
  s = search.parse('성수 4명 저녁 술 한잔 1인 5만원 이하', v);
  assert.equal(s.gu, '성동구'); assert.equal(s.priceMax, 50000); assert(s.categoryTerms.includes('이자카야')); assert.deepEqual(s.leftoverTokens, []);
  s = search.parse('성수역 한식 A 이상 4.6점 이상 신규 빼고', v);
  assert.equal(s.gradeMin, 'A'); assert.equal(s.avgMin, 4.6); assert.equal(s.excludeNew, true); assert.deepEqual(s.leftoverTokens, []);
});
test('separate name and address terms find the correct branch', () => {
  const rows = db.prepare("select * from restaurants where name = '수숯불직화꼬치바베큐'").all().map(r => ({ ...r, badges: JSON.parse(r.badges || '[]') }));
  assert.equal(rows.filter(r => search.matches(r, search.parse('송파구 수숯불', v))).length, 1);
  assert.equal(rows.filter(r => search.matches(r, search.parse('수숯불직화꼬치바베큐', v))).length, 2);
});
test('restaurant names are not stripped as sentence filler', () => {
  for (const name of ['밤나무집', '아침식당', '점심밥상', '맛집정원', '모임식당']) assert.deepEqual(search.parse(name, v).leftoverTokens, [name]);
  assert.equal(search.parse('최근 한식', v).badge, '신규');
});
test('widening removes only recognized locations, keeping names, ratings and budgets', () => {
  assert.equal(search.withoutLocation('서울 강남구 한식 4.6 이상 5만원 이하', v), '한식 4.6 이상 5만원 이하');
  assert.equal(search.withoutLocation('성수역에서 수숯불', v), '수숯불');
  assert.equal(search.withoutLocation('서울,수숯불 50,000원 이하', v), '수숯불 50,000원 이하');
  assert.equal(search.withoutLocation('밤나무집 4.6점 이상', v), '밤나무집 4.6점 이상');
  assert.equal(search.withoutLocation('부모님 모시고 갈 조용한 한식', v), '부모님 모시고 갈 조용한 한식');
});
test('personal sorts handle ties, null ratings and all five options', () => {
  const rows = [{ id: 1, name: '나', avg: 4.7, grade: 'B', badges: [] }, { id: 2, name: '가', avg: 4.1, grade: 'A', badges: [{ name: '신규' }] }, { id: 3, name: '다', avg: null, grade: null, badges: [] }];
  for (const [sort, ids] of [['avg_desc', [1, 2, 3]], ['avg_asc', [2, 1, 3]], ['grade', [2, 1, 3]], ['name', [2, 1, 3]], ['new_first', [2, 1, 3]]]) assert.deepEqual([...rows].sort(search.compare(sort)).map(r => r.id), ids);
});

