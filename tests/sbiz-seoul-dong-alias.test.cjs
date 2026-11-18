const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withoutDongNumber } = require('../scripts/import-sbiz-seoul-dong-alias');

test('numeric Seoul legal-dong alias preserves the lot', () => {
  assert.equal(withoutDongNumber('서울 동작구 상도1동 638-1'), '서울 동작구 상도동 638-1');
  assert.equal(withoutDongNumber('서울 동작구 상도동 638-1'), null);
  assert.equal(withoutDongNumber('서울 중구 태평로2가 318-2'), null);
});
