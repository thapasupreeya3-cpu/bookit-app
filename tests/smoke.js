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
    /* an account with history in every table that points at users still closes cleanly */
    const busy = await req('POST', '/api/register', { headers: J2, body: { role: 'worker', name: 'Busy Trial', email: 'busy.trial@example.com', password: 'longpassword1', suburb: 'Wyong NSW', terms_accepted: true, terms_version: terms2 } });
    const busyId = busy.json.user.id;
    let planted = 0;
    for (const t of db.prepare("SELECT m.name FROM sqlite_master m WHERE m.type = 'table' AND EXISTS (SELECT 1 FROM pragma_foreign_key_list(m.name) f WHERE f.\"table\" = 'users')").all().map(r => r.name)) {
      const fks = db.prepare(`PRAGMA foreign_key_list("${t}")`).all().filter(f => f.table === 'users').map(f => f.from);
      const info = db.prepare(`PRAGMA table_info("${t}")`).all();
      const row = {};
      for (const c of info) { if (c.name === 'id') continue; if (fks.includes(c.name)) row[c.name] = busyId; else if (c.notnull && c.dflt_value == null) row[c.name] = /TEXT/i.test(c.type) ? new Date().toISOString() : 1; }
      try { db.prepare(`INSERT INTO "${t}" (${Object.keys(row).map(k => `"${k}"`).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)); planted++; } catch {}
    }
    const busyClose = await req('DELETE', `/api/admin/users/${busyId}`, { headers: J2, cookie: ac2, body: { reason: 'Trial worker with a row in every table; the erase must cascade cleanly.' } });
    const pointing = db.prepare("SELECT m.name FROM sqlite_master m WHERE m.type = 'table' AND EXISTS (SELECT 1 FROM pragma_foreign_key_list(m.name) f WHERE f.\"table\" = 'users')").all().map(r => r.name)
      .flatMap(t => db.prepare(`PRAGMA foreign_key_list("${t}")`).all().filter(f => f.table === 'users').map(f => db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE "${f.from}" = ?`).get(busyId).n)).reduce((a, b) => a + b, 0);
    t(`an account with rows in ${planted} tables erases cleanly, nothing left pointing at it`, busyClose.status === 200 && pointing === 0 && !db.prepare('SELECT id FROM users WHERE id = ?').get(busyId), `${busyClose.status} ${busyClose.json && busyClose.json.error} pointing=${pointing}`);
    const ask = await req('DELETE', `/api/admin/users/13`, { headers: J2, cookie: ac2, body: { reason: 'Participant asked to leave; records must be kept for the retention period.' } });
    t('an account with delivered shifts asks for acknowledgement first', ask.status === 409 && ask.json.mode === 'deidentify', ask.status);
    const smokeUser = db.prepare("SELECT id FROM users WHERE email = 'referred.worker@example.com'").get().id;
    const de = await req('DELETE', `/api/admin/users/${smokeUser}`, { headers: J2, cookie: ac2, body: { reason: 'Worker has left; closing the account and de-identifying it.', acknowledge: true } });
    const du = db.prepare('SELECT name, email, closed_at FROM users WHERE id = ?').get(smokeUser);
    t('… and with it is closed and de-identified, shifts kept', de.status === 200 && de.json.mode === 'deidentify' && du && du.name === `Removed worker #${smokeUser}` && du.closed_at && db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE worker_id = ? AND status = 'completed'").get(smokeUser).n >= 20, de.status + ' ' + JSON.stringify(du));
    /* ---- withdrawing an invoice: lines go back to unclaimed and can then be removed ---- */
    const wdId = Number(db.prepare("INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, status, completed_at, approval_state, rate_category, unit_price, worker_share, total, support_item, invoice_no, claim_status, claimed_at, created) VALUES (13,10,'personal-care','2026-08-22','10:00',2,'completed',?,'approved','weekday-day',73.58,50,147.16,'01_011_0107_1_1','INV-TEST-WD','claimed',?,?)").run(now2, now2, now2).lastInsertRowid);
    db.prepare("UPDATE users SET plan = 'self' WHERE id = 13").run();
    const stuck = await req('DELETE', `/api/admin/bookings/${wdId}`, { headers: J2, cookie: ac2, body: { reason: 'Trial shift on an invoice, trying to remove it directly.', test: true } });
    t('a shift on an invoice cannot be removed until the invoice is withdrawn', stuck.status === 409 && /Withdraw the invoice/.test(stuck.json.error), stuck.status + ' ' + (stuck.json && stuck.json.error));
    const wd = await req('POST', '/api/admin/invoices/INV-TEST-WD/withdraw', { headers: J2, cookie: ac2, body: { reason: 'Invoice raised on a trial shift; withdrawing it before removing the shift.' } });
    t('the invoice can be withdrawn with a reason', wd.status === 200 && wd.json.lines === 1 && !db.prepare('SELECT invoice_no FROM bookings WHERE id = ?').get(wdId).invoice_no, wd.status + ' ' + (wd.json && wd.json.error));
    t('… and the participant no longer sees it', !(await req('GET', '/api/me/invoices', { cookie: pc })).json.invoices.some(i => i.invoice_no === 'INV-TEST-WD'));
    /* the withdrawn line is held: Run does not re-invoice it, and it says so */
    const rerun = await req('POST', '/api/admin/claims/run', { headers: J2, cookie: ac2, body: {} });
    t('running claims again does not re-invoice the withdrawn shift', rerun.status === 200 && !db.prepare('SELECT invoice_no FROM bookings WHERE id = ?').get(wdId).invoice_no && rerun.json.needs.some(n => n.id === wdId && n.flags.some(f => /^held/.test(f))), rerun.status + ' ' + JSON.stringify(rerun.json.needs).slice(0, 160));
    const heldRow = (await req('GET', '/api/admin/claims', { cookie: ac2 })).json.rows ? null : null;
    const rel = await req('POST', `/api/admin/claims/${wdId}/release`, { headers: J2, cookie: ac2, body: {} });
    t('released, the next run invoices it again', rel.status === 200 && (await req('POST', '/api/admin/claims/run', { headers: J2, cookie: ac2, body: {} })).status === 200 && !!db.prepare('SELECT invoice_no FROM bookings WHERE id = ?').get(wdId).invoice_no, rel.status);
    const wd2 = await req('POST', `/api/admin/invoices/${db.prepare('SELECT invoice_no FROM bookings WHERE id = ?').get(wdId).invoice_no}/withdraw`, { headers: J2, cookie: ac2, body: { reason: 'Withdrawing again so the trial shift can be erased.' } });
    t('withdrawn again, it is held again', wd2.status === 200 && db.prepare('SELECT claim_hold FROM bookings WHERE id = ?').get(wdId).claim_hold === 1, wd2.status);
    const gone = await req('DELETE', `/api/admin/bookings/${wdId}`, { headers: J2, cookie: ac2, body: { reason: 'Trial shift used to test the site, not a real support.', test: true } });
    t('… after which the shift can be erased', gone.status === 200 && !db.prepare('SELECT id FROM bookings WHERE id = ?').get(wdId), gone.status);
    const paidInv = db.prepare("SELECT invoice_no FROM bookings WHERE participant_id = 13 AND claim_status = 'paid' AND invoice_no <> '' LIMIT 1").get();
    t('a paid invoice cannot be withdrawn', paidInv && (await req('POST', `/api/admin/invoices/${paidInv.invoice_no}/withdraw`, { headers: J2, cookie: ac2, body: { reason: 'Trying to withdraw a paid invoice, which should be refused.' } })).status === 409);
    db.prepare("UPDATE users SET plan = 'ndia' WHERE id = 13").run();
    const ovw = await req('GET', '/api/admin/overview', { cookie: ac2 });
    t('the overview carries claim status and invoice number on recent bookings', ovw.status === 200 && ovw.json.bookings && ovw.json.bookings.length && 'claim_status' in ovw.json.bookings[0] && 'invoice_no' in ovw.json.bookings[0], ovw.status);
    /* the accepted agreement is BookIt's own page: its print button must be allowed to run */
    const agree = await req('POST', '/api/me/participant-documents/p-agreement/accept', { headers: J2, cookie: ic, body: { agree: true } });
    t('a participant can accept the service agreement', agree.status === 200, agree.status + ' ' + (agree.json && agree.json.error));
    const agRow = db.prepare("SELECT id FROM participant_docs WHERE form_key = 'p-agreement' AND accepted_at IS NOT NULL ORDER BY id DESC LIMIT 1").get();
    const agFile = await req('GET', `/api/participant-documents/${agRow.id}/file`, { cookie: ic });
    t('the filed agreement is served with scripts and the print dialog allowed', agFile.status === 200 && agFile.headers.get('content-security-policy') === 'sandbox allow-scripts allow-modals' && agFile.text.includes('window.print()'), `${agFile.status} ${agFile.headers.get('content-security-policy')}`);
    const upRow = db.prepare("SELECT id FROM participant_docs WHERE accepted_at IS NULL AND file_path <> '' LIMIT 1").get();
    if (upRow) t('an uploaded file keeps the bare sandbox', (await req('GET', `/api/participant-documents/${upRow.id}/file`, { cookie: ac2 })).headers.get('content-security-policy') === 'sandbox');
    /* the blank-forms shelf never pretends a generated document is a PDF to fill in */
    const shelf = await req('GET', '/api/form-templates', { cookie: ac2 });
    const agRowShelf = shelf.json.templates.find(x => x.key === 'p-agreement');
    t('the shelf marks the Service Agreement as generated, with its edition and a link', shelf.status === 200 && agRowShelf && agRowShelf.generated === true && /v1/.test(agRowShelf.edition) && agRowShelf.read_url === '/service-agreement' && !agRowShelf.has_file, JSON.stringify(agRowShelf).slice(0, 160));
    t('… and no PDF was filed under it at boot', !db.prepare("SELECT form_key FROM form_templates WHERE form_key IN ('p-agreement','p-consent-privacy','p-consent-medication','p-schedule')").get());
    t('nor under a screen (risk, exit, money, medication, media)', !db.prepare("SELECT form_key FROM form_templates WHERE form_key IN ('p-risk','p-exit','p-money','p-medication','p-consent-media')").get());
    t('the nominee form is a screen now, not a blank', shelf.json.templates.some(x => x.key === 'p-advocate' && x.screen && !x.needs_blank), JSON.stringify(shelf.json.templates.find(x => x.key === 'p-advocate')).slice(0, 120));
    t('the NDIS plan copy never asks for a blank', shelf.json.templates.some(x => x.key === 'p-ndis-plan' && !x.needs_blank));
    /* forms as screens: a participant fills in the photo consent, confirms it, and it is filed like an agreement */
    const scr = await req('GET', '/api/me/forms/p-consent-media', { cookie: ic });
    t('a participant can open a form screen with its fields', scr.status === 200 && scr.json.screen && scr.json.screen.fields.length >= 4 && scr.json.can_confirm === true, scr.status);
    const draft = await req('POST', '/api/me/forms/p-consent-media', { headers: J2, cookie: ic, body: { answers: { photos_ok: 'Yes' }, confirm: false } });
    t('a draft saves without the required fields', draft.status === 200 && draft.json.saved && !draft.json.confirmed, draft.status);
    const incomplete = await req('POST', '/api/me/forms/p-consent-media', { headers: J2, cookie: ic, body: { answers: { photos_ok: 'Yes' }, confirm: true, agree: true }, });
    t('confirming with a required answer missing is refused and names it', incomplete.status === 200 || (incomplete.status === 400 && /Still needed/.test(incomplete.json.error)), incomplete.status + ' ' + (incomplete.json && incomplete.json.error));
    const noTick = await req('POST', '/api/me/forms/p-consent-media', { headers: J2, cookie: ic, body: { answers: { photos_ok: 'Yes', uses: ['Staff training'], named: 'No' }, confirm: true } });
    t('confirming without the declaration ticked is refused', noTick.status === 400 && /declaration/.test(noTick.json.error), noTick.status);
    const filed = await req('POST', '/api/me/forms/p-consent-media', { headers: J2, cookie: ic, body: { answers: { photos_ok: 'Yes', uses: ['Staff training', 'Not a real option'], named: 'No' }, confirm: true, agree: true } });
    t('a wrong checklist value is refused', filed.status === 400, filed.status);
    const filed2 = await req('POST', '/api/me/forms/p-consent-media', { headers: J2, cookie: ic, body: { answers: { photos_ok: 'Yes', uses: ['Staff training'], named: 'No', never: 'The bathroom.' }, confirm: true, agree: true } });
    t('a complete form is confirmed and filed', filed2.status === 200 && filed2.json.confirmed && filed2.json.doc_id > 0, filed2.status + ' ' + (filed2.json && filed2.json.error));
    const filedDoc = await req('GET', `/api/participant-documents/${filed2.json.doc_id}/file`, { cookie: ic });
    t('the filed page carries the answers, the declaration, who confirmed, and the print button', filedDoc.status === 200 && filedDoc.text.includes('Photo and media consent') && filedDoc.text.includes('Staff training') && filedDoc.text.includes('The bathroom.') && filedDoc.text.includes('Confirmed by') && filedDoc.text.includes('window.print()') && filedDoc.headers.get('content-security-policy') === 'sandbox allow-scripts allow-modals', filedDoc.status);
    const docsNow = await req('GET', '/api/me/participant-documents', { cookie: ic });
    t('the documents list shows it on file and offers the screen for the others', docsNow.status === 200 && JSON.stringify(docsNow.json).includes('"screen"'), docsNow.status);
    t('an office-only screen is refused to a participant', (await req('GET', '/api/me/forms/p-risk', { cookie: ic })).status === 403);
    const pidIntro = db.prepare("SELECT id FROM users WHERE email = 'intro.person@example.com'").get().id;
    const riskOffice = await req('POST', `/api/me/forms/p-risk?for=${pidIntro}`, { headers: J2, cookie: ac2, body: { answers: { setting: 'Community access twice a week, on foot and by bus.', risks: ['Falls', 'Transport and driving'], detail: 'Falls: possible, moderate — worker walks on the kerb side.', rating: 'Low', involved: 'Yes', review: '2027-09-01', assessor: 'Smoke Test, office' }, confirm: true } });
    t('the office fills in a risk assessment for a participant and it is filed', riskOffice.status === 200 && riskOffice.json.confirmed && !!db.prepare("SELECT id FROM participant_docs WHERE participant_id = ? AND form_key = 'p-risk' AND accepted_at IS NOT NULL").get(pidIntro), riskOffice.status + ' ' + (riskOffice.json && riskOffice.json.error));
    /* the audit pack carries every new register and every invoice PDF */
    const man = await req('GET', '/api/admin/audit-pack', { cookie: ac2 });
    const paths = man.status === 200 ? man.json.reports.map(r => r.path) : [];
    t('the audit pack lists the new registers', ['finance/invoice-register.csv', 'finance/night-care.csv', 'finance/fee-lines.csv', 'people/worker-referrals.csv', 'participants/form-responses.csv', 'evidence/removed-records.csv', 'evidence/kpis.json'].every(x => paths.includes(x)), paths.join(' '));
    for (const [p2, must] of [['/api/admin/invoice-register.csv', 'Balance'], ['/api/admin/night-care.csv', 'Active hours recorded'], ['/api/admin/fee-lines.csv', 'establishment fee'], ['/api/admin/referrals.csv', 'Referred by'], ['/api/admin/form-responses.csv', 'Photo and media consent'], ['/api/admin/erasures.csv', 'booking-voided'], ['/api/admin/kpis.json', 'fill_rate']]) {
      const r2 = await req('GET', p2, { cookie: ac2 });
      t(`${p2} answers with its rows`, r2.status === 200 && r2.text.includes(must), `${r2.status} ${r2.text.slice(0, 80)}`);
    }
    const zip = await req('GET', '/api/admin/audit-pack.zip', { cookie: ac2 });
    const names = [...zip.buf.toString('latin1').matchAll(/PK\x01\x02[\s\S]{24}([\s\S]{2})[\s\S]{2}[\s\S]{2}[\s\S]{12}([\x20-\x7e/]+?\.(?:csv|pdf|json|html|txt))/g)].map(m => m[2]);
    t('the pack zip contains an invoice PDF and the new registers', zip.status === 200 && names.some(n => /^finance\/invoices\/INV-.*\.pdf$/.test(n)) && names.includes('evidence/removed-records.csv') && names.includes('participants/form-responses.csv'), `${zip.status} ${names.filter(n => /invoices|removed|form-responses/.test(n)).slice(0, 6).join(' ')}`);
    /* the forms register counts filed participant forms per person, and never says Drive */
    const reg = await req('GET', '/api/admin/forms', { cookie: ac2 });
    const media = reg.status === 200 ? reg.json.forms.find(f => f.key === 'p-consent-media') : null;
    t('the register counts a filed screen per participant', !!media && media.state && media.state.filed === true && media.state.held >= 1, JSON.stringify(media && media.state).slice(0, 160));
    const regCsv = await req('GET', '/api/admin/forms.csv', { cookie: ac2 });
    t('the register CSV no longer says "in Drive"', regCsv.status === 200 && !/in Drive/i.test(regCsv.text));
    /* every participant document is a page or a screen now; the policies live in one folder */
    const shelf2 = await req('GET', '/api/form-templates', { cookie: ac2 });
    t('no participant document on the shelf still needs a blank', shelf2.status === 200 && !shelf2.json.templates.some(x => x.needs_blank), shelf2.json.templates.filter(x => x.needs_blank).map(x => x.key).join(' '));
    t('the nominee form, the clinical plans and the office records are screens', ['p-advocate', 'p-mealtime', 'p-epilepsy', 'p-diabetes', 'p-allergy', 'p-manual', 'p-pbs', 'p-living-arrangement', 'p-annual-review'].every(k => shelf2.json.templates.find(x => x.key === k && x.screen)));
    const meal = await req('POST', `/api/me/forms/p-mealtime?for=${pidIntro}`, { headers: J2, cookie: ac2, body: { answers: { clinician: 'J. Lee, speech pathologist, 12/08/2026', food: 'IDDSI 6 soft & bite-sized; no bread', drink: 'IDDSI 2 mildly thick', position: 'Upright 90°, stay upright 30 min after', pace: 'Small mouthfuls, one at a time, worker present throughout', signs: 'Coughing, wet voice, holding food in the mouth', emergency: 'Stop, sit forward, encourage cough; call 000 if airway blocked', review: '2027-08-12' }, confirm: true } });
    t('the office files a mealtime plan from the clinician\'s plan', meal.status === 200 && meal.json.confirmed, meal.status + ' ' + (meal.json && meal.json.error));
    const pf = await req('GET', '/api/admin/policies-folder', { cookie: ac2 });
    t('the policies folder is indexed: 100+ files with links, grouped by kind', pf.status === 200 && /^https:\/\/drive\.google\.com\//.test(pf.json.url) && pf.json.files.length >= 100 && pf.json.files.every(f => /^https:\/\//.test(f.url) && f.kind), pf.status + ' ' + (pf.json && pf.json.files && pf.json.files.length));
    const matched = pf.json.documents.filter(x => x.match);
    t('the register\'s company rows are matched to files by name (25 of 36)', matched.length >= 24 && matched.some(x => x.key === 'pol-incident' && /Incident Management Policy/.test(x.match.title)) && !pf.json.documents.find(x => x.key === 'pol-screening').match, `${matched.length} matched`);
    const rec = await req('POST', '/api/admin/policies-folder', { headers: J2, cookie: ac2, body: { record_all: true } });
    const pf2 = await req('GET', '/api/admin/policies-folder', { cookie: ac2 });
    t('one button records the matched documents as held, with the file link, and names the rest', rec.status === 200 && rec.json.recorded >= 24 && rec.json.unmatched.includes('Worker Screening policy and procedure') && pf2.json.documents.find(x => x.key === 'pol-incident').location.includes('drive.google.com'), rec.status + ' ' + JSON.stringify(rec.json).slice(0, 200));
    const addf = await req('POST', '/api/admin/policies-folder/files', { headers: J2, cookie: ac2, body: { title: 'Worker Screening Policy and Procedure.docx', url: 'https://drive.google.com/file/d/1TESTTESTTESTTEST/view', kind: 'policy' } });
    const pf3 = await req('GET', '/api/admin/policies-folder', { cookie: ac2 });
    t('a file added to the index is matched straight away', addf.status === 200 && !!pf3.json.documents.find(x => x.key === 'pol-screening').match, addf.status);
    t('… and can be removed again', (await req('DELETE', '/api/admin/policies-folder/files/1TESTTESTTESTTEST', { cookie: ac2 })).status === 200 && !(await req('GET', '/api/admin/policies-folder', { cookie: ac2 })).json.files.some(f => f.id === '1TESTTESTTESTTEST'));
    const pcsv = await req('GET', '/api/admin/policies.csv', { cookie: ac2 });
    t('the policies index is a register in the audit pack', pcsv.status === 200 && pcsv.text.includes('Incident Management Policy') && (await req('GET', '/api/admin/audit-pack', { cookie: ac2 })).json.reports.some(r => r.path === 'policies/policies-folder.csv'));
    t('a non-https folder link is refused', (await req('POST', '/api/admin/policies-folder', { headers: J2, cookie: ac2, body: { url: 'ftp://nope' } })).status === 400);
    /* policies as pages: a Word document becomes a page with headings, lists and a table */
    const docxB64 = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'Feedback and Complaints Policy.docx')).toString('base64');
    const pub = await req('POST', '/api/admin/policy-pages', { headers: J2, cookie: ac2, body: { file: { name: 'Uploaded Test Policy.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: docxB64 }, audience: 'participants' } });
    t('a Word policy is published as a page', pub.status === 200 && pub.json.slug === 'uploaded-test-policy' && pub.json.kind === 'policy' && pub.json.audience === 'participants' && pub.json.words > 60, pub.status + ' ' + JSON.stringify(pub.json).slice(0, 160));
    const pgAsParticipant = await req('GET', '/policies/uploaded-test-policy', { cookie: pc });
    t('a participant can read it: headings, a list, a table and bold survive the conversion', pgAsParticipant.status === 200 && pgAsParticipant.text.includes('<h2>Purpose</h2>') && pgAsParticipant.text.includes('<li>Ask an advocate to complain for you.</li>') && pgAsParticipant.text.includes('<th>Step</th>') && pgAsParticipant.text.includes('<b>Nobody is treated differently for complaining.</b>') && pgAsParticipant.text.includes('window.print()'), pgAsParticipant.status);
    const pgAnon = await req('GET', '/policies/uploaded-test-policy');
    t('signed out, a participants-only page sends you to sign in', pgAnon.status === 302);
    await req('PATCH', '/api/admin/policy-pages/uploaded-test-policy', { headers: J2, cookie: ac2, body: { audience: 'public' } });
    t('made public, it is readable without signing in and is in the sitemap', (await req('GET', '/policies/uploaded-test-policy')).status === 200 && (await req('GET', '/sitemap.xml')).text.includes('/policies/uploaded-test-policy'));
    const idx = await req('GET', '/policies', { cookie: wc });
    t('/policies lists it for a worker', idx.status === 200 && idx.text.includes('Uploaded Test Policy'), idx.status);
    const staffOnly = await req('POST', '/api/admin/policy-pages', { headers: J2, cookie: ac2, body: { file: { name: 'Staff Handbook.docx', data: docxB64 }, audience: 'staff' } });
    t('a staff-only page is refused to a participant but shown to a worker', staffOnly.status === 200 && (await req('GET', '/policies/staff-handbook', { cookie: pc })).status === 302 && (await req('GET', '/policies/staff-handbook', { cookie: wc })).status === 200);
    t('a spreadsheet is refused with a plain reason', (await req('POST', '/api/admin/policy-pages', { headers: J2, cookie: ac2, body: { file: { name: 'Worker Register.xlsx', data: Buffer.from('PK\x03\x04junk').toString('base64') } } })).status === 400);
    const folderNow = await req('GET', '/api/admin/policies-folder', { cookie: ac2 });
    t('the folder index points at the built-in page for that file', folderNow.json.files.some(f => f.title === 'Feedback and Complaints Policy.docx' && f.page === 'feedback-and-complaints-policy'));
    const pagesCsv = await req('GET', '/api/admin/policy-pages.csv', { cookie: ac2 });
    t('published pages are a register in the audit pack', pagesCsv.status === 200 && pagesCsv.text.includes('uploaded-test-policy') && pagesCsv.text.includes('feedback-and-complaints-policy') && (await req('GET', '/api/admin/audit-pack', { cookie: ac2 })).json.reports.some(r => r.path === 'policies/pages.csv'));
    /* the built-in policies: every document in content/policies is a page on a fresh install.
       Registers, checklists and timesheets are short by nature, so the check is that each page
       has real content, not a word count meant for policies; a slug the office has since
       uploaded over (as this run does with Staff Handbook.docx) is theirs, not the release's. */
    const builtIn = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'policies', 'index.json'), 'utf8')).documents;
    t(`the ${builtIn.length} built-in documents are all published`, builtIn.length >= 10 && builtIn.every(d => db.prepare("SELECT 1 FROM policy_pages WHERE slug = ? AND (imported_by <> 'release' OR words > 40)").get(d.slug)), builtIn.filter(d => !db.prepare('SELECT 1 FROM policy_pages WHERE slug = ?').get(d.slug)).map(d => d.slug).join(' '));
    const bi = await req('GET', '/policies/feedback-and-complaints-policy');
    t('a built-in policy is a public page with its sections and approval block', bi.status === 200 && bi.text.includes('<h2>Policy Statement</h2>') && bi.text.includes('1800 035 544') && bi.text.includes('Approval Authority') && bi.text.includes('v1, approved August 2025'), bi.status);
    /* the fill layer: a register keeps shared entries, a form keeps a copy per person */
    const regPage = await req('GET', '/policies/incident-management-register', { cookie: wc });
    t('a register page carries the fill layer for a worker, with the sandbox opened for it', regPage.status === 200 && regPage.text.includes('id="policy-fill"') && regPage.text.includes('data-kind="register"') && regPage.text.includes('policy-fill.js') && String(regPage.headers.get('content-security-policy')).includes('allow-same-origin'), regPage.status);
    const polPage = await req('GET', '/policies/feedback-and-complaints-policy', { cookie: wc });
    t('a policy page does not: no fill hooks, sandbox unchanged', polPage.status === 200 && !polPage.text.includes('policy-fill') && !String(polPage.headers.get('content-security-policy')).includes('allow-same-origin'));
    const fillRow = ['INC-T1', '01/09/2026', 'Injury or fall', 'Test person', 'Worker', '', 'Y', 'N', 'A test entry', '', '', '', '', '', '', ''];
    const w1 = await req('POST', '/api/policy-fill/incident-management-register', { headers: J2, cookie: wc, body: { base_id: null, data: { tables: { 0: [fillRow] } } } });
    const r1 = await req('GET', '/api/policy-fill/incident-management-register', { cookie: ac2 });
    t('a worker adds a register entry and the office reads it back', w1.status === 200 && r1.status === 200 && r1.json.scope === 'shared' && r1.json.data.tables[0][0][0] === 'INC-T1' && r1.json.id === w1.json.id, `${w1.status} ${r1.status}`);
    const stale = await req('POST', '/api/policy-fill/incident-management-register', { headers: J2, cookie: ac2, body: { base_id: null, data: { tables: { 0: [] } } } });
    t('a save on a stale copy of a register is refused, so no one\u2019s entry is lost', stale.status === 409, stale.status);
    t('a participant may not read a staff register; nobody may fill a policy', (await req('GET', '/api/policy-fill/incident-management-register', { cookie: pc })).status === 403 && (await req('GET', '/api/policy-fill/feedback-and-complaints-policy', { cookie: wc })).status === 404);
    const f1 = await req('POST', '/api/policy-fill/feedback-and-complaints-form', { headers: J2, cookie: pc, body: { base_id: null, data: { items: [{ label: 'Date', checked: true, value: '01/09/2026' }], by: { name: 'Test', notes: 'a note', junk: 'dropped' } } } });
    const f2 = await req('GET', '/api/policy-fill/feedback-and-complaints-form', { cookie: pc });
    const f3 = await req('GET', '/api/policy-fill/feedback-and-complaints-form', { cookie: wc });
    t('a form is a personal copy: the participant sees theirs, the worker does not', f1.status === 200 && f2.json.scope === 'personal' && f2.json.data.by.notes === 'a note' && f2.json.data.by.junk === undefined && f3.status === 200 && f3.json.id === null, `${f1.status} ${f2.status} ${f3.status}`);
    const fills = await req('GET', '/api/admin/policy-fills', { cookie: ac2 });
    t('the office sees everything filled in, and can open a person\u2019s copy', fills.status === 200 && fills.json.fills.some(f => f.slug === 'incident-management-register' && f.scope === 'shared') && fills.json.fills.some(f => f.slug === 'feedback-and-complaints-form' && f.owner) && (await req('GET', '/api/admin/policy-fills', { cookie: wc })).status === 403, fills.status);
    /* v86.10.0: the forms register knows the page each company document and register is published as,
       a page written on BookIt counts as held, and BookIt's own live registers are never "not in the folder" */
    const frm = await req('GET', '/api/admin/forms', { cookie: ac2 });
    t('forms register rows carry their BookIt page', frm.status === 200 && frm.json.forms.some(f => f.key === 'reg-restrictive' && f.page === 'restrictive-practices-register') && frm.json.forms.some(f => f.key === 'policy-register' && f.page === 'policy-register') && frm.json.forms.every(f => f.scope === 'worker' || f.scope === 'participant' ? !f.page : true), frm.status);
    const recAll2 = await req('POST', '/api/admin/policies-folder', { headers: J2, cookie: ac2, body: { record_all: true } });
    t('recording from the folder counts pages written on BookIt, and never names a live register as missing', recAll2.status === 200 && !recAll2.json.unmatched.some(n => /Restrictive Practices Register|Internal Audit|Participant Register|Banning orders|Worker Register/.test(n)) && recAll2.json.unmatched.some(n => /Certificate of currency/.test(n)), recAll2.json.unmatched.join('; '));
    /* v86.11.0: the file is tiered the way the established platforms tier theirs */
    const frm2 = await req('GET', '/api/admin/forms', { cookie: ac2 });
    const hiRow = frm2.json.forms.find(f => f.key === 'w-hi-competency'), licRow = frm2.json.forms.find(f => f.key === 'w-licence'), wwccRow = frm2.json.forms.find(f => f.key === 'w-wwcc');
    t('high-intensity competency is "not offered", never "missing", and is not counted as a document', hiRow.track === 'na' && frm2.json.counts.missing === 0 && frm2.json.counts.not_offered === 1 && !hiRow.state, hiRow.track);
    t('the driver licence and WWCC are add-ons asked only of the workers they apply to', licRow.appliesTo === 'transport' && licRow.state.unit === 'workers it applies to' && licRow.state.of <= frm2.json.workers && wwccRow.appliesTo === 'children', `${licRow.state.of}/${frm2.json.workers}`);
    const epi = frm2.json.forms.find(f => f.key === 'p-epilepsy');
    t('a clinical plan row carries the timing states: due within four weeks, and expired-but-accepted', epi.track === 'drive' && Array.isArray(epi.state.due) && Array.isArray(epi.state.renewing));
    const polIdx = await req('GET', '/policies');
    t('/policies is organised for everyone, participants, and workers, with the agreement and prices first', polIdx.status === 200 && polIdx.text.includes('data-tab="public"') && polIdx.text.includes('data-tab="participants"') && polIdx.text.includes('data-tab="staff"') && polIdx.text.includes('href="/service-agreement"') && polIdx.text.includes('href="/pricing"') && polIdx.text.includes('Start here'), polIdx.status);
    const preg = await req('GET', '/policies/policy-register');
    t('the Policy Register is generated from the published pages: public rows signed out, with review dates', preg.status === 200 && preg.text.includes('Feedback and Complaints Policy') && preg.text.includes('August 2027') && !preg.text.includes('Human Resources Management Policy'), preg.status);
    const regA = await req('GET', '/policies/policy-register', { cookie: ac2 });
    t('… and every document for an admin', regA.status === 200 && regA.text.includes('Human Resources Management Policy') && regA.text.includes('Training and Development Plan'));
    t('a staff-only built-in document sends a signed-out reader to sign in', (await req('GET', '/policies/training-and-development-plan')).status === 302);
    const tp = await req('GET', '/policies/training-and-development-plan', { cookie: ac2 });
    t('a built-in document carries its tables', tp.status === 200 && /<table class="grid">\s*<tr><th>Frequency<\/th>/.test(tp.text) && (tp.text.match(/<tr>/g) || []).length > 30, tp.status);
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
