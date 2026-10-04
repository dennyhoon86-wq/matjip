const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAddress, exactAddressCandidate, toWgs84, distanceMeters } = require('../geo-locations');
const { geocode } = require('../juso-client');

test('지번 주소는 공백과 시도 표기를 정규화하되 다른 시군구는 섞지 않는다', () => {
  assert.equal(normalizeAddress('서울특별시 강동구 천호동\u00a0 123-4'), '서울 강동구 천호동 123-4');
  assert.equal(normalizeAddress('강원특별자치도 강릉시 교동 17'), '강원 강릉시 교동 17');
  assert.notEqual(normalizeAddress('서울 강동구 천호동 123-4'), normalizeAddress('서울 송파구 천호동 123-4'));
});

test('정확한 지번의 단일 건물만 채택한다', () => {
  const row = { jibunAddr: '서울특별시 강동구 천호동 123-4', bdMgtSn: 'A' };
  assert.equal(exactAddressCandidate('서울 강동구 천호동 123-4', [row]), row);
  assert.equal(exactAddressCandidate('서울 송파구 천호동 123-4', [row]), null);
  assert.equal(exactAddressCandidate('서울 강동구 천호동 123-4', [row, { ...row, bdMgtSn: 'B' }]), null);
});

test('행안부 UTM-K 좌표를 위경도로 변환하고 거리를 계산한다', () => {
  const point = toWgs84(1000000, 2000000);
  assert(Math.abs(point.lat - 38) < 0.00001);
  assert(Math.abs(point.lon - 127.5) < 0.00001);
  assert.equal(toWgs84(0, 0), null);
  assert.equal(Math.round(distanceMeters(37, 127, 37, 127)), 0);
  assert(distanceMeters(37, 127, 37.01, 127) > 1000);
});

test('행안부 주소검색 결과의 동일 지번만 좌표제공 API에 전달한다', async () => {
  const calls = [];
  const fakeFetch = async url => {
    calls.push(url);
    const juso = url.pathname.endsWith('addrLinkApi.do')
      ? [{ jibunAddr: '서울특별시 강동구 천호동 123-4', bdMgtSn: 'A', admCd: '1174010100', rnMgtSn: '117404172001', udrtYn: '0', buldMnnm: '1', buldSlno: '0' }]
      : [{ entX: '1000000', entY: '2000000' }];
    return new Response(JSON.stringify({ results: { common: { errorCode: '0' }, juso } }), { status: 200 });
  };
  const result = await geocode('서울 강동구 천호동 123-4', { addressKey: 'address-test', coordKey: 'coord-test' }, fakeFetch);
  assert.equal(result.status, 'ok');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get('confmKey'), 'address-test');
  assert.equal(calls[1].searchParams.get('confmKey'), 'coord-test');
  assert.equal(calls[1].searchParams.get('admCd'), '1174010100');
  assert.equal(calls[1].searchParams.get('udrtYn'), '0');
  calls.length = 0;
  assert.deepEqual(await geocode('서울 송파구 천호동 123-4', { addressKey: 'address-test', coordKey: 'coord-test' }, fakeFetch), { status: 'ambiguous_or_inexact' });
  assert.equal(calls.length, 1);
});
