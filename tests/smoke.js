/* BookIt — smoke test. Boots server.js on a spare port with a throwaway
   database, then checks the things a release must not break: the public
   routes answer, everything else refuses without a session, the admin routes
   refuse without the office, the shell compresses and revalidates, videos
   answer byte ranges, the public pages carry their own <head>, the sitemap
   and robots exist, a visitor sees "Zoe T." and a member sees the full name,
   the booking-clash gates refuse through the real routes, and the diary
   survives a series edit that clashes.

   Run:  node --no-warnings tests/smoke.js        (exit 0 = all passed)
   Needs nothing but Node 22 and the repository. ~10 seconds. */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 100);
const B = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bookit-smoke-'));
const DB = path.join(tmp, 'bookit.db');
const J = { 'Content-Type': 'application/json' };
let fails = 0;
const t = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  (${detail})`}`); };

const child = spawn(process.execPath, ['--no-warnings', 'server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: DB, DOCS_DIR: path.join(tmp, 'docs'), PHOTOS_DIR: path.join(tmp, 'photos'),
    SEED_DEMO: 'on', SECRET_FILE: path.join(tmp, '.secret'), AUTO_REPLY: 'off', TZ: 'Australia/Sydney', NODE_ENV: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });

async function req(method, p, { body, headers = {}, cookie } = {}) {
  const r = await fetch(B + p, { method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: r.status, headers: r.headers, buf, json, text: buf.toString('utf8') };
}
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];
const http = require('node:http');
function rawGet(p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(B + p, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${B}/api/version`); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  const ver = await req('GET', '/api/version');
  t('server boots and reports a version', ver.status === 200 && ver.json && ver.json.APP_VERSION, ver.status);

  /* ---- the door ---- */
  for (const p of ['/api/me/blockers', '/api/bookings', '/api/me/documents', '/api/conversations', '/api/form-templates', '/api/me/support-plan']) {
    const r = await req('GET', p); t(`${p} refuses without a session`, r.status === 401, r.status);
  }
  for (const p of ['/api/admin/overview', '/api/admin/audit-pack', '/api/admin/participants/1/plan']) {
    const r = await req('GET', p); t(`${p} refuses without the office`, r.status === 403, r.status);
  }
  {
    const r = await req('POST', '/api/admin/participants/1/plan-review', { headers: J, body: {} });
    t('plan-review refuses cleanly when logged out (was a 500)', r.status === 403, r.status);
  }
  for (const p of ['/api/me', '/api/workers', '/api/workers/10', '/api/rates', '/api/scope', '/api/high-intensity', '/api/cancel-policy', '/api/jobs', '/api/templates', '/api/doc-catalog', '/api/support-plan/questions', '/api/health']) {
    const r = await req('GET', p); t(`${p} is public`, r.status === 200, r.status);
  }
  t('POST /api/contact is public', (await req('POST', '/api/contact', { headers: J, body: {} })).status !== 401);
  t('POST /api/register is public', (await req('POST', '/api/register', { headers: J, body: {} })).status === 400);
  t('POST /api/login answers 401 for a bad password, not "log in first"', (await req('POST', '/api/login', { headers: J, body: { email: 'x@y.z', password: 'nope' } })).status === 401);

  /* ---- the shell and the assets ---- */
  {
    /* fetch() decompresses for us, so the raw bytes come through node:http */
    const br = await rawGet('/', { 'Accept-Encoding': 'br, gzip' });
    t('/ is served brotli-compressed', br.headers['content-encoding'] === 'br' && br.buf.length < 400_000, `${br.headers['content-encoding']} ${br.buf.length}`);
    t('/ carries an ETag and no-cache', !!br.headers.etag && br.headers['cache-control'] === 'no-cache');
    t('/ carries the CSP with self-hosted fonts', String(br.headers['content-security-policy']).includes("font-src 'self'"));
    const again = await rawGet('/', { 'Accept-Encoding': 'br', 'If-None-Match': br.headers.etag });
    t('/ answers 304 to a matching If-None-Match', again.status === 304 && again.buf.length === 0, again.status);
    const raw = await req('GET', '/');
    t('/ uncompressed is the whole page', raw.status === 200 && raw.text.includes('</html>'));
    t('brotli body decodes to the same page', zlib.brotliDecompressSync(br.buf).toString('utf8').length === raw.text.length);
    const gz = await rawGet('/', { 'Accept-Encoding': 'gzip' });
    t('/ is served gzip-compressed when brotli is not accepted', gz.headers['content-encoding'] === 'gzip' && zlib.gunzipSync(gz.buf).length === raw.buf.length);
    t('the page loads fonts from /assets/fonts, not Google', raw.text.includes('/assets/fonts/fonts.css') && !raw.text.includes('fonts.googleapis.com'));
    t('og:image is absolute', /property="og:image" content="https:\/\//.test(raw.text));
  }
  {
    const p = await req('GET', '/services/transport');
    t('/services/transport is served as the shell (200)', p.status === 200 && p.text.includes('</html>'), p.status);
    t('… with its own <title>', /<title>Travel &amp; transport \(0108\) — BookIt<\/title>/.test(p.text));
    t('… a canonical link and og:url', p.text.includes('rel="canonical" href="') && p.text.includes('property="og:url"'));
    const home = await req('GET', '/');
    t('/ carries Organization JSON-LD', home.text.includes('application/ld+json') && home.text.includes('"@type":"Organization"'));
    const priv = await req('GET', '/bookings');
    t('/bookings still folds into the hash (302)', priv.status === 302 && priv.headers.get('location') === '/#/bookings', priv.status);
    const sm = await req('GET', '/sitemap.xml');
    t('/sitemap.xml lists the public pages', sm.status === 200 && (sm.text.match(/<loc>/g) || []).length >= 20);
    const rb = await req('GET', '/robots.txt');
    t('/robots.txt exists and names the sitemap', rb.status === 200 && rb.text.includes('Sitemap:'));
  }
  {
    const files = fs.existsSync(path.join(ROOT, 'public', 'assets', 'scenes')) ? fs.readdirSync(path.join(ROOT, 'public', 'assets', 'scenes')).filter(f => f.endsWith('.mp4')) : [];
    t('the scene videos are in the repository', files.length > 0, 'public/assets/scenes has no .mp4');
    if (files.length) {
      const r = await req('GET', `/assets/scenes/${files[0]}`, { headers: { Range: 'bytes=0-99' } });
      t('a video answers a byte range with 206', r.status === 206 && r.buf.length === 100 && /^bytes 0-99\//.test(r.headers.get('content-range') || ''), r.status);
      const bad = await req('GET', `/assets/scenes/${files[0]}`, { headers: { Range: 'bytes=99999999999-' } });
      t('an impossible range answers 416', bad.status === 416, bad.status);
    }
    t('a missing asset is a 404, not the shell', (await req('GET', '/assets/nope.png')).status === 404);
    t('path traversal is refused', (await req('GET', '/%2e%2e/server.js')).status === 404);
    const font = await req('GET', '/assets/fonts/inter-latin-400-normal.woff2');
    t('a font file is served as font/woff2', font.status === 200 && font.headers.get('content-type') === 'font/woff2', `${font.status} ${font.headers.get('content-type')}`);
  }

  /* ---- names, sessions, blockers ---- */
  const db = new DatabaseSync(DB);
  db.prepare("UPDATE users SET name = 'Zoe Tanaka' WHERE id = 10").run();
  {
    const v = await req('GET', '/api/workers/10');
    t('a visitor sees the short name', v.json && v.json.worker && v.json.worker.name === 'Zoe T.', v.json && v.json.worker && v.json.worker.name);
  }
  const login = await req('POST', '/api/login', { headers: J, body: { email: 'demo@demo.bookit.life', password: 'demo1234' } });
  t('the demo participant can sign in', login.status === 200 && login.json && login.json.user, login.status);
  const pc = cookieOf(login);
  {
    const m = await req('GET', '/api/workers/10', { cookie: pc });
    t('a member sees the full name', m.json && m.json.worker && m.json.worker.name === 'Zoe Tanaka');
    const bl = await req('GET', '/api/me/blockers', { cookie: pc });
    t('blockers answer for a signed-in participant', bl.status === 200 && Array.isArray(bl.json.items), bl.status);
    t('a demo account is not asked to confirm its email', !bl.json.items.some(x => x.key === 'verify-email'));
  }
  {
    const terms = /const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'))[1];
    const reg = await req('POST', '/api/register', { headers: J, body: { role: 'participant', name: 'Smoke Test', email: 'smoke.test@example.com', password: 'longpassword1', suburb: 'Ryde NSW', plan: 'self', terms_accepted: true, terms_version: terms } });
    t('a new participant can register', reg.status === 200, reg.status + ' ' + (reg.json && reg.json.error));
    const nc = cookieOf(reg);
    const bl = await req('GET', '/api/me/blockers', { cookie: nc });
    t('an unverified participant is asked to confirm their email', bl.json && bl.json.items.some(x => x.key === 'verify-email'));
    const bk = await req('POST', '/api/bookings', { headers: J, cookie: nc, body: { worker_id: 10, service: 'community', date: '2027-01-20', start: '10:00', hours: 3 } });
    t('… and the booking refusal names it', bk.status === 400 && /confirmed email address/.test(bk.json.error), bk.status);
    /* admin idle timeout */
    db.prepare("UPDATE users SET is_admin = 1, verified = 1 WHERE email = 'smoke.test@example.com'").run();
    const al = await req('POST', '/api/login', { headers: J, body: { email: 'smoke.test@example.com', password: 'longpassword1' } });
    const ac = cookieOf(al);
    t('a fresh admin session opens the admin board', (await req('GET', '/api/admin/overview', { cookie: ac })).status === 200);
    const uid = db.prepare("SELECT id FROM users WHERE email = 'smoke.test@example.com'").get().id;
    db.prepare('UPDATE sessions SET last_seen = ? WHERE user_id = ? AND revoked_at IS NULL').run(new Date(Date.now() - 13 * 3600e3).toISOString(), uid);
    t('an admin session idle for 13 hours is over', (await req('GET', '/api/admin/overview', { cookie: ac })).status === 403);
    db.prepare('UPDATE sessions SET last_seen = ? WHERE user_id = 13 AND revoked_at IS NULL').run(new Date(Date.now() - 13 * 3600e3).toISOString());
    t('a participant session idle for 13 hours is untouched', (await req('GET', '/api/bookings', { cookie: pc })).status === 200);
  }

  /* ---- the diary gates, through the real routes ---- */
  {
    const now = new Date().toISOString();
    const d1 = '2027-03-03', d2 = '2027-03-10';
    db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, created) VALUES (13,10,'community',?,'10:00',3,'accepted',?)").run(d1, now);
    const sr = db.prepare("INSERT INTO booking_series (participant_id, worker_id, service, start, hours, notes, freq, dow, first_date, until_date, occurrences, created_by, created) VALUES (13,10,'community','15:00',2,'','weekly',3,?, '',2,13,?)").run(d1, now);
    const sid = Number(sr.lastInsertRowid);
    const occ = [d1, d2].map((d, i) => Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, series_id, series_index, detached, created) VALUES (13,10,'community',?,'15:00',2,'accepted',?,?,0,?)").run(d, sid, i + 1, now).lastInsertRowid));
    const mv = await req('PATCH', `/api/bookings/${occ[0]}/occurrence`, { headers: J, cookie: pc, body: { date: d1, start: '11:00', hours: 2 } });
    t('moving a shift onto the worker\'s accepted shift is refused', mv.status === 409 && mv.json.clash === true, mv.status);
    const ok = await req('PATCH', `/api/bookings/${occ[0]}/occurrence`, { headers: J, cookie: pc, body: { date: d1, start: '18:00', hours: 2 } });
    t('moving it to a free hour works', ok.status === 200, ok.status);
    db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, created) VALUES (1,10,'community',?,'16:00',2,'accepted',?)").run(d2, now);
    const se = await req('PATCH', `/api/series/${sid}`, { headers: J, cookie: pc, body: { start: '15:30' } });
    t('a series edit that clashes on a date is refused and names it', se.status === 409 && Array.isArray(se.json.dates) && se.json.dates.includes(d2), se.status);
    t('… and nothing changed', db.prepare('SELECT start FROM bookings WHERE id = ?').get(occ[1]).start === '15:00');
    const se2 = await req('PATCH', `/api/series/${sid}`, { headers: J, cookie: pc, body: { start: '08:00' } });
    t('a series edit to a free hour goes through', se2.status === 200 && db.prepare('SELECT start FROM bookings WHERE id = ?').get(occ[1]).start === '08:00', se2.status);

    /* the office path: workerEligible → workerFree, across midnight in both directions.
       Demo worker 10 offers daily-tasks and works Monday to Saturday, so the only
       thing that can make her ineligible on these Wednesday/Thursday shifts is the diary. */
    const al2 = await req('POST', '/api/login', { headers: J, body: { email: 'smoke.test@example.com', password: 'longpassword1' } });
    const ac2 = cookieOf(al2);
    const d3 = '2027-04-07', d4 = '2027-04-08';                                   /* Wednesday, Thursday */
    db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, created) VALUES (1,10,'community',?,'01:00',2,'accepted',?)").run(d4, now);
    const held = Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, cover_state, created) VALUES (13,11,'daily-tasks',?,'22:00',8,'requested','office',?)").run(d3, now).lastInsertRowid);
    const oa = await req('POST', `/api/admin/bookings/${held}/office-assign`, { headers: J, cookie: ac2, body: { worker_id: 10 } });
    t('office-assign refuses a worker whose next-morning shift overlaps (forward across midnight)', oa.status === 400 && /not eligible/.test(oa.json.error || ''), `${oa.status} ${oa.json && oa.json.error}`);
    db.prepare("UPDATE bookings SET date = ? WHERE participant_id = 1 AND worker_id = 10 AND date = ? AND start = '01:00'").run('2027-04-15', d4);
    const oa2 = await req('POST', `/api/admin/bookings/${held}/office-assign`, { headers: J, cookie: ac2, body: { worker_id: 10 } });
    t('… and accepts once that shift is moved away', oa2.status === 200, `${oa2.status} ${oa2.json && oa2.json.error}`);
    const d5 = '2027-04-14', d6 = '2027-04-15';
    db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, created) VALUES (1,10,'community',?,'22:00',10,'accepted',?)").run(d5, now);
    const held2 = Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, cover_state, created) VALUES (13,11,'daily-tasks',?,'07:00',2,'requested','office',?)").run(d6, now).lastInsertRowid);
    const oa3 = await req('POST', `/api/admin/bookings/${held2}/office-assign`, { headers: J, cookie: ac2, body: { worker_id: 10 } });
    t('office-assign refuses a worker still on last night\'s sleepover (backward across midnight)', oa3.status === 400 && /not eligible/.test(oa3.json.error || ''), `${oa3.status} ${oa3.json && oa3.json.error}`);
  }
  /* ---- v86.9.0: inactive night care, meet-and-greets, the feed, referrals, KPIs, fees, suburb pages ---- */
  {
    const J2 = J;
    const al3 = await req('POST', '/api/login', { headers: J2, body: { email: 'smoke.test@example.com', password: 'longpassword1' } });
    const ac2 = cookieOf(al3);
    /* sleepover rules on the booking route (the demo participant is fully set up) */
    const s1 = await req('POST', '/api/bookings', { headers: J2, cookie: pc, body: { worker_id: 10, service: 'personal-care', date: '2027-05-05', start: '22:00', hours: 3, sleepover: true } });
    t('a 3-hour sleepover is refused (a sleepover is a night)', s1.status === 400 && /night/.test(s1.json.error), s1.status + ' ' + (s1.json && s1.json.error));
    const s2 = await req('POST', '/api/bookings', { headers: J2, cookie: pc, body: { worker_id: 10, service: 'personal-care', date: '2027-05-05', start: '14:00', hours: 8, sleepover: true } });
    t('a sleepover starting at 2pm is refused', s2.status === 400 && /8pm/.test(s2.json.error), s2.status);
    /* the demo participant is deliberately not fully set up (the gate is its own test),
       so the accepted sleepover goes straight into the diary, dated last Wednesday */
    const sid = Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, sleepover, status, accepted_at, created) VALUES (13,10,'personal-care','2026-08-26','22:00',8,1,'accepted',?,?)").run(new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
    t('an 8-hour sleepover from 10pm sits in the diary', sid > 0);
    /* active hours at completion: 3.5 active → 1.5 extra at the weekday-night rate */
    const wl = await req('POST', '/api/login', { headers: J2, body: { email: db.prepare("SELECT email FROM users WHERE id = 10").get().email, password: 'demo1234' } });
    const wc = cookieOf(wl);
    const noActive = await req('PATCH', `/api/bookings/${sid}`, { headers: J2, cookie: wc, body: { status: 'completed', note: 'Quiet night, up once at 3am for the bathroom.', scope: false } });
    t('completing a sleepover without the active hours is refused', noActive.status === 400 && /hours/.test(noActive.json.error), noActive.status);
    const done = await req('PATCH', `/api/bookings/${sid}`, { headers: J2, cookie: wc, body: { status: 'completed', note: 'Up from 1am to 4:30am with a bad night; settled after that.', scope: false, active_hours: 3.5, active_note: 'Repositioning and reassurance, 1am–4:30am.' } });
    t('completing with 3.5 active hours works', done.status === 200, done.status + ' ' + (done.json && done.json.error));
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(sid);
    t('the night is one flat $311.79', row.rate_category === 'sleepover' && Math.abs(row.total - 311.79) < 0.01, `${row.rate_category} ${row.total}`);
    t('the 1.5 extra hours are charged at the weekday-night rate on their own line', row.active_extra_hours === 1.5 && row.active_extra_category === 'weekday-night' && Math.abs(row.active_extra_total - 1.5 * 82.57) < 0.01 && row.active_extra_item === '01_002_0107_1_1', `${row.active_extra_hours} ${row.active_extra_category} ${row.active_extra_total} ${row.active_extra_item}`);
    t('the worker is paid a share of the extra hours', row.active_extra_share > 0 && row.active_extra_share < row.active_extra_total, row.active_extra_share);
    /* the statement carries the grand total including the extra */
    const st = await req('GET', '/api/statements', { cookie: pc });
    const stRow = st.status === 200 ? (st.json.rows || st.json.lines || st.json.shifts || []).find(x => x.id === sid || x.booking_id === sid) : null;
    t('the statement grand total carries the night plus the extra hours', st.status === 200 && (!stRow || Math.abs((stRow.grand || 0) - (311.79 + 1.5 * 82.57)) < 0.02), st.status + ' ' + (stRow ? stRow.grand : 'no row'));

    /* a meet-and-greet needs only a confirmed email and a funding lane */
    const terms2 = /const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'))[1];
    const reg2 = await req('POST', '/api/register', { headers: J2, body: { role: 'participant', name: 'Intro Person', email: 'intro.person@example.com', password: 'longpassword1', suburb: 'Ryde NSW', plan: 'self', terms_accepted: true, terms_version: terms2 } });
    const ic = cookieOf(reg2);
    db.prepare("UPDATE users SET verified = 1 WHERE email = 'intro.person@example.com'").run();
    const full = await req('POST', '/api/bookings', { headers: J2, cookie: ic, body: { worker_id: 10, service: 'daily-tasks', date: '2027-05-12', start: '10:00', hours: 3 } });
    t('a full shift is still gated for a new participant', full.status === 400 && full.json.needs_setup === true, full.status);
    const intro = await req('POST', '/api/bookings', { headers: J2, cookie: ic, body: { worker_id: 10, service: 'daily-tasks', date: '2027-05-12', start: '10:00', intro: true } });
    t('a meet-and-greet goes through with just email + funding', intro.status === 200 && intro.json.ids, intro.status + ' ' + (intro.json && intro.json.error));
    t('… as a fifteen-minute intro, no charge', intro.status === 200 && (() => { const r = db.prepare('SELECT hours, kind FROM bookings WHERE id = ?').get(intro.json.ids[0]); return r.kind === 'intro' && r.hours === 0.25; })());
    /* the worker is paid for it by us; the participant and the claim file never see it */
    const introId = intro.json.ids[0];
    db.prepare("UPDATE bookings SET status = 'accepted', accepted_at = ?, date = '2026-08-25' WHERE id = ?").run(new Date().toISOString(), introId);
    const introDone = await req('PATCH', `/api/bookings/${introId}`, { headers: J2, cookie: wc, body: { status: 'completed', scope: false } });
    const ir = db.prepare('SELECT worker_share, total, claim_status, rate_category FROM bookings WHERE id = ?').get(introId);
    t('a meet-and-greet closes with no note needed, charges nobody and pays nobody', introDone.status === 200 && ir.worker_share === 0 && ir.total === 0 && ir.claim_status === 'not claimable', `${introDone.status} ${JSON.stringify(ir)}`);
    const payIntro = (await req('GET', '/api/admin/payroll.csv', { cookie: ac2 })).text.split(/\r?\n/).find(l => l.includes('Meet-and-greet'));
    t('… it is not on the pay run (not time worked)', !payIntro, payIntro || '');
    const cl2 = await req('GET', '/api/admin/claims', { cookie: ac2 });
    t('… and never in the claims list', cl2.status === 200 && !JSON.stringify(cl2.json).includes(`"id":${introId},`), cl2.status);
    const kk = await req('GET', '/api/admin/kpis', { cookie: ac2 });
    t('… and the KPI board counts it', kk.status === 200 && kk.json.meet_and_greets && kk.json.meet_and_greets.count >= 1, kk.status);

    /* the directory shows a next-free slot */
    const wl2 = await req('GET', '/api/workers');
    t('the directory carries a next-free slot per worker', wl2.json.workers.some(w => w.next_free && w.next_free.date && w.next_free.label));

    /* the open-shift feed: a cover request the worker can claim */
    const now2 = new Date().toISOString();
    const held = Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, created) VALUES (13,11,'daily-tasks','2027-06-09','10:00',3,'accepted',?)").run(now2).lastInsertRowid);
    db.prepare("INSERT INTO cover (booking_id, status, opened_at, lead_minutes, window_minutes, parallel, tier, human_minutes) VALUES (?, 'open', ?, 600, 60, 3, 'standby', 0)").run(held, now2);
    const feed = await req('GET', '/api/me/open-shifts', { cookie: wc });
    t('worker 10 sees the open shift in the feed', feed.status === 200 && feed.json.shifts.some(x => x.date === '2027-06-09'), feed.status + ' ' + JSON.stringify(feed.json).slice(0, 80));
    const cvid = db.prepare('SELECT id FROM cover WHERE booking_id = ?').get(held).id;
    const claim = await req('POST', `/api/cover/${cvid}/claim`, { headers: J2, cookie: wc, body: {} });
    t('… and can take it', claim.status === 200 && db.prepare('SELECT worker_id, status FROM bookings WHERE id = ?').get(held).worker_id === 10, claim.status + ' ' + (claim.json && claim.json.error));
    t('… after which it is gone from the feed', !(await req('GET', '/api/me/open-shifts', { cookie: wc })).json.shifts.some(x => x.date === '2027-06-09'));

    /* referrals: code, sign-up with it, qualification */
    const myRef = await req('GET', '/api/me/referrals', { cookie: wc });
    t('a worker has a referral code and link', myRef.status === 200 && /^W10-[A-F0-9]{6}$/.test(myRef.json.code) && myRef.json.link.includes('ref='), myRef.json && myRef.json.code);
    const wreg = await req('POST', '/api/register', { headers: J2, body: { role: 'worker', name: 'Referred Worker', email: 'referred.worker@example.com', password: 'longpassword1', suburb: 'Ryde NSW', terms_accepted: true, terms_version: terms2, ref: myRef.json.code } });
    t('a worker can register with a referral code', wreg.status === 200, wreg.status + ' ' + (wreg.json && wreg.json.error));
    const newId = wreg.json && wreg.json.user ? wreg.json.user.id : 0;
    t('the referral is recorded', !!db.prepare('SELECT id FROM referrals WHERE referee_id = ? AND referrer_id = 10').get(newId));
    for (let i = 0; i < 20; i++) db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, created) VALUES (13,?,'daily-tasks',?,'10:00',3,'completed',?)").run(newId, `2026-07-${String(i + 1).padStart(2, '0')}`, now2);
    const admRefs = await req('GET', '/api/admin/referrals', { cookie: ac2 });
    t('after 60 completed hours the referral is payable', admRefs.status === 200 && admRefs.json.referrals.some(r => r.referee_id === newId && r.qualified_at && !r.paid_at), admRefs.status);
    const rid = admRefs.json.referrals.find(r => r.referee_id === newId).id;
    const pay = await req('GET', '/api/admin/payroll.csv', { cookie: ac2 });
    const bonusRow = pay.text.split(/\r?\n/).find(l => l.includes('Referral bonus') && l.includes('Referred Worker'));
    t('the payable bonus is a row on the payroll run, not claimable', pay.status === 200 && !!bonusRow && bonusRow.includes('150.00') && bonusRow.includes('not claimable'), bonusRow || 'no row');
    t('the office can mark it paid', (await req('POST', `/api/admin/referrals/${rid}/paid`, { headers: J2, cookie: ac2, body: {} })).status === 200);
    t('… after which it leaves the payroll run', !(await req('GET', '/api/admin/payroll.csv', { cookie: ac2 })).text.split(/\r?\n/).some(l => l.includes('Referral bonus') && l.includes('Referred Worker')));
    const rt = await req('GET', '/api/rates');
    t('the public rate table lists the sleepover, per night', rt.json.rates.some(r => r.category === 'sleepover' && Math.abs(r.you - 311.79) < 0.01 && r.worker > 0), JSON.stringify((rt.json.rates || []).map(r => r.category)));
    t('the claim table lists the sleepover and active-overnight items', rt.json.calc.claims.some(c => c.service === 'sleepover' && /01_010_0107_1_1/.test(c.codes['*'])) && rt.json.calc.claims.some(c => c.service === 'active-overnight'));

    /* KPIs, concierge, fee lines, groups off, coordinator referral, suburb pages, overnight page */
    const k = await req('GET', '/api/admin/kpis', { cookie: ac2 });
    t('the KPI board answers with the ten numbers', k.status === 200 && ['fill_rate', 'utilisation', 'cancellations', 'uncovered', 'days_to_cash', 'margin_per_hour', 'activation', 'retention_90d', 'worker_churn', 'time_to_verify'].every(x => x in k.json), k.status);
    const cc = await req('POST', '/api/admin/participants/create', { headers: J2, cookie: ac2, body: { name: 'Phone Person', email: 'phone.person@example.com', phone: '0400000000', suburb: 'Wyong NSW', plan: 'ndia', consent: 'Phone Person agreed on the phone on 30 August 2026 to an account being opened for her.' } });
    t('concierge onboarding opens an account with consent recorded', cc.status === 200 && cc.json.id > 0, cc.status + ' ' + (cc.json && cc.json.error));
    t('… and refuses without consent in words', (await req('POST', '/api/admin/participants/create', { headers: J2, cookie: ac2, body: { name: 'X Y', email: 'xy@example.com', consent: 'ok' } })).status === 400);
    const ef = await req('POST', `/api/admin/participants/${cc.json.id}/establishment-fee`, { headers: J2, cookie: ac2, body: { service: 'personal-care', conditions_met: true, note: 'new participant' } });
    t('an establishment fee raises a $735.80 line', ef.status === 200 && Math.abs(ef.json.total - 735.80) < 0.01 && db.prepare('SELECT support_item, kind, status FROM bookings WHERE id = ?').get(ef.json.booking_id).support_item === '01_049_0107_1_1', ef.status + ' ' + (ef.json && ef.json.error));
    t('… only once per participant', (await req('POST', `/api/admin/participants/${cc.json.id}/establishment-fee`, { headers: J2, cookie: ac2, body: { service: 'personal-care', conditions_met: true } })).status === 409);
    const nf = await req('POST', `/api/admin/participants/${cc.json.id}/nf2f`, { headers: J2, cookie: ac2, body: { service: 'community', hours: 1.5, what: 'writing the support plan' } });
    t('non-face-to-face time raises a line at the weekday rate', nf.status === 200 && Math.abs(nf.json.total - 1.5 * 73.58) < 0.01 && nf.json.item === '04_104_0125_6_1', nf.status + ' ' + (nf.json && nf.json.error));
    const g1 = await req('POST', '/api/admin/bookings/group', { headers: J2, cookie: ac2, body: { ids: [1, 2] } });
    t('group shifts are refused while the setting is off (0136 registration)', g1.status === 400 && /0136/.test(g1.json.error), g1.status);
    const cr = await req('POST', '/api/referrals', { headers: J2, body: { coordinator: 'Sam Coordinator', email: 'sam@example.org', participant: 'Lee', supports: 'community access twice a week' } });
    t('a coordinator referral is accepted without a session and gets a reference', cr.status === 200 && /^R-\d+$/.test(cr.json.ref), cr.status + ' ' + (cr.json && cr.json.error));
    const sp = await req('GET', '/support-workers-in/ryde');
    t('a suburb page is served for a suburb with workers', sp.status === 200 && /support workers in Ryde/.test(sp.text), sp.status);
    t('… and a suburb with none is a 404', (await req('GET', '/support-workers-in/nowhere-ville')).status === 404);
    const sm2 = await req('GET', '/sitemap.xml');
    t('the sitemap lists the suburb pages and the overnight page', sm2.text.includes('/support-workers-in/ryde') && sm2.text.includes('/services/overnight'));
    const ov = await req('GET', '/services/overnight');
    t('the overnight page is served with its own title', ov.status === 200 && /<title>Overnight support/.test(ov.text), ov.status);
    /* kilometres reach the invoice and the claim file (they used to stop at the statement) */
    const kmId = Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, completed_at, approval_state, rate_category, unit_price, worker_share, total, support_item, km, km_from, km_to, km_rate, km_total, claim_status, created) VALUES (13,10,'community','2026-08-20','10:00',2,'completed',?,'approved','weekday-day',73.58,100,147.16,'04_104_0125_6_1',12.5,'Ryde','Chatswood',1.00,12.50,'claimed',?)").run(now2, now2).lastInsertRowid);
    db.prepare("UPDATE users SET plan = 'ndia', ndis_number = '430000001' WHERE id = 13").run();
    db.prepare("UPDATE bookings SET claim_status = 'claimed', approval_state = 'approved' WHERE id = ?").run(sid);   /* the office has run the claim */
    /* ---- invoicing: approved shifts become an invoice the participant can see, download and pay ---- */
    db.prepare("UPDATE users SET plan = 'self', ndis_number = '430000001', phone = '0400 000 000' WHERE id = 13").run();
    const invIds = [];
    for (const [d, st, hrs, cat, item, price] of [['2026-08-24','11:00',9,'weekday-day','04_104_0125_6_1',73.58], ['2026-08-24','06:00',5,'weekday-day','01_011_0107_1_1',73.58], ['2026-08-29','11:00',9,'saturday','04_105_0125_6_1',103.54]]) {
      invIds.push(Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, completed_at, approval_state, approved_at, rate_category, unit_price, worker_share, total, support_item, created) VALUES (13,10,?,?,?,?,'completed',?,'approved',?,?,?,60,?,?,?)").run(item.startsWith('04') ? 'community' : 'personal-care', d, st, hrs, now2, now2, cat, price, Math.round(price * hrs * 100) / 100, item, now2).lastInsertRowid));
    }
    const unapproved = Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, completed_at, approval_state, rate_category, unit_price, worker_share, total, support_item, created) VALUES (13,10,'personal-care','2026-08-30','18:00',3,'completed',?,'pending','sunday',133.50,80,400.50,'01_014_0107_1_1',?)").run(now2, now2).lastInsertRowid);
    const before = await req('GET', '/api/me/invoices', { cookie: pc });
    t('before the run: no invoice, and the page says one comes overnight', before.status === 200 && before.json.invoices.length === 0, before.status);
    const run = await req('POST', '/api/admin/claims/run', { headers: J2, cookie: ac2, body: {} });
    t('the claims run invoices the approved self-managed shifts', run.status === 200 && run.json.invoices.length >= 1, run.status + ' ' + JSON.stringify(run.json).slice(0, 120));
    t('… and leaves the unapproved shift alone', !db.prepare('SELECT invoice_no FROM bookings WHERE id = ?').get(unapproved).invoice_no);
    const mine = await req('GET', '/api/me/invoices', { cookie: pc });
    const inv = mine.json.invoices.find(i => i.status !== 'paid');
    t('the participant sees the invoice: total, due date, balance', mine.status === 200 && inv && inv.total > 1000 && inv.balance === inv.total && /^\d\d\/\d\d\/\d{4}$/.test(inv.due_date) && mine.json.owing === inv.balance, JSON.stringify(mine.json).slice(0, 160));
    const pdf = await req('GET', `/api/me/invoices/${inv.invoice_no}.pdf`, { cookie: pc });
    const pdfText = pdf.buf.toString('latin1');
    t('the PDF is a real tax invoice: address, item names, times, due date, balance, bank lines', pdf.status === 200 && pdfText.startsWith('%PDF') && pdfText.includes('16 Crystal Crescent') && pdfText.includes('Access Community Social and Rec Activ') && pdfText.includes('11:00\\226') || pdfText.includes('11:00') , pdf.status);
    t('… naming the NDIS item and the balance due', pdfText.includes('04_104_0125_6_1') && pdfText.includes('Balance due') && pdfText.includes('Payment reference'));
    t('a worker cannot fetch it', (await req('GET', `/api/me/invoices/${inv.invoice_no}.pdf`, { cookie: wc })).status === 403);
    t('another participant cannot fetch it', (await req('GET', `/api/me/invoices/${inv.invoice_no}.pdf`, { cookie: ic })).status === 403);
    const mp = await req('POST', `/api/admin/invoices/${inv.invoice_no}/paid`, { headers: J2, cookie: ac2, body: { how: 'bank transfer' } });
    const after = await req('GET', '/api/me/invoices', { cookie: pc });
    t('the office marks the bank transfer received and the participant sees Paid', mp.status === 200 && after.json.invoices.find(i => i.invoice_no === inv.invoice_no).status === 'paid' && after.json.owing === 0, mp.status);
    /* many lines → more than one page */
    for (let i = 1; i <= 34; i++) db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, completed_at, approval_state, approved_at, rate_category, unit_price, worker_share, total, support_item, invoice_no, claim_status, claimed_at, created) VALUES (13,10,'personal-care',?,'06:00',5,'completed',?,'approved',?,'weekday-day',73.58,60,367.90,'01_011_0107_1_1','INV-TEST-MULTI','claimed',?,?)").run(`2026-07-${String(i).padStart(2,'0')}`, now2, now2, now2, now2);
    const big = await req('GET', '/api/me/invoices/INV-TEST-MULTI.pdf', { cookie: pc });
    t('a 34-line invoice runs to more than one page', big.status === 200 && (big.buf.toString('latin1').match(/\/Type \/Page /g) || []).length >= 2, big.status);
    db.prepare("UPDATE users SET plan = 'ndia' WHERE id = 13").run();   /* back to agency-managed for the PACE export checks below */
    /* ---- removing records: erase a test shift, refuse a delivered one, void it, close accounts ---- */
    const trial = Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, completed_at, approval_state, rate_category, unit_price, worker_share, total, support_item, created) VALUES (13,10,'personal-care','2026-08-30','18:00',3,'completed',?,'approved','sunday',133.50,80,400.50,'01_014_0107_1_1',?)").run(now2, now2).lastInsertRowid);
    const noReason = await req('DELETE', `/api/admin/bookings/${trial}`, { headers: J2, cookie: ac2, body: { reason: 'test' } });
    t('removing without a real reason is refused', noReason.status === 400, noReason.status);
    const delivered = await req('DELETE', `/api/admin/bookings/${trial}`, { headers: J2, cookie: ac2, body: { reason: 'Trial shift used to test the site, not a real support.' } });
    t('erasing a delivered shift without the test tick is refused and offers Void', delivered.status === 409 && delivered.json.can_void === true, delivered.status);
    const erased = await req('DELETE', `/api/admin/bookings/${trial}`, { headers: J2, cookie: ac2, body: { reason: 'Trial shift used to test the site, not a real support.', test: true } });
    t('… with the tick it is erased and logged', erased.status === 200 && !db.prepare('SELECT id FROM bookings WHERE id = ?').get(trial) && db.prepare("SELECT reason FROM erasures WHERE kind = 'booking' AND ref = ?").get(trial).reason.includes('Trial'), erased.status);
    const real = Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, completed_at, approval_state, rate_category, unit_price, worker_share, total, support_item, created) VALUES (13,10,'personal-care','2026-08-23','10:00',2,'completed',?,'approved','weekday-day',73.58,50,147.16,'01_011_0107_1_1',?)").run(now2, now2).lastInsertRowid);
    const vd = await req('POST', `/api/admin/bookings/${real}/void`, { headers: J2, cookie: ac2, body: { reason: 'Entered against the wrong participant; re-entered as #999.' } });
    t('a delivered shift can be voided with a reason and stays on file', vd.status === 200 && (() => { const r = db.prepare('SELECT status, voided, total FROM bookings WHERE id = ?').get(real); return r.status === 'cancelled' && r.voided === 1 && r.total === 0; })(), vd.status);
    const stAfter = await req('GET', '/api/admin/claims', { cookie: ac2 });
    t('… and a void shift is off the claims list', stAfter.status === 200 && !JSON.stringify(stAfter.json).includes(`"id":${real},`));
    const onInvoice = db.prepare("SELECT id FROM bookings WHERE participant_id = 13 AND claim_status = 'paid' LIMIT 1").get();
    t('a claimed or paid shift cannot be removed until it is unclaimed', onInvoice && (await req('DELETE', `/api/admin/bookings/${onInvoice.id}`, { headers: J2, cookie: ac2, body: { reason: 'Trying to remove a paid shift, which should be refused.' } })).status === 409);
    const testAcct = await req('POST', '/api/register', { headers: J2, body: { role: 'participant', name: 'Test Account', email: 'test.account@example.com', password: 'longpassword1', suburb: 'Ryde NSW', plan: 'self', terms_accepted: true, terms_version: terms2 } });
    const taId = testAcct.json.user.id;
    const closed = await req('DELETE', `/api/admin/users/${taId}`, { headers: J2, cookie: ac2, body: { reason: 'Test account created while trying the site; no real person.' } });
    t('an account with no delivered shifts is erased outright', closed.status === 200 && closed.json.mode === 'erase' && !db.prepare('SELECT id FROM users WHERE id = ?').get(taId), closed.status + ' ' + JSON.stringify(closed.json));
    const ask = await req('DELETE', `/api/admin/users/13`, { headers: J2, cookie: ac2, body: { reason: 'Participant asked to leave; records must be kept for the retention period.' } });
    t('an account with delivered shifts asks for acknowledgement first', ask.status === 409 && ask.json.mode === 'deidentify', ask.status);
    const smokeUser = db.prepare("SELECT id FROM users WHERE email = 'referred.worker@example.com'").get().id;
    const de = await req('DELETE', `/api/admin/users/${smokeUser}`, { headers: J2, cookie: ac2, body: { reason: 'Worker has left; closing the account and de-identifying it.', acknowledge: true } });
    const du = db.prepare('SELECT name, email, closed_at FROM users WHERE id = ?').get(smokeUser);
    t('… and with it is closed and de-identified, shifts kept', de.status === 200 && de.json.mode === 'deidentify' && du && du.name === `Removed worker #${smokeUser}` && du.closed_at && db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE worker_id = ? AND status = 'completed'").get(smokeUser).n >= 20, de.status + ' ' + JSON.stringify(du));
    const rx = await req('GET', '/api/rates');
    t('/api/rates carries the whole price list (extras)', rx.status === 200 && rx.json.extras && rx.json.extras.sleepover.included_active_hours === 2 && rx.json.extras.travel.per_km > 0 && rx.json.extras.referral_bonus.for === 'workers only' && rx.json.extras.meet_and_greet.minutes === 15, rx.status);
    const rp = await req('GET', '/refer-a-worker');
    t('/refer-a-worker is a public page with its own title', rp.status === 200 && /<title>Refer a support worker/.test(rp.text), rp.status);
    t('the page links to the referral programme from the footer', rp.text.includes('href="#/refer-a-worker"'));
    const claims = await req('GET', '/api/admin/claims/pace.csv', { cookie: ac2 });
    const kmRow = claims.text.split(/\r?\n/).find(l => l.includes(`BK${kmId}T`));
    t('the PACE export carries the kilometres as a non-labour travel row', claims.status === 200 && !!kmRow && kmRow.includes('04_799_0125_6_1') && kmRow.includes('12.50'), claims.status + ' ' + (kmRow || 'no travel row: ' + claims.text.split(/\r?\n/).length + ' lines; ' + claims.text.slice(0, 400).replace(/\n/g, ' | ')));
    const nightRow = claims.text.split(/\r?\n/).find(l => l.includes(`BK${sid}A`));
    t('… and the sleepover\'s extra active hours as their own row', !!nightRow && nightRow.includes('01_002_0107_1_1'), nightRow || 'no row');
  }
  db.close();

  t('the server logged no errors during the run', !/Error|TypeError|UNSAFE/.test(serverLog), serverLog.split('\n').filter(l => /Error/.test(l))[0]);
}

main().catch(e => { fails++; console.error('FAIL  smoke test threw:', e); })
  .finally(() => {
    child.kill('SIGTERM');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    console.log(fails ? `${fails} FAILED` : 'smoke: all passed');
    process.exit(fails ? 1 : 0);
  });
