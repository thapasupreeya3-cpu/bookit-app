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
      CHECK (status IN ('requested','accepted','declined','cancelled')),
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY,
    name TEXT, email TEXT, topic TEXT, body TEXT, created TEXT NOT NULL
  );
`);

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
  return db.prepare('SELECT id, role, name, email, suburb, plan FROM users WHERE id = ?').get(Number(uid)) || null;
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
    db.prepare('INSERT INTO worker_profiles (user_id, bio, services) VALUES (?,?,?)')
      .run(uid, clean(body.bio, 600), JSON.stringify(services));
  }
  const me = db.prepare('SELECT id, role, name, email, suburb, plan FROM users WHERE id = ?').get(uid);
  json(res, 200, { user: me }, setSessionHeaders(uid));
});

route('POST', /^\/api\/login$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'login', 25)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  const email = clean(body.email, 120).toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !verifyPassword(String(body.password || ''), row.pass)) {
    return json(res, 401, { error: 'Email or password doesn\'t match.' });
  }
  json(res, 200, { user: { id: row.id, role: row.role, name: row.name, email: row.email, suburb: row.suburb, plan: row.plan } }, setSessionHeaders(row.id));
});

route('POST', /^\/api\/logout$/, (req, res) => json(res, 200, { ok: true }, CLEAR_COOKIE));

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
    const w = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'worker'").get(workerId);
    if (!w) return json(res, 404, { error: 'Worker not found.' });
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
  const w = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'worker'").get(workerId);
  if (!w) return json(res, 404, { error: 'Worker not found.' });
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
    return json(res, 200, { ok: true });
  }
  if (user.role === 'participant' && b.participant_id === user.id && participantActions.includes(status) && ['requested', 'accepted'].includes(b.status)) {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, b.id);
    return json(res, 200, { ok: true });
  }
  json(res, 403, { error: 'That change isn\'t allowed.' });
});

route('POST', /^\/api\/contact$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'contact', 20)) return json(res, 429, { error: 'Too many messages — try again later.' });
  db.prepare('INSERT INTO contact_messages (name, email, topic, body, created) VALUES (?,?,?,?,?)')
    .run(clean(body.name, 80), clean(body.email, 120), clean(body.topic, 80), clean(body.body, 2000), now());
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
});
