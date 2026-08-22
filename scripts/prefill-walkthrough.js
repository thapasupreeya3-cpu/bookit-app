#!/usr/bin/env node
'use strict';
/* ============================================================================
   prefill-walkthrough.js — fill a test participant's file for a walkthrough
   ----------------------------------------------------------------------------
   Signs in as the participant through the ordinary API — the same calls the
   browser makes — and writes:

     1. a confirmed support plan (every required question answered)
     2. billing details (self-managed, with an obviously-placeholder NDIS number)
     3. the Service Agreement, agreed on screen (and on servers before v86.2,
        the privacy consent and schedule clicks those versions asked for)
     4. on v86+: "who manages this account" = nobody, I manage my own

   It goes through the server's own validation, versioning and compliance log,
   so what lands on the file is exactly what the participant would have
   produced by clicking — confirmed by them, under their name, dated today.
   Nothing is deleted. Running it twice adds a new plan version and reports
   the agreements as already on file.

   Works on v85.3 and v86: it asks the server which questions exist and answers
   the ones it knows; anything it has no answer for gets a safe default.

   Usage:
     node scripts/prefill-walkthrough.js https://bookit.life you+participant@gmail.com
     node scripts/prefill-walkthrough.js https://bookit.life you+participant@gmail.com --gate "site password"
     node scripts/prefill-walkthrough.js https://bookit.life you+participant@gmail.com --dry-run
     node scripts/prefill-walkthrough.js https://bookit.life you+participant@gmail.com --leave-agreements
         (fills the plan and billing but does not press "I agree" on anything,
          so the agreement click can be done live in front of someone)

   The account password is asked for on the terminal (not echoed). If the
   account has two-step sign-in, the six-digit code is asked for too.
   Needs Node 18+ and nothing else.
   ========================================================================== */

const readline = require('node:readline');

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
const email = (args.find(a => a.includes('@')) || '').toLowerCase();
const gateIdx = args.indexOf('--gate');
const gatePw = gateIdx >= 0 ? args[gateIdx + 1] : '';
const dryRun = args.includes('--dry-run');
const leaveAgreements = args.includes('--leave-agreements');   /* so the "I agree" click can be shown live */
if (!base || !email) {
  console.error('usage: node scripts/prefill-walkthrough.js https://bookit.life participant@example.com [--gate "site password"] [--dry-run]');
  process.exit(1);
}

/* ---------- the persona: one fictional participant, written once ---------- */
const ANSWERS = {
  /* the supports they use */
  use_personal: false,
  use_daily: true,
  daily_detail: 'Weekday mornings: we plan the day on the whiteboard in the kitchen, then do the shopping list and cook one main meal together, which I freeze in portions. I do my own showering, dressing and medication — I do not need prompting for any of that.',
  use_community: true,
  community_detail: 'Tuesday and Thursday afternoons: the library, the community garden, and a swim at the aquatic centre in summer. I go quiet in crowds, so we leave when I say so. A worker who can drive makes the afternoon twice as useful.',
  use_transport: true,
  transport_detail: 'Worker\'s car — I don\'t drive. I sit in the front. Short trips are fine; for anything over 30 minutes, tell me the route before we leave.',
  use_household: false,
  use_employ: false,

  /* if a shift falls over */
  main_source: true,
  health_safety: false,
  impact_detail: '',
  backup_24h: true,
  backup_detail: 'My sister Anjali — 0400 000 000. She lives ten minutes away and can come the same day. The after-hours mental health line is the other call.',
  preventative_health: true,

  /* what a worker needs to know */
  goals: 'To keep living in my own place, get back to two regular days a week out of the house, and be on the library\'s volunteer roster by Christmas.',
  communication: 'Plain English, one thing at a time. I read and text fine. If I go quiet or short with you, that is anxiety, not rudeness — give me a minute and don\'t fill the silence.',
  mobility: 'I walk without aids and stairs are fine. I tire on long days, so the afternoon is planned around one sit-down.',
  health_supports: 'Anxiety and depression, managed by my GP and a psychologist I see fortnightly. I take my own medication and do not need reminding. No allergies. Asthma as a child, nothing since.',
  cognition: 'I lose track of time and of multi-step tasks when I am stressed. Writing the plan on the whiteboard works; being told twice does not.',
  mental_health: 'Early warning signs: I stop answering texts and the blinds stay down. If a worker notices that, say it plainly and ring the office — don\'t just leave. Bad days are not a reason to cancel; a shorter shift is better than none.',
  other_info: 'Knock and wait — I always answer, it just takes me a while. No perfume or strong aftershave. The cat is called Biscuit and goes outside when the door opens; that is fine.',
  /* v86 only — ignored by older servers */
  living_situation: 'My own one-bedroom unit, on my own. The neighbour upstairs has a spare key and my sister visits most weekends.',
  diagnosis: 'Generalised anxiety disorder and recurrent depression; a mild intellectual disability diagnosed at school.',
  interpreter: false,
  interpreter_detail: '',

  /* v86 only — specialised support: none of the seven applies */
  need_medication: false, need_mealtime: false, need_seizure: false, need_diabetes: false,
  need_allergy: false, need_manual: false, has_pbs: false,

  /* home and community */
  home_safety: 'Ground floor, no stairs inside. The back door sticks and needs a shoulder. The smoke alarm was replaced in March. Power board under the TV, nothing on a double adapter. No smoking in the unit.',
  community_safety: 'Shopping centres at peak times overwhelm me, so we go before 11am. I know my way home from the library and the station. I don\'t carry cash; my card is in a wallet on a lanyard.',
  disaster_8h: false,

  /* who we ring */
  ec_name: 'Anjali Rai',
  ec_relationship: 'Sister',
  ec_phone: '0400 000 000',
  ec_email: ''
};
const BILLING = { plan: 'self', ndis_number: '430000001', pm_email: '', plan_start: '2026-07-01', plan_end: '2027-06-30' };
const AGREEMENTS = ['p-agreement', 'p-consent-privacy', 'p-schedule'];   /* on v86.2+ only the agreement is a click; the other two are skipped as 'not outstanding' */

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
    /* hidden input: every redraw of the line writes the prompt and nothing
       else, so the prompt stays on screen and the keystrokes never do */
    if (hidden && tty) rl._writeToOutput = () => process.stdout.write(q);
    rl.question(q, a => { if (hidden && tty) process.stdout.write('\n'); rl.close(); resolve(String(a || '').trim()); });
  });
}
const ok = m => console.log('  \u2713 ' + m);
const skip = m => console.log('  \u2013 ' + m);
const bad = m => console.log('  \u2717 ' + m);

(async () => {
  console.log(`\nBookIt walkthrough prefill \u2014 ${base} \u2014 ${email}${dryRun ? ' (dry run: nothing will be written)' : ''}\n`);

  /* 0. the site-wide preview gate, if there is one */
  if (gatePw) {
    const res = await fetch(base + '/gate', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'pw=' + encodeURIComponent(gatePw) });
    eatCookies(res);
    if (!jar.bk_gate) { bad('The site password was not accepted.'); process.exit(1); }
    ok('Through the preview gate.');
  }
  const probe = await api('GET', '/api/support-plan/questions');
  if (probe.status === 401 && /private preview/i.test(probe.data.error || '')) { bad('The site is behind its preview password \u2014 run again with --gate "the password".'); process.exit(1); }
  if (probe.status !== 200) { bad(`Could not reach ${base} (${probe.status}). ${probe.data.error || probe.data.raw || ''}`); process.exit(1); }
  const questions = probe.data.questions || [];
  const v86 = questions.some(q => q.key === 'need_medication');
  ok(`Server reached. ${questions.length} plan questions \u2014 ${v86 ? 'v86 or later (specialised-support section present)' : 'v85 or earlier'}.`);

  /* 1. sign in as the participant */
  const password = process.env.BOOKIT_PASS || await ask(`Password for ${email}: `, true);
  let login = await api('POST', '/api/login', { email, password });
  if (login.status !== 200) { bad(`Sign-in failed: ${login.data.error || login.status}`); process.exit(1); }
  if (login.data.mfa) {
    const code = await ask('Two-step code from the authenticator app: ');
    login = await api('POST', '/api/login/mfa', { challenge: login.data.challenge, code: code.trim() });
    if (login.status !== 200) { bad(`Two-step failed: ${login.data.error || login.status}`); process.exit(1); }
  }
  const me = login.data.user || {};
  ok(`Signed in as ${me.name} (${me.role}${me.admin ? ', admin' : ''}).`);
  if (me.role !== 'participant') {
    bad(`${email} is a ${me.role} account. A support plan belongs to a participant, so this account cannot have one.`);
    console.log('    Use the participant test account instead (for example an address ending +participant@gmail.com).');
    console.log('    If there is none yet: sign up at /#/get-started as a participant, verify the email, then run this again.');
    process.exit(2);
  }

  /* 2. the support plan, every required question answered */
  const body = { confirm: true, declaration: true, care_plans: [] };
  const unknown = [];
  for (const q of questions) {
    if (q.key in ANSWERS) body[q.key] = ANSWERS[q.key];
    else { unknown.push(q.key); body[q.key] = q.type === 'yn' ? false : (q.required ? 'Not applicable.' : ''); }
  }
  if (unknown.length) skip(`Questions this script has no answer for (given a safe default): ${unknown.join(', ')}`);
  if (dryRun) { skip('Dry run \u2014 the plan would be confirmed with these answers:'); console.log(JSON.stringify(body, null, 2)); process.exit(0); }
  const plan = await api('POST', '/api/me/support-plan', body);
  if (plan.status !== 200) { bad(`Support plan refused: ${plan.data.error || plan.status}${plan.data.missing ? ' \u2014 missing: ' + plan.data.missing.join(', ') : ''}`); process.exit(1); }
  ok(`Support plan confirmed \u2014 version ${plan.data.plan.version}, continuity tier "${(plan.data.continuity || {}).label}", next review ${plan.data.plan.review_due}.`);

  /* 3. billing */
  const bill = await api('POST', '/api/me/billing', Object.assign({ confirm: true }, BILLING));
  if (bill.status === 200) ok(`Billing: self-managed, NDIS number ${BILLING.ndis_number}${v86 ? `, plan ${BILLING.plan_start} to ${BILLING.plan_end}` : ''}.`);
  else bad(`Billing refused: ${bill.data.error || bill.status}`);

  /* 4. the click agreements that are published */
  const file = await api('GET', '/api/me/participant-documents');
  const outstanding = (file.data.outstanding || []);
  if (leaveAgreements) skip(`Agreements left for you to click live: ${outstanding.filter(o => o.sign === 'click').map(o => o.label).join(', ') || 'none outstanding'}.`);
  for (const key of (leaveAgreements ? [] : AGREEMENTS)) {
    const row = outstanding.find(o => o.key === key);
    if (!row) { skip(`${key}: not outstanding (already agreed, or not on this version).`); continue; }
    if (row.sign !== 'click') { skip(`${key}: not a click agreement on this server.`); continue; }
    if (!row.template || (!row.template.has_file && !row.template.link)) { skip(`${row.label}: nothing published yet, so nothing to agree to \u2014 put the blank up under Admin \u203a Documents \u203a Blank forms.`); continue; }
    const acc = await api('POST', `/api/me/participant-documents/${key}/accept`, { agree: true });
    if (acc.status === 200) ok(`${row.label}: agreed on screen \u2014 ${acc.data.version_label || ('version ' + acc.data.version)}.`);
    else bad(`${row.label}: ${acc.data.error || acc.status}`);
  }

  /* 5. v86: who manages the account */
  if (v86) {
    const nom = await api('POST', '/api/me/nominee', { role: 'none', under_18: false });
    if (nom.status === 200) ok('Who manages this account: recorded as "nobody \u2014 I manage my own".');
    else bad(`Nominee: ${nom.data.error || nom.status}`);
  }

  /* 6. where it landed */
  const after = await api('GET', '/api/me/participant-documents');
  const d = after.data;
  console.log(`\nThe file now: ${d.held} of ${d.of} documents on file; ${d.yours_held} of ${d.yours_of} of theirs. Still outstanding: ${(d.outstanding || []).map(o => o.label).join(', ') || 'nothing'}.`);
  console.log('\nWhat to open on the day: /#/support-plan (the plan), /#/bookings (documents and billing cards), /#/account/documents (agreements list).');
  console.log('Nothing here touched the worker account, the admin boards or any real participant.\n');
})().catch(e => { bad(e.message); process.exit(1); });
