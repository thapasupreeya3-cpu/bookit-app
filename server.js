/* ============================================================
   BookIt — backend server (zero dependencies)
   Node 22+ (uses built-in node:sqlite). Run:  node server.js
   Env: PORT (default 3000) · SECRET (session key; auto-generated
        to .secret if unset) · AUTO_REPLY=off to disable the demo
        auto-acknowledgement bot · DB_PATH (default ./bookit.db)
   ============================================================ */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bookit.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const AUTO_REPLY = (process.env.AUTO_REPLY || 'on') !== 'off';
const SESSION_DAYS = 30;

/* ---------- secret ---------- */
const SECRET_FILE = path.join(__dirname, '.secret');
const SECRET = process.env.SECRET || (() => {
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); }
  catch { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); return s; }
})();

/* ---------- database ---------- */
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('participant','worker')),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    pass TEXT NOT NULL,
    suburb TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    plan TEXT DEFAULT '',
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS worker_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    bio TEXT DEFAULT '',
    services TEXT DEFAULT '[]',
    langs TEXT DEFAULT 'English',
    exp TEXT DEFAULT 'New to BookIt',
    color TEXT DEFAULT '#0E6B62',
    rating REAL DEFAULT 0,
    shifts INTEGER DEFAULT 0,
    checks TEXT DEFAULT '["NDIS Worker Screening (in progress)"]',
    days TEXT DEFAULT '[1,1,1,1,1,0,0]',
    visible INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    participant_id INTEGER NOT NULL REFERENCES users(id),
    worker_id INTEGER NOT NULL REFERENCES users(id),
    created TEXT NOT NULL,
    UNIQUE (participant_id, worker_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    convo_id INTEGER NOT NULL REFERENCES conversations(id),
    sender_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created TEXT NOT NULL,
    read_at TEXT
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY,
    participant_id INTEGER NOT NULL REFERENCES users(id),
    worker_id INTEGER NOT NULL REFERENCES users(id),
    service TEXT NOT NULL,
    date TEXT NOT NULL,
    start TEXT NOT NULL,
    hours REAL NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested','accepted','declined','cancelled','completed')),
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY,
    name TEXT, email TEXT, topic TEXT, body TEXT, created TEXT NOT NULL
  );
`);

/* migration (email build): verification flag on users */
try { db.exec('ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0'); } catch {}
db.exec("UPDATE users SET verified = 1 WHERE email LIKE '%@demo.bookit.life' AND verified = 0");

/* migration (invoicing build): completion + invoice fields on bookings */
for (const col of ['completed_at TEXT', 'rate_category TEXT', 'unit_price REAL', 'worker_share REAL', 'total REAL']) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col}`); } catch {}
}
/* migration (payments build): billing details + claim tracking */
for (const col of ['ndis_number TEXT DEFAULT \'\'', 'pm_email TEXT DEFAULT \'\'']) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch {}
}
for (const col of ['claim_status TEXT DEFAULT \'\'', 'claim_ref TEXT', 'invoice_no TEXT', 'support_item TEXT', 'claimed_at TEXT', 'paid_at TEXT', 'sleepover INTEGER DEFAULT 0']) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col}`); } catch {}
}
/* migration (profiles build): worker profile photos */
for (const col of ['photo TEXT DEFAULT \'\'', 'photo_at TEXT DEFAULT \'\'']) {
  try { db.exec(`ALTER TABLE worker_profiles ADD COLUMN ${col}`); } catch {}
}
/* compliance build: credentials + incident + complaint registers */
db.exec(`
  CREATE TABLE IF NOT EXISTS worker_docs (
    id INTEGER PRIMARY KEY,
    worker_id INTEGER NOT NULL REFERENCES users(id),
    doc_type TEXT NOT NULL,
    label TEXT DEFAULT '',
    check_number TEXT DEFAULT '',
    expiry_date TEXT DEFAULT '',
    file_name TEXT DEFAULT '',
    file_mime TEXT DEFAULT '',
    file_path TEXT DEFAULT '',
    uploaded_at TEXT NOT NULL,
    verified_at TEXT,
    verified_by TEXT DEFAULT '',
    warned_stage TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY,
    created_by INTEGER,
    created_by_name TEXT DEFAULT '',
    participant_name TEXT DEFAULT '',
    worker_name TEXT DEFAULT '',
    occurred_at TEXT NOT NULL,
    location TEXT DEFAULT '',
    category TEXT NOT NULL,
    reportable INTEGER DEFAULT 0,
    description TEXT NOT NULL,
    immediate_action TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    notify_due TEXT,
    commission_notified_at TEXT,
    lessons TEXT DEFAULT '',
    closed_at TEXT,
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY,
    source_name TEXT DEFAULT '',
    source_email TEXT DEFAULT '',
    channel TEXT DEFAULT 'site',
    summary TEXT NOT NULL,
    details TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    acknowledged_at TEXT,
    resolved_at TEXT,
    outcome TEXT DEFAULT '',
    created TEXT NOT NULL
  );
`);

/* …and allow the 'completed' status. SQLite can't edit a CHECK constraint,
   so databases created before invoicing get their bookings table rebuilt once. */
const bkDef = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookings'").get();
if (bkDef && !bkDef.sql.includes("'completed'")) {
  db.exec(`
    BEGIN;
    CREATE TABLE bookings_new (
      id INTEGER PRIMARY KEY,
      participant_id INTEGER NOT NULL REFERENCES users(id),
      worker_id INTEGER NOT NULL REFERENCES users(id),
      service TEXT NOT NULL,
      date TEXT NOT NULL,
      start TEXT NOT NULL,
      hours REAL NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested','accepted','declined','cancelled','completed')),
      created TEXT NOT NULL,
      completed_at TEXT, rate_category TEXT, unit_price REAL, worker_share REAL, total REAL
    );
    INSERT INTO bookings_new (id, participant_id, worker_id, service, date, start, hours, notes, status, created, completed_at, rate_category, unit_price, worker_share, total)
      SELECT id, participant_id, worker_id, service, date, start, hours, notes, status, created, completed_at, rate_category, unit_price, worker_share, total FROM bookings;
    DROP TABLE bookings;
    ALTER TABLE bookings_new RENAME TO bookings;
    COMMIT;
  `);
  console.log('Migrated bookings table to allow completed status.');
}

/* ---------- helpers ---------- */
const now = () => new Date().toISOString();
const SERVICES = ['employment','personal-care','transport','daily-tasks','household','community'];
const RATES = [
  { label: 'Weekday daytime', you: 73.58, worker: 53.25 },
  { label: 'Weekday evening', you: 81.07, worker: 58.70 },
  { label: 'Weekday night', you: 82.57, worker: 59.80 },
  { label: 'Saturday', you: 103.54, worker: 74.95 },
  { label: 'Sunday', you: 133.50, worker: 96.65 },
  { label: 'Public holiday', you: 163.46, worker: 118.35 }
];

/* ---------- invoicing (NDIS Pricing Arrangements 2026–27 price limits) ----------
   A completed shift gets a rate category. The category is auto-suggested from
   the booking's date/time (public holidays can't be auto-detected — admins can
   override any line from the dashboard before exporting). */
const INVOICE_RATES = {
  'weekday-day':     { label: 'Weekday daytime', price: 73.58,  worker: 53.25 },
  'weekday-evening': { label: 'Weekday evening', price: 81.07,  worker: 58.70 },
  'weekday-night':   { label: 'Weekday night',   price: 82.57,  worker: 59.80 },
  'saturday':        { label: 'Saturday',        price: 103.54, worker: 74.95 },
  'sunday':          { label: 'Sunday',          price: 133.50, worker: 96.65 },
  'public-holiday':  { label: 'Public holiday',  price: 163.46, worker: 118.35 },
  'household':       { label: 'Household tasks (cleaning)', price: 60.10, worker: 43.50 },
  /* 0102 Employment Assistance (10_016_0102_5_3) is a flat rate — no day-type variants */
  'employment':      { label: 'Employment support (flat)', price: 83.87, worker: 60.70 },
  /* inactive night: flat per-night price, not hourly */
  'sleepover':       { label: 'Night-time sleepover (inactive)', price: 311.79, worker: 225.65, perNight: true }
};
const REG_GROUPS = { 'employment': '0102', 'personal-care': '0107', 'transport': '0108', 'daily-tasks': '0115/0138', 'household': '0120', 'community': '0125' };
function suggestCategory(b) {
  if (b.sleepover) return 'sleepover';
  if (b.service === 'household') return 'household';
  if (b.service === 'employment') return 'employment';
  const dow = new Date(b.date + 'T00:00:00').getDay();
  if (dow === 6) return 'saturday';
  if (dow === 0) return 'sunday';
  const [h, min] = String(b.start).split(':').map(Number);
  const endH = h + (min || 0) / 60 + Number(b.hours);
  let cat = 'weekday-day';
  if (h < 6) cat = 'weekday-night';
  else if (h >= 20 || endH > 20) cat = 'weekday-evening';
  /* the 0125 set has no night item — night community/transport shifts claim the evening item */
  if (cat === 'weekday-night' && (b.service === 'community' || b.service === 'transport')) cat = 'weekday-evening';
  return cat;
}
/* Verified verbatim against the official NDIS Pricing Schedule 2026-27 v1.2
   (Schedule 1 pp.5-15, Schedule 3 Table 13 p.25), supplied by the provider:
   - 0107 self-care: 01_002 night · 01_010 SLEEPOVER (Each $311.79) · 01_011 day
     · 01_012 PH · 01_013 Sat · 01_014 Sun · 01_015 evening
   - 0115 SIL: 01_801..806 day/eve/night/Sat/Sun/PH · 01_832 sleepover
     (0138 mirror set 01_8xx_0138_1_1 exists for SIL-group claims)
   - 0125 community: 04_104 day · 04_103 evening · 04_105 Sat · 04_106 Sun
     · 04_102 PH — NO night or sleepover items (night coerced to evening)
   - 0120: 01_020_0120_1_1 House Cleaning $60.10/h (01_019 yard $59.01 exists)
   - 0102: 10_016_0102_5_3 Employment Assistance — FLAT $83.87/h, all days
   - transport (0108): no hourly labour items exist; labour is claimed under the
     0125 set + Activity Based Transport 04_590_0125_6_1 for km — confirm with
     each plan manager (hence the confirm flag). */
const SUPPORT_ITEMS = {
  'personal-care': { 'weekday-day': '01_011_0107_1_1', 'weekday-evening': '01_015_0107_1_1', 'weekday-night': '01_002_0107_1_1', 'saturday': '01_013_0107_1_1', 'sunday': '01_014_0107_1_1', 'public-holiday': '01_012_0107_1_1', 'sleepover': '01_010_0107_1_1' },
  'daily-tasks': { 'weekday-day': '01_801_0115_1_1', 'weekday-evening': '01_802_0115_1_1', 'weekday-night': '01_803_0115_1_1', 'saturday': '01_804_0115_1_1', 'sunday': '01_805_0115_1_1', 'public-holiday': '01_806_0115_1_1', 'sleepover': '01_832_0115_1_1' },
  'community': { 'weekday-day': '04_104_0125_6_1', 'weekday-evening': '04_103_0125_6_1', 'saturday': '04_105_0125_6_1', 'sunday': '04_106_0125_6_1', 'public-holiday': '04_102_0125_6_1' },
  'household': { '*': '01_020_0120_1_1' },
  'employment': { '*': '10_016_0102_5_3' },
  'transport': { 'weekday-day': '04_104_0125_6_1', 'weekday-evening': '04_103_0125_6_1', 'saturday': '04_105_0125_6_1', 'sunday': '04_106_0125_6_1', 'public-holiday': '04_102_0125_6_1' }
};
const ITEM_CONFIRM = { 'transport': true };
function supportItemFor(service, category) {
  const m = SUPPORT_ITEMS[service] || {};
  return m[category] || m['*'] || '';
}
const NDIS_REG_NO = process.env.NDIS_REG_NO || '4-LO5XNY0';
const COMPANY_ABN = '19658578575';
const BANK_DETAILS = process.env.BANK_DETAILS || '';

/* ---------- tiny PDF invoice generator (zero-dependency) ---------- */
function pdfEsc(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function makeInvoicePdf(inv) {
  /* inv: { invoice_no, date, bill_to: [lines], lines: [{date, service, item, hours, rate, amount}], total, self } */
  const ops = [];
  const T = (x, y, size, font, text, color) => {
    if (color) ops.push(color); else ops.push('0.09 0.19 0.23 rg');
    ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfEsc(text)}) Tj ET`);
  };
  const TEAL = '0.055 0.42 0.384 rg', SOFT = '0.35 0.44 0.48 rg';
  T(40, 795, 24, 'FB', 'BookIt', TEAL);
  T(40, 780, 8.5, 'F', 'Disability & Mental Health Care Pty Ltd · ABN 19 658 578 575', SOFT);
  T(40, 769, 8.5, 'F', `Registered NDIS Provider ${NDIS_REG_NO} · hello@bookit.life · 0488 114 368 · bookit.life`, SOFT);
  T(400, 795, 15, 'FB', 'TAX INVOICE');
  T(400, 781, 8.5, 'F', 'GST-free NDIS supports (s38-38 GST Act)', SOFT);
  T(400, 766, 10, 'FB', `Invoice ${inv.invoice_no}`);
  T(400, 753, 9.5, 'F', `Date: ${inv.date}`);
  T(40, 730, 9, 'FB', 'Bill to:');
  let y = 718;
  for (const line of inv.bill_to) { T(40, y, 9.5, 'F', line); y -= 12; }
  y = Math.min(y - 14, 660);
  const cols = { date: 40, svc: 105, item: 300, hrs: 400, rate: 445, amt: 505 };
  T(cols.date, y, 8.5, 'FB', 'Date'); T(cols.svc, y, 8.5, 'FB', 'Support'); T(cols.item, y, 8.5, 'FB', 'Support item no.');
  T(cols.hrs, y, 8.5, 'FB', 'Hours'); T(cols.rate, y, 8.5, 'FB', 'Rate'); T(cols.amt, y, 8.5, 'FB', 'Amount');
  y -= 5; ops.push('0.9 0.87 0.83 RG 0.7 w', `40 ${y} m 555 ${y} l S`); y -= 13;
  for (const l of inv.lines) {
    T(cols.date, y, 9, 'F', l.date);
    T(cols.svc, y, 9, 'F', String(l.service).slice(0, 34));
    T(cols.item, y, 9, 'F', l.item || '—');
    T(cols.hrs, y, 9, 'F', String(l.hours));
    T(cols.rate, y, 9, 'F', `$${l.rate.toFixed(2)}`);
    T(cols.amt, y, 9, 'F', `$${l.amount.toFixed(2)}`);
    y -= 15;
    if (y < 150) { T(40, y, 9, 'F', `… ${inv.lines.length} lines total — remainder on statement.`); break; }
  }
  y -= 4; ops.push('0.9 0.87 0.83 RG 0.7 w', `40 ${y} m 555 ${y} l S`); y -= 16;
  T(400, y, 11, 'FB', 'Total due:'); T(cols.amt, y, 11, 'FB', `$${inv.total.toFixed(2)}`);
  y -= 26;
  T(40, y, 9.5, 'FB', 'Payment'); y -= 13;
  if (inv.self) {
    T(40, y, 9, 'F', BANK_DETAILS ? `Please pay within 14 days by bank transfer: ${BANK_DETAILS}` : 'Please pay within 14 days — payment details provided separately.'); y -= 12;
    T(40, y, 9, 'F', `Reference: ${inv.invoice_no}. You can claim this amount back through the myplace participant portal.`, undefined);
  } else {
    T(40, y, 9, 'F', 'Please pay from plan funds within 14 days.' + (BANK_DETAILS ? ` Bank transfer: ${BANK_DETAILS}` : ' Payment details provided separately.')); y -= 12;
    T(40, y, 9, 'F', `Reference: ${inv.invoice_no}. Prices align with the NDIS Pricing Arrangements and Price Limits 2026-27.`);
  }
  T(40, 60, 8, 'F', 'Questions about this invoice? hello@bookit.life · 0488 114 368. Thank you for choosing BookIt.', SOFT);
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F 5 0 R /FB 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(o => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function applyInvoice(id, category) {
  const r = INVOICE_RATES[category];
  const b = db.prepare('SELECT hours FROM bookings WHERE id = ?').get(id);
  if (!r || !b) return null;
  const qty = r.perNight ? 1 : b.hours; /* sleepovers are one flat per-night price */
  const total = Math.round(r.price * qty * 100) / 100;
  const workerShare = Math.round(r.worker * qty * 100) / 100;
  db.prepare('UPDATE bookings SET rate_category = ?, unit_price = ?, worker_share = ?, total = ? WHERE id = ?')
    .run(category, r.price, workerShare, total, id);
  return { category, label: r.label, unit_price: r.price, qty, total, worker_share: workerShare };
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}
function makeSession(uid) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const base = `${uid}.${exp}`;
  return `${base}.${sign(base)}`;
}
/* the user object handed to routes and returned by /api/me — includes the worker's
   photo url + live (visible) flag so the front-end account menu can show them */
function sessionUser(uid) {
  const u = db.prepare('SELECT id, role, name, email, suburb, plan, verified, ndis_number, pm_email FROM users WHERE id = ?').get(Number(uid));
  if (!u) return null;
  if (u.role === 'worker') {
    const p = db.prepare('SELECT photo, photo_at, visible FROM worker_profiles WHERE user_id = ?').get(u.id);
    u.photo = p && p.photo ? `/photos/${u.id}?v=${encodeURIComponent(p.photo_at || '')}` : null;
    u.live = p && p.visible ? 1 : 0;
  }
  return withAdmin(u);
}
function readSession(cookieHeader) {
  const m = /(?:^|;\s*)bk_session=([^;]+)/.exec(cookieHeader || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const base = `${uid}.${exp}`;
  const expected = sign(base);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return sessionUser(uid);
}
function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...(SITE_PASSWORD ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
    ...headers
  });
  res.end(body);
}
function setSessionHeaders(uid) {
  return { 'Set-Cookie': `bk_session=${makeSession(uid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}` };
}
const CLEAR_COOKIE = { 'Set-Cookie': 'bk_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' };

/* ---------- private preview gate ----------
   Set SITE_PASSWORD to lock the whole site (pages + API) behind a
   password screen while you build. Delete the variable to go public. */
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
function gateValid(cookieHeader) {
  if (!SITE_PASSWORD) return true;
  const m = /(?:^|;\s*)bk_gate=([^;]+)/.exec(cookieHeader || '');
  if (!m) return false;
  const expected = sign('gate-ok:' + SITE_PASSWORD);
  return m[1].length === expected.length && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expected));
}
function gatePage(wrong) {
  return `<!DOCTYPE html><html lang="en-AU"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex, nofollow"><title>BookIt — private preview</title>
<style>body{font-family:system-ui,sans-serif;background:#FAF6F0;color:#17313A;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
.card{background:#fff;border:1px solid #E7DFD4;border-radius:20px;box-shadow:0 18px 50px rgba(23,49,58,.14);padding:40px;max-width:400px;width:100%;text-align:center;}
.logo{font-weight:800;font-size:1.6rem;display:flex;align-items:center;justify-content:center;gap:2px;margin-bottom:14px;}
.logo svg{height:.68em;width:auto;margin-top:.1em;}
h1{font-size:1.15rem;margin:0 0 8px;}
p{color:#3E5A64;font-size:.92rem;margin:0 0 22px;}
input{width:100%;padding:13px 16px;border:1.5px solid #E7DFD4;border-radius:11px;font-size:1rem;margin-bottom:12px;box-sizing:border-box;}
input:focus{outline:3px solid #F5B841;border-color:#0E6B62;}
button{width:100%;background:#0E6B62;color:#fff;border:none;border-radius:999px;padding:13px;font-size:1rem;font-weight:600;cursor:pointer;}
button:hover{background:#0A544D;}
.err{color:#a8250b;font-size:.88rem;margin:0 0 12px;font-weight:600;}</style></head>
<body><div class="card">
<div class="logo">b<svg viewBox="0 0 94 48" aria-hidden="true"><circle cx="23" cy="24" r="22" fill="#0E6B62"/><circle cx="69" cy="24" r="22" fill="#F5B841"/><path d="M57 25 l9 9 17 -18" stroke="#17313A" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>kit</div>
<h1>Private preview</h1>
<p>BookIt isn't open to the public just yet. Enter the access password to look around.</p>
${wrong ? '<p class="err">That password did not match — try again.</p>' : ''}
<form method="POST" action="/gate"><input type="password" name="pw" placeholder="Access password" autofocus required><button type="submit">Enter</button></form>
</div></body></html>`;
}

/* ---------- email (zero-dependency SMTP over TLS) ----------
   Sends through your Zoho mailbox. Set:
     SMTP_USER = hello@bookit.life
     SMTP_PASS = that mailbox's password (or a Zoho app password if MFA is on)
   Optional: SMTP_HOST (default smtppro.zoho.com.au — Zoho AU, paid org),
     SMTP_PORT (465 SSL), MAIL_FROM (defaults to SMTP_USER — must be the
     account address or one of its aliases), APP_URL (absolute link base
     for emails, e.g. https://demo.bookit.life).
   Without SMTP_USER+SMTP_PASS email is OFF: everything else works and
   would-be emails are logged to the console instead. Demo accounts
   (@demo.bookit.life) are never emailed. */
const SMTP_HOST = process.env.SMTP_HOST || 'smtppro.zoho.com.au';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || 'hello@bookit.life';
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
/* Resend HTTPS API (api.resend.com) — needed on hosts that block outbound
   SMTP (Railway Free/Trial/Hobby all do). Set RESEND_API_KEY to use it;
   it wins over SMTP when both are configured. */
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const RESEND_BASE = (process.env.RESEND_BASE || 'https://api.resend.com').replace(/\/+$/, '');
const EMAIL_ON = Boolean(RESEND_KEY || (SMTP_USER && SMTP_PASS));

/* ---------- admins ----------
   ADMIN_EMAILS = comma-separated list of account emails that get the admin
   dashboard (approve workers, see users/bookings/messages). */
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
function withAdmin(u) { if (u) u.admin = ADMIN_EMAILS.includes(String(u.email || '').toLowerCase()) ? 1 : 0; return u; }
function requireAdmin(user, res) { if (!user || !user.admin) { json(res, 403, { error: 'Admin only.' }); return false; } return true; }

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = n => escHtml(String(n || '').split(' ')[0] || 'there');
const SERVICE_LABELS = { 'employment': 'Employment support', 'personal-care': 'Personal care', 'transport': 'Travel & transport', 'daily-tasks': 'Daily tasks & shared living', 'household': 'Household tasks', 'community': 'Community participation' };
const prettyDate = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; } };

function b64wrap(str) { return Buffer.from(str, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'); }

function smtpSend(to, subject, html, text, replyTo, attachments) {
  return new Promise((resolve, reject) => {
    const boundary = 'bk' + crypto.randomBytes(12).toString('hex');
    const msgId = `<${crypto.randomBytes(12).toString('hex')}@bookit.life>`;
    const altPart =
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${b64wrap(text)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${b64wrap(html)}\r\n` +
      `--${boundary}--\r\n`;
    let topType = `multipart/alternative; boundary="${boundary}"`;
    let bodyPart = altPart;
    if (attachments && attachments.length) {
      const mix = 'mix' + crypto.randomBytes(10).toString('hex');
      topType = `multipart/mixed; boundary="${mix}"`;
      bodyPart =
        `--${mix}\r\n` +
        `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
        altPart +
        attachments.map(a =>
          `--${mix}\r\n` +
          `Content-Type: ${a.mime || 'application/octet-stream'}; name="${a.filename}"\r\n` +
          `Content-Disposition: attachment; filename="${a.filename}"\r\n` +
          `Content-Transfer-Encoding: base64\r\n\r\n` +
          `${a.buffer.toString('base64').replace(/(.{76})/g, '$1\r\n')}\r\n`).join('') +
        `--${mix}--\r\n`;
    }
    const data =
      `From: =?UTF-8?B?${Buffer.from('BookIt', 'utf8').toString('base64')}?= <${MAIL_FROM}>\r\n` +
      `To: <${to}>\r\n` +
      (replyTo ? `Reply-To: <${replyTo}>\r\n` : '') +
      `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `Message-ID: ${msgId}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: ${topType}\r\n` +
      `\r\n` +
      bodyPart;
    const steps = [
      { expect: 220, send: () => 'EHLO bookit.life\r\n' },
      { expect: 250, send: () => 'AUTH LOGIN\r\n' },
      { expect: 334, send: () => Buffer.from(SMTP_USER, 'utf8').toString('base64') + '\r\n' },
      { expect: 334, send: () => Buffer.from(SMTP_PASS, 'utf8').toString('base64') + '\r\n' },
      { expect: 235, send: () => `MAIL FROM:<${MAIL_FROM}>\r\n` },
      { expect: 250, send: () => `RCPT TO:<${to}>\r\n` },
      { expect: 250, send: () => 'DATA\r\n' },
      { expect: 354, send: () => data + '.\r\n' },
      { expect: 250, send: () => 'QUIT\r\n', done: true }
    ];
    let i = 0, buf = '', finished = false;
    const sock = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST });
    const fail = err => { if (finished) return; finished = true; clearTimeout(timer); try { sock.destroy(); } catch {} reject(err); };
    const timer = setTimeout(() => fail(new Error(`SMTP timeout talking to ${SMTP_HOST}:${SMTP_PORT}`)), 25000);
    sock.on('error', fail);
    sock.on('data', chunk => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        if (finished) return;
        if (/^\d{3}-/.test(line)) continue; /* multiline reply — keep reading */
        const step = steps[i];
        if (!step) continue;
        const code = Number(line.slice(0, 3));
        if (code !== step.expect) return fail(new Error(`${SMTP_HOST} said: ${line.trim() || '(empty reply)'}`));
        i++;
        sock.write(step.send());
        if (step.done) { finished = true; clearTimeout(timer); sock.end(); resolve(true); }
      }
    });
  });
}

async function resendSend(to, subject, html, text, replyTo, attachments) {
  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `BookIt <${MAIL_FROM}>`, to: [to], subject, html, text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachments && attachments.length ? { attachments: attachments.map(a => ({ filename: a.filename, content: a.buffer.toString('base64') })) } : {})
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) {
    let msg = `Resend API ${res.status}`;
    try { const j = await res.json(); if (j && j.message) msg += `: ${j.message}`; } catch {}
    throw new Error(msg);
  }
  return true;
}

function emailHtml(heading, bodyHtml, ctaText, ctaUrl) {
  const btn = (ctaText && ctaUrl) ? `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto 8px;"><tr><td style="background:#0E6B62;border-radius:999px;">
<a href="${ctaUrl}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;">${ctaText}</a>
</td></tr></table>
<p style="font-size:12px;color:#7d8f96;text-align:center;margin:0;">Button not working? Paste this into your browser:<br>
<a href="${ctaUrl}" style="color:#0E6B62;word-break:break-all;">${ctaUrl}</a></p>` : '';
  return `<!DOCTYPE html>
<html lang="en-AU"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#FAF6F0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6F0;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #E7DFD4;border-radius:18px;">
<tr><td style="padding:30px 34px 24px;font-family:Arial,Helvetica,sans-serif;color:#17313A;">
<div style="font-size:26px;font-weight:800;letter-spacing:-.5px;margin-bottom:20px;">b<span style="color:#0E6B62;">o</span><span style="color:#F5B841;">o</span>kit <span style="color:#0E6B62;">&#10003;</span></div>
<h1 style="font-size:20px;margin:0 0 14px;">${heading}</h1>
<div style="font-size:15px;line-height:1.65;color:#3E5A64;">${bodyHtml}</div>
${btn}
</td></tr>
<tr><td style="padding:18px 34px 26px;border-top:1px solid #F0EAE0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7d8f96;line-height:1.6;">
BookIt &middot; operated by Disability &amp; Mental Health Care Pty Ltd<br>
ABN 19 658 578 575 &middot; Registered NDIS Provider 4-LO5XNY0<br>
You&#39;re receiving this because of activity on your BookIt account.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function sendMail(to, subject, heading, bodyHtml, ctaText, ctaUrl, replyTo, attachments) {
  const dest = String(to || '').trim().toLowerCase();
  if (!dest || dest.endsWith('@demo.bookit.life')) return Promise.resolve('skipped-demo');
  const html = emailHtml(heading, bodyHtml, ctaText, ctaUrl);
  const text = bodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&middot;/g, '·').trim()
    + (ctaUrl ? `\n\n${ctaText}: ${ctaUrl}` : '')
    + '\n\n— BookIt · Disability & Mental Health Care Pty Ltd · ABN 19 658 578 575';
  if (!EMAIL_ON) { console.log(`[email off] '${subject}' → ${dest}${ctaUrl ? ' · link: ' + ctaUrl : ''}${attachments && attachments.length ? ' · attachments: ' + attachments.map(a => a.filename).join(',') : ''}`); return Promise.resolve('skipped-off'); }
  const transport = RESEND_KEY ? resendSend : smtpSend;
  return transport(dest, subject, html, text, replyTo, attachments).then(
    ok => { console.log(`[email] sent '${subject}' → ${dest}`); return ok; },
    err => { console.error(`[email] FAILED '${subject}' → ${dest}: ${err.message}`); throw err; }
  );
}

function baseUrl(req) {
  if (APP_URL) return APP_URL;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  return `${proto}://${host}`;
}

/* signed, expiring email tokens (verify / reset) */
function makeEmailToken(kind, uid, ttlMs, extra = '') {
  const exp = Date.now() + ttlMs;
  const base = `${kind}.${uid}.${exp}`;
  return `${base}.${sign(`${base}.${extra}`)}`;
}
function readEmailToken(kind, token, extraFor) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== kind) return null;
  const [k, uid, exp, sig] = parts;
  if (!/^\d+$/.test(uid) || !/^\d+$/.test(exp)) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(uid));
  if (!u) return null;
  const extra = extraFor ? extraFor(u) : '';
  const expected = sign(`${k}.${uid}.${exp}.${extra}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return u;
}
function sendVerifyEmail(req, u) {
  const url2 = `${baseUrl(req)}/verify-email?token=${makeEmailToken('v', u.id, 7 * 864e5)}`;
  return sendMail(u.email, 'Confirm your email — BookIt',
    `Welcome to BookIt, ${firstName(u.name)}!`,
    `<p>Your account is live. One quick thing — press the button below so we know this address is really yours. That's what keeps password resets and booking updates flowing to the right inbox.</p><p>The link works for 7 days.</p>`,
    'Confirm my email', url2);
}

function clean(v, max = 300) { return String(v ?? '').trim().slice(0, max); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* naive rate limiter for auth endpoints */
const hits = new Map();
function limited(ip, key, max = 25, windowMs = 10 * 60e3) {
  const k = `${ip}:${key}`;
  const rec = hits.get(k) || { n: 0, reset: Date.now() + windowMs };
  if (Date.now() > rec.reset) { rec.n = 0; rec.reset = Date.now() + windowMs; }
  rec.n++;
  hits.set(k, rec);
  return rec.n > max;
}

/* ---------- seed ---------- */
function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const demoWorkers = [
    { name: 'Sarah M.', email: 'sarah@demo.bookit.life', suburb: 'Parramatta NSW', color: '#0E6B62', exp: '6 yrs experience', langs: 'English, Auslan (basic)', services: ['community','personal-care','transport'], days: [1,1,1,0,1,0,0], bio: 'Former youth worker who loves footy, board games and getting out and about. Patient, punctual and big on routines that stick.', shifts: 112, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','Police check (transport)'] },
    { name: 'Daniel O.', email: 'daniel@demo.bookit.life', suburb: 'Blacktown NSW', color: '#D94F32', exp: '4 yrs experience', langs: 'English, Samoan', services: ['employment','community','daily-tasks'], days: [1,1,0,1,1,1,0], bio: 'Supports several clients in open employment. Great with interview nerves, workplace routines and building confidence on the job.', shifts: 87, rating: 4.8, checks: ['NDIS Worker Screening','First Aid & CPR','NDIS Orientation Module'] },
    { name: 'Priya S.', email: 'priya@demo.bookit.life', suburb: 'Liverpool NSW', color: '#7A4FBF', exp: '8 yrs experience', langs: 'English, Hindi, Tamil', services: ['personal-care','household','daily-tasks'], days: [1,0,1,1,1,0,1], bio: 'Gentle, thorough and endlessly cheerful. Loves cooking with clients — her butter chicken lesson is legendary.', shifts: 203, rating: 5.0, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','Cert III Individual Support'] },
    { name: 'Tom H.', email: 'tom@demo.bookit.life', suburb: 'Penrith NSW', color: '#1C7C43', exp: '3 yrs experience', langs: 'English', services: ['transport','community','household'], days: [0,1,1,1,0,1,1], bio: 'Drives a big, comfy wagon and knows every accessible café in the west. Happy to help with errands, gym runs and game day.', shifts: 64, rating: 4.9, checks: ['NDIS Worker Screening','Police check (transport)','First Aid & CPR','Comprehensive car insurance'] },
    { name: 'Amara W.', email: 'amara@demo.bookit.life', suburb: 'Bankstown NSW', color: '#B0468A', exp: '5 yrs experience', langs: 'English, Arabic', services: ['personal-care','daily-tasks','community'], days: [1,1,1,1,1,0,0], bio: 'Specialises in morning routines and building independence at home. Calm, respectful and a great listener.', shifts: 145, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','Manual handling training'] },
    { name: 'Liam C.', email: 'liam@demo.bookit.life', suburb: 'Chatswood NSW', color: '#3E5A64', exp: '2 yrs experience', langs: 'English, Mandarin', services: ['employment','transport','community'], days: [1,0,1,0,1,1,1], bio: 'Uni student and part-time barista. Brilliant with tech, public transport training and finding free things to do on weekends.', shifts: 41, rating: 4.7, checks: ['NDIS Worker Screening','First Aid & CPR','NDIS Orientation Module'] },
    { name: 'Grace N.', email: 'grace@demo.bookit.life', suburb: 'Newtown NSW', color: '#C2542B', exp: '7 yrs experience', langs: 'English, Vietnamese', services: ['household','daily-tasks','personal-care'], days: [1,1,0,1,1,1,0], bio: 'Runs a tight ship: sparkling kitchens, folded laundry and meal-prepped fridges. Also a certified plant whisperer.', shifts: 178, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR'] },
    { name: 'Noah B.', email: 'noah@demo.bookit.life', suburb: 'Campbelltown NSW', color: '#0A544D', exp: '5 yrs experience', langs: 'English', services: ['community','employment','daily-tasks'], days: [0,1,1,1,1,0,1], bio: 'Ex-tradie who now supports young blokes into apprenticeships. Practical, straight-up and great on a worksite or at pub trivia.', shifts: 96, rating: 4.8, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','White Card'] },
    { name: 'Isabella R.', email: 'isabella@demo.bookit.life', suburb: 'Hornsby NSW', color: '#6B8E23', exp: '4 yrs experience', langs: 'English, Spanish', services: ['personal-care','community','household'], days: [1,1,1,0,0,1,1], bio: 'Warm, energetic and music-obsessed. Supports clients to gigs, choir and everything in between.', shifts: 88, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR'] },
    { name: 'Zoe T.', email: 'zoe@demo.bookit.life', suburb: 'Ryde NSW', color: '#8a6d00', exp: '9 yrs experience', langs: 'English, Auslan (fluent)', services: ['daily-tasks','personal-care','employment'], days: [1,1,1,1,1,1,0], bio: 'Fluent in Auslan with a decade in disability support. Loves teaching cooking, budgeting and travel skills that last a lifetime.', shifts: 260, rating: 5.0, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','Cert IV Disability'] },
    { name: 'Kai M.', email: 'kai@demo.bookit.life', suburb: 'Brisbane QLD', color: '#2F6690', exp: '3 yrs experience', langs: 'English, Te Reo Māori', services: ['community','transport','household'], days: [0,1,1,1,1,1,0], bio: 'Surf-mad and endlessly upbeat. Supports beach days, park runs and community groups across Brisbane.', shifts: 55, rating: 4.8, checks: ['NDIS Worker Screening','Police check (transport)','First Aid & CPR'] },
    { name: 'Elena V.', email: 'elena@demo.bookit.life', suburb: 'Melbourne VIC', color: '#5D3FD3', exp: '6 yrs experience', langs: 'English, Greek', services: ['personal-care','daily-tasks','community'], days: [1,1,0,1,1,0,1], bio: 'Melbourne through and through: markets, galleries and the best souvlaki. Experienced with complex routines and hoists.', shifts: 132, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (VIC)','First Aid & CPR','Manual handling training'] }
  ];
  const insUser = db.prepare('INSERT INTO users (role, name, email, pass, suburb, created) VALUES (?,?,?,?,?,?)');
  const insProf = db.prepare('INSERT INTO worker_profiles (user_id, bio, services, langs, exp, color, rating, shifts, checks, days) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const demoPass = hashPassword('demo1234');
  for (const w of demoWorkers) {
    const r = insUser.run('worker', w.name, w.email, demoPass, w.suburb, now());
    insProf.run(Number(r.lastInsertRowid), w.bio, JSON.stringify(w.services), w.langs, w.exp, w.color, w.rating, w.shifts, JSON.stringify(w.checks), JSON.stringify(w.days));
  }
  insUser.run('participant', 'Demo Participant', 'demo@demo.bookit.life', demoPass, 'Wyong NSW', now());
  db.exec("UPDATE users SET verified = 1 WHERE email LIKE '%@demo.bookit.life'");
  console.log('Seeded 12 demo workers (…@demo.bookit.life / demo1234) and demo@demo.bookit.life / demo1234');
}
seed();

/* ---------- data access ---------- */
function publicWorker(row) {
  return {
    id: row.user_id, name: row.name, suburb: row.suburb, color: row.color,
    exp: row.exp, langs: row.langs, bio: row.bio,
    services: JSON.parse(row.services), checks: JSON.parse(row.checks),
    days: JSON.parse(row.days), rating: row.rating, shifts: row.shifts,
    photo: row.photo ? `/photos/${row.user_id}?v=${encodeURIComponent(row.photo_at || '')}` : null
  };
}
function convoForUser(user, convoRow) {
  const otherId = user.role === 'participant' ? convoRow.worker_id : convoRow.participant_id;
  const other = db.prepare("SELECT u.id, u.name, u.suburb, COALESCE(p.color, '#0E6B62') AS color FROM users u LEFT JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ?").get(otherId);
  const last = db.prepare('SELECT body, sender_id, created FROM messages WHERE convo_id = ? ORDER BY id DESC LIMIT 1').get(convoRow.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE convo_id = ? AND sender_id != ? AND read_at IS NULL').get(convoRow.id, user.id).n;
  return {
    id: convoRow.id,
    other: { id: other.id, name: other.name, suburb: other.suburb, color: other.color },
    last: last ? { body: last.body, mine: last.sender_id === user.id, created: last.created } : null,
    unread
  };
}
function memberOf(user, convoId) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convoId);
  if (!c) return null;
  return (c.participant_id === user.id || c.worker_id === user.id) ? c : null;
}

/* ---------- routes ---------- */
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

route('GET', /^\/api\/health$/, (req, res) => json(res, 200, { ok: true, time: now() }));

route('GET', /^\/api\/me$/, (req, res, m, user) => json(res, 200, { user }));

route('POST', /^\/api\/register$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'register', 15)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  const role = body.role === 'worker' ? 'worker' : 'participant';
  const name = clean(body.name, 80);
  const email = clean(body.email, 120).toLowerCase();
  const password = String(body.password || '');
  const suburb = clean(body.suburb, 80);
  if (!name || name.length < 2) return json(res, 400, { error: 'Please enter your name.' });
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Please enter a valid email address.' });
  if (password.length < 8) return json(res, 400, { error: 'Password needs at least 8 characters.' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return json(res, 409, { error: 'That email already has an account — try logging in.' });
  const ndisNum = /^\d{9}$/.test(clean(body.ndis_number, 12)) ? clean(body.ndis_number, 12) : '';
  const pmEmail = EMAIL_RE.test(clean(body.pm_email, 120)) ? clean(body.pm_email, 120).toLowerCase() : '';
  const r = db.prepare('INSERT INTO users (role, name, email, pass, suburb, phone, plan, ndis_number, pm_email, created) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(role, name, email, hashPassword(password), suburb, clean(body.phone, 40), clean(body.plan, 30), ndisNum, pmEmail, now());
  const uid = Number(r.lastInsertRowid);
  if (role === 'worker') {
    const services = Array.isArray(body.services) ? body.services.filter(s => SERVICES.includes(s)).slice(0, 6) : [];
    /* vetting: new workers start hidden (visible = 0) until an admin approves them */
    db.prepare('INSERT INTO worker_profiles (user_id, bio, services, visible) VALUES (?,?,?,0)')
      .run(uid, clean(body.bio, 600), JSON.stringify(services));
    if (MAIL_FROM) sendMail(MAIL_FROM, 'New worker application — BookIt',
      'A new support worker has applied',
      `<p><b>${escHtml(name)}</b> (${escHtml(suburb) || 'no suburb given'}) has registered as a worker and is waiting for approval.</p><p><b>Email:</b> ${escHtml(email)}<br><b>Services:</b> ${services.map(s => SERVICE_LABELS[s] || s).join(', ') || '—'}</p><p>Their profile stays hidden from Find Workers until you approve it.</p>`,
      'Open the admin dashboard', `${baseUrl(req)}/#/admin`).catch(() => {});
  }
  const me = sessionUser(uid);
  sendVerifyEmail(req, me).catch(() => {});
  json(res, 200, { user: me }, setSessionHeaders(uid));
});

route('POST', /^\/api\/login$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'login', 25)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  const email = clean(body.email, 120).toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !verifyPassword(String(body.password || ''), row.pass)) {
    return json(res, 401, { error: 'Email or password doesn\'t match.' });
  }
  json(res, 200, { user: sessionUser(row.id) }, setSessionHeaders(row.id));
});

route('POST', /^\/api\/logout$/, (req, res) => json(res, 200, { ok: true }, CLEAR_COOKIE));

/* participant billing details (funding lane, NDIS number, plan manager) */
route('POST', /^\/api\/me\/billing$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'participant') return json(res, 403, { error: 'Only participants have billing details.' });
  const plan = ['self', 'plan', 'ndia', 'none'].includes(body.plan) ? body.plan : '';
  const nd = clean(body.ndis_number, 12).replace(/\s+/g, '');
  if (nd && !/^\d{9}$/.test(nd)) return json(res, 400, { error: 'An NDIS number is 9 digits (e.g. 430123456).' });
  const pm = clean(body.pm_email, 120).toLowerCase();
  if (pm && !EMAIL_RE.test(pm)) return json(res, 400, { error: 'That plan manager email doesn\'t look right.' });
  db.prepare('UPDATE users SET plan = ?, ndis_number = ?, pm_email = ? WHERE id = ?').run(plan || user.plan, nd, pm, user.id);
  const me = sessionUser(user.id);
  json(res, 200, { user: me });
});

/* ---------- email flows: forgot / reset / verify ---------- */
route('POST', /^\/api\/forgot$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'forgot', 8)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  const email = clean(body.email, 120).toLowerCase();
  const row = EMAIL_RE.test(email) ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  if (row) {
    const token = makeEmailToken('r', row.id, 45 * 60e3, String(row.pass).slice(0, 16));
    const url2 = `${baseUrl(req)}/#/reset?token=${token}`;
    sendMail(row.email, 'Reset your BookIt password',
      `Hi ${firstName(row.name)},`,
      `<p>Someone (hopefully you) asked to reset the password on your BookIt account. Press the button to choose a new one — the link works for 45 minutes.</p><p>If this wasn't you, ignore this email and nothing changes.</p>`,
      'Choose a new password', url2).catch(() => {});
  }
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/reset$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'reset', 10)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  const password = String(body.password || '');
  if (password.length < 8) return json(res, 400, { error: 'Password needs at least 8 characters.' });
  const u = readEmailToken('r', body.token, x => String(x.pass).slice(0, 16));
  if (!u) return json(res, 400, { error: 'That reset link is invalid or has expired — request a fresh one from the log in screen.' });
  /* clicking an emailed link also proves the address works */
  db.prepare('UPDATE users SET pass = ?, verified = 1 WHERE id = ?').run(hashPassword(password), u.id);
  const me = sessionUser(u.id);
  json(res, 200, { user: me }, setSessionHeaders(u.id));
});

route('POST', /^\/api\/resend-verification$/, (req, res, m, user, body, ip) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (limited(ip, 'resend', 6)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  if (user.verified) return json(res, 200, { ok: true, already: true });
  sendVerifyEmail(req, user).catch(() => {});
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/email-test$/, async (req, res, m, user, body, ip) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (limited(ip, 'emailtest', 6)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  if (!EMAIL_ON) return json(res, 200, { ok: false, error: 'Email is not configured yet — set SMTP_USER and SMTP_PASS.' });
  if (user.email.endsWith('@demo.bookit.life')) return json(res, 400, { error: 'Demo accounts never receive email — log in with a real account to test.' });
  try {
    await sendMail(user.email, 'BookIt email test',
      `It works, ${firstName(user.name)}!`,
      `<p>This test email was sent by your BookIt server through <b>${RESEND_KEY ? 'the Resend API' : escHtml(SMTP_HOST)}</b>. Welcome emails, password resets and booking updates are all go.</p>`,
      'Open BookIt', baseUrl(req));
    json(res, 200, { ok: true, sent_to: user.email, via: RESEND_KEY ? 'resend-api' : `${SMTP_HOST}:${SMTP_PORT}` });
  } catch (e) {
    json(res, 502, { ok: false, error: e.message });
  }
});

/* ---------- admin: dashboard + worker vetting ---------- */
route('GET', /^\/api\/admin\/overview$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const counts = {
    participants: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'participant'").get().n,
    workers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'worker'").get().n,
    pending: db.prepare('SELECT COUNT(*) AS n FROM worker_profiles WHERE visible = 0').get().n,
    bookings: db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,
    messages: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
    contacts: db.prepare('SELECT COUNT(*) AS n FROM contact_messages').get().n,
    completed: db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'completed'").get().n,
    billed: Math.round(db.prepare("SELECT COALESCE(SUM(total), 0) AS s FROM bookings WHERE status = 'completed'").get().s * 100) / 100,
    open_incidents: db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE status != 'closed'").get().n,
    urgent_incidents: db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE reportable = 1 AND commission_notified_at IS NULL AND status != 'closed'").get().n,
    open_complaints: db.prepare("SELECT COUNT(*) AS n FROM complaints WHERE status != 'resolved'").get().n
  };
  const pending = db.prepare(`SELECT p.user_id, p.bio, p.services, p.photo, p.photo_at, u.name, u.email, u.suburb, u.phone, u.verified, u.created
    FROM worker_profiles p JOIN users u ON u.id = p.user_id WHERE p.visible = 0 ORDER BY u.created DESC`).all()
    .map(w => ({ ...w, photo: w.photo ? `/photos/${w.user_id}?v=${encodeURIComponent(w.photo_at || '')}` : null, services: JSON.parse(w.services || '[]') }));
  const users = db.prepare('SELECT u.id, u.role, u.name, u.email, u.suburb, u.verified, u.created, p.visible FROM users u LEFT JOIN worker_profiles p ON p.user_id = u.id ORDER BY u.id DESC LIMIT 100').all();
  const bookings = db.prepare(`SELECT b.id, b.service, b.date, b.start, b.hours, b.status, b.created,
    up.name AS participant_name, uw.name AS worker_name FROM bookings b
    JOIN users up ON up.id = b.participant_id JOIN users uw ON uw.id = b.worker_id ORDER BY b.id DESC LIMIT 50`).all();
  const contacts = db.prepare('SELECT id, name, email, topic, body, created FROM contact_messages ORDER BY id DESC LIMIT 50').all();
  json(res, 200, { counts, pending, users, bookings, contacts });
});

route('POST', /^\/api\/admin\/workers\/(\d+)\/approve$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const uid = Number(m[1]);
  const w = db.prepare("SELECT u.name, u.email FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(uid);
  if (!w) return json(res, 404, { error: 'No such worker.' });
  /* approval requirements: current NDIS Worker Screening + a profile photo — or an explicit override */
  if (!w.email.endsWith('@demo.bookit.life') && !body.override) {
    const missing = [];
    const state = screeningState(uid);
    if (state !== 'valid' && state !== 'expiring') {
      missing.push(state === 'none' ? 'a current NDIS Worker Screening Check (nothing on file)' : 'a current NDIS Worker Screening Check (the one on file has expired or has no expiry)');
    }
    const prof = db.prepare('SELECT photo FROM worker_profiles WHERE user_id = ?').get(uid);
    if (!prof || !prof.photo) missing.push('a profile photo');
    if (missing.length) {
      return json(res, 400, { needs_override: true, error: `Still needed before approval: ${missing.join(' and ')}. Ask the worker to add ${missing.length > 1 ? 'them' : 'it'} from their Bookings page — or tick "approve anyway" to override.` });
    }
  }
  db.prepare('UPDATE worker_profiles SET visible = 1 WHERE user_id = ?').run(uid);
  sendMail(w.email, 'Your BookIt profile is live', `Great news, ${firstName(w.name)} 🎉`,
    `<p>Your checks are in order and your profile has been approved — you're now visible in <b>Find Workers</b> across BookIt.</p><p>Participants can message you and request bookings from today. Keep your availability up to date, reply promptly, and welcome aboard!</p>`,
    'Open BookIt', `${baseUrl(req)}/#/find-workers`).catch(() => {});
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/admin\/workers\/(\d+)\/hide$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const uid = Number(m[1]);
  const w = db.prepare("SELECT u.id FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(uid);
  if (!w) return json(res, 404, { error: 'No such worker.' });
  db.prepare('UPDATE worker_profiles SET visible = 0 WHERE user_id = ?').run(uid);
  json(res, 200, { ok: true });
});

/* ---------- admin: invoicing ---------- */
function invoiceRows() {
  return db.prepare(`SELECT b.id, b.service, b.date, b.start, b.hours, b.rate_category, b.unit_price, b.worker_share, b.total, b.completed_at,
      up.name AS participant_name, up.email AS participant_email, uw.name AS worker_name
    FROM bookings b JOIN users up ON up.id = b.participant_id JOIN users uw ON uw.id = b.worker_id
    WHERE b.status = 'completed' ORDER BY b.date DESC, b.id DESC`).all();
}
route('GET', /^\/api\/admin\/invoices$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = invoiceRows();
  const sum = rows.reduce((a, r) => { a.total += r.total || 0; a.worker += r.worker_share || 0; return a; }, { total: 0, worker: 0 });
  json(res, 200, {
    invoices: rows,
    totals: { billed: Math.round(sum.total * 100) / 100, worker_share: Math.round(sum.worker * 100) / 100 },
    categories: Object.entries(INVOICE_RATES).map(([key, r]) => ({ key, label: r.label, price: r.price }))
  });
});
route('POST', /^\/api\/admin\/invoices\/(\d+)\/category$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const b = db.prepare("SELECT id FROM bookings WHERE id = ? AND status = 'completed'").get(Number(m[1]));
  if (!b) return json(res, 404, { error: 'No such completed shift.' });
  const inv = applyInvoice(b.id, clean(body.category, 30));
  if (!inv) return json(res, 400, { error: 'Unknown rate category.' });
  json(res, 200, { ok: true, invoice: inv });
});
route('GET', /^\/api\/admin\/invoices\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Shift ID', 'Date', 'Start', 'Hours', 'Service', 'Registration group', 'Participant', 'Participant email', 'Worker', 'Rate category', 'Unit price ($/h)', 'Total billed ($)', 'Worker share incl. super ($)', 'Completed at'].map(q).join(',')];
  for (const r of invoiceRows()) {
    lines.push([r.id, r.date, r.start, r.hours, SERVICE_LABELS[r.service] || r.service, REG_GROUPS[r.service] || '', r.participant_name, r.participant_email, r.worker_name,
      (INVOICE_RATES[r.rate_category] || {}).label || r.rate_category, (r.unit_price ?? 0).toFixed(2), (r.total ?? 0).toFixed(2), (r.worker_share ?? 0).toFixed(2), r.completed_at].map(q).join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="bookit-invoices-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end('﻿' + lines.join('\r\n'));
});

/* ---------- admin: claims & payments (the money engine) ---------- */
const dmy = iso => String(iso || '').split('-').reverse().join('/');
function claimRows(where) {
  return db.prepare(`SELECT b.id, b.service, b.date, b.start, b.hours, b.rate_category, b.unit_price, b.total,
      b.claim_status, b.claim_ref, b.invoice_no, b.support_item, b.claimed_at, b.paid_at,
      up.id AS pid, up.name AS participant_name, up.email AS participant_email, up.plan AS funding, up.ndis_number, up.pm_email,
      uw.name AS worker_name
    FROM bookings b JOIN users up ON up.id = b.participant_id JOIN users uw ON uw.id = b.worker_id
    WHERE b.status = 'completed' ${where || ''} ORDER BY b.date ASC, b.id ASC`).all();
}
function effectiveItem(r) { return r.support_item || supportItemFor(r.service, r.rate_category) || ''; }
function lineFlags(r) {
  const flags = [];
  if (!['ndia', 'plan', 'self'].includes(r.funding)) flags.push('no funding type on the participant profile');
  if (r.funding === 'ndia' && !/^\d{9}$/.test(r.ndis_number || '')) flags.push('NDIS number missing');
  if (r.funding === 'plan' && !r.pm_email) flags.push('plan manager email missing');
  if (!effectiveItem(r)) flags.push('support item number needed');
  else if (ITEM_CONFIRM[r.service] && !r.support_item) flags.push('confirm the prefilled support item');
  return flags;
}

route('GET', /^\/api\/admin\/claims$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = claimRows().map(r => ({ ...r, item: effectiveItem(r), flags: r.claim_status ? [] : lineFlags(r) }));
  const unclaimed = rows.filter(r => !r.claim_status);
  const claimed = rows.filter(r => r.claim_status === 'claimed');
  const paid = rows.filter(r => r.claim_status === 'paid');
  const sum = a => Math.round(a.reduce((n, r) => n + (r.total || 0), 0) * 100) / 100;
  json(res, 200, {
    unclaimed, claimed, paid,
    totals: { unclaimed: sum(unclaimed), claimed: sum(claimed), paid: sum(paid) },
    reg_no: NDIS_REG_NO
  });
});

route('POST', /^\/api\/admin\/claims\/(\d+)\/item$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const item = clean(body.support_item, 20);
  if (item && !/^\d{2}_\d{3}_\d{4}_\d_\d$/.test(item)) return json(res, 400, { error: 'Support item numbers look like 01_011_0107_1_1.' });
  const r = db.prepare("SELECT id FROM bookings WHERE id = ? AND status = 'completed'").get(Number(m[1]));
  if (!r) return json(res, 404, { error: 'No such completed shift.' });
  db.prepare('UPDATE bookings SET support_item = ? WHERE id = ?').run(item, r.id);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/admin\/claims\/run$/, async (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = claimRows("AND (b.claim_status IS NULL OR b.claim_status = '')");
  const needs = [], ndiaClaimed = [], invoiceGroups = new Map();
  for (const r of rows) {
    const flags = lineFlags(r).filter(f => !f.startsWith('confirm'));
    if (flags.length) { needs.push({ id: r.id, date: r.date, participant: r.participant_name, flags }); continue; }
    const item = effectiveItem(r);
    if (r.funding === 'ndia') {
      db.prepare("UPDATE bookings SET claim_status = 'claimed', claim_ref = ?, support_item = ?, claimed_at = ? WHERE id = ?")
        .run(`BK${r.id}`, item, now(), r.id);
      ndiaClaimed.push(r.id);
    } else {
      const key = `${r.pid}:${r.funding}`;
      if (!invoiceGroups.has(key)) invoiceGroups.set(key, []);
      invoiceGroups.get(key).push({ ...r, item });
    }
  }
  const invoices = [];
  for (const group of invoiceGroups.values()) {
    const first = group[0];
    let invNo = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${first.pid}`;
    let n = 1;
    while (db.prepare('SELECT 1 FROM bookings WHERE invoice_no = ?').get(n === 1 ? invNo : `${invNo}-${n}`)) n++;
    if (n > 1) invNo = `${invNo}-${n}`;
    const total = Math.round(group.reduce((s, r) => s + (r.total || 0), 0) * 100) / 100;
    for (const r of group) {
      db.prepare("UPDATE bookings SET claim_status = 'claimed', claim_ref = ?, support_item = ?, invoice_no = ?, claimed_at = ? WHERE id = ?")
        .run(`BK${r.id}`, r.item, invNo, now(), r.id);
    }
    const self = first.funding === 'self';
    const dest = self ? first.participant_email : first.pm_email;
    const pdf = makeInvoicePdf({
      invoice_no: invNo,
      date: dmy(new Date().toISOString().slice(0, 10)),
      self,
      bill_to: self
        ? [first.participant_name, first.participant_email, first.ndis_number ? `NDIS number: ${first.ndis_number}` : '']
        : [`Plan manager for ${first.participant_name}`, dest, first.ndis_number ? `NDIS number: ${first.ndis_number}` : ''],
      lines: group.map(r => ({
        date: dmy(r.date),
        service: (SERVICE_LABELS[r.service] || r.service) + (r.rate_category === 'sleepover' ? ' — sleepover (per night)' : ''),
        item: r.item,
        hours: (INVOICE_RATES[r.rate_category] || {}).perNight ? 1 : r.hours,
        rate: r.unit_price || 0, amount: r.total || 0
      })),
      total
    });
    let emailed = false;
    try {
      await sendMail(dest, `Invoice ${invNo} — BookIt supports for ${first.participant_name}`,
        `Invoice ${invNo}`,
        `<p>Please find attached invoice <b>${invNo}</b> for NDIS supports delivered to <b>${escHtml(first.participant_name)}</b> — total <b>$${total.toFixed(2)}</b> (GST-free). Payment within 14 days, thank you.</p><p>Prices align with the NDIS Pricing Arrangements and Price Limits 2026–27. Questions? Just reply to this email.</p>`,
        null, null, MAIL_FROM, [{ filename: `${invNo}.pdf`, mime: 'application/pdf', buffer: pdf }]);
      emailed = EMAIL_ON;
    } catch (e) { console.error(`[claims] invoice email failed for ${invNo}: ${e.message}`); }
    invoices.push({ invoice_no: invNo, to: dest, funding: first.funding, lines: group.length, total, emailed });
  }
  json(res, 200, { ok: true, ndia_claimed: ndiaClaimed.length, invoices, needs_attention: needs });
});

route('GET', /^\/api\/admin\/claims\/pace\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = claimRows("AND up.plan = 'ndia' AND b.claim_status = 'claimed'");
  const header = ['RegistrationNumber', 'NDISNumber', 'SupportsDeliveredFrom', 'SupportsDeliveredTo', 'SupportNumber', 'ClaimReference', 'Quantity', 'Hours', 'UnitPrice', 'GSTCode', 'ClaimType', 'CancellationReason', 'ABN', 'InKindFundingProgram', 'ClaimReason', 'RequestedAmount'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const qty = (INVOICE_RATES[r.rate_category] || {}).perNight ? 1 : r.hours; /* sleepovers claim 1 Each */
    lines.push([q(NDIS_REG_NO), q(r.ndis_number), q(dmy(r.date)), q(dmy(r.date)), q(effectiveItem(r)), q(r.claim_ref || `BK${r.id}`),
      qty, '', (r.unit_price || 0).toFixed(2), 'P2', '', '', q(COMPANY_ABN), '', '', (r.total || 0).toFixed(2)].join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="bookit-pace-claims-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end(lines.join('\r\n'));
});

route('POST', /^\/api\/admin\/claims\/(\d+)\/paid$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const r = db.prepare("SELECT id, claim_status FROM bookings WHERE id = ? AND status = 'completed'").get(Number(m[1]));
  if (!r || !r.claim_status) return json(res, 404, { error: 'No such claimed shift.' });
  if (body.paid === false) db.prepare("UPDATE bookings SET claim_status = 'claimed', paid_at = NULL WHERE id = ?").run(r.id);
  else db.prepare("UPDATE bookings SET claim_status = 'paid', paid_at = ? WHERE id = ?").run(now(), r.id);
  json(res, 200, { ok: true });
});

/* ---------- compliance: worker credentials ---------- */
const DOCS_DIR = process.env.DOCS_DIR || path.join(path.dirname(path.resolve(DB_PATH)), 'bookit-docs');
try { fs.mkdirSync(DOCS_DIR, { recursive: true }); } catch {}
const PHOTOS_DIR = process.env.PHOTOS_DIR || path.join(path.dirname(path.resolve(DB_PATH)), 'bookit-photos');
try { fs.mkdirSync(PHOTOS_DIR, { recursive: true }); } catch {}
const DOC_TYPES = { 'ndis-screening': 'NDIS Worker Screening Check', 'wwcc': 'Working with Children Check', 'first-aid': 'First Aid / CPR', 'other': 'Other credential' };
const DOC_MIMES = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

function docStatus(d) {
  if (!d.expiry_date) return 'no-expiry';
  const today = new Date().toISOString().slice(0, 10);
  if (d.expiry_date < today) return 'expired';
  const days = Math.round((new Date(d.expiry_date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 864e5);
  return days <= 30 ? 'expiring' : 'valid';
}
function docDays(d) {
  if (!d.expiry_date) return null;
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((new Date(d.expiry_date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 864e5);
}
function screeningState(workerId) {
  const docs = db.prepare("SELECT * FROM worker_docs WHERE worker_id = ? AND doc_type = 'ndis-screening'").all(workerId);
  if (!docs.length) return 'none';
  const st = docs.map(docStatus);
  if (st.includes('valid')) return 'valid';
  if (st.includes('expiring')) return 'expiring';
  if (st.includes('no-expiry')) return 'no-expiry';
  return 'expired';
}
function docOut(d) { return { ...d, file_path: undefined, status: docStatus(d), days: docDays(d), type_label: DOC_TYPES[d.doc_type] || d.doc_type, has_file: Boolean(d.file_path) }; }

route('GET', /^\/api\/me\/documents$/, (req, res, m, user) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  json(res, 200, { documents: db.prepare('SELECT * FROM worker_docs WHERE worker_id = ? ORDER BY doc_type, id DESC').all(user.id).map(docOut) });
});

route('POST', /^\/api\/me\/documents$/, (req, res, m, user, body, ip) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  if (limited(ip, 'docs', 30)) return json(res, 429, { error: 'Too many uploads — try again later.' });
  const docType = DOC_TYPES[body.doc_type] ? body.doc_type : null;
  if (!docType) return json(res, 400, { error: 'Pick a credential type.' });
  const expiry = clean(body.expiry_date, 10);
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return json(res, 400, { error: 'Expiry date looks wrong.' });
  if (docType !== 'other' && !expiry) return json(res, 400, { error: 'Please enter the expiry date — it drives the automatic checks.' });
  let fileName = '', fileMime = '', filePath = '';
  if (body.file && body.file.data) {
    fileMime = String(body.file.mime || '');
    if (!DOC_MIMES[fileMime]) return json(res, 400, { error: 'Files must be PDF, JPG or PNG.' });
    let buf;
    try { buf = Buffer.from(String(body.file.data).replace(/^data:[^,]*,/, ''), 'base64'); } catch { return json(res, 400, { error: 'Could not read that file.' }); }
    if (!buf.length || buf.length > 4 * 1024 * 1024) return json(res, 400, { error: 'Files can be up to 4 MB.' });
    fileName = clean(body.file.name, 80).replace(/[^A-Za-z0-9. _-]/g, '') || ('document' + DOC_MIMES[fileMime]);
    filePath = path.join(DOCS_DIR, `w${user.id}-${Date.now()}${DOC_MIMES[fileMime]}`);
    fs.writeFileSync(filePath, buf);
  }
  const r = db.prepare('INSERT INTO worker_docs (worker_id, doc_type, label, check_number, expiry_date, file_name, file_mime, file_path, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(user.id, docType, clean(body.label, 80), clean(body.check_number, 40), expiry, fileName, fileMime, filePath, now());
  if (MAIL_FROM) sendMail(MAIL_FROM, 'Credential uploaded — BookIt', 'A worker updated their credentials',
    `<p><b>${escHtml(user.name)}</b> added a <b>${DOC_TYPES[docType]}</b>${expiry ? ` (expires ${escHtml(expiry)})` : ''}${clean(body.check_number, 40) ? ` — number ${escHtml(clean(body.check_number, 40))}` : ''}.</p><p>Verify it against the NDIS Worker Screening Database, then press Verify in the Credentials section.</p>`,
    'Open credentials', `${baseUrl(req)}/#/admin`).catch(() => {});
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

/* profile photo — a requirement before a worker can be approved */
const PHOTO_MIMES = { 'image/jpeg': '.jpg', 'image/png': '.png' };
function photoUrl(row) { return row && row.photo ? `/photos/${row.user_id ?? row.id}?v=${encodeURIComponent(row.photo_at || '')}` : null; }

route('POST', /^\/api\/me\/photo$/, (req, res, m, user, body, ip) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  if (limited(ip, 'photo', 20)) return json(res, 429, { error: 'Too many uploads — try again later.' });
  if (!body.file || !body.file.data) return json(res, 400, { error: 'Choose a photo first.' });
  const mime = String(body.file.mime || '');
  if (!PHOTO_MIMES[mime]) return json(res, 400, { error: 'Photos must be JPG or PNG.' });
  let buf;
  try { buf = Buffer.from(String(body.file.data).replace(/^data:[^,]*,/, ''), 'base64'); } catch { return json(res, 400, { error: 'Could not read that photo.' }); }
  if (!buf.length || buf.length > 3 * 1024 * 1024) return json(res, 400, { error: 'Photos can be up to 3 MB.' });
  const prev = db.prepare('SELECT photo FROM worker_profiles WHERE user_id = ?').get(user.id);
  const fp = path.join(PHOTOS_DIR, `w${user.id}-${Date.now()}${PHOTO_MIMES[mime]}`);
  fs.writeFileSync(fp, buf);
  db.prepare('UPDATE worker_profiles SET photo = ?, photo_at = ? WHERE user_id = ?').run(fp, now(), user.id);
  if (prev && prev.photo) { try { fs.unlinkSync(prev.photo); } catch {} }
  json(res, 200, { ok: true, photo: `/photos/${user.id}?v=${Date.now()}` });
});

route('GET', /^\/api\/me\/profile$/, (req, res, m, user) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  const p = db.prepare('SELECT bio, services, visible, photo, photo_at FROM worker_profiles WHERE user_id = ?').get(user.id) || {};
  json(res, 200, { profile: { bio: p.bio || '', services: JSON.parse(p.services || '[]'), visible: p.visible, photo: p.photo ? `/photos/${user.id}?v=${encodeURIComponent(p.photo_at || '')}` : null } });
});

route('POST', /^\/api\/me\/profile$/, (req, res, m, user, body) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  db.prepare('UPDATE worker_profiles SET bio = ? WHERE user_id = ?').run(clean(body.bio, 600), user.id);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/me\/documents\/(\d+)\/delete$/, (req, res, m, user) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  const d = db.prepare('SELECT * FROM worker_docs WHERE id = ? AND worker_id = ?').get(Number(m[1]), user.id);
  if (!d) return json(res, 404, { error: 'No such document.' });
  if (d.verified_at) return json(res, 400, { error: 'That one\'s been verified — ask the BookIt team to update it.' });
  if (d.file_path) { try { fs.unlinkSync(d.file_path); } catch {} }
  db.prepare('DELETE FROM worker_docs WHERE id = ?').run(d.id);
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/documents\/(\d+)\/file$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const d = db.prepare('SELECT * FROM worker_docs WHERE id = ?').get(Number(m[1]));
  if (!d || !d.file_path) return json(res, 404, { error: 'No file.' });
  if (!(user.admin || user.id === d.worker_id)) return json(res, 403, { error: 'Not yours.' });
  if (!fs.existsSync(d.file_path)) return json(res, 404, { error: 'File missing from disk.' });
  res.writeHead(200, { 'Content-Type': d.file_mime || 'application/octet-stream', 'Content-Disposition': `inline; filename="${d.file_name || 'document'}"` });
  fs.createReadStream(d.file_path).pipe(res);
});

route('GET', /^\/api\/admin\/credentials$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const workers = db.prepare(`SELECT u.id, u.name, u.email, u.verified, p.visible, p.photo, p.photo_at FROM users u
    JOIN worker_profiles p ON p.user_id = u.id WHERE u.role = 'worker' ORDER BY u.name`).all()
    .map(w => ({
      ...w,
      photo: w.photo ? `/photos/${w.id}?v=${encodeURIComponent(w.photo_at || '')}` : null,
      demo: w.email.endsWith('@demo.bookit.life'),
      screening: screeningState(w.id),
      documents: db.prepare('SELECT * FROM worker_docs WHERE worker_id = ? ORDER BY doc_type, id DESC').all(w.id).map(docOut)
    }));
  json(res, 200, { workers });
});

route('POST', /^\/api\/admin\/documents\/(\d+)\/verify$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const d = db.prepare('SELECT id FROM worker_docs WHERE id = ?').get(Number(m[1]));
  if (!d) return json(res, 404, { error: 'No such document.' });
  db.prepare('UPDATE worker_docs SET verified_at = ?, verified_by = ? WHERE id = ?').run(now(), user.name, d.id);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/admin\/documents\/(\d+)\/delete$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const d = db.prepare('SELECT * FROM worker_docs WHERE id = ?').get(Number(m[1]));
  if (!d) return json(res, 404, { error: 'No such document.' });
  if (d.file_path) { try { fs.unlinkSync(d.file_path); } catch {} }
  db.prepare('DELETE FROM worker_docs WHERE id = ?').run(d.id);
  json(res, 200, { ok: true });
});

/* the automatic checker: warns ahead of expiry and hides workers whose
   screening has lapsed. Runs on boot, twice a day, and on demand. */
function credentialSweep(req) {
  const actions = [];
  const base = req ? baseUrl(req) : APP_URL || 'https://bookit.life';
  const workers = db.prepare(`SELECT u.id, u.name, u.email, p.visible FROM users u
    JOIN worker_profiles p ON p.user_id = u.id WHERE u.role = 'worker'`).all();
  for (const w of workers) {
    if (w.email.endsWith('@demo.bookit.life')) continue;
    const docs = db.prepare('SELECT * FROM worker_docs WHERE worker_id = ?').all(w.id);
    for (const d of docs) {
      const st = docStatus(d), days = docDays(d);
      let stage = '';
      if (st === 'expired') stage = 'expired';
      else if (st === 'expiring' && days <= 7) stage = '7';
      else if (st === 'expiring') stage = '30';
      if (stage && d.warned_stage !== stage) {
        db.prepare('UPDATE worker_docs SET warned_stage = ? WHERE id = ?').run(stage, d.id);
        const what = `${DOC_TYPES[d.doc_type] || d.doc_type}${d.check_number ? ` (${d.check_number})` : ''}`;
        const when = st === 'expired' ? 'has EXPIRED' : `expires in ${days} day${days === 1 ? '' : 's'} (${d.expiry_date})`;
        sendMail(w.email, `Your ${DOC_TYPES[d.doc_type] || 'credential'} ${st === 'expired' ? 'has expired' : 'is expiring'} — BookIt`,
          `Heads up, ${firstName(w.name)}`,
          `<p>Your <b>${escHtml(what)}</b> ${escHtml(when)}.</p><p>${st === 'expired' ? 'You can\'t deliver supports until a current check is on file — please renew it and upload the new details today.' : 'Renewals can be lodged up to 90 days early — please update your credentials in BookIt as soon as you have the new document.'}</p>`,
          'Update my credentials', `${base}/#/bookings`).catch(() => {});
        if (MAIL_FROM) sendMail(MAIL_FROM, `Credential ${st === 'expired' ? 'EXPIRED' : 'expiring'}: ${w.name} — BookIt`,
          `${w.name} — ${DOC_TYPES[d.doc_type] || d.doc_type}`,
          `<p><b>${escHtml(w.name)}</b>'s <b>${escHtml(what)}</b> ${escHtml(when)}.</p>`,
          'Open credentials', `${base}/#/admin`).catch(() => {});
        actions.push({ worker: w.name, doc: d.doc_type, stage });
      }
    }
    /* auto-hide: a screening doc exists but none is current */
    if (w.visible && screeningState(w.id) === 'expired') {
      db.prepare('UPDATE worker_profiles SET visible = 0 WHERE user_id = ?').run(w.id);
      actions.push({ worker: w.name, hidden: true });
      sendMail(w.email, 'Your BookIt profile is paused — BookIt', `Your profile is paused, ${firstName(w.name)}`,
        '<p>Your NDIS Worker Screening Check has expired, so your profile has been automatically hidden and new bookings are paused — this is a legal requirement, not a judgement! Upload your renewed check and we\'ll switch you back on straight away.</p>',
        'Update my credentials', `${base}/#/bookings`).catch(() => {});
      if (MAIL_FROM) sendMail(MAIL_FROM, `Worker auto-hidden (screening expired): ${w.name} — BookIt`,
        'Worker automatically hidden',
        `<p><b>${escHtml(w.name)}</b> was hidden from Find Workers because their NDIS Worker Screening Check has expired. They've been asked to renew; re-approve them once the new check is verified.</p>`,
        'Open credentials', `${base}/#/admin`).catch(() => {});
    }
  }
  return actions;
}
route('POST', /^\/api\/admin\/credentials\/sweep$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, { ok: true, actions: credentialSweep(req) });
});
setTimeout(() => { try { credentialSweep(); } catch (e) { console.error('sweep:', e.message); } }, 30_000);
setInterval(() => { try { credentialSweep(); } catch (e) { console.error('sweep:', e.message); } }, 12 * 3600e3);

/* ---------- compliance: incident register ---------- */
const REPORTABLE_24H = ['death', 'serious-injury', 'abuse-neglect', 'unlawful-contact', 'sexual-misconduct'];
const INCIDENT_CATS = {
  'death': 'Death of a person with disability', 'serious-injury': 'Serious injury', 'abuse-neglect': 'Abuse or neglect',
  'unlawful-contact': 'Unlawful sexual or physical contact', 'sexual-misconduct': 'Sexual misconduct or grooming',
  'restrictive-practice': 'Unauthorised restrictive practice', 'near-miss': 'Near miss', 'other': 'Other incident'
};
function addBusinessDays(fromIso, n) {
  const d = new Date(fromIso);
  let added = 0;
  while (added < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) added++; }
  return d.toISOString();
}
function incidentOut(i) {
  let hoursLeft = null;
  if (i.notify_due && !i.commission_notified_at) hoursLeft = Math.round((new Date(i.notify_due) - Date.now()) / 36e5);
  return { ...i, category_label: INCIDENT_CATS[i.category] || i.category, hours_left: hoursLeft };
}

route('POST', /^\/api\/incidents$/, (req, res, m, user, body, ip) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (limited(ip, 'incidents', 30)) return json(res, 429, { error: 'Slow down a moment.' });
  const category = INCIDENT_CATS[body.category] ? body.category : 'other';
  const description = clean(body.description, 4000);
  if (!description) return json(res, 400, { error: 'Describe what happened.' });
  const reportable = REPORTABLE_24H.includes(category) || category === 'restrictive-practice' ? 1 : 0;
  const created = now();
  const due = REPORTABLE_24H.includes(category) ? new Date(Date.now() + 24 * 3600e3).toISOString()
    : category === 'restrictive-practice' ? addBusinessDays(created, 5) : null;
  const r = db.prepare(`INSERT INTO incidents (created_by, created_by_name, participant_name, worker_name, occurred_at, location, category, reportable, description, immediate_action, notify_due, created)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(user.id, user.name, clean(body.participant_name, 80), clean(body.worker_name, 80),
      clean(body.occurred_at, 25) || created, clean(body.location, 120), category, reportable,
      description, clean(body.immediate_action, 2000), due, created);
  if (reportable && MAIL_FROM) sendMail(MAIL_FROM, `⚠ REPORTABLE INCIDENT logged — BookIt`,
    'Reportable incident — the clock is running',
    `<p><b>${escHtml(INCIDENT_CATS[category])}</b> logged by ${escHtml(user.name)}.</p><p><b>Notify the NDIS Commission ${REPORTABLE_24H.includes(category) ? 'within 24 HOURS' : 'within 5 business days'}</b> via the Commission portal, then record it in the incident register. Full written report within 14 days.</p><p>${escHtml(description.slice(0, 300))}</p>`,
    'Open the incident register', `${baseUrl(req)}/#/admin`).catch(() => {});
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid), reportable, notify_due: due });
});

route('GET', /^\/api\/admin\/incidents$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, { incidents: db.prepare('SELECT * FROM incidents ORDER BY id DESC LIMIT 500').all().map(incidentOut), categories: INCIDENT_CATS });
});

route('POST', /^\/api\/admin\/incidents\/(\d+)$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const i = db.prepare('SELECT * FROM incidents WHERE id = ?').get(Number(m[1]));
  if (!i) return json(res, 404, { error: 'No such incident.' });
  if (body.action === 'notified') db.prepare('UPDATE incidents SET commission_notified_at = ?, status = ? WHERE id = ?').run(now(), 'investigating', i.id);
  else if (body.action === 'investigating') db.prepare('UPDATE incidents SET status = ? WHERE id = ?').run('investigating', i.id);
  else if (body.action === 'close') db.prepare('UPDATE incidents SET status = ?, closed_at = ?, lessons = ? WHERE id = ?').run('closed', now(), clean(body.lessons, 2000), i.id);
  else return json(res, 400, { error: 'Unknown action.' });
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/admin\/incidents\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['ID', 'Created', 'Occurred', 'Category', 'Reportable', 'Participant', 'Worker', 'Location', 'Description', 'Immediate action', 'Notify due', 'Commission notified', 'Status', 'Lessons', 'Closed'].map(q).join(',')];
  for (const i of db.prepare('SELECT * FROM incidents ORDER BY id').all()) {
    lines.push([i.id, i.created, i.occurred_at, INCIDENT_CATS[i.category] || i.category, i.reportable ? 'YES' : 'no', i.participant_name, i.worker_name, i.location, i.description, i.immediate_action, i.notify_due || '', i.commission_notified_at || '', i.status, i.lessons, i.closed_at || ''].map(q).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookit-incident-register.csv"' });
  res.end('﻿' + lines.join('\r\n'));
});

/* ---------- compliance: complaints register ---------- */
route('POST', /^\/api\/admin\/complaints$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const summary = clean(body.summary, 200);
  if (!summary) return json(res, 400, { error: 'Give the complaint a one-line summary.' });
  const r = db.prepare('INSERT INTO complaints (source_name, source_email, channel, summary, details, created) VALUES (?,?,?,?,?,?)')
    .run(clean(body.source_name, 80), clean(body.source_email, 120), ['site', 'email', 'phone', 'in-person', 'other'].includes(body.channel) ? body.channel : 'other', summary, clean(body.details, 4000), now());
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

route('GET', /^\/api\/admin\/complaints$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, { complaints: db.prepare('SELECT * FROM complaints ORDER BY id DESC LIMIT 500').all() });
});

route('POST', /^\/api\/admin\/complaints\/(\d+)$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const c = db.prepare('SELECT * FROM complaints WHERE id = ?').get(Number(m[1]));
  if (!c) return json(res, 404, { error: 'No such complaint.' });
  if (body.action === 'acknowledge') db.prepare('UPDATE complaints SET acknowledged_at = ?, status = ? WHERE id = ?').run(now(), 'resolving', c.id);
  else if (body.action === 'resolve') db.prepare('UPDATE complaints SET resolved_at = ?, status = ?, outcome = ? WHERE id = ?').run(now(), 'resolved', clean(body.outcome, 2000), c.id);
  else if (body.action === 'reopen') db.prepare('UPDATE complaints SET status = ?, resolved_at = NULL WHERE id = ?').run('open', c.id);
  else return json(res, 400, { error: 'Unknown action.' });
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/admin\/complaints\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['ID', 'Received', 'From', 'Email', 'Channel', 'Summary', 'Details', 'Acknowledged', 'Resolved', 'Outcome', 'Status'].map(q).join(',')];
  for (const c of db.prepare('SELECT * FROM complaints ORDER BY id').all()) {
    lines.push([c.id, c.created, c.source_name, c.source_email, c.channel, c.summary, c.details, c.acknowledged_at || '', c.resolved_at || '', c.outcome, c.status].map(q).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookit-complaints-register.csv"' });
  res.end('﻿' + lines.join('\r\n'));
});

route('GET', /^\/api\/admin\/payroll\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.prepare(`SELECT b.date, b.start, b.hours, b.service, b.rate_category, b.worker_share, b.claim_status,
      uw.name AS worker_name, uw.email AS worker_email
    FROM bookings b JOIN users uw ON uw.id = b.worker_id
    WHERE b.status = 'completed' ORDER BY uw.name, b.date`).all();
  const lines = [['Worker', 'Worker email', 'Date', 'Start', 'Hours', 'Service', 'Rate category', 'Worker share incl. super ($)', 'Claim status'].map(q).join(',')];
  for (const r of rows) {
    lines.push([q(r.worker_name), q(r.worker_email), q(r.date), q(r.start), r.hours, q(SERVICE_LABELS[r.service] || r.service),
      q((INVOICE_RATES[r.rate_category] || {}).label || r.rate_category), (r.worker_share || 0).toFixed(2), q(r.claim_status || 'unclaimed')].join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="bookit-payroll-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end('﻿' + lines.join('\r\n'));
});

route('GET', /^\/api\/workers$/, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.name, u.suburb FROM worker_profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.visible = 1 ORDER BY p.shifts DESC`).all();
  json(res, 200, { workers: rows.map(publicWorker) });
});

route('GET', /^\/api\/rates$/, (req, res) => json(res, 200, { rates: RATES }));

route('GET', /^\/api\/conversations$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const rows = db.prepare(`
    SELECT c.* FROM conversations c
    LEFT JOIN messages msg ON msg.convo_id = c.id
    WHERE c.participant_id = ? OR c.worker_id = ?
    GROUP BY c.id ORDER BY MAX(COALESCE(msg.id, 0)) DESC`).all(user.id, user.id);
  json(res, 200, { conversations: rows.map(r => convoForUser(user, r)) });
});

route('POST', /^\/api\/conversations$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  let participantId, workerId;
  if (user.role === 'participant') {
    workerId = Number(body.worker_id);
    participantId = user.id;
    const w = db.prepare("SELECT u.id, p.visible FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(workerId);
    if (!w) return json(res, 404, { error: 'Worker not found.' });
    if (!w.visible) return json(res, 400, { error: 'That worker isn\'t taking messages yet.' });
  } else {
    participantId = Number(body.participant_id);
    workerId = user.id;
    const p = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'participant'").get(participantId);
    if (!p) return json(res, 404, { error: 'Participant not found.' });
  }
  let convo = db.prepare('SELECT * FROM conversations WHERE participant_id = ? AND worker_id = ?').get(participantId, workerId);
  if (!convo) {
    const r = db.prepare('INSERT INTO conversations (participant_id, worker_id, created) VALUES (?,?,?)').run(participantId, workerId, now());
    convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(r.lastInsertRowid));
  }
  json(res, 200, { conversation: convoForUser(user, convo) });
});

route('GET', /^\/api\/conversations\/(\d+)\/messages$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const convo = memberOf(user, Number(m[1]));
  if (!convo) return json(res, 404, { error: 'Conversation not found.' });
  db.prepare('UPDATE messages SET read_at = ? WHERE convo_id = ? AND sender_id != ? AND read_at IS NULL').run(now(), convo.id, user.id);
  const msgs = db.prepare('SELECT id, sender_id, body, created FROM messages WHERE convo_id = ? ORDER BY id ASC LIMIT 500').all(convo.id);
  json(res, 200, { messages: msgs.map(x => ({ id: x.id, mine: x.sender_id === user.id, body: x.body, created: x.created })) });
});

route('POST', /^\/api\/conversations\/(\d+)\/messages$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const convo = memberOf(user, Number(m[1]));
  if (!convo) return json(res, 404, { error: 'Conversation not found.' });
  const text = clean(body.body, 2000);
  if (!text) return json(res, 400, { error: 'Message can\'t be empty.' });
  const r = db.prepare('INSERT INTO messages (convo_id, sender_id, body, created) VALUES (?,?,?,?)').run(convo.id, user.id, text, now());
  /* demo auto-acknowledgement from seeded workers, once per conversation */
  if (AUTO_REPLY && user.role === 'participant') {
    const worker = db.prepare('SELECT u.id, u.name, u.email FROM users u WHERE u.id = ?').get(convo.worker_id);
    const priorFromWorker = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE convo_id = ? AND sender_id = ?').get(convo.id, convo.worker_id).n;
    if (worker && worker.email.endsWith('@demo.bookit.life') && priorFromWorker === 0) {
      setTimeout(() => {
        try {
          db.prepare('INSERT INTO messages (convo_id, sender_id, body, created) VALUES (?,?,?,?)')
            .run(convo.id, worker.id, `Thanks for your message! This is an automatic acknowledgement so you know it arrived — ${worker.name.split(' ')[0]} will reply here as soon as they can. (Demo auto-reply)`, now());
        } catch {}
      }, 4000);
    }
  }
  json(res, 200, { id: Number(r.lastInsertRowid), ok: true });
});

route('GET', /^\/api\/bookings$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const col = user.role === 'participant' ? 'participant_id' : 'worker_id';
  const otherCol = user.role === 'participant' ? 'worker_id' : 'participant_id';
  const rows = db.prepare(`SELECT b.*, u.name AS other_name,
      COALESCE(p.color, '#0E6B62') AS other_color
    FROM bookings b
    JOIN users u ON u.id = b.${otherCol}
    LEFT JOIN worker_profiles p ON p.user_id = u.id
    WHERE b.${col} = ? ORDER BY b.date DESC, b.id DESC LIMIT 200`).all(user.id);
  json(res, 200, { bookings: rows });
});

route('POST', /^\/api\/bookings$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'participant') return json(res, 403, { error: 'Only participants can request bookings.' });
  const workerId = Number(body.worker_id);
  const w = db.prepare("SELECT u.id, p.visible FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(workerId);
  if (!w) return json(res, 404, { error: 'Worker not found.' });
  if (!w.visible) return json(res, 400, { error: 'That worker isn\'t taking bookings yet.' });
  const service = clean(body.service, 30);
  if (!SERVICES.includes(service)) return json(res, 400, { error: 'Please choose a service.' });
  const date = clean(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Please choose a date.' });
  const start = clean(body.start, 5);
  if (!/^\d{2}:\d{2}$/.test(start)) return json(res, 400, { error: 'Please choose a start time.' });
  const hours = Number(body.hours);
  if (!(hours >= 2 && hours <= 10)) return json(res, 400, { error: 'Bookings are between 2 and 10 hours.' });
  const sleepover = body.sleepover && ['personal-care', 'daily-tasks'].includes(service) ? 1 : 0;
  const r = db.prepare('INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, notes, sleepover, created) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(user.id, workerId, service, date, start, hours, clean(body.notes, 600), sleepover, now());
  const wu = db.prepare('SELECT name, email FROM users WHERE id = ?').get(workerId);
  if (wu) sendMail(wu.email, 'New booking request — BookIt',
    `New booking request, ${firstName(wu.name)}!`,
    `<p><b>${escHtml(user.name)}</b> has requested <b>${SERVICE_LABELS[service] || service}</b> on <b>${prettyDate(date)}</b> starting <b>${escHtml(start)}</b> (${hours} hours).</p><p>Accept or decline from your bookings page — they'll see your answer straight away.</p>`,
    'View the request', `${baseUrl(req)}/#/bookings`).catch(() => {});
  json(res, 200, { id: Number(r.lastInsertRowid), ok: true });
});

route('PATCH', /^\/api\/bookings\/(\d+)$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(m[1]));
  if (!b) return json(res, 404, { error: 'Booking not found.' });
  const status = clean(body.status, 20);
  const workerActions = ['accepted', 'declined'];
  const participantActions = ['cancelled'];
  if (user.role === 'worker' && b.worker_id === user.id && workerActions.includes(status) && b.status === 'requested') {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, b.id);
    const pu = db.prepare('SELECT name, email FROM users WHERE id = ?').get(b.participant_id);
    if (pu) sendMail(pu.email, `Booking ${status} — BookIt`,
      status === 'accepted' ? 'Your booking is confirmed 🎉' : 'About your booking request',
      `<p><b>${escHtml(user.name)}</b> has <b>${status}</b> your booking for <b>${SERVICE_LABELS[b.service] || escHtml(b.service)}</b> on <b>${prettyDate(b.date)}</b> at <b>${escHtml(b.start)}</b>.</p>` +
      (status === 'accepted'
        ? `<p>You can message ${firstName(user.name)} any time to sort the details before the day.</p>`
        : '<p>No stress — every worker on Find Workers is ready to hear from you, and Meet &amp; Greets are always free.</p>'),
      'Open my bookings', `${baseUrl(req)}/#/bookings`).catch(() => {});
    return json(res, 200, { ok: true });
  }
  if (user.role === 'participant' && b.participant_id === user.id && participantActions.includes(status) && ['requested', 'accepted'].includes(b.status)) {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, b.id);
    const wu2 = db.prepare('SELECT name, email FROM users WHERE id = ?').get(b.worker_id);
    if (wu2) sendMail(wu2.email, 'Booking cancelled — BookIt',
      `A booking was cancelled, ${firstName(wu2.name)}`,
      `<p><b>${escHtml(user.name)}</b> has cancelled the booking for <b>${SERVICE_LABELS[b.service] || escHtml(b.service)}</b> on <b>${prettyDate(b.date)}</b> at <b>${escHtml(b.start)}</b>.</p><p>Your calendar for that time is free again.</p>`,
      'Open my bookings', `${baseUrl(req)}/#/bookings`).catch(() => {});
    return json(res, 200, { ok: true });
  }
  /* worker marks an accepted shift as completed (on/after the shift date) → invoice line is born */
  if (user.role === 'worker' && b.worker_id === user.id && status === 'completed' && b.status === 'accepted') {
    const today = new Date().toISOString().slice(0, 10);
    if (b.date > today) return json(res, 400, { error: 'You can mark a shift completed on the day of the shift or after — this one hasn\'t happened yet.' });
    const inv = applyInvoice(b.id, suggestCategory(b));
    db.prepare('UPDATE bookings SET status = ?, completed_at = ? WHERE id = ?').run('completed', now(), b.id);
    const pu2 = db.prepare('SELECT name, email FROM users WHERE id = ?').get(b.participant_id);
    if (pu2 && inv) sendMail(pu2.email, 'Shift completed — BookIt',
      `Shift completed, ${firstName(pu2.name)}`,
      `<p><b>${escHtml(user.name)}</b> has marked your <b>${SERVICE_LABELS[b.service] || escHtml(b.service)}</b> shift on <b>${prettyDate(b.date)}</b> as completed.</p><p><b>${inv.qty === 1 && inv.category === 'sleepover' ? '1 night (flat)' : `${b.hours} hours ×`} $${inv.unit_price.toFixed(2)}</b> (${inv.label} — 2026–27 NDIS price limit) = <b>$${inv.total.toFixed(2)}</b>.</p><p>If anything about this shift doesn't look right, just reply to this email and we'll sort it out before it's claimed.</p>`,
      'View my bookings', `${baseUrl(req)}/#/bookings`).catch(() => {});
    return json(res, 200, { ok: true, invoice: inv });
  }
  json(res, 403, { error: 'That change isn\'t allowed.' });
});

route('POST', /^\/api\/contact$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'contact', 20)) return json(res, 429, { error: 'Too many messages — try again later.' });
  db.prepare('INSERT INTO contact_messages (name, email, topic, body, created) VALUES (?,?,?,?,?)')
    .run(clean(body.name, 80), clean(body.email, 120), clean(body.topic, 80), clean(body.body, 2000), now());
  /* complaints land straight in the complaints register too */
  if (/complaint/i.test(String(body.topic || ''))) {
    db.prepare('INSERT INTO complaints (source_name, source_email, channel, summary, details, created) VALUES (?,?,?,?,?,?)')
      .run(clean(body.name, 80), clean(body.email, 120), 'site', clean(body.body, 2000).slice(0, 200) || 'Complaint via contact form', clean(body.body, 4000), now());
  }
  /* forward a copy to the BookIt inbox so nothing sits unseen in the database */
  const fromEmail = clean(body.email, 120);
  if (MAIL_FROM) sendMail(MAIL_FROM, `Contact form — ${clean(body.topic, 80) || 'General'}`,
    'New message from the contact form',
    `<p><b>From:</b> ${escHtml(clean(body.name, 80)) || 'Anonymous'} &lt;${escHtml(fromEmail) || 'no email given'}&gt;<br><b>Topic:</b> ${escHtml(clean(body.topic, 80)) || 'General'}</p><p style="white-space:pre-wrap;">${escHtml(clean(body.body, 2000))}</p>`,
    null, null, EMAIL_RE.test(fromEmail) ? fromEmail : undefined).catch(() => {});
  json(res, 200, { ok: true });
});

/* ---------- static files ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) {
      /* SPA-ish: unknown paths get the app shell */
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, home) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(home);
      });
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...(SITE_PASSWORD ? { 'X-Robots-Tag': 'noindex, nofollow' } : {})
    });
    res.end(data);
  });
}

/* ---------- server ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const ip = req.socket.remoteAddress || 'unknown';

  /* ----- force HTTPS when behind a proxy (Railway etc.) ----- */
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (xfProto === 'http') {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (host) { res.writeHead(301, { 'Location': `https://${host}${req.url}` }); return res.end(); }
  }

  /* ----- private preview gate ----- */
  if (SITE_PASSWORD) {
    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('User-agent: *\nDisallow: /\n');
    }
    if (pathname === '/gate' && req.method === 'POST') {
      let raw = '';
      req.on('data', c => { raw += c; if (raw.length > 5000) req.destroy(); });
      req.on('end', () => {
        const pw = new URLSearchParams(raw).get('pw') || '';
        if (limited(ip, 'gate', 30)) {
          res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(gatePage(true));
        }
        const a = sign('pw:' + pw), b = sign('pw:' + SITE_PASSWORD);
        if (a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))) {
          res.writeHead(302, {
            'Location': '/',
            'Set-Cookie': `bk_gate=${sign('gate-ok:' + SITE_PASSWORD)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`
          });
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' });
        res.end(gatePage(true));
      });
      return;
    }
    if (!gateValid(req.headers.cookie)) {
      if (pathname.startsWith('/api/')) {
        return json(res, 401, { error: 'This site is in private preview.' }, { 'X-Robots-Tag': 'noindex, nofollow' });
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
      return res.end(gatePage(false));
    }
  }

  /* worker profile photos (behind the preview gate like every page) */
  const photoMatch = pathname.match(/^\/photos\/(\d+)$/);
  if (photoMatch && req.method === 'GET') {
    const row = db.prepare('SELECT photo FROM worker_profiles WHERE user_id = ?').get(Number(photoMatch[1]));
    if (!row || !row.photo || !fs.existsSync(row.photo)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      'Content-Type': row.photo.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'public, max-age=86400'
    });
    return fs.createReadStream(row.photo).pipe(res);
  }

  /* emailed verification links land here, then bounce into the app */
  if (pathname === '/verify-email' && req.method === 'GET') {
    const u = readEmailToken('v', url.searchParams.get('token') || '');
    if (u) db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(u.id);
    res.writeHead(302, { 'Location': u ? '/#/verified' : '/#/verify-failed' });
    return res.end();
  }

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  }

  let raw = '';
  let overflow = false;
  const bodyCap = (pathname === '/api/me/documents' || pathname === '/api/me/photo') ? 6_000_000 : 100_000; /* uploads carry base64 files */
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > bodyCap) { overflow = true; req.destroy(); }
  });
  req.on('end', () => {
    if (overflow) return;
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON.' }); } }
    const user = readSession(req.headers.cookie);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      try { return r.handler(req, res, m, user, body, ip); }
      catch (e) { console.error(e); return json(res, 500, { error: 'Something went wrong on our end.' }); }
    }
    json(res, 404, { error: 'Not found.' });
  });
});

server.listen(PORT, () => {
  console.log(`BookIt server running → http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH} · auto-reply bot: ${AUTO_REPLY ? 'on' : 'off'}`);
  console.log(`Email: ${EMAIL_ON ? `ON — sending as ${MAIL_FROM} via ${RESEND_KEY ? 'Resend HTTPS API' : `${SMTP_HOST}:${SMTP_PORT} (SMTP — blocked on Railway Free/Trial/Hobby!)`}` : 'OFF — set RESEND_API_KEY (or SMTP_USER + SMTP_PASS) to enable; emails are logged to console instead'}`);
});
