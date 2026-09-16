'use strict';
// Actual routes, a disposable database and synthetic identities. A preload
// blocks all external traffic, including payment, email and calendar services.
process.env.TZ = 'Australia/Sydney';
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..'), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'careweb-booking-mail-http-'));
const stamp = new Date().toISOString(), password = 'Copper-Rainstorm!82', results = [];
const home = { street: '41 Synthetic Private Lane', suburb: 'Ryde', state: 'NSW', postcode: '2112', arrival_notes: 'Synthetic private door instruction.' };
let child, db, base, log = '', owner, helper, worker;
const ins = (table, values) => Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
async function req(method, url, person, body, forId) {
  const r = await fetch(base + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(person?.cookie ? { Cookie: person.cookie } : {}), ...(forId ? { 'X-Bookit-For': String(forId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch {}
  return { status: r.status, text, data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
function ok(r, status = 200) { assert.equal(r.status, status, JSON.stringify(r.data) || r.text.slice(0, 200)); return r.data; }
async function test(name, fn) { try { await fn(); results.push({ name, result: 'PASS' }); console.log('PASS ' + name); } catch (error) { results.push({ name, result: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ' ' + error.stack); } }
async function register(label) {
  const email = 'booking-mail-' + label + '@example.test';
  const r = await req('POST', '/api/register', null, { role: 'participant', email, name: 'Synthetic booking email ' + label, password, suburb: 'Ryde NSW', plan: 'private', terms_accepted: true, terms_version: /const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(ROOT + '/server.js', 'utf8'))[1] });
  return { id: ok(r).user.id, cookie: r.cookie, email };
}
async function login(id) { const r = await req('POST', '/api/login', null, { email: db.prepare('SELECT email FROM users WHERE id=?').get(id).email, password: 'demo1234' }); ok(r); return { id, cookie: r.cookie }; }
function assertPrivateAbsent(value) { for (const secret of [home.street, home.arrival_notes]) assert.ok(!JSON.stringify(value).includes(secret), 'Exact address escaped into a booking email'); }

async function main() {
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); base = 'http://127.0.0.1:' + port;
  const guard = path.join(DIR, 'loopback-only.js');
  fs.writeFileSync(guard, `'use strict';
const local=value=>{const h=typeof value==='string'||value instanceof URL?new URL(value).hostname:(value.hostname||value.host||'');if(!['127.0.0.1','localhost','::1','[::1]'].includes(h))throw Error('Synthetic booking email test blocks external network');};
for(const name of ['node:http','node:https']){const m=require(name),request=m.request;m.request=function(...args){local(args[0]);return request.apply(this,args);};const get=m.get;m.get=function(...args){local(args[0]);return get.apply(this,args);};}
const fetch=global.fetch;global.fetch=function(input,...args){local(typeof input==='string'||input instanceof URL?input:input.url);return fetch.call(this,input,...args);};
`);
  const env = { ...require('../scripts/test-environment')(), PORT: String(port), BIND_HOST: '127.0.0.1', APP_URL: base, DB_PATH: path.join(DIR, 'test.db'), DOCS_DIR: path.join(DIR, 'docs'), PHOTOS_DIR: path.join(DIR, 'photos'), SECRET_FILE: path.join(DIR, 'secret'), SEED_DEMO: 'on', ADMIN_MFA_REQUIRED: 'off', TZ: 'Australia/Sydney' };
  child = spawn(process.execPath, ['--no-warnings', '--require', guard, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw Error(log); try { if ((await fetch(base + '/api/version')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  db = new DatabaseSync(env.DB_PATH); db.exec('PRAGMA busy_timeout=5000');
  owner = await register('owner'); helper = await register('helper');
  db.prepare("UPDATE users SET role='coordinator',verified=1 WHERE id=?").run(helper.id); db.prepare('UPDATE users SET verified=1 WHERE id=?').run(owner.id); db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  ins('account_links', { participant_id: owner.id, coordinator_id: helper.id, invite_email: helper.email, invite_token: 'synthetic-booking-email-link', scopes: '["bookings"]', status: 'active', invited_at: stamp });
  worker = await login(10);
  db.exec(`UPDATE users SET suburb='Ryde NSW' WHERE id=10;UPDATE worker_profiles SET visible=1,self_paused=0,days='[1,1,1,1,1,1,1]',service_areas='["Ryde NSW"]',availability_windows=NULL,leave_dates='[]',services='["daily-tasks","personal-care"]' WHERE user_id=10;UPDATE module_completions SET expires_at='2032-01-01' WHERE worker_id=10`);
  ok(await req('PUT', '/api/me/service-address', owner, { revision: 0, address: home }));


  db.prepare("UPDATE users SET email='booking-mail-worker@example.test' WHERE id=?").run(worker.id);
  for(const form_key of ['p-agreement','p-consent-privacy'])ins('participant_docs',{participant_id:owner.id,form_key,uploaded_at:stamp});
  const planId=ins('support_plans',{participant_id:owner.id,version:1,current:1,status:'confirmed',created:stamp,updated:stamp,confirmed_at:stamp,reviewed_at:stamp,reviewed_by:'Synthetic reviewer',review_due:'2031-12-31'});
  const noticeRows=(id,event)=>db.prepare("SELECT * FROM delivery_outbox WHERE event_key LIKE 'booking-notice:%' ORDER BY id").all().filter(r=>{const m=JSON.parse(r.payload)[8];return m?.booking_ids.includes(id)&&(!event||m.booking_event===event);});
  const proposed=date=>({worker_id:worker.id,date,start:'10:00',hours:2,service:'personal-care',service_location:{mode:'saved',source_revision:1}});
  let one,series,declined;
  await test('A real request queues an acknowledgement to participant and helper plus a worker request',async()=>{
    one=ok(await req('POST','/api/bookings',owner,proposed('2030-09-13'))).id;
    const rows=noticeRows(one,'requested');assert.deepEqual(rows.map(r=>r.user_id),[owner.id,helper.id,worker.id]);assert.ok(rows.every(r=>r.status==='queued'&&r.urgent===1));
    for(const r of rows)assertPrivateAbsent(JSON.parse(r.payload));
  });
  await test('Real worker acceptance queues participant-side confirmations only',async()=>{
    ok(await req('PATCH','/api/bookings/'+one,worker,{status:'accepted',plan_ack:true,plan_id:planId,plan_version:1}));
    assert.deepEqual(noticeRows(one,'accepted').map(r=>r.user_id),[owner.id,helper.id]);
  });
  await test('A real accepted booking appears immediately in each participant-side in-site inbox',async()=>{
    const own=ok(await req('GET','/api/me/booking-updates',owner));assert.equal(own.count,1);assert.equal(own.updates[0].booking_id,one);assert.equal(own.updates[0].destination,'#/journey?panel=shift&booking='+one);assertPrivateAbsent(own);
    assert.equal(ok(await req('GET','/api/me/booking-updates',owner)).count,1);
    assert.equal(ok(await req('GET','/api/me/booking-updates',helper,undefined,owner.id)).count,1);
    const ids=own.updates.map(row=>row.id);assert.equal(ok(await req('POST','/api/me/booking-updates/read',owner,{ids})).read,1);
    assert.equal(ok(await req('GET','/api/me/booking-updates',owner)).count,0);assert.equal(ok(await req('GET','/api/me/booking-updates',helper,undefined,owner.id)).count,1);
    assert.equal(ok(await req('POST','/api/me/booking-updates/read',owner,{ids})).read,0);assert.equal(ok(await req('GET','/api/me/booking-updates',worker)).count,0);
  });
  await test('Live helper revocation denies both confirmation access and acknowledgment',async()=>{
    const updates=ok(await req('GET','/api/me/booking-updates',helper,undefined,owner.id)).updates;
    db.prepare("UPDATE account_links SET status='revoked' WHERE participant_id=? AND coordinator_id=?").run(owner.id,helper.id);
    ok(await req('GET','/api/me/booking-updates',helper,undefined,owner.id),403);ok(await req('POST','/api/me/booking-updates/read',helper,{ids:updates.map(row=>row.id)},owner.id),403);
    db.prepare("UPDATE account_links SET status='active' WHERE participant_id=? AND coordinator_id=?").run(owner.id,helper.id);
  });
  await test('Moving an occurrence queues clear changed details and a fresh worker request',async()=>{
    ok(await req('PATCH','/api/bookings/'+one+'/occurrence',owner,{date:'2030-09-14',start:'11:00'}));
    const rows=noticeRows(one,'changed');assert.equal(rows.length,3);assert.equal(JSON.parse(rows.find(r=>r.user_id===worker.id).payload)[8].event_kind,'booking-request');assert.ok(rows.every(r=>r.urgent===1));
    assert.equal(ok(await req('GET','/api/me/booking-updates',helper,undefined,owner.id)).count,0);
  });
  await test('Real participant cancellation creates both participant and worker notices',async()=>{
    ok(await req('PATCH','/api/bookings/'+one,owner,{status:'cancelled',reason:'Synthetic changed plans'}));assert.deepEqual(noticeRows(one,'cancelled').map(r=>r.user_id),[owner.id,helper.id,worker.id]);
  });
  await test('Real worker decline sends participant-side updates',async()=>{
    declined=ok(await req('POST','/api/bookings',owner,proposed('2030-09-16'))).id;ok(await req('PATCH','/api/bookings/'+declined,worker,{status:'declined'}));assert.deepEqual(noticeRows(declined,'declined').map(r=>r.user_id),[owner.id,helper.id]);
  });
  await test('A repeating request and batch acceptance each send one grouped email per appropriate recipient',async()=>{
    series=ok(await req('POST','/api/bookings',owner,{...proposed('2030-09-20'),repeat:'weekly',repeat_count:2}));assert.equal(noticeRows(series.id,'requested').length,3);
    const review=ok(await req('GET','/api/journey/series/'+series.series_id,worker));ok(await req('POST','/api/journey/series/'+series.series_id+'/accept',worker,{ids:series.ids,revisions:Object.fromEntries(review.visits.map(v=>[v.id,v.revision])),plan_ack:true,plan_id:planId,plan_version:1}));assert.deepEqual(noticeRows(series.id,'accepted').map(r=>r.user_id),[owner.id,helper.id]);
    assert.deepEqual(ok(await req('GET','/api/me/booking-updates',owner)).updates.map(row=>row.booking_id).sort((a,b)=>a-b),series.ids.slice().sort((a,b)=>a-b));
  });
  await test('Changing a repeating booking sends an urgent update to each side',async()=>{
    ok(await req('PATCH','/api/series/'+series.series_id,owner,{start:'12:00'}));const rows=noticeRows(series.id,'changed');assert.equal(rows.length,3);assert.ok(rows.every(r=>r.urgent===1));
  });
  await test('Ending the series queues cancellation summaries for both sides',async()=>{
    const preview=ok(await req('GET','/api/journey/series/'+series.series_id+'/end-preview',owner));ok(await req('POST','/api/series/'+series.series_id+'/end',owner,{confirm:true,token:preview.token,expires:preview.expires}));const rows=noticeRows(series.id,'ended');assert.equal(rows.length,3);assert.ok(rows.every(r=>JSON.parse(r.payload)[8].booking_ids.length===2));
  });
  await test('A failed acceptance-event save rolls back the real booking mutation',async()=>{
    const id=ok(await req('POST','/api/bookings',owner,proposed('2030-10-01'))).id;
    db.exec(`CREATE TRIGGER synthetic_booking_update_failure BEFORE INSERT ON booking_acceptance_updates WHEN NEW.booking_id=${id} BEGIN SELECT RAISE(ABORT,'Synthetic acceptance persistence failure'); END;`);
    try{ok(await req('PATCH','/api/bookings/'+id,worker,{status:'accepted',plan_ack:true,plan_id:planId,plan_version:1}),500);assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'requested');assert.equal(noticeRows(id,'accepted').length,0);}
    finally{db.exec('DROP TRIGGER synthetic_booking_update_failure');}
    ok(await req('PATCH','/api/bookings/'+id,worker,{status:'accepted',plan_ack:true,plan_id:planId,plan_version:1}));assert.ok(ok(await req('GET','/api/me/booking-updates',owner)).updates.some(row=>row.booking_id===id));
  });
  await test('A replacement worker accepting cover creates the new participant confirmation',async()=>{
    const id=ok(await req('POST','/api/bookings',owner,proposed('2030-10-03'))).id;
    db.prepare("UPDATE bookings SET worker_id=2,status='accepted',accepted_at=?,cover_state='finding' WHERE id=?").run(stamp,id);
    const coverId=ins('cover',{booking_id:id,from_worker_id:2,reason:'Synthetic replacement acceptance',opened_at:stamp,tier:'pool',status:'open'});
    ins('cover_offers',{cover_id:coverId,tier:'pool',worker_id:worker.id,rank:1,sent_at:stamp,expires_at:new Date(Date.now()+3600000).toISOString()});
    ok(await req('POST','/api/cover/'+coverId+'/review',worker,{}));ok(await req('POST','/api/cover/'+coverId+'/claim',worker,{plan_ack:true,plan_id:planId,plan_version:1}));
    const update=ok(await req('GET','/api/me/booking-updates',owner)).updates.find(row=>row.booking_id===id);assert.ok(update);assert.equal(update.worker_name,db.prepare('SELECT name FROM users WHERE id=?').get(worker.id).name);assert.deepEqual(noticeRows(id,'accepted').map(r=>r.user_id),[owner.id,helper.id,worker.id]);
  });
  await test('An office assignment with recorded worker agreement also creates a confirmation',async()=>{
    const office=await login(1),id=ok(await req('POST','/api/bookings',owner,proposed('2030-10-05'))).id;
    db.prepare("UPDATE bookings SET worker_id=2,cover_state='office' WHERE id=?").run(id);
    ok(await req('POST','/api/admin/bookings/'+id+'/office-assign',office,{worker_id:worker.id,worker_agreed:true,consent_note:'Synthetic office spoke to worker and recorded their explicit agreement.',plan_read_confirmed:true,plan_id:planId,plan_version:1}));
    assert.ok(ok(await req('GET','/api/me/booking-updates',owner)).updates.some(row=>row.booking_id===id));assert.deepEqual(noticeRows(id,'accepted').map(r=>r.user_id),[owner.id,helper.id,worker.id]);
  });
  const shiftRows=(id,event)=>db.prepare('SELECT * FROM delivery_outbox WHERE booking_id=? ORDER BY id').all(id).filter(r=>r.event_kind==='shift-'+event);
  const makeFinishedBooking=(funding='private',extra={})=>{
    db.prepare('UPDATE users SET plan=? WHERE id=?').run(funding,owner.id);
    return ins('bookings',{participant_id:owner.id,worker_id:worker.id,service:'personal-care',date:'2026-09-01',start:'10:00',hours:2,status:'accepted',accepted_at:stamp,created:stamp,...extra});
  };
  const completion={status:'completed',note:'PRIVATE synthetic shift note: the agreed personal support was delivered and the participant outcome was recorded.'};
  let completedId;
  await test('Real self/private completion sends separate urgent completion and worker receipts alongside invoice',async()=>{
    completedId=makeFinishedBooking();const done=ok(await req('PATCH','/api/bookings/'+completedId,worker,completion));assert.ok(done.invoice_no);assert.equal(done.approval_state,'pending');
    assert.deepEqual(shiftRows(completedId,'review').map(r=>r.user_id),[owner.id,helper.id]);assert.deepEqual(shiftRows(completedId,'submitted').map(r=>r.user_id),[worker.id]);
    assert.equal(db.prepare('SELECT count(*) n FROM delivery_outbox WHERE event_key=?').get('invoice:'+done.invoice_no).n,1);
    for(const mail of [...shiftRows(completedId,'review'),...shiftRows(completedId,'submitted')]){assert.equal(mail.urgent,1);assert.doesNotMatch(mail.payload,/PRIVATE synthetic shift note/);assert.match(JSON.parse(mail.payload)[5],new RegExp('panel=shift&booking='+completedId));}
    ok(await req('PATCH','/api/bookings/'+completedId,worker,completion));assert.equal(shiftRows(completedId,'review').length,2);assert.equal(shiftRows(completedId,'submitted').length,1);
  });
  await test('Plan-managed and NDIA completion each notify reviewers without requiring an invoice',async()=>{
    for(const funding of ['plan','ndia']){const id=makeFinishedBooking(funding);const done=ok(await req('PATCH','/api/bookings/'+id,worker,completion));assert.equal(done.invoice_no,null);assert.deepEqual(shiftRows(id,'review').map(r=>r.user_id),[owner.id,helper.id]);assert.equal(shiftRows(id,'submitted').length,1);}
  });
  await test('A failed completion-email persistence rolls back status, shift note and billing submission together',async()=>{
    const id=makeFinishedBooking();db.exec(`CREATE TRIGGER synthetic_completion_mail_failure BEFORE INSERT ON delivery_outbox WHEN NEW.event_key LIKE 'shift-submitted:${id}:%' BEGIN SELECT RAISE(ABORT,'Synthetic mail persistence failure'); END;`);
    try{ok(await req('PATCH','/api/bookings/'+id,worker,completion),500);assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'accepted');assert.equal(db.prepare('SELECT count(*) n FROM shift_notes WHERE booking_id=?').get(id).n,0);assert.equal(db.prepare('SELECT count(*) n FROM immediate_invoice_submissions WHERE booking_id=?').get(id).n,0);assert.equal(shiftRows(id,'review').length,0);}
    finally{db.exec('DROP TRIGGER synthetic_completion_mail_failure');}
    ok(await req('PATCH','/api/bookings/'+id,worker,completion));assert.equal(shiftRows(id,'submitted').length,1);
  });
  await test('Real question, worker answer, approval and note addendum have private targeted notifications',async()=>{
    const question='PRIVATE QUERY please clarify the support timing and personal care record.';
    ok(await req('PATCH','/api/bookings/'+completedId,owner,{status:'queried',query_note:question}));assert.equal(shiftRows(completedId,'queried').length,1);assert.doesNotMatch(shiftRows(completedId,'queried')[0].payload,/PRIVATE QUERY/);const retried=ok(await req('PATCH','/api/bookings/'+completedId,owner,{status:'queried',query_note:question}));assert.equal(retried.duplicate,true);assert.equal(shiftRows(completedId,'queried').length,1);assert.equal(db.prepare("SELECT count(*) n FROM shift_notes WHERE booking_id=? AND kind='question'").get(completedId).n,1);
    ok(await req('POST','/api/bookings/'+completedId+'/notes',worker,{note:'PRIVATE ANSWER the original record is accurate and the support timing has been clarified.'}));assert.deepEqual(shiftRows(completedId,'answered').map(r=>r.user_id),[owner.id,helper.id]);assert.ok(shiftRows(completedId,'answered').every(r=>!r.payload.includes('PRIVATE ANSWER')&&r.urgent===1));
    ok(await req('PATCH','/api/bookings/'+completedId,owner,{status:'approved'}));assert.equal(shiftRows(completedId,'approved').length,1);ok(await req('PATCH','/api/bookings/'+completedId,owner,{status:'approved'}));assert.equal(shiftRows(completedId,'approved').length,1);
    ok(await req('POST','/api/bookings/'+completedId+'/notes',worker,{note:'A further factual clarification has been added to the original support record for review.'}));assert.equal(shiftRows(completedId,'note-added').length,2);
  });
  await test('Failed approval or question notification persistence leaves the prior review state unchanged',async()=>{
    const id=makeFinishedBooking('plan');ok(await req('PATCH','/api/bookings/'+id,worker,completion));
    for(const [event,status] of [['approved','approved'],['queried','queried']]){
      db.exec(`CREATE TRIGGER synthetic_review_mail_failure BEFORE INSERT ON delivery_outbox WHEN NEW.event_key LIKE 'shift-${event}:${id}:%' BEGIN SELECT RAISE(ABORT,'Synthetic review persistence failure'); END;`);
      try{ok(await req('PATCH','/api/bookings/'+id,owner,{status,query_note:'Please clarify this synthetic support record and recorded time.'}),500);assert.equal(db.prepare('SELECT approval_state FROM bookings WHERE id=?').get(id).approval_state,'pending');assert.equal(db.prepare("SELECT count(*) n FROM shift_notes WHERE booking_id=? AND kind='question'").get(id).n,0);}
      finally{db.exec('DROP TRIGGER synthetic_review_mail_failure');}
    }
    ok(await req('PATCH','/api/bookings/'+id,owner,{status:'queried',query_note:'Please clarify this synthetic support record and recorded time.'}));
    db.exec(`CREATE TRIGGER synthetic_answer_mail_failure BEFORE INSERT ON delivery_outbox WHEN NEW.event_key LIKE 'shift-answered:${id}:%' BEGIN SELECT RAISE(ABORT,'Synthetic answer persistence failure'); END;`);
    try{ok(await req('POST','/api/bookings/'+id+'/notes',worker,{note:'The requested details have been clarified in this synthetic answer to the question.'}),500);assert.equal(db.prepare('SELECT approval_state FROM bookings WHERE id=?').get(id).approval_state,'queried');assert.equal(db.prepare('SELECT count(*) n FROM shift_notes WHERE booking_id=? AND addendum=1').get(id).n,0);}
    finally{db.exec('DROP TRIGGER synthetic_answer_mail_failure');}
  });
  await test('Issued invoice review also persists worker notifications and deduplicates identical open questions',async()=>{
    const id=makeFinishedBooking(),done=ok(await req('PATCH','/api/bookings/'+id,worker,completion)),url='/api/payments/invoices/'+done.invoice_no;
    const review=async(action,query_note)=>{const shown=ok(await req('GET',url,owner));return req('POST',url+'/review',owner,{action,query_note,confirm:true,fingerprint:shown.review_fingerprint});};
    const question='Please confirm the recorded support timing before this invoice is approved.';
    ok(await review('query',question));assert.equal(shiftRows(id,'queried').length,1);ok(await review('query',question));assert.equal(shiftRows(id,'queried').length,1);assert.equal(db.prepare("SELECT count(*) n FROM shift_notes WHERE booking_id=? AND kind='question'").get(id).n,1);
    db.exec(`CREATE TRIGGER synthetic_invoice_review_mail_failure BEFORE INSERT ON delivery_outbox WHEN NEW.event_key LIKE 'shift-approved:${id}:%' BEGIN SELECT RAISE(ABORT,'Synthetic invoice approval notice failure'); END;`);
    try{ok(await review('approve'),409);assert.equal(db.prepare('SELECT approval_state FROM bookings WHERE id=?').get(id).approval_state,'queried');}
    finally{db.exec('DROP TRIGGER synthetic_invoice_review_mail_failure');}
    ok(await review('approve'));assert.equal(shiftRows(id,'approved').length,1);
  });
  await test('Real reminder and automatic approval queue urgent, deduplicated lifecycle notices',async()=>{
    const office=await login(1),id=makeFinishedBooking('plan',{status:'completed',completed_at:new Date(Date.now()-4*864e5).toISOString(),approval_state:'pending',approval_from:new Date(Date.now()-4*864e5).toISOString()});
    ok(await req('POST','/api/admin/approvals/sweep',office,{}));assert.equal(shiftRows(id,'reminder').length,2);assert.ok(shiftRows(id,'reminder').every(r=>r.urgent===1));ok(await req('POST','/api/admin/approvals/sweep',office,{}));assert.equal(shiftRows(id,'reminder').length,2);
    db.prepare('UPDATE bookings SET approval_from=? WHERE id=?').run(new Date(Date.now()-8*864e5).toISOString(),id);ok(await req('POST','/api/admin/approvals/sweep',office,{}));assert.deepEqual(shiftRows(id,'deemed').map(r=>r.user_id),[owner.id,helper.id,worker.id]);
  });
  await test('Meet-and-greet completion sends receipts without an invoice or payment prompt',async()=>{
    const id=makeFinishedBooking('private',{kind:'intro',hours:0.25});const done=ok(await req('PATCH','/api/bookings/'+id,worker,{status:'completed'}));assert.equal(done.invoice_no,null);assert.equal(shiftRows(id,'completed').length,2);assert.equal(shiftRows(id,'submitted').length,1);assert.equal(shiftRows(id,'review').length,0);
  });
  await test('Restarting on the upgraded database preserves confirmations and viewer acknowledgments',async()=>{
    const before=ok(await req('GET','/api/me/booking-updates',owner)),id=before.updates[0].id;
    ok(await req('POST','/api/me/booking-updates/read',owner,{ids:[id]}));
    const expected=ok(await req('GET','/api/me/booking-updates',owner)),stored=db.prepare('SELECT count(*) n FROM booking_acceptance_updates').get().n;
    const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;
    child=spawn(process.execPath,['--no-warnings','--require',guard,'server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
    let started=false;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok){started=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(started,'Upgraded server restarted');
    assert.deepEqual(ok(await req('GET','/api/me/booking-updates',owner)),expected);assert.equal(db.prepare('SELECT count(*) n FROM booking_acceptance_updates').get().n,stored);
    assert.equal(db.prepare('SELECT count(*) n FROM booking_acceptance_reads WHERE update_id=? AND viewer_id=?').get(id,owner.id).n,1);
  });
}
main().catch(error => { console.error(error); results.push({ name: 'HTTP fixture', result: 'FAIL', error: error.stack }); }).finally(async () => {
  if (db) db.close(); if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
  if (process.env.BOOKING_NOTIFICATION_HTTP_RESULTS) fs.writeFileSync(process.env.BOOKING_NOTIFICATION_HTTP_RESULTS, JSON.stringify({ runtime: process.version, scope: 'Disposable synthetic accounts; external network blocked', results, serverLog: log }, null, 2));
  fs.rmSync(DIR, { recursive: true, force: true }); console.log(`booking notification HTTP: ${results.filter(r => r.result === 'PASS').length}/${results.length} passed`); if (results.some(r => r.result === 'FAIL')) process.exitCode = 1;
});
