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
  'household':       { label: 'Household tasks (cleaning)', price: 60.10, worker: 43.50 }
};
const REG_GROUPS = { 'employment': '0102', 'personal-care': '0107', 'transport': '0108', 'daily-tasks': '0115/0138', 'household': '0120', 'community': '0125' };
function suggestCategory(b) {
  if (b.service === 'household') return 'household';
  const dow = new Date(b.date + 'T00:00:00').getDay();
  if (dow === 6) return 'saturday';
  if (dow === 0) return 'sunday';
  const [h, min] = String(b.start).split(':').map(Number);
  const endH = h + (min || 0) / 60 + Number(b.hours);
  if (h < 6) return 'weekday-night';
  if (h >= 20 || endH > 20) return 'weekday-evening';
  return 'weekday-day';
}
function applyInvoice(id, category) {
  const r = INVOICE_RATES[category];
  const b = db.prepare('SELECT hours FROM bookings WHERE id = ?').get(id);
  if (!r || !b) return null;
  const total = Math.round(r.price * b.hours * 100) / 100;
  const workerShare = Math.round(r.worker * b.hours * 100) / 100;
  db.prepare('UPDATE bookings SET rate_category = ?, unit_price = ?, worker_share = ?, total = ? WHERE id = ?')
    .run(category, r.price, workerShare, total, id);
  return { category, label: r.label, unit_price: r.price, total, worker_share: workerShare };
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
  return withAdmin(db.prepare('SELECT id, role, name, email, suburb, plan, verified FROM users WHERE id = ?').get(Number(uid)) || null);
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

function smtpSend(to, subject, html, text, replyTo) {
  return new Promise((resolve, reject) => {
    const boundary = 'bk' + crypto.randomBytes(12).toString('hex');
    const msgId = `<${crypto.randomBytes(12).toString('hex')}@bookit.life>`;
    const data =
      `From: =?UTF-8?B?${Buffer.from('BookIt', 'utf8').toString('base64')}?= <${MAIL_FROM}>\r\n` +
      `To: <${to}>\r\n` +
      (replyTo ? `Reply-To: <${replyTo}>\r\n` : '') +
      `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `Message-ID: ${msgId}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: multipart/alternative; boundary="${boundary}"\r\n` +
      `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${b64wrap(text)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${b64wrap(html)}\r\n` +
      `--${boundary}--\r\n`;
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

async function resendSend(to, subject, html, text, replyTo) {
  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `BookIt <${MAIL_FROM}>`, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
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

function sendMail(to, subject, heading, bodyHtml, ctaText, ctaUrl, replyTo) {
  const dest = String(to || '').trim().toLowerCase();
  if (!dest || dest.endsWith('@demo.bookit.life')) return Promise.resolve('skipped-demo');
  const html = emailHtml(heading, bodyHtml, ctaText, ctaUrl);
  const text = bodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&middot;/g, '·').trim()
    + (ctaUrl ? `\n\n${ctaText}: ${ctaUrl}` : '')
    + '\n\n— BookIt · Disability & Mental Health Care Pty Ltd · ABN 19 658 578 575';
  if (!EMAIL_ON) { console.log(`[email off] '${subject}' → ${dest}${ctaUrl ? ' · link: ' + ctaUrl : ''}`); return Promise.resolve('skipped-off'); }
  const transport = RESEND_KEY ? resendSend : smtpSend;
  return transport(dest, subject, html, text, replyTo).then(
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
    days: JSON.parse(row.days), rating: row.rating, shifts: row.shifts
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
  const r = db.prepare('INSERT INTO users (role, name, email, pass, suburb, phone, plan, created) VALUES (?,?,?,?,?,?,?,?)')
    .run(role, name, email, hashPassword(password), suburb, clean(body.phone, 40), clean(body.plan, 30), now());
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
  const me = withAdmin(db.prepare('SELECT id, role, name, email, suburb, plan, verified FROM users WHERE id = ?').get(uid));
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
  json(res, 200, { user: withAdmin({ id: row.id, role: row.role, name: row.name, email: row.email, suburb: row.suburb, plan: row.plan, verified: row.verified }) }, setSessionHeaders(row.id));
});

route('POST', /^\/api\/logout$/, (req, res) => json(res, 200, { ok: true }, CLEAR_COOKIE));

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
  const me = withAdmin(db.prepare('SELECT id, role, name, email, suburb, plan, verified FROM users WHERE id = ?').get(u.id));
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
    billed: Math.round(db.prepare("SELECT COALESCE(SUM(total), 0) AS s FROM bookings WHERE status = 'completed'").get().s * 100) / 100
  };
  const pending = db.prepare(`SELECT p.user_id, p.bio, p.services, u.name, u.email, u.suburb, u.phone, u.verified, u.created
    FROM worker_profiles p JOIN users u ON u.id = p.user_id WHERE p.visible = 0 ORDER BY u.created DESC`).all()
    .map(w => ({ ...w, services: JSON.parse(w.services || '[]') }));
  const users = db.prepare('SELECT u.id, u.role, u.name, u.email, u.suburb, u.verified, u.created, p.visible FROM users u LEFT JOIN worker_profiles p ON p.user_id = u.id ORDER BY u.id DESC LIMIT 100').all();
  const bookings = db.prepare(`SELECT b.id, b.service, b.date, b.start, b.hours, b.status, b.created,
    up.name AS participant_name, uw.name AS worker_name FROM bookings b
    JOIN users up ON up.id = b.participant_id JOIN users uw ON uw.id = b.worker_id ORDER BY b.id DESC LIMIT 50`).all();
  const contacts = db.prepare('SELECT id, name, email, topic, body, created FROM contact_messages ORDER BY id DESC LIMIT 50').all();
  json(res, 200, { counts, pending, users, bookings, contacts });
});

route('POST', /^\/api\/admin\/workers\/(\d+)\/approve$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const uid = Number(m[1]);
  const w = db.prepare("SELECT u.name, u.email FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(uid);
  if (!w) return json(res, 404, { error: 'No such worker.' });
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
  const r = db.prepare('INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, notes, created) VALUES (?,?,?,?,?,?,?,?)')
    .run(user.id, workerId, service, date, start, hours, clean(body.notes, 600), now());
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
      `<p><b>${escHtml(user.name)}</b> has marked your <b>${SERVICE_LABELS[b.service] || escHtml(b.service)}</b> shift on <b>${prettyDate(b.date)}</b> as completed.</p><p><b>${b.hours} hours × $${inv.unit_price.toFixed(2)}</b> (${inv.label} — 2026–27 NDIS price limit) = <b>$${inv.total.toFixed(2)}</b>.</p><p>If anything about this shift doesn't look right, just reply to this email and we'll sort it out before it's claimed.</p>`,
      'View my bookings', `${baseUrl(req)}/#/bookings`).catch(() => {});
    return json(res, 200, { ok: true, invoice: inv });
  }
  json(res, 403, { error: 'That change isn\'t allowed.' });
});

route('POST', /^\/api\/contact$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'contact', 20)) return json(res, 429, { error: 'Too many messages — try again later.' });
  db.prepare('INSERT INTO contact_messages (name, email, topic, body, created) VALUES (?,?,?,?,?)')
    .run(clean(body.name, 80), clean(body.email, 120), clean(body.topic, 80), clean(body.body, 2000), now());
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
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 100_000) { overflow = true; req.destroy(); }
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
