'use strict';

const crypto = require('node:crypto');

// In-site confirmations are independent of email delivery and email preferences.
// Events belong to a booking; read receipts belong to the real signed-in viewer.
module.exports = function bookingUpdates(c) {
  const {db, route, json} = c;
  const now = c.now || (() => new Date().toISOString());
  db.exec(`CREATE TABLE IF NOT EXISTS booking_acceptance_updates (
    id INTEGER PRIMARY KEY, event_key TEXT NOT NULL UNIQUE,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted_at TEXT NOT NULL, state_hash TEXT NOT NULL, created_at TEXT NOT NULL,
    invalidated_at TEXT);
    CREATE INDEX IF NOT EXISTS booking_acceptance_participant ON booking_acceptance_updates(participant_id, invalidated_at, id);
    CREATE TABLE IF NOT EXISTS booking_acceptance_reads (
      update_id INTEGER NOT NULL REFERENCES booking_acceptance_updates(id) ON DELETE CASCADE,
      viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL, PRIMARY KEY(update_id, viewer_id));
    CREATE TRIGGER IF NOT EXISTS booking_acceptance_invalidate AFTER UPDATE ON bookings
    WHEN OLD.participant_id IS NOT NEW.participant_id OR OLD.worker_id IS NOT NEW.worker_id
      OR OLD.service IS NOT NEW.service OR OLD.date IS NOT NEW.date OR OLD.start IS NOT NEW.start
      OR OLD.hours IS NOT NEW.hours OR OLD.status IS NOT NEW.status OR OLD.accepted_at IS NOT NEW.accepted_at
      OR OLD.cancelled_at IS NOT NEW.cancelled_at OR OLD.sleepover IS NOT NEW.sleepover
      OR OLD.kind IS NOT NEW.kind OR OLD.voided IS NOT NEW.voided
      OR OLD.cover_state IS NOT NEW.cover_state OR OLD.delivered_by_allied IS NOT NEW.delivered_by_allied
    BEGIN
      UPDATE booking_acceptance_updates SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE booking_id=NEW.id AND invalidated_at IS NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS booking_acceptance_location_invalidate AFTER UPDATE OF data ON booking_locations
    WHEN OLD.data IS NOT NEW.data
    BEGIN
      UPDATE booking_acceptance_updates SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE booking_id=NEW.booking_id AND invalidated_at IS NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS booking_acceptance_location_removed AFTER DELETE ON booking_locations
    BEGIN
      UPDATE booking_acceptance_updates SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE booking_id=OLD.booking_id AND invalidated_at IS NULL;
    END;`);

  const current = id => db.prepare('SELECT * FROM bookings WHERE id=?').get(Number(id));
  const activeUser = id => db.prepare("SELECT id,name,role,is_admin FROM users WHERE id=? AND COALESCE(closed_at,'')=''").get(Number(id));
  function fingerprint(b) {
    // Only the location revision participates; private address data stays in its
    // existing table. An edited place or visit invalidates an earlier acceptance.
    const keys = ['participant_id','worker_id','service','date','start','hours','status','accepted_at','cancelled_at','sleepover','kind','cover_state','delivered_by_allied'];
    const location = db.prepare('SELECT revision FROM booking_locations WHERE booking_id=?').get(b.id)?.revision || 0;
    return crypto.createHash('sha256').update(JSON.stringify([...keys.map(k => [k, b[k] ?? '']), ['location_revision',location]])).digest('hex');
  }
  function invalidateChanged(values) {
    for (const value of values) {
      const b = current(typeof value === 'object' ? value.id : value);
      const id = b?.id || Number(typeof value === 'object' ? value.id : value);
      if (!id) continue;
      if (!b || b.voided || b.status !== 'accepted') {
        db.prepare('UPDATE booking_acceptance_updates SET invalidated_at=? WHERE booking_id=? AND invalidated_at IS NULL').run(now(), id);
      } else {
        db.prepare('UPDATE booking_acceptance_updates SET invalidated_at=? WHERE booking_id=? AND state_hash<>? AND invalidated_at IS NULL').run(now(), id, fingerprint(b));
      }
    }
  }
  function recordAccepted(values) {
    invalidateChanged(values);
    const ids = [];
    for (const value of values) {
      const b = current(typeof value === 'object' ? value.id : value);
      if (!b || b.voided || b.status !== 'accepted' || !b.accepted_at) continue;
      const state = fingerprint(b), key = 'booking-accepted:' + b.id + ':' + state;
      db.prepare('INSERT OR IGNORE INTO booking_acceptance_updates(event_key,booking_id,participant_id,accepted_at,state_hash,created_at) VALUES(?,?,?,?,?,?)')
        .run(key, b.id, b.participant_id, b.accepted_at, state, now());
      ids.push(db.prepare('SELECT id FROM booking_acceptance_updates WHERE event_key=?').get(key).id);
    }
    return ids;
  }
  function subject(req, user) {
    const viewer = user && activeUser(user.id);
    if (!viewer || viewer.is_admin || user.admin) return null;
    if (viewer.role === 'participant') return viewer;
    if (viewer.role !== 'coordinator') return null;
    const selected = c.actFor(req, {...user, role: viewer.role}, 'bookings');
    const p = selected && activeUser(selected.id);
    return p?.role === 'participant' ? p : null;
  }
  function relevantRows(pid, viewerId, includeRead = false) {
    const rows = db.prepare(`SELECT n.*,r.read_at FROM booking_acceptance_updates n
      LEFT JOIN booking_acceptance_reads r ON r.update_id=n.id AND r.viewer_id=?
      WHERE n.participant_id=? AND n.invalidated_at IS NULL ${includeRead ? '' : 'AND r.update_id IS NULL'} ORDER BY n.id DESC`).all(viewerId, pid);
    const answer = [];
    for (const row of rows) {
      const b = current(row.booking_id);
      if (!b || b.voided || b.status !== 'accepted' || b.participant_id !== pid || fingerprint(b) !== row.state_hash) continue;
      if (['finding','office','uncovered','failed','allied','referred'].includes(b.cover_state) || b.delivered_by_allied) continue;
      const ends = Number(c.bookingEnd(b));
      if (!Number.isFinite(ends) || ends <= Date.parse(now())) continue;
      const participant = activeUser(pid), worker = activeUser(b.worker_id);
      if (!participant || !worker || worker.role !== 'worker') continue;
      answer.push({id:row.id, booking_id:b.id, participant_id:pid, participant_name:participant.name || 'Participant', worker_name:worker.name || 'Your worker',
        date:b.date, start:b.start, hours:b.hours, accepted_at:row.accepted_at, destination:'#/journey?panel=shift&booking=' + b.id});
    }
    return answer;
  }
  const response = rows => ({count:rows.length, updates:rows.slice(0, 100)});
  route('GET', /^\/api\/me\/booking-updates$/, (req, res, m, user) => {
    if (!user) return json(res, 401, {error:'Please log in.'});
    if (user.admin || activeUser(user.id)?.is_admin || !['participant','coordinator'].includes(user.role)) return json(res, 200, response([]));
    const p = subject(req, user);
    if (!p) return json(res, 403, {error:'Choose a participant you have permission to support with bookings.'});
    json(res, 200, response(relevantRows(p.id, user.id)));
  });
  route('POST', /^\/api\/me\/booking-updates\/read$/, (req, res, m, user, body = {}) => {
    if (!user) return json(res, 401, {error:'Please log in.'});
    const p = subject(req, user);
    if (!p) return json(res, 403, {error:'Booking update access is not available.'});
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || body.ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      return json(res, 400, {error:'Choose between 1 and 100 booking updates.'});
    }
    const ids = [...new Set(body.ids)], available = new Set(relevantRows(p.id, user.id, true).map(row => row.id));
    if (ids.some(id => !available.has(id))) return json(res, 403, {error:'A booking update is no longer available for this account.'});
    let read = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of ids) read += Number(db.prepare('INSERT OR IGNORE INTO booking_acceptance_reads(update_id,viewer_id,read_at) VALUES(?,?,?)').run(id, user.id, now()).changes);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    json(res, 200, {ok:true, read, count:relevantRows(p.id, user.id).length});
  });
  return {recordAccepted, invalidateChanged};
};
