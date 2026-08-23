#!/usr/bin/env node
'use strict';
/* ============================================================================
   prefill-worker-training.js — finish a test worker's training modules
   ----------------------------------------------------------------------------
   Signs in as the worker through the ordinary API — the same calls the
   Training page makes — and sits every module that is outstanding or
   overdue, so the training lock lifts and the worker can accept shifts.
   Each pass issues the certificate into the worker's documents, writes the
   evidence log and lifts the lock, exactly as a click on the page would.

   Two ways to run it:

     ON THE SERVER, with DB_PATH set (the site keeps running — the database
     is only read): the script reads each module's answer key from the
     database and every module passes at 100% on the first attempt.

       sudo env DB_PATH=/opt/bookit-data/bookit.db node prefill-worker-training.js https://bookit.life you+worker@gmail.com --gate "site password"

     FROM ANYWHERE, without DB_PATH: the script has no answer key, so it
     submits one attempt, reads the marking (the server says which answer
     was right for each question and why, as it does for a worker), then
     submits the correct answers. Every module still passes at 100%, but the
     record shows two attempts, the first a fail. Fine for a test account;
     say so if anyone asks.

       node prefill-worker-training.js https://bookit.life you+worker@gmail.com --gate "site password"

   Options:
     --dry-run    sign in, list what would be sat, change nothing
     --all        sit every module, including optional ones and ones already
                  current (default: required modules that are outstanding,
                  overdue or expired)

   The worker's password is asked for on the terminal (or BOOKIT_PASS).
   Needs Node 18+ (Node 22 for the DB_PATH route) and nothing else.
   ========================================================================== */

const readline = require('node:readline');

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
const email = (args.find(a => a.includes('@')) || '').toLowerCase();
const gateIdx = args.indexOf('--gate');
const gatePw = gateIdx >= 0 ? args[gateIdx + 1] : '';
const dryRun = args.includes('--dry-run');
const sitAll = args.includes('--all');
const DB_PATH = process.env.DB_PATH || '';
if (!base || !email) {
  console.error('usage: node scripts/prefill-worker-training.js https://bookit.life worker@example.com [--gate "site password"] [--dry-run] [--all]');
  process.exit(1);
}
if (/@demo\.bookit\.life$/i.test(email)) { console.error('  \u2717 That is a demo account; demo workers are trained by the seed.'); process.exit(1); }

/* ---------- tiny http client with a cookie jar ---------- */
const jar = {};
function cookieHeader() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); }
function eatCookies(res) {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [].concat(res.headers.get('set-cookie') || []);
  for (const c of sc) { const m = /^([^=]+)=([^;]*)/.exec(c); if (m) jar[m[1]] = m[2]; }
}
async function api(method, path, body) {
  const res = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader(), 'Origin': base },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  eatCookies(res);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data };
}
function ask(q, hidden) {
  return new Promise(resolve => {
    const tty = Boolean(process.stdin.isTTY);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
    if (hidden && tty) { let shown = false; rl._writeToOutput = () => { if (!shown) { shown = true; process.stdout.write(q); } }; }
    rl.question(q, a => { if (hidden && tty) process.stdout.write('\n'); rl.close(); resolve(String(a || '').trim()); });
  });
}
const ok = m => console.log('  \u2713 ' + m);
const skip = m => console.log('  \u2013 ' + m);
const bad = m => console.log('  \u2717 ' + m);

/* ---------- the answer key, if the database is at hand ---------- */
function answerKey() {
  if (!DB_PATH) return null;
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { bad('This Node cannot open the database (needs Node 22). Running without the answer key.'); return null; }
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const rows = db.prepare('SELECT key, quiz FROM modules WHERE active = 1').all();
    const key = {};
    for (const r of rows) {
      let quiz = []; try { quiz = JSON.parse(r.quiz || '[]'); } catch { /* no quiz */ }
      key[r.key] = quiz.map(q => Number(q.correct));
    }
    db.close();
    return key;
  } catch (e) { bad(`Could not read ${DB_PATH}: ${e.message}. Running without the answer key.`); return null; }
}

(async () => {
  console.log(`\nBookIt worker training prefill \u2014 ${base} \u2014 ${email}${dryRun ? ' (dry run: nothing will be written)' : ''}\n`);

  if (gatePw) {
    const res = await fetch(base + '/gate', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'pw=' + encodeURIComponent(gatePw) });
    eatCookies(res);
    if (!jar.bk_gate) { bad('The site password was not accepted.'); process.exit(1); }
    ok('Through the preview gate.');
  }
  const probe = await api('GET', '/api/version');
  if (probe.status === 401 && /private preview/i.test(probe.data.error || '')) { bad('The site is behind its preview password \u2014 run again with --gate "the password".'); process.exit(1); }
  if (probe.status !== 200) { bad(`Could not reach ${base} (${probe.status}). ${probe.data.error || probe.data.raw || ''}`); process.exit(1); }
  ok(`Server reached: BookIt ${probe.data.APP_VERSION || ''}.`);

  const password = process.env.BOOKIT_PASS || await ask(`Password for ${email}: `, true);
  let login = await api('POST', '/api/login', { email, password });
  if (login.status !== 200) { bad(`Sign-in failed: ${login.data.error || login.status}`); process.exit(1); }
  if (login.data.mfa) {
    const code = await ask('Two-step code from the authenticator app: ');
    login = await api('POST', '/api/login/mfa', { challenge: login.data.challenge, code: code.trim() });
    if (login.status !== 200) { bad(`Two-step failed: ${login.data.error || login.status}`); process.exit(1); }
  }
  const me = login.data.user || {};
  ok(`Signed in as ${me.name} (${me.role}).`);
  if (me.role !== 'worker') { bad(`${email} is a ${me.role} account. Training belongs to a worker.`); process.exit(1); }

  const st = await api('GET', '/api/me/training');
  if (st.status !== 200) { bad(`Could not read the training page: ${st.data.error || st.status}`); process.exit(1); }
  const mods = st.data.modules || [];
  console.log(`\n  Training lock: ${st.data.lock ? st.data.lock.toUpperCase() + ' (' + st.data.overdue_days + ' days overdue)' : 'none'}. ${mods.length} modules.`);
  /* required modules only, unless --all: DMHC does not offer high-intensity
     supports, and an optional knowledge check sat by a test account would
     put a certificate on the file that says otherwise */
  const today = new Date().toISOString().slice(0, 10);
  const toSit = mods.filter(m => (sitAll || m.required) && (sitAll || !m.done || m.overdue_days > 0 || (m.expires_at && m.expires_at < today)));
  for (const m of mods) {
    const why = !m.done ? 'not yet sat' : m.overdue_days > 0 ? `${m.overdue_days} days overdue` : m.expires_at ? `current, renews ${m.expires_at}` : 'current';
    (toSit.includes(m) ? ok : skip)(`${m.title} \u2014 ${why}${m.required ? '' : ' (optional)'}`);
  }
  if (!toSit.length) { console.log('\n  Nothing to sit. The lock, if any, is not about training.\n'); process.exit(0); }
  if (dryRun) { console.log(`\n  Dry run: would sit ${toSit.length} module(s).\n`); process.exit(0); }

  const key = answerKey();
  console.log(key ? '\n  Answer key read from the database: each module passes on its first attempt.\n' : '\n  No answer key: each module is sat twice, the first attempt marked, the second correct.\n');

  let passed = 0;
  for (const m of toSit) {
    const mod = await api('GET', `/api/modules/${m.key}`);
    if (mod.status !== 200) { bad(`${m.title}: ${mod.data.error || mod.status}`); continue; }
    const qs = mod.data.module.questions || [];
    if (!qs.length) { skip(`${m.title}: no questions \u2014 nothing to sit.`); continue; }
    let answers = key && key[m.key] && key[m.key].length === qs.length ? key[m.key] : null;
    if (!answers) {
      /* the marking comes back for the wrong answers only (n, right, why);
         the ones not listed were right as given */
      const guess = qs.map(() => 0);
      const first = await api('POST', `/api/modules/${m.key}/submit`, { answers: guess });
      if (first.status !== 200 || !Array.isArray(first.data.review)) { bad(`${m.title}: first attempt failed \u2014 ${first.data.error || first.status}`); continue; }
      if (first.data.passed) { passed++; ok(`${m.title}: passed at ${first.data.score}% on the first attempt.`); continue; }
      answers = guess.slice();
      for (const w of first.data.review) answers[Number(w.n)] = Number(w.right);
    }
    const sub = await api('POST', `/api/modules/${m.key}/submit`, { answers });
    if (sub.status !== 200) { bad(`${m.title}: ${sub.data.error || sub.status}`); continue; }
    if (sub.data.passed) { passed++; ok(`${m.title}: passed at ${sub.data.score}%${sub.data.doc_id ? ', certificate filed' : ''}${key ? '' : ' (second attempt)'}.`); }
    else bad(`${m.title}: ${sub.data.score}% \u2014 below the pass mark; the answer key may be out of date.`);
  }

  const after = await api('GET', '/api/me/training');
  console.log(`\n  ${passed} of ${toSit.length} sat and passed. Training lock now: ${after.data && after.data.lock ? after.data.lock.toUpperCase() : 'none'}.`);
  console.log(after.data && !after.data.lock ? '  The worker can accept shifts.\n' : '  Something is still outstanding \u2014 open the Training page as the worker to see what.\n');
})().catch(e => { bad(e.message); process.exit(1); });
