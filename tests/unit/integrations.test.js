import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

let mod;
before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  mod = await import('../../server/integrations.js');
});

test('credentials round-trip through AES-256-GCM', () => {
  const blob = mod.encrypt({ client_id: 'abc123', client_secret: 's3cret-value' });
  assert.match(blob, /^v1:/);
  assert.ok(!blob.includes('s3cret-value'), 'ciphertext must not contain the secret');
  assert.deepEqual(mod.decrypt(blob), { client_id: 'abc123', client_secret: 's3cret-value' });
  assert.notEqual(mod.encrypt({ a: 1 }), mod.encrypt({ a: 1 }), 'random IV per encryption');
});

test('tampered ciphertext is rejected', () => {
  const [v, iv, tag, data] = mod.encrypt({ client_secret: 'x' }).split(':');
  const flipped = Buffer.from(data, 'base64');
  flipped[0] ^= 1;
  assert.throws(() => mod.decrypt([v, iv, tag, flipped.toString('base64')].join(':')));
});

test('catalogue covers eight networks and three messaging channels', () => {
  assert.equal(Object.keys(mod.CATALOGUE.social).length, 8);
  assert.deepEqual(Object.keys(mod.CATALOGUE.messaging), ['sms', 'whatsapp', 'email']);
  for (const it of Object.values(mod.CATALOGUE.social)) assert.ok(it.portal.startsWith('https://') && it.steps.length >= 3);
});
