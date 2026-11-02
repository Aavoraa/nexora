import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGstin, gstinCheckChar } from '../../server/gstin.js';

test('normalizeGstin accepts valid GSTINs, uppercased and without spaces', () => {
  assert.equal(normalizeGstin('27AAPFU0939F1ZV'), '27AAPFU0939F1ZV');
  assert.equal(normalizeGstin(' 29aagcb7383j1z4 '), '29AAGCB7383J1Z4');
  assert.equal(normalizeGstin('27 AAPFU 0939F 1ZV'), '27AAPFU0939F1ZV');
});

test('normalizeGstin rejects bad check characters, shapes and state codes', () => {
  for (const bad of ['27AAPFU0939F1ZA', '27AAPFU0939F1Z', '27AAPFU0939F1YV', '00AAPFU0939F1ZV', '', null, 27]) {
    assert.equal(normalizeGstin(bad), null, String(bad));
  }
});

test('gstinCheckChar matches the published example', () => {
  assert.equal(gstinCheckChar('27AAPFU0939F1Z'), 'V');
});
