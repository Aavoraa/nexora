import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.TOKEN_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
const { extractJson, PROVIDERS } = await import('../../server/aiproviders.js');

test('extractJson reads plain, fenced and wrapped JSON', () => {
  assert.deepEqual(extractJson('{"drafts":["a"]}'), { drafts: ['a'] });
  assert.deepEqual(extractJson('```json\n{"drafts":["b"]}\n```'), { drafts: ['b'] });
  assert.deepEqual(extractJson('Sure! Here you go: {"drafts":["c"]} Hope that helps.'), { drafts: ['c'] });
});

test('extractJson rejects text with no JSON', () => {
  assert.throws(() => extractJson('I cannot help with that.'), /unreadable response/);
});

test('every provider has a key link, key prefix and default model', () => {
  for (const p of Object.values(PROVIDERS)) {
    assert.match(p.keyUrl, /^https:\/\//);
    assert.ok(p.keyPrefix && p.defaultModel && p.label);
  }
});

test('rankModels prefers capable text models and skips media ones', async () => {
  const { rankModels } = await import('../../server/aiproviders.js');
  const ids = (list) => list.map((id) => ({ id }));
  assert.deepEqual(rankModels('gemini', ids(['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-image', 'text-embedding-004', 'gemini-2.5-pro'])),
    ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro']);
  assert.equal(rankModels('groq', ids(['whisper-large-v3', 'llama-guard-4', 'llama-3.3-70b-versatile']))[0], 'llama-3.3-70b-versatile');
  assert.deepEqual(rankModels('openrouter', [{ id: 'a/paid' }, { id: 'b/x:free', free: true }]), ['b/x:free']);
  assert.deepEqual(rankModels('openrouter', [{ id: 'a/paid' }]), ['a/paid'], 'paid only when nothing is free');
});
