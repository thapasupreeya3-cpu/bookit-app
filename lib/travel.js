'use strict';
/* v86.14.0 — how far, and roughly how long by car, between a worker's stated
   area and a visit. Read from static locality and postcode centroids in
   data/au-localities.json (no network, no runtime dependency). The time is an
   estimate from straight-line distance with a road factor and a speed that
   falls as trips get longer; it is presented as "about", never as a promise. */
const fs = require('node:fs');
const path = require('node:path');

let DATA = null;
function data() {
  if (!DATA) {
    try { DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'au-localities.json'), 'utf8')); }
    catch { DATA = { localities: {}, postcodes: {} }; }
  }
  return DATA;
}

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

/* "Wyong NSW", "Wyong, NSW 2259", "2259", "wyong" → a centroid, or null */
function place(text, fallbackState) {
  const raw = String(text || '').normalize('NFKC').trim();
  if (!raw) return null;
  const d = data();
  const pc = raw.match(/\b(\d{4})\b/);
  if (pc && d.postcodes[pc[1]]) return { name: raw, at: d.postcodes[pc[1]], via: 'postcode' };
  const up = raw.toUpperCase().replace(/[,.;]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = up.split(' ');
  const last = words[words.length - 1];
  const state = STATES.includes(last) ? last : (fallbackState || '').toUpperCase();
  const locality = STATES.includes(last) ? words.slice(0, -1).join(' ') : up;
  if (state && d.localities[`${locality} ${state}`]) return { name: raw, at: d.localities[`${locality} ${state}`], via: 'locality' };
  for (const st of STATES) if (d.localities[`${locality} ${st}`]) return { name: raw, at: d.localities[`${locality} ${st}`], via: 'locality', assumed_state: st };
  return null;
}

function distanceKm(a, b) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* straight line × 1.3 for roads; ~30 km/h across town, rising to ~70 km/h on
   longer, more open trips; plus five minutes to park and walk in */
function minutesFor(km) {
  const road = km * 1.3;
  const speed = road < 10 ? 30 : road < 40 ? 45 : 70;
  return Math.round(road / speed * 60 + 5);
}

/* the nearest of a worker's stated areas to the visit */
function estimate(areas, visitPlace, fallbackState) {
  const to = place(visitPlace, fallbackState);
  if (!to) return { known: false, reason: 'visit location not recognised' };
  const froms = (Array.isArray(areas) ? areas : [areas]).map(a => place(a, fallbackState)).filter(Boolean);
  if (!froms.length) return { known: false, reason: 'worker area not recognised' };
  let best = null;
  for (const f of froms) {
    const km = distanceKm(f.at, to.at);
    if (!best || km < best.km) best = { km, from: f.name };
  }
  const km = Math.round(best.km * 1.3);
  return { known: true, km, minutes: minutesFor(best.km), from: best.from, to: to.name, source: 'estimate', maps: mapsLink(best.from, to.name),
    text: `about ${fmtMinutes(minutesFor(best.km))} by car (${km} km by road) from ${best.from}` };
}

/* Google's documented Maps URL scheme: opens the driving route in Maps, on
   any device, with no key and no cost. Not the same as a session link copied
   from the address bar (those carry place ids and expire). */
function mapsLink(from, to) {
  const q = s => encodeURIComponent(String(s || '').trim());
  return `https://www.google.com/maps/dir/?api=1&origin=${q(from)}&destination=${q(to)}&travelmode=driving`;
}

/* A real drive time, with traffic, from Google's Routes API (Compute Route
   Matrix — the successor to the Distance Matrix API, which Google now lists
   as legacy) — only when the office has set GOOGLE_MAPS_KEY. Traffic-aware
   answers bill under Google's Pro SKU (5,000 free elements a month, then
   US$10 per 1,000); GOOGLE_MAPS_TRAFFIC=off asks without traffic, which is
   the Essentials SKU (10,000 free, then US$5 per 1,000). Each suburb
   pair is remembered for a day so the same question is not paid for twice;
   any failure, or no key, leaves the offline estimate as it was. Never
   blocks for more than three seconds. */
const LIVE_CACHE = new Map();
async function live(from, to) {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key || !from || !to) return null;
  const ck = `${String(from).toLowerCase()}|${String(to).toLowerCase()}`;
  const hit = LIVE_CACHE.get(ck);
  if (hit && hit.until > Date.now()) return hit.value;
  const url = process.env.GOOGLE_MAPS_ENDPOINT || 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 3000);
  let value = null;
  try {
    const r = await fetch(url, { method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,staticDuration,distanceMeters,condition' },
      body: JSON.stringify({ origins: [{ waypoint: { address: `${from}, Australia` } }], destinations: [{ waypoint: { address: `${to}, Australia` } }],
        travelMode: 'DRIVE', routingPreference: /^(off|0|false|no)$/i.test(process.env.GOOGLE_MAPS_TRAFFIC || '') ? 'TRAFFIC_UNAWARE' : 'TRAFFIC_AWARE', regionCode: 'AU', languageCode: 'en-AU' }) });
    const j = await r.json();
    const el = Array.isArray(j) ? j[0] : null;
    const secs = el && el.condition === 'ROUTE_EXISTS' ? parseInt(String(el.duration || '').replace(/s$/, ''), 10) : NaN;
    if (r.ok && el && Number.isFinite(secs) && Number.isFinite(el.distanceMeters)) {
      const km = Math.round(el.distanceMeters / 1000), minutes = Math.round(secs / 60);
      const staticSecs = parseInt(String(el.staticDuration || '').replace(/s$/, ''), 10);
      const traffic = Number.isFinite(staticSecs) && staticSecs !== secs;
      value = { known: true, km, minutes, source: 'google', traffic,
        text: `about ${fmtMinutes(minutes)} by car (${km} km)${traffic ? ' in current traffic' : ''} from ${from}` };
    }
  } catch { value = null; }
  clearTimeout(timer);
  LIVE_CACHE.set(ck, { value, until: Date.now() + (value ? 24 : 1) * 3600e3 });
  return value;
}

/* the estimate, upgraded to Google's figures when they can be had */
async function withLive(travel) {
  if (!travel || !travel.known) return travel;
  const g = await live(travel.from, travel.to);
  return g ? { ...travel, ...g, estimate_km: travel.km, estimate_minutes: travel.minutes } : travel;
}

function fmtMinutes(m) {
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} hour${h === 1 ? '' : 's'}`;
}

module.exports = { place, distanceKm, estimate, fmtMinutes, mapsLink, live, withLive };
