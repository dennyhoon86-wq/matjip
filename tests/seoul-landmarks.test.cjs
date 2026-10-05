const test = require('node:test');
const assert = require('node:assert/strict');
const { DISTRICTS, LANDMARKS, findLandmarks } = require('../seoul-landmarks');

test('서울 25개 구의 1차 장소 82곳은 중복 없이 구성한다', () => {
  assert.equal(DISTRICTS.length, 25);
  assert.equal(LANDMARKS.length, 82);
  const keys = LANDMARKS.map(place => `${place.district}:${place.name}`);
  assert.equal(new Set(keys).size, keys.length);
  assert(DISTRICTS.every(([district]) => LANDMARKS.some(place => place.district === district)));
  assert(LANDMARKS.some(place => place.district === '강동구' && place.name === '이케아 강동점'));
  assert(LANDMARKS.every(place => Number.isFinite(place.lat) && Number.isFinite(place.lon)));
  assert(LANDMARKS.every(place => place.lat > 37.4 && place.lat < 37.7 && place.lon > 126.7 && place.lon < 127.2));
  assert(LANDMARKS.every(place => place.source && place.sourceUrl && place.pointLabel));
  assert.deepEqual(findLandmarks('강동 이케아').map(place => place.id), ['강동구:이케아 강동점']);
  assert.deepEqual(findLandmarks('코엑스').map(place => place.id), ['강남구:스타필드 코엑스몰']);
  const mustNotBeStations = ['종로구:경복궁 광화문', '영등포구:국회의사당', '강남구:봉은사', '강동구:중앙보훈병원'];
  assert(mustNotBeStations.every(id => LANDMARKS.find(place => place.id === id).pointLabel !== '지하철역'));
});
