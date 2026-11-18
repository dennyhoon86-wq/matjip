const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shortVariants } = require('../scripts/import-sbiz-truncated-parcels');

test('omitted Gyeonggi district and township variants retain the same parcel', () => {
  assert.deepEqual(shortVariants('경기 광주시 남한산성면 검복리 39'),
    ['경기 광주시 검복리 39']);
  assert.deepEqual(shortVariants('경기 부천시 원미구 역곡동 78-4'),
    ['경기 부천시 역곡동 78-4']);
  assert.deepEqual(shortVariants('경기 고양시 덕양구 화전동 832-41'),
    ['경기 고양시 화전동 832-41']);
});
