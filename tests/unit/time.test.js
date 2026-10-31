import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, upcomingSlots, isValidTimeZone, zonedParts } from '../../server/time.js';

test('zonedToUtc converts wall-clock time in a fixed-offset zone', () => {
  assert.equal(zonedToUtc(2026, 10, 2, 9, 0, 'Asia/Kolkata').toISOString(), '2026-11-02T03:30:00.000Z');
});

test('zonedToUtc respects daylight saving on both sides of the change', () => {
  // New York: EDT (UTC-4) on 31 Oct 2026, EST (UTC-5) after 1 Nov 2026.
  assert.equal(zonedToUtc(2026, 9, 31, 9, 0, 'America/New_York').toISOString(), '2026-10-31T13:00:00.000Z');
  assert.equal(zonedToUtc(2026, 10, 2, 9, 0, 'America/New_York').toISOString(), '2026-11-02T14:00:00.000Z');
});

test('zonedParts gives the local calendar day and weekday', () => {
  // 20:00 UTC Saturday is already Sunday in Kolkata.
  const p = zonedParts(new Date('2026-10-31T20:00:00Z'), 'Asia/Kolkata');
  assert.deepEqual(p, { y: 2026, m: 10, d: 1, weekday: 0 });
});

test('upcomingSlots returns future slots in order and skips past ones', () => {
  const from = new Date('2026-11-02T04:00:00Z'); // Mon 09:30 IST
  const slots = [{ weekday: 1, time: '09:00' }, { weekday: 1, time: '15:00' }, { weekday: 3, time: '10:00' }];
  const out = upcomingSlots(slots, 'Asia/Kolkata', from, 7).map((d) => d.toISOString());
  assert.deepEqual(out, ['2026-11-02T09:30:00.000Z', '2026-11-04T04:30:00.000Z']);
});

test('upcomingSlots with no slots is empty', () => {
  assert.deepEqual(upcomingSlots([], 'UTC'), []);
});

test('isValidTimeZone accepts IANA zones and rejects junk', () => {
  assert.equal(isValidTimeZone('Europe/London'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('Mars/Base'), false);
  assert.equal(isValidTimeZone(undefined), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(42), false);
});
