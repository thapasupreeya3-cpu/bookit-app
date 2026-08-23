#!/usr/bin/env node
/* ============================================================================
   reset-walkthrough.js — undo the prefill on a TEST participant, piece by piece
   ----------------------------------------------------------------------------
   prefill-walkthrough.js fills four things on a test account. This script
   clears any of them, or all of them, so the account can be shown from the
   beginning again: the plan written live, the billing typed live, the
   agreement clicked live.

     --plan         every support-plan version and the workers' "I have read
                    it" ticks for this participant (the office review goes
                    with the plan, because the review is of a plan)
     --billing      how supports are funded, NDIS number, plan manager email,
                    NDIS plan dates
     --agreements   the on-screen "I agree" records: Service Agreement, privacy
                    consent, and any old schedule clicks, with their snapshots
     --nominee      "who manages this account" (and the under-18 flag)
     --all          all four

   It refuses: any account that is not a participant; any demo account;
   any account with a completed booking (a real history is never edited).
   With --plan it also refuses if the account has a requested or accepted
   booking, because a worker holding a shift must be able to read the plan —
   cancel the booking first, or leave the plan alone.

   RUN IT ON THE SERVER, with the site stopped:

     sudo systemctl stop bookit
     sudo env DB_PATH=/opt/bookit-data/bookit.db node reset-walkthrough.js you+participant@gmail.com --all
     sudo env DB_PATH=/opt/bookit-data/bookit.db node reset-walkthrough.js you+participant@gmail.com --all --yes
     sudo chown bookit:bookit /opt/bookit-data/bookit.db*
     sudo systemctl start bookit

   The first call only shows what it would clear. Nothing is changed
   without --yes. Afterwards, run the prefill again (or do it live).
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const email = (args.find(a => !a.startsWith('--')) || '').trim().toLowerCase();
const yes = args.includes('--yes');
const all = args.includes('--all');
const want = {
  plan: all || args.includes('--plan'),
  billing: all || args.includes('--billing'),
  agreements: all || args.includes('--agreements'),
  nominee: all || args.includes('--nominee')
};
const DB_PATH = process.env.DB_PATH || '';
const AGREEMENT_KEYS = ['p-agreement', 'p-consent-privacy', 'p-schedule'];

function die(msg) { console.error('  ✗ ' + msg); process.exit(2); }
if (!email) die('Usage: DB_PATH=/path/to/bookit.db node reset-walkthrough.js you+participant@gmail.com --plan|--billing|--agreements|--nominee|--all [--yes]');
if (!Object.values(want).some(Boolean)) die('Say what to clear: --plan, --billing, --agreements, --nominee, or --all.');
if (!DB_PATH) die('Set DB_PATH to the live database (on the server: /opt/bookit-data/bookit.db).');
if (!fs.existsSync(DB_PATH)) die(`No database at ${DB_PATH}.`);
if (/@demo\.bookit\.life$/i.test(email)) die('That is a demo account; this script does not touch demo data.');

const db = new DatabaseSync(DB_PATH);
const u = db.prepare('SELECT id, email, role, name, plan, ndis_number, pm_email, plan_start, plan_end, nominee_role, nominee_name, under_18 FROM users WHERE lower(email) = ?').get(email);
if (!u) die(`No account with the email ${email}.`);
if (u.role !== 'participant') die(`${email} is a ${u.role} account, not a participant. Nothing changed.`);

const done = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE participant_id = ? AND status = 'completed'").get(u.id).n;
if (done > 0) die(`${u.name} has ${done} completed booking(s). This script only resets accounts with no service history. Nothing changed.`);

const mark = yes ? '✗ clearing ' : '– would clear';
console.log(`\n${u.name} <${u.email}> — participant #${u.id}\n`);
const work = [];   /* [label, fn] */

/* ---- plan ---- */
if (want.plan) {
  const live = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE participant_id = ? AND status IN ('requested','accepted')").get(u.id).n;
  if (live > 0) die(`${u.name} has ${live} requested or accepted booking(s); a worker holding a shift must be able to read the plan. Cancel them first, or run without --plan.`);
  /* SELECT * so the script also runs against a database from before v86.4, which has no reviewed_at column */
  const plans = db.prepare('SELECT * FROM support_plans WHERE participant_id = ? ORDER BY version').all(u.id);
  const acks = db.prepare('SELECT COUNT(*) AS n FROM plan_acks WHERE participant_id = ?').get(u.id).n;
  if (!plans.length) console.log('  – plan: nothing on file');
  for (const p of plans) console.log(`  ${mark}  plan v${p.version} (${p.status}${p.confirmed_at ? ', confirmed ' + String(p.confirmed_at).slice(0, 10) : ''}${p.reviewed_at ? ', office-reviewed ' + String(p.reviewed_at).slice(0, 10) : ''})`);
  if (acks) console.log(`  ${mark}  ${acks} worker plan acknowledgement(s)`);
  if (plans.length || acks) work.push(['plan', () => {
    db.prepare('DELETE FROM plan_acks WHERE participant_id = ?').run(u.id);
    db.prepare('DELETE FROM support_plans WHERE participant_id = ?').run(u.id);
  }]);
}

/* ---- billing ---- */
if (want.billing) {
  const has = u.plan && u.plan !== 'none' || u.ndis_number || u.pm_email || u.plan_start || u.plan_end;
  if (!has) console.log('  – billing: nothing on file');
  else {
    console.log(`  ${mark}  billing: ${u.plan || 'none'}${u.ndis_number ? ' · NDIS ' + u.ndis_number : ''}${u.pm_email ? ' · PM ' + u.pm_email : ''}${u.plan_start || u.plan_end ? ' · plan ' + (u.plan_start || '?') + ' to ' + (u.plan_end || '?') : ''}`);
    work.push(['billing', () => {
      db.prepare("UPDATE users SET plan = 'none', ndis_number = '', pm_email = '', plan_start = '', plan_end = '' WHERE id = ?").run(u.id);
    }]);
  }
}

/* ---- agreements ---- */
let agreementRows = [];
if (want.agreements) {
  agreementRows = db.prepare(`SELECT id, form_key, accepted_at, accepted_version, file_path FROM participant_docs
    WHERE participant_id = ? AND form_key IN (${AGREEMENT_KEYS.map(() => '?').join(',')}) ORDER BY id`).all(u.id, ...AGREEMENT_KEYS);
  if (!agreementRows.length) console.log('  – agreements: nothing on file');
  for (const r of agreementRows) console.log(`  ${mark}  ${r.form_key}  ${r.accepted_at ? 'agreed ' + String(r.accepted_at).slice(0, 10) : 'not agreed'}${r.accepted_version ? ' · ' + r.accepted_version : ''}`);
  if (agreementRows.length) work.push(['agreements', () => {
    const del = db.prepare('DELETE FROM participant_docs WHERE id = ? AND participant_id = ?');
    for (const r of agreementRows) {
      del.run(r.id, u.id);
      if (r.file_path) {
        const cands = [r.file_path, path.join(path.dirname(path.resolve(DB_PATH)), 'bookit-docs', path.basename(r.file_path))];
        for (const c of cands) { try { if (fs.existsSync(c)) fs.unlinkSync(c); } catch { /* leave it */ } }
      }
    }
  }]);
}

/* ---- nominee ---- */
if (want.nominee) {
  if (!u.nominee_role && !u.nominee_name && !u.under_18) console.log('  – who manages the account: not answered yet');
  else {
    console.log(`  ${mark}  who manages the account: ${u.nominee_role === 'none' ? 'self' : (u.nominee_name || u.nominee_role)}${u.under_18 ? ' · under 18' : ''}`);
    work.push(['nominee', () => {
      db.prepare("UPDATE users SET nominee_role = '', nominee_name = '', nominee_relationship = '', nominee_phone = '', nominee_email = '', nominee_paid = 0, under_18 = 0, nominee_at = '' WHERE id = ?").run(u.id);
    }]);
  }
}

if (!work.length) { console.log('\nNothing to do.\n'); process.exit(0); }
if (!yes) { console.log('\nDry run. Add --yes to clear these.\n'); process.exit(0); }

db.exec('BEGIN');
try {
  for (const [, fn] of work) fn();
  try {
    db.prepare("INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?, 'test-walkthrough-reset', ?, ?)")
      .run(u.id, `cleared: ${work.map(w => w[0]).join(', ')} on ${u.email}`, new Date().toISOString());
  } catch { /* no audit table in this build — the reset still stands */ }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); die(`Failed, nothing changed: ${e.message}`); }
console.log(`\n  ✓ Cleared: ${work.map(w => w[0]).join(', ')}. Start the site, then run the prefill again or do it live.\n`);
