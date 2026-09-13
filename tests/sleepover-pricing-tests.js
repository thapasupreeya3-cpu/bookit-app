'use strict';
process.env.TZ = 'Australia/Sydney';
const assert = require('node:assert/strict');
const rates = {
  saturday: { label: 'Saturday / weekday sleepover extra', price: 103.54 },
  sunday: { label: 'Sunday', price: 133.50 },
  'public-holiday': { label: 'Public holiday', price: 163.46 }
};
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const start = b => new Date(b.at), end = b => new Date(+start(b) + b.hours * 3600000);
const holidays = { at: (date, minute, b) => ({ holiday: date === '2026-12-25' || (b.suburb === 'Synthetic place' && date === '2026-09-15' && minute >= 1380) }) };
const pricing = require('../lib/sleepover-pricing')({ rates, holidays, start, end, ymd, itemFor: (service, category, ratio) => `${service}:${category}:${ratio}` });
const booking = (at = '2026-09-14T22:00:00+10:00', hours = 8, overrides = {}) => ({ at, hours, start: at.slice(11, 16), service: 'personal-care', sleepover: true, ...overrides });
const period = (start, end) => ({ start, end });
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

test('Sleepovers use actual 8–10 hours and must cross midnight', () => {
  assert.equal(pricing.validate(booking()).ok, true);
  assert.equal(pricing.validate(booking(undefined, 7.75)).code, 'sleepover_duration');
  assert.equal(pricing.validate(booking(undefined, 10.25)).code, 'sleepover_duration');
  assert.equal(pricing.validate(booking('2026-09-14T01:00:00+10:00')).code, 'sleepover_midnight');
  assert.equal(pricing.validate(booking('2026-09-14T16:00:00+10:00')).code, 'sleepover_midnight');
  assert.equal(pricing.validate(booking('2026-09-14T19:00:00+10:00')).ok, true);
  assert.equal(pricing.validate(booking(undefined, 8, { service: 'household' })).code, 'sleepover_service');
  assert.equal(pricing.validate(booking(undefined, 8, { service: 'daily-tasks' })).ok, true);
});
test('Zero to two active hours stay included, with no timing requirement', () => {
  for (const hours of [0, 0.25, 1.5, 2]) {
    const r = pricing.active(booking('2026-09-12T22:00:00+10:00'), hours);
    assert.equal(r.total, 0); assert.equal(r.extra, 0); assert.equal(r.included, 2); assert.deepEqual(r.lines, []);
  }
});
test('Weekday extra support uses the Saturday rate, without rounding active hours', () => {
  const r = pricing.active(booking(), '2.25');
  assert.equal(r.active, 2.25); assert.equal(r.extra, 0.25); assert.equal(r.total, 25.89);
  assert.equal(r.lines[0].category, 'saturday'); assert.equal(r.lines[0].rate, 103.54);
  assert.equal(pricing.active(booking(), 2.1).code, 'active_hours_increment');
  assert.equal(pricing.active(booking(), 8.25).code, 'active_hours_range');
  assert.equal(pricing.active(booking(), -1).code, 'active_hours_range');
  assert.equal(pricing.active(booking(), 'two').code, 'active_hours_number');
});
test('Extra-rate quote shows both sides of Saturday into Sunday', () => {
  const r = pricing.extraRates(booking('2026-09-12T22:00:00+10:00'));
  assert.deepEqual(r.rates.map(r => r.category), ['saturday', 'sunday']);
  assert.deepEqual(r.rates.map(r => r.rate), [103.54, 133.5]); assert.equal(r.requires_periods, true);
  assert.equal(r.bands[0].from, '2026-09-12T22:00:00+10:00');
  assert.equal(r.bands[0].to, '2026-09-13T00:00:00+10:00');
  assert.equal(r.bands[1].to, '2026-09-13T06:00:00+10:00');
  assert.equal(pricing.active(booking('2026-09-12T22:00:00+10:00'), 3).code, 'active_periods_required');
});
test('First two active hours are included chronologically; Sunday work receives Sunday pricing', () => {
  const r = pricing.active(booking('2026-09-12T22:00:00+10:00'), 3, [
    period('2026-09-13T03:00:00+10:00', '2026-09-13T04:00:00+10:00'),
    period('2026-09-12T22:00:00+10:00', '2026-09-13T00:00:00+10:00')
  ]);
  assert.equal(r.total, 133.5); assert.equal(r.lines[0].date, '2026-09-13');
  assert.equal(r.lines[0].when, '03:00–04:00'); assert.equal(r.lines[0].item, 'personal-care:sunday:1');
  assert.equal(r.periods[0].start, '2026-09-12T22:00:00+10:00');
});
test('Sunday into Monday extras split by actual support time, not booking start day', () => {
  const r = pricing.active(booking('2026-09-13T19:00:00+10:00', 10), 4, [
    period('2026-09-13T19:00:00+10:00', '2026-09-13T22:00:00+10:00'),
    period('2026-09-14T01:00:00+10:00', '2026-09-14T02:00:00+10:00')
  ]);
  assert.deepEqual(r.lines.map(l => l.category), ['sunday', 'saturday']);
  assert.deepEqual(r.lines.map(l => l.qty), [1, 1]); assert.equal(r.total, 237.04);
});
test('Holiday start after midnight is priced using the actual date of active work', () => {
  const b = booking('2026-12-24T22:00:00+11:00');
  const quote = pricing.extraRates(b);
  assert.deepEqual(quote.rates.map(r => r.category), ['saturday', 'public-holiday']);
  const r = pricing.active(b, 3, [period('2026-12-24T22:00:00+11:00', '2026-12-25T01:00:00+11:00')]);
  assert.equal(r.total, 163.46); assert.equal(r.lines[0].date, '2026-12-25'); assert.equal(r.lines[0].qty, 1);
});
test('A place-specific part-day holiday applies only during the published minutes', () => {
  const b = booking('2026-09-15T21:00:00+10:00', 8, { suburb: 'Synthetic place' });
  const quote = pricing.extraRates(b);
  assert.deepEqual(quote.bands.map(b => [b.when, b.category]), [['21:00–23:00', 'saturday'], ['23:00–00:00', 'public-holiday'], ['00:00–05:00', 'saturday']]);
  const r = pricing.active(b, 4, [period('2026-09-15T21:00:00+10:00', '2026-09-16T01:00:00+10:00')]);
  assert.deepEqual(r.lines.map(l => l.rate), [163.46, 103.54]); assert.equal(r.total, 267);
});
test('Shared support divides the applicable hourly rate per participant', () => {
  const b = booking(undefined, 8, { ratio: 2, service: 'daily-tasks' });
  const r = pricing.active(b, 2.25);
  assert.equal(r.lines[0].rate, 51.77); assert.equal(r.total, 12.94);
  assert.equal(r.lines[0].item, 'daily-tasks:saturday:2');
  assert.equal(pricing.extraRates(b).rates[0].rate, 51.77);
});
test('Overlapping, out-of-bounds and mismatched periods do not create charges', () => {
  const b = booking();
  assert.equal(pricing.active(b, 3, [period('2026-09-14T22:00+10:00', '2026-09-15T00:00+10:00'), period('2026-09-14T23:30+10:00', '2026-09-15T00:30+10:00')]).code, 'active_periods_overlap');
  assert.equal(pricing.active(b, 3, [period('2026-09-14T21:00+10:00', '2026-09-15T00:00+10:00')]).code, 'active_periods_bounds');
  assert.equal(pricing.active(b, 3, [period('2026-09-14T22:00+10:00', '2026-09-15T00:59+10:00')]).code, 'active_periods_total');
  assert.equal(pricing.active(b, 0, [period('2026-09-14T22:00+10:00', '2026-09-14T22:15+10:00')]).code, 'active_periods_total');
  assert.equal(pricing.active(b, 3, {}).code, 'active_periods_format');
  assert.equal(pricing.active(b, 3, Array(25).fill({})).code, 'active_periods_count');
});
test('Missing offsets, impossible dates, and sub-minute times are rejected', () => {
  const b = booking();
  for (const invalid of ['2026-09-14T22:00', '2026-02-30T22:00+10:00', '2026-09-14T22:00:01+10:00', '2026-09-14T22:00:00.001+10:00', '2026-09-14T25:00+10:00', '2026-09-14T22:00+15:00']) {
    assert.equal(pricing.active(b, 3, [period(invalid, '2026-09-15T01:00+10:00')]).code, 'active_periods_time', invalid);
  }
});
test('Fall-back daylight saving uses elapsed minutes and distinguishes the repeated clock', () => {
  const b = booking('2026-04-04T22:00:00+11:00', 10), valid = pricing.validate(b);
  assert.equal(valid.to, '2026-04-05T07:00:00+10:00'); assert.equal(valid.hours, 10);
  const r = pricing.active(b, 3, [
    period('2026-04-05T01:30:00+11:00', '2026-04-05T02:30:00+10:00'),
    period('2026-04-05T03:00:00+10:00', '2026-04-05T04:00:00+10:00')
  ]);
  assert.equal(r.total, 133.5); assert.equal(r.lines[0].when, '03:00–04:00');
});
test('Spring-forward daylight saving does not charge for the missing clock hour', () => {
  const b = booking('2026-10-03T22:00:00+10:00');
  assert.equal(pricing.validate(b).to, '2026-10-04T07:00:00+11:00');
  const r = pricing.active(b, 3, [
    period('2026-10-04T01:30:00+10:00', '2026-10-04T03:30:00+11:00'),
    period('2026-10-04T04:00:00+11:00', '2026-10-04T06:00:00+11:00')
  ]);
  assert.equal(r.total, 133.5); assert.equal(r.lines[0].qty, 1); assert.equal(r.lines[0].when, '05:00–06:00');
});
console.log(`sleepover pricing: ${passed} passed`);
