"use strict";
const time = require('./booking-time');
const parse = (v, fallback) => { try { return typeof v === 'string' ? JSON.parse(v) : v ?? fallback; } catch { return fallback; } };
function areaKey(v) { return String(v || '').normalize('NFKC').trim().toLowerCase().replace(/[,.;]+/g,' ').replace(/\s+/g,' '); }
function areaMatches(area, place) {
  const a = areaKey(area), p = areaKey(place);
  if (!a || !p) return false;
  if (a === p) return true;
  // Postcodes may be explicitly listed; names must match, never guessed by substring.
  if (/^\d{4}$/.test(a)) return p.split(' ').includes(a);
  return false;
}
function normalise(body) {
  const out = {};
  if (body.service_areas !== undefined) {
    const areas = typeof body.service_areas === 'string' ? body.service_areas.split(/[\n;]/) : body.service_areas;
    if (!Array.isArray(areas) || areas.length > 80 || areas.some(x => typeof x !== 'string' || x.trim().length < 2 || x.trim().length > 100 || x.includes('*'))) throw Error('List up to 80 specific suburbs with state, or postcodes, separated by semicolons. Wildcards are not accepted.');
    out.service_areas = JSON.stringify([...new Set(areas.map(x => x.trim()).filter(Boolean))]);
  }
  if (body.availability_windows !== undefined) {
    let a=body.availability_windows;if(typeof a==='string'){try{a=JSON.parse(a);}catch{throw Error('Availability must be seven time-window lists or null.');}}
    if (a !== null && (!Array.isArray(a) || a.length !== 7)) throw Error('Availability needs seven lists, Monday to Sunday.');
    if (a !== null) for (const day of a) {
      if (!Array.isArray(day) || day.length > 6) throw Error('Use up to six time windows per day.');
      for (const r of day) if (!r || !time.validTime(r.start) || !(time.validTime(r.end) || r.end === '24:00') || r.start >= r.end) throw Error('Each window must end after it starts. Split overnight windows at midnight.');
      const sorted = [...day].sort((x,y) => x.start.localeCompare(y.start));
      if (sorted.some((r,i) => i && r.start < sorted[i-1].end)) throw Error('Availability windows must not overlap.');
    }
    out.availability_windows = a === null ? null : JSON.stringify(a);
  }
  if (body.leave_dates !== undefined) {
    const a = parse(body.leave_dates, null);
    if (!Array.isArray(a) || a.length > 100 || a.some(x => !x || !time.validDate(x.from) || !time.validDate(x.to) || x.to < x.from)) throw Error('Leave needs valid inclusive from/to dates.');
    out.leave_dates = JSON.stringify(a.map(x => ({from:x.from,to:x.to})));
  }
  if (body.travel_buffer_minutes !== undefined) {
    const n = Number(body.travel_buffer_minutes);
    if (!Number.isInteger(n) || n < 0 || n > 180) throw Error('Travel buffer must be a whole number from 0 to 180 minutes.');
    out.travel_buffer_minutes = n;
  }
  return out;
}
function availability(profile, b, participantPlace) {
  const error = time.intervalError(b); if (error) return {ok:false,error};
  const areas = parse(profile.service_areas, []);
  const effectiveAreas = Array.isArray(areas) && areas.length ? areas : [profile.suburb];
  if (participantPlace !== undefined && !effectiveAreas.some(a => areaMatches(a,participantPlace))) return {ok:false,code:'service_area',error:'The visit location is outside this worker’s declared service areas. Confirm the suburb and state or postcode, or ask the worker to update their areas.'};
  const leave = parse(profile.leave_dates, []), windows = parse(profile.availability_windows, null);
  const days = parse(profile.days, [1,1,1,1,1,0,0]);
  const start = time.localStart(b), end = new Date(+start + Number(b.hours)*36e5);
  const pad = n => String(n).padStart(2,'0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  let cursor = +start;
  while (cursor < +end) {
    const at = new Date(cursor), date = ymd(at), idx = (at.getDay()+6)%7;
    const midnight = new Date(at); midnight.setHours(24,0,0,0);
    const segmentEnd = Math.min(+end,+midnight);
    if (leave.some(x => x.from <= date && date <= x.to)) return {ok:false,code:'leave',error:'The worker has recorded leave during this visit.'};
    if (windows) {
      const intervals = [...windows[idx]].sort((a,b) => a.start.localeCompare(b.start));
      let covered = cursor;
      for (const r of intervals) {
        const s = +time.localStart({date,start:r.start});
        const e = r.end === '24:00' ? +midnight : +time.localStart({date,start:r.end});
        if (s <= covered && e > covered) covered = e;
      }
      if (covered < segmentEnd) return {ok:false,code:'time_window',error:'The whole visit does not fit the worker’s declared time windows.'};
    } else if (!days[idx]) return {ok:false,code:'weekday',error:'The worker is not available on every day touched by this visit.'};
    cursor = segmentEnd;
  }
  return {ok:true, basis:windows?'declared time windows':'usual weekdays; exact hours not yet declared', area_basis:Array.isArray(areas)&&areas.length?'declared service area':'profile suburb only', travel_buffer_minutes:Number(profile.travel_buffer_minutes||0)};
}
module.exports = {normalise,availability,areaKey,areaMatches};
