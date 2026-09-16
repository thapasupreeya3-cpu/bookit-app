'use strict';
// Prices are calculated before approval. Issuing never recalculates an approved charge.
const { CURRENT, policyFor } = require('./booking-pricing-policy');
module.exports = function(c) {
  const { rates, holidays, start, end, ymd, itemFor } = c, round = x => Math.round(x * 100) / 100;
  function category(b, at, night = false) {
    if (b.sleepover) return 'sleepover';
    if (b.service === 'household') return 'household';
    if (b.service === 'employment') return 'employment';
    const day = ymd(at), minute = at.getHours() * 60 + at.getMinutes();
    if (holidays.at(day, minute, b).holiday) return 'public-holiday';
    if (at.getDay() === 6) return 'saturday';
    if (at.getDay() === 0) return 'sunday';
    let cat = night || minute < 360 ? 'weekday-night' : minute >= 1200 ? 'weekday-evening' : 'weekday-day';
    if (cat === 'weekday-night' && ['community', 'transport'].includes(b.service)) cat = 'weekday-evening';
    return cat;
  }
  function lines(b) {
    const from = start(b), to = end(b);
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || to <= from || to - from > 24 * 36e5) return null;
    const ratio = Math.max(1, Number(b.ratio) || 1), parts = [];
    if (b.sleepover) {
      const rate = round(rates.sleepover.price / ratio);
      return [{ date: ymd(from), when: b.start + ' sleepover', category: 'sleepover', item: itemFor(b.service, 'sleepover', ratio), description: rates.sleepover.label, qty: 1, unit: 'night', rate, amount: rate }];
    }
    // Special-calendar periods remain separate. The evening rule applies to
    // each continuous ordinary-weekday support, without spreading a weekend
    // or part-day public-holiday rate beyond the actual applicable interval.
    const minutes = [];
    for (let at = +from; at < +to; at += 60000) {
      const next = Math.min(+to, at + 60000), d = new Date(at), cat = category(b, d, false);
      minutes.push({ at, next, cat, ordinary: cat.startsWith('weekday-') });
    }
    for (let i = 0; i < minutes.length;) {
      let j = i + 1;
      if (minutes[i].ordinary) while (j < minutes.length && minutes[j].ordinary) j++;
      const begin = new Date(minutes[i].at), finish = new Date(minutes[j - 1].next - 1);
      const isNight = minutes[i].ordinary && (begin.getHours() < 6 || ymd(begin) !== ymd(finish));
      // Looking at the last included instant keeps an exact 20:00 finish on
      // daytime, and an exact midnight finish on evening rather than night.
      const isEvening = policyFor(b) === CURRENT && minutes[i].ordinary && !isNight && finish.getHours() >= 20;
      for (let k = i; k < j; k++) {
        const p = minutes[k], d = new Date(p.at);
        const cat = isNight ? (['community', 'transport'].includes(b.service) || ratio > 1 ? 'weekday-evening' : 'weekday-night') : isEvening ? 'weekday-evening' : p.cat;
        const date = ymd(d), previous = parts.at(-1);
        if (previous && previous.category === cat && previous.date === date) previous.ms += p.next - p.at;
        else parts.push({ date, category: cat, from: p.at, ms: p.next - p.at });
      }
      i = j;
    }
    return parts.map(p => {
      const r = rates[p.category], qty = p.ms / 36e5, rate = round(r.price / ratio), d = new Date(p.from), last = new Date(p.from + p.ms);
      return { date: p.date, when: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}–${String(last.getHours()).padStart(2, '0')}:${String(last.getMinutes()).padStart(2, '0')}`, category: p.category, item: itemFor(b.service, p.category, ratio), description: r.label + (ratio > 1 ? ' — 1:' + ratio : ''), qty, unit: 'hours', rate, amount: round(qty * rate) };
    });
  }
  return { category, lines };
};
