const test = require('node:test');
const assert = require('node:assert/strict');
const { seoulParcelKey, gyeonggiParcelKey } = require('../geo-locations');
const { sourcePoint } = require('../scripts/import-gyeonggi-public-coordinates');

test('parcel matching removes floor details without crossing provinces, cities or lot numbers', () => {
  assert.equal(seoulParcelKey('서울특별시 송파구 신천동 29 롯데월드타워 81F'), '서울 송파구 신천동 29');
  assert.equal(gyeonggiParcelKey('경기도 수원시 팔달구 인계동 1111-2 (1층)'), '경기 수원시 팔달구 인계동 1111-2');
  assert.notEqual(gyeonggiParcelKey('경기 수원시 팔달구 인계동 1111-2'), gyeonggiParcelKey('경기 성남시 분당구 인계동 1111-2'));
  assert.notEqual(gyeonggiParcelKey('경기 수원시 팔달구 인계동 1111-2'), gyeonggiParcelKey('경기 수원시 팔달구 인계동 1111-3'));
  assert.equal(gyeonggiParcelKey('서울 송파구 신천동 29'), null);
});

test('permit latitude and longitude must be numeric and near Gyeonggi', () => {
  assert.deepEqual(sourcePoint({ 위도: '37.2636', 경도: '127.0286' }), { lat: 37.2636, lon: 127.0286 });
  assert.equal(sourcePoint({ 위도: '', 경도: '127.0286' }), null);
  assert.equal(sourcePoint({ 위도: '35.2636', 경도: '127.0286' }), null);
});
