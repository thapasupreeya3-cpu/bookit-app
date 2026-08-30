/* BookIt — worker-diary clash cases.
   Reads ymd/bookingStart/bookingEnd/bookingClash out of ../server.js at run time,
   so the test always exercises the helper that will be deployed, not a copy.
   Run:  node --no-warnings tests/clash-tests.js      (exit 0 = all passed) */
'use strict';
process.env.TZ = 'Australia/Sydney';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found in server.js`);
  /* match the parameter list first (it may contain "opts = {}"), then the body */
  let k = src.indexOf('(', i), depth = 0;
  for (; k < src.length; k++) { if (src[k] === '(') depth++; else if (src[k] === ')' && --depth === 0) break; }
  k = src.indexOf('{', k); depth = 0;
  for (let j = k; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error(`could not read ${name}`);
}

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE bookings (id INTEGER PRIMARY KEY, participant_id INTEGER, worker_id INTEGER, date TEXT, start TEXT, hours REAL, status TEXT);
INSERT INTO users VALUES (1,'Alice'),(2,'Bob');
INSERT INTO bookings VALUES (1,1,10,'2026-09-03','10:00',3,'accepted');   -- 10:00-13:00
INSERT INTO bookings VALUES (2,2,10,'2026-09-03','15:00',2,'requested');  -- Bob asked 15:00-17:00
INSERT INTO bookings VALUES (3,1,10,'2026-09-04','22:00',10,'accepted');  -- sleepover 22:00 -> 08:00 on the 5th
INSERT INTO bookings VALUES (4,1,10,'2026-09-06','09:00',2,'cancelled');
INSERT INTO bookings VALUES (5,2,10,'2026-08-30','01:00',2,'accepted');   -- early hours of the 30th
INSERT INTO bookings VALUES (6,2,10,'2026-10-05','00:00',2,'accepted');   -- the night daylight saving starts`);

/* the four helpers, verbatim, bound to this db */
const helpers = new Function('db', `${['ymd', 'bookingStart', 'bookingEnd', 'bookingClash', 'workerFree'].map(grab).join('\n')}\nreturn { bookingClash, workerFree };`)(db);
const { bookingClash, workerFree } = helpers;

let fails = 0;
const id = r => (r ? r.id : null);
const t = (name, got, want) => { const ok = got === want; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${got}, want ${want})`}`); };
const R = { statuses: ['accepted', 'requested'] };

/* at request time: accepted + requested, participant-aware */
t('overlaps an accepted 10-13',                 id(bookingClash(10, '2026-09-03', '12:00', 2, { ...R, participantId: 2 })), 1);
t('touching end 13:00 is free',                 id(bookingClash(10, '2026-09-03', '13:00', 2, { ...R, participantId: 2 })), null);
t('Bob re-requests his own 15-17 = duplicate',  id(bookingClash(10, '2026-09-03', '16:00', 2, { ...R, participantId: 2 })), 2);
t('Alice may compete with Bob\'s request',      id(bookingClash(10, '2026-09-03', '16:00', 2, { ...R, participantId: 1 })), null);
t('cancelled row ignored',                      id(bookingClash(10, '2026-09-06', '09:30', 1, { ...R, participantId: 2 })), null);
t('BACK: last night\'s sleepover blocks 07:00', id(bookingClash(10, '2026-09-05', '07:00', 2, { ...R, participantId: 2 })), 3);
t('BACK: 08:00 after it ends is free',          id(bookingClash(10, '2026-09-05', '08:00', 2, { ...R, participantId: 2 })), null);
t('FWD: 29th 22:00-06:00 hits 30th 01:00',      id(bookingClash(10, '2026-08-29', '22:00', 8, { ...R, participantId: 1 })), 5);
t('FWD: 29th 22:00-01:00 touches, free',        id(bookingClash(10, '2026-08-29', '22:00', 3, { ...R, participantId: 1 })), null);
t('FWD: 29th 20:00-22:00 free',                 id(bookingClash(10, '2026-08-29', '20:00', 2, { ...R, participantId: 1 })), null);
t('FWD across DST start: 4 Oct 23:00-02:00',    id(bookingClash(10, '2026-10-04', '23:00', 3, { ...R, participantId: 1 })), 6);
t('different worker unaffected',                id(bookingClash(11, '2026-09-03', '12:00', 2, { ...R, participantId: 2 })), null);
/* at accept time: accepted only, the booking itself excluded */
t('accept Bob 15-17: no accepted clash',        id(bookingClash(10, '2026-09-03', '15:00', 2, { excludeId: 2 })), null);
t('accept a 12-14 request: clashes with #1',    id(bookingClash(10, '2026-09-03', '12:00', 2, { excludeId: 99 })), 1);
t('excludeId hides the booking itself',         id(bookingClash(10, '2026-09-03', '10:00', 3, { excludeId: 1 })), null);
t('accept-time ignores competing requests',     id(bookingClash(10, '2026-09-03', '16:00', 1, { excludeId: 99 })), null);

/* workerFree — what the cover cascade and the office assignment ask — must read both sides of midnight too */
t('workerFree FWD: cover 29th 22:00-06:00 vs accepted 30th 01:00 → busy', workerFree(10, '2026-08-29', '22:00', 8, 0), false);
t('workerFree BACK: cover 5th 07:00 vs sleepover from the 4th → busy',    workerFree(10, '2026-09-05', '07:00', 2, 0), false);
t('workerFree: a competing REQUEST counts as busy for an offer list',    workerFree(10, '2026-09-03', '16:00', 1, 0), false);
t('workerFree: a free hour is free',                                     workerFree(10, '2026-09-05', '09:00', 2, 0), true);
t('workerFree: excludes the booking being covered',                      workerFree(10, '2026-09-03', '10:00', 3, 1), true);

console.log(fails ? `${fails} FAILED` : 'all 21 passed');
process.exit(fails ? 1 : 0);
