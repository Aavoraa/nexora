import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, roleAtLeast } from '../../server/auth.js';

test('password hashes verify and are salted', () => {
  const a = hashPassword('correct horse');
  const b = hashPassword('correct horse');
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(verifyPassword('correct horse', a), true);
  assert.equal(verifyPassword('wrong', a), false);
});

test('unknown hash schemes never verify', () => {
  assert.equal(verifyPassword('x', 'md5$abc$def'), false);
});

test('role ranking', () => {
  assert.equal(roleAtLeast({ role: 'owner' }, 'admin'), true);
  assert.equal(roleAtLeast({ role: 'editor' }, 'admin'), false);
  assert.equal(roleAtLeast({ role: 'viewer' }, 'viewer'), true);
});
