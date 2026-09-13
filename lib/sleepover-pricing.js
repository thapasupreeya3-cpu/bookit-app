'use strict';

// Participant invoice pricing only. The two included active hours do not define
// employee entitlements; payroll must assess every period of work separately.
const activeHours = require('./active-hours');
const MINUTE = 60000, HOUR = 60 * MINUTE, INCLUDED_MINUTES = 120;
const round = value => Math.round(value * 100) / 100;
const pad = value => String(value).padStart(2, '0');

module.exports = function ({ rates, holidays, start, end, ymd, itemFor }) {
  const error = (code, message) => ({ error: message, code });
  const clock = at => `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  function localISO(at) {
    const offset = -at.getTimezoneOffset(), sign = offset < 0 ? '-' : '+';
    return `${ymd(at)}T${clock(at)}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  }
  function validate(b) {
    if (!['personal-care', 'daily-tasks'].includes(b.service)) return error('sleepover_service', 'Choose personal care or daily tasks for an inactive overnight sleepover.');
    const from = start(b), to = end(b), hours = (+to - +from) / HOUR;
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || +from % MINUTE || +to % MINUTE) return error('sleepover_interval', 'Enter a valid sleepover date and time, in whole minutes.');
    if (hours < 8 || hours > 10) return error('sleepover_duration', 'An inactive overnight sleepover must be 8–10 continuous hours. Choose active overnight support if the worker needs to stay awake.');
    // Ending at midnight is not finishing after midnight. Use elapsed time so
    // daylight-saving changes never silently add or remove a billed hour.
    if (ymd(from) === ymd(new Date(+to - 1))) return error('sleepover_midnight', 'An inactive overnight sleepover must start before midnight and finish after midnight.');
    const ratio = b.ratio == null ? 1 : Number(b.ratio);
    if (!Number.isInteger(ratio) || ratio < 1) return error('sleepover_ratio', 'Enter a valid support ratio.');
    return { ok: true, hours, from: localISO(from), to: localISO(to) };
  }
  function category(b, at) {
    if (holidays.at(ymd(at), at.getHours() * 60 + at.getMinutes(), b).holiday) return 'public-holiday';
    return at.getDay() === 0 ? 'sunday' : 'saturday';
  }
  function price(b, category) {
    const ratio = b.ratio == null ? 1 : Number(b.ratio), r = rates[category];
    return { category, description: r.label + (ratio > 1 ? ` — 1:${ratio}` : ''), rate: round(r.price / ratio), item: itemFor(b.service, category, ratio) };
  }
  function bandsFor(b) {
    const from = +start(b), to = +end(b), bands = [];
    for (let at = from; at < to; at += MINUTE) {
      const d = new Date(at), next = Math.min(to, at + MINUTE), cat = category(b, d), previous = bands.at(-1), date = ymd(d), offset = d.getTimezoneOffset();
      if (previous && previous.category === cat && previous.date === date && previous.offset === offset) previous.end = next;
      else bands.push({ ...price(b, cat), date, start: at, end: next, offset });
    }
    return bands;
  }
  function extraRates(b) {
    const valid = validate(b);
    if (valid.error) return valid;
    const bands = bandsFor(b), unique = new Map();
    for (const band of bands) if (!unique.has(band.category)) unique.set(band.category, price(b, band.category));
    return {
      rates: [...unique.values()],
      bands: bands.map(({ start: a, end: z, offset, ...band }) => ({ ...band, from: localISO(new Date(a)), to: localISO(new Date(z)), when: `${clock(new Date(a))}–${clock(new Date(z))}` })),
      requires_periods: unique.size > 1
    };
  }
  function parseMinute(value) {
    // Explicit offsets distinguish repeated clocks during daylight-saving
    // changes. Reject impossible calendar dates and sub-minute values instead
    // of allowing Date.parse to normalise or round them.
    if (typeof value !== 'string') return NaN;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00(?:\.0{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!m) return NaN;
    const [, year, month, day, hour, minute, zone] = m, parts = [+year, +month, +day, +hour, +minute];
    if (+year < 1000 || +month < 1 || +month > 12 || +day < 1 || +day > 31 || +hour > 23 || +minute > 59) return NaN;
    const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute));
    if ([date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()].some((p, i) => p !== parts[i])) return NaN;
    const zh = zone === 'Z' ? 0 : Number(zone.slice(1, 3)), zm = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
    if (zh > 14 || zm > 59 || (zh === 14 && zm)) return NaN;
    return +date - (zone[0] === '-' ? -1 : 1) * (zh * 60 + zm) * MINUTE;
  }
  function active(b, value, suppliedPeriods, options={}) {
    let valid = validate(b);
    // Existing accepted records may predate corrected shape validation. Saving actual work
    // is permitted, while the caller must hold any charge for explicit correction.
    if(valid.error&&options.legacy){const hours=(+end(b)-+start(b))/HOUR;if(Number.isFinite(hours)&&hours>0&&hours<=24)valid={hours};}
    if (valid.error) return valid;
    const checked = activeHours.validate(value, valid.hours);
    if (checked.error) return checked;
    const active = checked.hours, extra = Math.max(0, active - 2), bands = bandsFor(b), categories = new Set(bands.map(band => band.category));
    if (suppliedPeriods != null && !Array.isArray(suppliedPeriods)) return error('active_periods_format', 'Enter the active support periods as start and finish times.');
    if (suppliedPeriods?.length > 24) return error('active_periods_count', 'Record up to 24 active support periods.');
    let periods = [];
    if (suppliedPeriods?.length) {
      periods = suppliedPeriods.map(p => ({ start: parseMinute(p?.start), end: parseMinute(p?.end) })).sort((a, b) => a.start - b.start);
      if (periods.some(p => !Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end <= p.start)) return error('active_periods_time', 'Enter valid start and finish dates and times, including a timezone offset, in whole minutes.');
      if (periods.some(p => p.start < +start(b) || p.end > +end(b))) return error('active_periods_bounds', 'Active support periods must be within the booked sleepover.');
      if (periods.some((p, i) => i > 0 && p.start < periods[i - 1].end)) return error('active_periods_overlap', 'Active support periods cannot overlap.');
      const minutes = periods.reduce((n, p) => n + (p.end - p.start) / MINUTE, 0);
      if (minutes !== active * 60) return error('active_periods_total', 'The active support periods must add up to the active hours entered. Your entry has not been rounded.');
    } else if (extra > 0 && categories.size > 1) {
      return error('active_periods_required', 'This sleepover crosses different extra-support rates. Record when all active support occurred so the two included hours and any additional charges use the correct rates.');
    }
    const lines = [];
    if (extra > 0 && !periods.length) {
      const p = price(b, bands[0].category);
      lines.push({ date: ymd(start(b)), when: 'during the sleepover (times not recorded)', ...p, description: `${p.description} — active sleepover support beyond the two included hours`, qty: extra, unit: 'hours', amount: round(extra * p.rate) });
    } else if (extra > 0) {
      let included = INCLUDED_MINUTES;
      for (const period of periods) {
        const minutes = (period.end - period.start) / MINUTE, skip = Math.min(included, minutes);
        included -= skip;
        const chargeFrom = period.start + skip * MINUTE;
        for (const band of bands) {
          const a = Math.max(chargeFrom, band.start), z = Math.min(period.end, band.end);
          if (z <= a) continue;
          const qty = (z - a) / HOUR, p = price(b, band.category);
          lines.push({ date: band.date, when: `${clock(new Date(a))}–${clock(new Date(z))}`, ...p, description: `${p.description} — active sleepover support beyond the two included hours`, qty, unit: 'hours', amount: round(qty * p.rate) });
        }
      }
    }
    return { active, included: 2, extra, lines, total: round(lines.reduce((n, line) => n + line.amount, 0)), periods: periods.map(p => ({ start: localISO(new Date(p.start)), end: localISO(new Date(p.end)) })) };
  }
  return { validate, extraRates, active };
};
