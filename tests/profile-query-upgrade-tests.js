'use strict';
// Optional current-update acceptance test. The baseline is an explicit trusted
// local Git revision, never a downloaded executable or a production database.
// PROFILE_QUERY_UPGRADE_BASELINE=ed82772 node tests/profile-query-upgrade-tests.js
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..'),revision=process.env.PROFILE_QUERY_UPGRADE_BASELINE||'ed82772';
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'careweb-profile-query-upgrade-')),BASE=path.join(DIR,'baseline'),DB=path.join(DIR,'synthetic.db'),docs=path.join(DIR,'uploads'),photos=path.join(DIR,'photos');
const results=[],boots=[],files=[],password='Upgrade-Copper-Rainstorm!82',secret=crypto.randomBytes(48).toString('base64');
const targetVersion=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;
let child,db,base,log='',admin,participant,worker,queriedNo,paidNo,expected,baselineCommit,photoBytes;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function ins(table,values){return Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values)).lastInsertRowid);}
async function request(method,url,actor,body){const r=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json',...(actor?.cookie?{Cookie:actor.cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)}),bytes=Buffer.from(await r.arrayBuffer());let data;try{data=JSON.parse(bytes);}catch{}return{status:r.status,data,bytes,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
function ok(r,status=200){assert.equal(r.status,status,JSON.stringify(r.data)||r.bytes.toString().slice(0,300));return r.data;}
async function register(role,label){const terms=/const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(BASE,'server.js'),'utf8'))[1];const r=await request('POST','/api/register',null,{role,email:label+'@example.test',name:'Synthetic '+label,password,suburb:'Ryde NSW',plan:'self',services:['personal-care'],terms_accepted:true,terms_version:terms});return{id:ok(r).user.id,email:label+'@example.test',cookie:r.cookie};}
async function start(source,label){
 log='';const listener=http.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));base='http://127.0.0.1:'+port;
 // Allowlist environment: no inherited email, card, bank, cloud or AI credentials.
 const env={PATH:process.env.PATH,PORT:String(port),BIND_HOST:'127.0.0.1',APP_URL:base,DB_PATH:DB,DOCS_DIR:docs,PHOTOS_DIR:photos,SECRET_FILE:path.join(DIR,'secret'),SESSION_SECRET:secret,SEED_DEMO:'off',AUTO_REPLY:'off',TZ:'Australia/Sydney',ADMIN_MFA_REQUIRED:'on'};
 child=spawn(process.execPath,['--no-warnings','--require',path.join(DIR,'local-only.js'),'server.js'],{cwd:source,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
 let ready;for(let i=0;i<150;i++){try{const r=await fetch(base+'/api/version');if(r.ok){ready=await r.json();break;}}catch{}if(child.exitCode!==null)throw Error('Server boot failed: '+log);await wait(100);}
 if(!ready)throw Error('Local server did not become ready: '+log);boots.push({label,version:ready});db=new DatabaseSync(DB);db.exec('PRAGMA busy_timeout=5000');return ready;
}
async function stop(){if(db){db.close();db=null;}if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}child=null;}
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(error){results.push({name,result:'FAIL',error:error.stack});throw error;}}
function state(){return{
 users:db.prepare('SELECT * FROM users WHERE id IN (?,?,?) ORDER BY id').all(admin.id,participant.id,worker.id),
 bookings:db.prepare('SELECT * FROM bookings ORDER BY id').all(),
 snapshots:db.prepare('SELECT * FROM invoice_snapshots ORDER BY invoice_no').all(),
 payments:db.prepare('SELECT * FROM invoice_payment_evidence ORDER BY id').all(),
 collection:db.prepare('SELECT * FROM payment_invoice_access ORDER BY invoice_no').all(),
 notes:db.prepare('SELECT * FROM shift_notes ORDER BY id').all(),
 documents:db.prepare('SELECT * FROM worker_docs ORDER BY id').all(),
 sessions:db.prepare('SELECT * FROM sessions WHERE user_id IN (?,?,?) ORDER BY id').all(admin.id,participant.id,worker.id).map(({last_seen,...rest})=>rest)
};}
function integrity(){assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}
function unchanged(){assert.deepEqual(state(),expected,'Upgrade must not change existing account, invoice, query, payment, upload or session records');for(const f of files)assert.equal(sha(fs.readFileSync(f.path)),f.sha256,f.relative);integrity();}
async function issued(start){const stamp=new Date().toISOString(),id=ins('bookings',{participant_id:participant.id,worker_id:worker.id,service:'personal-care',date:'2026-09-11',start,hours:2,status:'completed',created:stamp,completed_at:stamp,approval_from:stamp,approval_state:'approved',approval_source:'participant',approved_by:participant.id,rate_category:'weekday-day',unit_price:73.58,total:147.16});ok(await request('POST','/api/admin/claims/run',admin,{}));const no=db.prepare('SELECT invoice_no FROM bookings WHERE id=?').get(id).invoice_no;assert.ok(no);return{id,no};}
(async()=>{try{
 fs.writeFileSync(path.join(DIR,'local-only.js'),`const local=x=>{const host=typeof x==='string'||x instanceof URL?new URL(x).hostname:x.hostname||x.host||'';if(!['127.0.0.1','localhost','::1','[::1]'].includes(host))throw Error('Upgrade test blocks external network');};for(const name of ['node:http','node:https']){const m=require(name),r=m.request,g=m.get;m.request=function(...a){local(a[0]);return r.apply(this,a);};m.get=function(...a){local(a[0]);return g.apply(this,a);};}const tls=require('node:tls'),tc=tls.connect;tls.connect=function(...a){local(typeof a[0]==='object'?a[0]:{host:a[1]});return tc.apply(this,a);};const f=global.fetch;global.fetch=function(x,...a){local(typeof x==='string'||x instanceof URL?x:x.url);return f.call(this,x,...a);};`);
 await test('Trusted v88.4.5 Git revision extracts into an isolated source tree',()=>{
  assert.match(revision,/^[a-f0-9]{7,40}$/,'Supply an explicit local commit hash');const commit=spawnSync('git',['rev-parse','--verify',revision+'^{commit}'],{cwd:ROOT,encoding:'utf8'});assert.equal(commit.status,0,commit.stderr);baselineCommit=commit.stdout.trim();
  const archive=path.join(DIR,'baseline.zip'),zip=spawnSync('git',['archive','--format=zip','--output='+archive,baselineCommit],{cwd:ROOT,encoding:'utf8'});assert.equal(zip.status,0,zip.stderr);fs.mkdirSync(BASE);
  const extract=spawnSync('python3',['-c',"import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[2]).resolve()\nwith zipfile.ZipFile(sys.argv[1]) as z:\n for e in z.infolist():\n  out=(root/e.filename).resolve()\n  if not out.is_relative_to(root): raise ValueError('Unsafe archive path')\n  if ((e.external_attr>>16)&0o170000)==0o120000: raise ValueError('Archive symlink refused')\n z.extractall(root)\n",archive,BASE],{encoding:'utf8'});assert.equal(extract.status,0,extract.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8')).version,'88.4.5');
 });
 await test('Baseline creates synthetic sign-ins, photo/document uploads, issued invoices, a query and payment evidence',async()=>{
  assert.match(process.version,/^v22\./);await start(BASE,'baseline');assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='account_email_changes'").get().n,0);
  admin=await register('participant','upgrade-office');participant=await register('participant','upgrade-participant');worker=await register('worker','upgrade-worker');const stamp=new Date().toISOString();db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(admin.id);ins('mfa',{user_id:admin.id,secret:'JBSWY3DPEHPK3PXP',enabled:1,created:stamp,confirmed_at:stamp});db.prepare('UPDATE sessions SET mfa_verified_at=? WHERE user_id=?').run(stamp,admin.id);
  photoBytes=fs.readFileSync(path.join(BASE,'public/assets/careweb/favicon-32.png'));const file={name:'synthetic-upgrade.png',mime:'image/png',data:photoBytes.toString('base64')};ok(await request('POST','/api/me/photo',participant,{file}));ok(await request('POST','/api/me/documents',worker,{doc_type:'resume',file}));
  const query=await issued('10:00');queriedNo=query.no;const detail=ok(await request('GET','/api/payments/invoices/'+queriedNo,participant));ok(await request('POST','/api/payments/invoices/'+queriedNo+'/review',participant,{action:'query',query_note:'Please explain the finish time recorded for this synthetic shift.',fingerprint:detail.review_fingerprint,confirm:true}));assert.equal(db.prepare('SELECT approval_state FROM bookings WHERE id=?').get(query.id).approval_state,'queried');assert.ok(db.prepare('SELECT paused_at FROM payment_invoice_access WHERE invoice_no=?').get(queriedNo).paused_at);
  const paid=await issued('13:00');paidNo=paid.no;ins('invoice_payment_evidence',{invoice_no:paidNo,reference:'synthetic-upgrade-part-payment',amount:25,recorded_by:admin.id,recorded_at:stamp,note:'Synthetic pre-upgrade partial payment.',state:'recorded'});
  for(const dir of [docs,photos])for(const filename of fs.readdirSync(dir)){const full=path.join(dir,filename);if(fs.statSync(full).isFile())files.push({path:full,relative:path.relative(DIR,full),sha256:sha(fs.readFileSync(full)),bytes:fs.statSync(full).size});}assert.ok(files.length>=2);expected=state();assert.equal(expected.snapshots.length,2);assert.equal(expected.payments.length,1);integrity();await stop();
 });
 await test('First current-release boot adds an empty email-change table and preserves all existing records and bytes',async()=>{
  const version=await start(ROOT,'upgrade-first');assert.equal(version.APP_VERSION,targetVersion);assert.equal(db.prepare('SELECT count(*) n FROM account_email_changes').get().n,0);unchanged();
 });
 await test('Existing sessions remain usable and the queried invoice is actionable without unpausing payment',async()=>{
  for(const actor of [admin,participant,worker])assert.equal(ok(await request('GET','/api/me',actor)).user.id,actor.id);
  const email=ok(await request('GET','/api/me/email',participant));assert.equal(email.email,participant.email);assert.equal(email.pending,null);const query=ok(await request('GET','/api/admin/invoices/'+queriedNo+'/query',admin));assert.equal(query.state,'needs-reply');assert.equal(query.can_reply,true);assert.ok(query.history.some(n=>n.kind==='question'));const detail=ok(await request('GET','/api/payments/invoices/'+queriedNo,participant));assert.equal(detail.can_pay,false);assert.equal(detail.paid,0);const received=ok(await request('GET','/api/payments/invoices/'+paidNo,participant));assert.equal(received.paid,25);const photo=await request('GET','/photos/'+participant.id,participant);assert.equal(photo.status,200);assert.deepEqual(photo.bytes,photoBytes);unchanged();await stop();
 });
 await test('Second current-release boot is idempotent and does not reset queries, payments, uploads or active sessions',async()=>{
  await start(ROOT,'upgrade-second');assert.equal(db.prepare('SELECT count(*) n FROM account_email_changes').get().n,0);unchanged();assert.equal(ok(await request('GET','/api/me/email',participant)).email,participant.email);assert.equal(ok(await request('GET','/api/admin/invoices/'+queriedNo+'/query',admin)).state,'needs-reply');unchanged();
 });
}finally{
 const report={runtime:process.version,baseline_version:'88.4.5',baseline_commit:baselineCommit||null,target_version:targetVersion,scope:'Two upgrades of a disposable synthetic v88.4.5 database; external network blocked; no inherited provider credentials.',boots,results,uploads:files.map(({relative,sha256,bytes})=>({relative,sha256,bytes})),preserved_snapshot_hashes:(expected?.snapshots||[]).map(s=>({invoice_no:s.invoice_no,sha256:sha(s.data)})),status:results.some(r=>r.result==='FAIL')?'FAIL':'PASS'};await stop();if(process.env.PROFILE_QUERY_UPGRADE_RESULTS)fs.writeFileSync(process.env.PROFILE_QUERY_UPGRADE_RESULTS,JSON.stringify(report,null,2)+'\n');fs.rmSync(DIR,{recursive:true,force:true});console.log('Profile/query upgrade: '+results.filter(r=>r.result==='PASS').length+'/'+results.length+' passed');
}})().catch(error=>{console.error(error);process.exitCode=1;});
