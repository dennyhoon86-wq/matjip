const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exactPoint } = require('../scripts/geocode-sgis-remaining');
const { seoulParcelKey } = require('../geo-locations');

test('SGIS accepts only an exact building or parcel match', () => {
  const item = { addr_type: '6', sido_nm: '서울특별시', sgg_nm: '종로구', leg_nm: '서린동',
    ri_nm: 'null', jibun_main_no: '154', jibun_sub_no: '1', y: '37.57', x: '126.98' };
  assert.deepEqual(exactPoint({ matching: '0', resultdata: [item] }, '서울 종로구 서린동 154-1'), { lat: 37.57, lon: 126.98 });
  assert.equal(exactPoint({ matching: '1', resultdata: [item] }, '서울 종로구 서린동 154-1'), null);
  assert.equal(exactPoint({ matching: '0', resultdata: [item] }, '서울 종로구 서린동 154-2'), null);
  assert.equal(exactPoint({ matching: '0', resultdata: [{ ...item, addr_type: '3' }] }, '서울 종로구 서린동 154-1'), null);
});

test('Sejong-ro is a legal parcel neighborhood only in the known Seoul case', () => {
  assert.equal(seoulParcelKey('서울 종로구 세종로 164'), '서울 종로구 세종로 164');
  assert.equal(seoulParcelKey('서울 강남구 테헤란로 164'), null);
});
