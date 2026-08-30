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
