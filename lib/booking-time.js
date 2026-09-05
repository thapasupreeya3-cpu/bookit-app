"use strict";
// Calendar strings are exact API values, never truncated or normalised into a different day.
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y,m,0)).getUTCDate();
}
function validTime(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function localStart(b) {
  if (!b || !validDate(b.date) || !validTime(b.start)) return new Date(NaN);
  const d = new Date(`${b.date}T${b.start}:00`);
  const pad = n => String(n).padStart(2,'0');
  // Reject a nonexistent clock time during the spring daylight-saving transition.
  if (`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` !== b.date || `${pad(d.getHours())}:${pad(d.getMinutes())}` !== b.start) return new Date(NaN);
  return d;
}
function intervalError(b) {
  if (!validDate(b && b.date)) return 'Choose a real calendar date in YYYY-MM-DD format.';
  if (!validTime(b.start)) return 'Choose a real start time from 00:00 to 23:59.';
  if (!Number.isFinite(localStart(b).getTime())) return 'That local clock time does not exist because daylight saving changes. Choose another time.';
  if (!Number.isFinite(Number(b.hours)) || Number(b.hours) <= 0 || Number(b.hours) > 24) return 'Choose a valid, finite duration of up to 24 hours.';
  return null;
}
module.exports = { validDate, validTime, localStart, intervalError };
