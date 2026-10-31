import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, addDays, daysBetween, schedule, render, deliveryFor, todayIn } from '../../server/loans.js';

test('monthly schedule clamps to the end of short months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.deepEqual(schedule('2026-01-31', 4, 'monthly'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('weekly schedule and day arithmetic', () => {
  assert.deepEqual(schedule('2026-12-28', 3, 'weekly'), ['2026-12-28', '2027-01-04', '2027-01-11']);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-11-01', '2026-11-04'), 3);
  assert.equal(daysBetween('2026-11-04', '2026-11-01'), -3);
});

test('today in a time zone', () => {
  // 20:00 UTC on 31 Oct is already 1 Nov in Kolkata.
  assert.equal(todayIn('Asia/Kolkata', new Date('2026-10-31T20:00:00Z')), '2026-11-01');
  assert.equal(todayIn('UTC', new Date('2026-10-31T20:00:00Z')), '2026-10-31');
});

test('templates fill known placeholders and keep unknown ones', () => {
  assert.equal(render('Hi {name}, {amount} due {due_date}. {other}', { name: 'Ana', amount: '₹500', due_date: '3 Nov 2026' }),
    'Hi Ana, ₹500 due 3 Nov 2026. {other}');
});

test('delivery: consent, opt-out, address and the STOP footer', () => {
  const base = { id: 1, phone: '+91 98765 43210', email: 'a@b.co', consent_sms: true, consent_whatsapp: false, consent_email: true, opted_out_at: null };
  const sms = deliveryFor(base, 'sms', 'Payment due.');
  assert.equal(sms.status, 'simulated');
  assert.match(sms.text, /Reply STOP to opt out\.$/);
  assert.equal(deliveryFor(base, 'sms', 'Text STOP to end').text, 'Text STOP to end', 'no double footer');
  assert.equal(deliveryFor(base, 'email', 'Hi').text, 'Hi', 'email has no SMS footer');
  assert.deepEqual([deliveryFor(base, 'whatsapp', 'x').status, deliveryFor(base, 'whatsapp', 'x').reason], ['skipped', 'No WhatsApp consent']);
  assert.equal(deliveryFor({ ...base, opted_out_at: new Date() }, 'sms', 'x').reason, 'Customer opted out');
  assert.equal(deliveryFor({ ...base, phone: '' }, 'sms', 'x').reason, 'No phone number');
});
