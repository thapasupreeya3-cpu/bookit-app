'use strict';

const CURRENT = 'continuous-weekday-v2';
const LEGACY = 'weekday-bands-v1';

function policyFor(booking) {
  // An existing row without a marker is always legacy. New public estimates
  // have no row ID and use the currently offered terms.
  if (booking?.pricing_policy === CURRENT) return CURRENT;
  if (booking?.pricing_policy === LEGACY || booking?.id || booking?.booking_id) return LEGACY;
  return CURRENT;
}

function migrate(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('PRAGMA table_info(bookings)').all().some(c => c.name === 'pricing_policy')) {
      db.exec("ALTER TABLE bookings ADD COLUMN pricing_policy TEXT NOT NULL DEFAULT ''");
    }
    // Only classify records: quotes, charges, approvals and issued invoices
    // are deliberately untouched. The insert trigger also covers roster and
    // future booking creation paths which do not pass through the public form.
    db.prepare("UPDATE bookings SET pricing_policy=? WHERE COALESCE(pricing_policy,'')=''").run(LEGACY);
    db.exec(`CREATE TRIGGER IF NOT EXISTS booking_pricing_policy_insert
      AFTER INSERT ON bookings WHEN COALESCE(NEW.pricing_policy,'')=''
      BEGIN UPDATE bookings SET pricing_policy='${CURRENT}' WHERE id=NEW.id; END;`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function recordedLines(booking, calculated, context) {
  let quote;
  try { quote = typeof booking?.booking_quote === 'string' ? JSON.parse(booking.booking_quote) : booking?.booking_quote; }
  catch { return null; }
  if (!quote || quote.date !== booking.date || quote.start !== booking.start || Number(quote.duration_hours) !== Number(booking.hours) ||
      Number(quote.ratio || 1) !== Number(booking.ratio || 1) || quote.service && quote.service !== booking.service ||
      (quote.support_type === 'sleepover') !== !!booking.sleepover || !Array.isArray(quote.lines) || !quote.lines.length) return null;
  if (quote.pricing_context && quote.pricing_context !== context) return null;
  if (!Array.isArray(calculated) || quote.lines.length !== calculated.length) return null;
  // Old quotes did not name their service or destination. Match the current
  // billing basis under the booking's retained policy, so a changed item,
  // holiday interval or quantity cannot masquerade as the original support.
  // Dollar rates are excluded: the recorded agreed price may legitimately
  // predate a rate-table update.
  if (quote.lines.some((line, i) => {
    const current = calculated[i];
    return ['date', 'when', 'category', 'item', 'unit'].some(key => line?.[key] !== current?.[key]) || Math.abs(Number(line?.qty) - Number(current?.qty)) > 1e-9;
  })) return null;
  if (quote.lines.some(line => !line || !Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.rate) || line.rate < 0 ||
      !Number.isFinite(line.amount) || line.amount < 0 || !['hours', 'night'].includes(line.unit) || typeof line.category !== 'string')) return null;
  const total = Math.round(quote.lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  if (!Number.isFinite(quote.total) || Math.abs(total - quote.total) > 0.001) return null;
  return quote.lines.map(line => ({ ...line }));
}

module.exports = { CURRENT, LEGACY, policyFor, migrate, recordedLines };
