#!/usr/bin/env node
/* ============================================================================
   reset-test-agreements.js — clear a TEST participant's on-screen agreements
   ----------------------------------------------------------------------------
   Deletes the "I agree" records (Service Agreement, privacy consent, and the
   old schedule clicks) for ONE account, so the account starts clean on the
   current edition: no "earlier editions", no "needs a fresh click". The next
   prefill run, or a live click, records a single v1 acceptance.

   It touches nothing else on the account — the plan, the billing details,
   the bookings and every other document stay.

   It refuses: any account that is not a participant; any demo account;
   any account with a completed booking (a real history is never edited).

   RUN IT ON THE SERVER, with the site stopped, exactly like the conversion
   script:

     sudo systemctl stop bookit
     sudo env DB_PATH=/opt/bookit-data/bookit.db node reset-test-agreements.js you+participant@gmail.com
     sudo env DB_PATH=/opt/bookit-data/bookit.db node reset-test-agreements.js you+participant@gmail.com --yes
     sudo chown bookit:bookit /opt/bookit-data/bookit.db*
     sudo systemctl start bookit

   The first call only shows what it would delete. Nothing is deleted
   without --yes.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const email = (args.find(a => !a.startsWith('--')) || '').trim().toLowerCase();
const yes = args.includes('--yes');
const DB_PATH = process.env.DB_PATH || '';
const KEYS = ['p-agreement', 'p-consent-privacy', 'p-schedule'];

function die(msg) { console.error('  ✗ ' + msg); process.exit(2); }
if (!email) die('Usage: DB_PATH=/path/to/bookit.db node reset-test-agreements.js you+participant@gmail.com [--yes]');
if (!DB_PATH) die('Set DB_PATH to the live database (on the server: /opt/bookit-data/bookit.db).');
if (!fs.existsSync(DB_PATH)) die(`No database at ${DB_PATH}.`);
if (/@demo\.bookit\.life$/i.test(email)) die('That is a demo account; this script does not touch demo data.');

const db = new DatabaseSync(DB_PATH);
const u = db.prepare('SELECT id, email, role, name FROM users WHERE lower(email) = ?').get(email);
if (!u) die(`No account with the email ${email}.`);
if (u.role !== 'participant') die(`${email} is a ${u.role} account, not a participant. Nothing changed.`);

const done = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE participant_id = ? AND status = 'completed'").get(u.id).n;
if (done > 0) die(`${u.name} has ${done} completed booking(s). This script only resets accounts with no service history. Nothing changed.`);

const rows = db.prepare(`SELECT id, form_key, accepted_at, accepted_version, file_path FROM participant_docs
  WHERE participant_id = ? AND form_key IN (${KEYS.map(() => '?').join(',')}) ORDER BY id`).all(u.id, ...KEYS);

console.log(`\n${u.name} <${u.email}> — participant #${u.id}`);
if (!rows.length) { console.log('  – No agreement records to clear. Nothing to do.\n'); process.exit(0); }
for (const r of rows) console.log(`  ${yes ? '✗ deleting' : '– would delete'}  ${r.form_key}  ${r.accepted_at ? 'agreed ' + String(r.accepted_at).slice(0, 10) : 'no click'}  ${r.accepted_version || ''}${r.file_path ? '  (+ saved copy)' : ''}`);

if (!yes) { console.log('\nDry run. Add --yes to delete these records.\n'); process.exit(0); }

db.exec('BEGIN');
try {
  const del = db.prepare('DELETE FROM participant_docs WHERE id = ? AND participant_id = ?');
  for (const r of rows) {
    del.run(r.id, u.id);
    if (r.file_path) {
      /* snapshots are stored as absolute paths, or as a name inside the docs
         folder beside the database — try both, never fail on a missing file */
      const cands = [r.file_path, path.join(path.dirname(path.resolve(DB_PATH)), 'bookit-docs', path.basename(r.file_path))];
      for (const c of cands) { try { if (fs.existsSync(c)) fs.unlinkSync(c); } catch { /* leave it */ } }
    }
  }
  try { db.prepare("INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?, 'test-agreements-reset', ?, ?)").run(u.id, `cleared ${rows.length} agreement record(s) for ${u.email} before re-acceptance`, new Date().toISOString()); }
  catch { /* no audit table in this build — the deletion still stands */ }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); die(`Failed, nothing changed: ${e.message}`); }
console.log(`\n  ✓ Cleared ${rows.length} record(s). Start the site, then run the prefill (or click I agree on the documents page) to record the current edition.\n`);
