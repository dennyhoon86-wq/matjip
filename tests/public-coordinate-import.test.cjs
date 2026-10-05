const test = require('node:test');
const assert = require('node:assert/strict');
const { permitAddress, permitPoint } = require('../scripts/import-seoul-public-coordinates');
const { distanceMeters } = require('../geo-locations');

test('서울 인허가 좌표의 두 좌표계를 교차 확인한다', () => {
  const old = { '좌표정보(X)': '212104.471', '좌표정보(Y)': '448565.389' };
  const current = { X좌표: '967997.416', Y좌표: '1948950.976' };
  const oldPoint = permitPoint(old);
  const currentPoint = permitPoint(current);
  assert(oldPoint && currentPoint);
  assert(distanceMeters(oldPoint.lat, oldPoint.lon, currentPoint.lat, currentPoint.lon) < 25);
  assert(permitPoint({ ...old, ...current }));
  assert.equal(permitPoint({ ...old, X좌표: '950000', Y좌표: '1948950.976' }), null);
  assert.equal(permitAddress('서울특별시 강동구 천호동 1-1 (상세)'), '서울 강동구 천호동 1-1');
});
