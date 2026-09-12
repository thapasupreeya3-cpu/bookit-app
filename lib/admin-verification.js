'use strict';
// The review workspace reuses the existing decision handlers and their eligibility checks.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const T = require('./booking-time');
module.exports = function mountVerification(c, workflow) {
  const {db, json, route} = c;
  const now = () => new Date().toISOString();
  const clean = (v, n=1000) => String(v ?? '').trim().slice(0,n);
  const fail = (res, message, status=400) => json(res,status,{error:message});
  const methods = {'sighted-original':'Sighted the original','sighted-copy':'Checked a copy','issuer-register':'Checked the issuing register','issuer-confirmed':'Confirmed with the issuer','other':'Other method — explain below'};
  db.exec(`CREATE TABLE IF NOT EXISTS verification_cases(user_id INTEGER PRIMARY KEY REFERENCES users(id),owner_id INTEGER REFERENCES users(id),due_date TEXT DEFAULT '',note TEXT DEFAULT '',updated_at TEXT NOT NULL,actor_id INTEGER);
    CREATE TABLE IF NOT EXISTS verification_activity(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),actor_id INTEGER,actor_name TEXT NOT NULL,action TEXT NOT NULL,subject TEXT DEFAULT '',created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS verification_activity_person ON verification_activity(user_id,id);`);
  const getPerson = id => db.prepare("SELECT id,name,role,email,phone,suburb,verified,created,plan,closed_at FROM users WHERE id=? AND role IN ('worker','participant') AND COALESCE(is_admin,0)=0 AND COALESCE(closed_at,'')=''").get(id);
  const staff = () => db.prepare("SELECT id,name FROM users WHERE is_admin=1 AND COALESCE(closed_at,'')='' ORDER BY name").all();
  function rawDocs(p) { return db.prepare(`SELECT * FROM ${p.role==='worker'?'worker_docs':'participant_docs'} WHERE ${p.role==='worker'?'worker_id':'participant_id'}=? ORDER BY id DESC`).all(p.id); }
  function evidenceRows(p) {
    // Link to an actual completion owned by this worker, never infer origin from
    // a title/category: uploaded orientation, first-aid and CPR remain documents.
    const issued=p.role==='worker'?new Set(db.prepare('SELECT doc_id FROM module_completions WHERE worker_id=? AND passed=1 AND doc_id IS NOT NULL').all(p.id).map(x=>x.doc_id)):new Set();
    return rawDocs(p).map(d=>{
    const out=(p.role==='worker'?c.docOut:c.pdocOut)(d),cat=(p.role==='worker'?c.docMap[d.doc_type]:c.pdocMap[d.form_key])||{};
    return {...out,evidence_origin:!d.file_path&&issued.has(d.id)?'platform-module':d.file_path?'uploaded-file':d.accepted_at?'recorded-agreement':'details-only',source_url:d.file_path?`/api/${p.role==='worker'?'documents':'participant-documents'}/${d.id}/file`:null,purpose:[cat.points?`${cat.points} identity points`:null,cat.primary?'Primary identity':null,cat.rtw?'Work rights':null,cat.requires].filter(Boolean).join(' · ')};
  }); }
  function documentRows(p) { return evidenceRows(p).filter(d=>d.evidence_origin!=='platform-module'); }
  function token(p) {
    const profile=p.role==='worker'?db.prepare('SELECT * FROM worker_profiles WHERE user_id=?').get(p.id):null;
    const plans=p.role==='participant'?db.prepare('SELECT * FROM support_plans WHERE participant_id=? AND current=1').all(p.id):[];
    const fields={last_action:db.prepare('SELECT MAX(id) AS id FROM verification_activity WHERE user_id=?').get(p.id).id,person:db.prepare('SELECT * FROM users WHERE id=?').get(p.id),profile,docs:rawDocs(p),plans,
      checks:db.prepare('SELECT * FROM recruitment_checks WHERE worker_id=? ORDER BY check_key').all(p.id),
      modules:db.prepare('SELECT id,completed_at,expires_at,passed FROM module_completions WHERE worker_id=? ORDER BY id').all(p.id),
      file:db.prepare('SELECT * FROM verification_cases WHERE user_id=?').get(p.id),
      assistance:db.prepare('SELECT id,result,status,decision,reviewed_at FROM document_assistance WHERE user_id=? ORDER BY id').all(p.id),followups:db.prepare('SELECT id,status,updated_at FROM verification_followups WHERE user_id=? ORDER BY id').all(p.id),requests:c.openRequests(p.role,p.id),privateReady:c.setting('private_billing_ready','off'),date:c.ymd()};
    // Only an opaque revision leaves the server; the underlying private fields never do.
    return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  }
  function summary(p) {
    const docs=documentRows(p),active=docs.filter(d=>!['rejected','superseded'].includes(d.review_state));
    const pending=active.filter(d=>!d.verified_at&&!d.accepted_at&&(d.has_file||d.accepted_at)),file=db.prepare('SELECT v.*,u.name AS owner_name FROM verification_cases v LEFT JOIN users u ON u.id=v.owner_id WHERE v.user_id=?').get(p.id)||{user_id:p.id,owner_id:null,due_date:'',note:''};
    const worker=p.role==='worker',profile=worker?db.prepare('SELECT visible,photo,self_paused,platform_block FROM worker_profiles WHERE user_id=?').get(p.id)||{}:null;
    const platform=worker?c.platformStatus(p.id):null, missing=worker?workflow.activationMissing(p.id):c.firstBookingBlockers(p.id,false);
    const tasks=worker?workflow.workerBlockers(p.id):missing.map(x=>({key:x.key,label:x.what,why:x.why,yours:x.yours,where:x.where}));
    const ready=worker?platform.ok&&!missing.length&&!!profile.photo&&!profile.self_paused&&!!p.verified:!missing.length;
    const safety=worker&&(platform.block?.on||profile.platform_block||['suspended','revoked','excluded'].includes(platform.screening?.status)||(platform.registers||[]).some(x=>x.result==='banned'));
    const plan=worker?null:c.confirmedPlan(p.id),planState=worker?null:c.planReviewState(p.id);
    const planReview=!!(plan&&(planState.awaiting_first_review||planState.changed_since_review||automation.planChanges(p)?.changes.length));
    let state=safety?'blocked':worker&&profile.visible&&platform.ok?'active':ready?'ready':pending.length||planReview||tasks.some(t=>t.yours===false&&t.key!=='activation')?'review':'waiting';
    // New evidence remains visible even for an already active worker.
    if(!safety&&(pending.length||planReview))state='review';
    const followupReview=!!db.prepare("SELECT 1 FROM verification_followups WHERE user_id=? AND status='needs-office'").get(p.id);
    if(followupReview&&!safety)state='review';
    const labels={blocked:'Needs attention',active:'Active',ready:worker?'Ready to activate':'Ready to book',review:'Office review',waiting:'Waiting on person'};
    const first=pending[0];
    const next=first?`Review ${first.type_label}`:planReview?'Review the confirmed support plan':safety?'Review the safety restriction':followupReview?'Follow up on the outstanding checklist':worker&&ready&&!profile.visible?'Make the activation decision':tasks.find(t=>t.yours===false&&t.key!=='activation')?.label||tasks.find(t=>t.key!=='activation')?.label||labels[state];
    const received=pending.map(d=>d.uploaded_at||d.created_at||d.doc_date).filter(Boolean).sort()[0]||null;
    return {id:p.id,name:p.name,role:p.role,email:p.email,suburb:p.suburb,email_confirmed:!!p.verified,demo:c.isDemoWorker(p.email),state,state_label:labels[state],ready,next,pending_count:pending.length,document_count:docs.length,received_at:received,case:file,tasks,platform,profile,missing,plan,planState,documents:docs,plan_review:planReview};
  }
  function detail(p) {
    const s=summary(p),worker=p.role==='worker',items=automation.candidates(p,s);
    return {...s,person:p,review_token:token(p),staff:staff(),automation:{candidates:items,followups:automation.followups(p,items)},plan_changes:automation.planChanges(p),assistance:automation.assistance(p),methods:worker?methods:c.pdocMethods,
      catalog:worker?Object.values(c.docMap):Object.values(c.pdocMap),
      requests:c.openRequests(p.role,p.id),training:worker?c.moduleState(p.id):null,
      training_certificates:worker?evidenceRows(p).filter(d=>d.evidence_origin==='platform-module'):[],
      recruitment:worker?db.prepare('SELECT * FROM recruitment_checks WHERE worker_id=? ORDER BY check_key').all(p.id):[],
      screening:worker?db.prepare('SELECT screening_outcome,screening_eligible,screening_expiry,screening_ref,screening_state,screening_app_number,nwsd_linked_at FROM worker_profiles WHERE user_id=?').get(p.id):null,
      participant_file:worker?null:c.participantFile(p.id),
      plan:!worker&&s.plan?{id:s.plan.id,version:s.plan.version,confirmed_at:s.plan.confirmed_at,reviewed_at:s.plan.reviewed_at,reviewed_by:s.plan.reviewed_by,url:`/api/admin/participants/${p.id}/plan`}:null,
      history:db.prepare('SELECT actor_name,action,subject,created_at FROM verification_activity WHERE user_id=? ORDER BY id DESC LIMIT 80').all(p.id)};
  }
  const automation=require('./verification-automation')(c,workflow,{summary,getPerson,staff,activity});
  const authorize=(u,res)=>c.requireAdmin(u,res);
  // Only this first-party shell may be framed by our own app. Uploaded file
  // responses keep DENY + sandbox; their existing endpoints authorise each read.
  route('GET', /^\/api\/document-viewer$/, (req,res,m,u)=>{
    if(!u)return fail(res,'Please log in.',401);
    const q=new URL(req.url,'http://local').searchParams,id=q.get('id');
    if(!['worker','participant','plan'].includes(q.get('scope'))||!/^\d+$/.test(id||'')||!Number.isSafeInteger(Number(id))||Number(id)<1)return fail(res,'Choose a worker or participant document.');
    if(q.get('scope')==='plan'&&!authorize(u,res))return;
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; frame-src 'none'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    res.end(fs.readFileSync(path.join(__dirname,'../public/document-viewer.html')));
  });
  route('GET', /^\/api\/admin\/verification\/settings$/, (req,res,m,u)=>{if(!authorize(u,res))return;json(res,200,automation.settings());});
  route('POST', /^\/api\/admin\/verification\/settings$/, (req,res,m,u,b)=>{if(!authorize(u,res))return;try{const result=automation.saveSettings(b||{},u);automation.tick();json(res,200,result);}catch(e){if(!e.status)throw e;fail(res,e.message,e.status);}});
  route('POST', /^\/api\/admin\/verification\/run$/, (req,res,m,u)=>{if(!authorize(u,res))return;json(res,200,automation.tick());});
  route('GET', /^\/api\/admin\/verification$/, (req,res,m,u)=>{
    if(!authorize(u,res))return;
    try{json(res,200,automation.queue(new URL(req.url,'http://local').searchParams,u));}catch(e){if(!e.status)throw e;fail(res,e.message,e.status);}
  });
  route('GET', /^\/api\/admin\/verification\/(\d+)$/, (req,res,m,u)=>{
    if(!authorize(u,res))return;const p=getPerson(Number(m[1]));if(!p)return fail(res,'This active participant or worker could not be found.',404);json(res,200,detail(p));
  });
  function activity(p,u,action,subject){db.prepare('INSERT INTO verification_activity(user_id,actor_id,actor_name,action,subject,created_at) VALUES(?,?,?,?,?,?)').run(p.id,u.id,u.name||u.email,action,clean(subject,250),now());}
  route('POST', /^\/api\/admin\/verification\/(\d+)\/action$/, async(req,res,m,u,b={},ip)=>{
    if(!authorize(u,res))return;const p=getPerson(Number(m[1]));if(!p)return fail(res,'This person is no longer available for review.',404);
    if(!b||typeof b!=='object'||Array.isArray(b))return fail(res,'Provide a review action and the current file revision.');
    if(typeof b.review_token!=='string'||b.review_token!==token(p))return fail(res,'This file changed after you opened it. Reload the current evidence before recording your decision. Your unsaved form remains on screen.',409);
    const action=clean(b.action,40),v=b.values&&typeof b.values==='object'&&!Array.isArray(b.values)?b.values:{};
    if(action==='assign'){
      const owner=v.owner_id?staff().find(x=>x.id===Number(v.owner_id)):null;
      if(v.owner_id&&!owner)return fail(res,'Choose a current office reviewer.');if(v.due_date&&!T.validDate(v.due_date))return fail(res,'Choose a real due date.');
      db.prepare('INSERT INTO verification_cases(user_id,owner_id,due_date,note,updated_at,actor_id) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET owner_id=excluded.owner_id,due_date=excluded.due_date,note=excluded.note,updated_at=excluded.updated_at,actor_id=excluded.actor_id,auto_assign=0').run(p.id,owner?.id||null,clean(v.due_date,10),clean(v.note,2000),now(),u.id);
      db.prepare('UPDATE verification_cases SET auto_assign=0 WHERE user_id=?').run(p.id);
      activity(p,u,'Review ownership updated',owner?.name||'Unassigned');return json(res,200,{ok:true});
    }
    try{
      if(action==='claim'){automation.claim(p,u);return json(res,200,{ok:true});}
      if(action==='request-checklist')return json(res,200,automation.startFollowup(p,v,u));
      if(action==='stop-followups'){if(v.confirm!==true)return fail(res,'Confirm stopping these follow-ups.');return json(res,200,automation.stopFollowup(p,v.id,u));}
      if(action==='review-suggestions')return json(res,200,automation.applyAssistance(p,v,u));
    }catch(e){if(!e.status)throw e;return fail(res,e.message,e.status);}
    const worker=p.role==='worker';let path,subject='',values={...v};
    if(['verify-document','return-document'].includes(action)){
      const d=documentRows(p).find(x=>x.id===Number(v.document_id));if(!d)return fail(res,'That document does not belong to this person.',403);
      if(v.confirm!==true)return fail(res,'Confirm that you reviewed this evidence.');
      subject=d.type_label;values.evidence_revision=d.evidence_revision;
      if(action==='verify-document'){
        if(!Object.hasOwn(worker?methods:c.pdocMethods,v.method))return fail(res,'Choose how you checked this document.');
        if(clean(v.note,400).length<10)return fail(res,'Record a short review note (at least 10 characters).');
        if(!d.has_file&&!d.accepted_at)return fail(res,'There is no uploaded file or recorded agreement to verify. Ask for the evidence first.',409);
        if(d.status==='expired'&&v.expired_ack!==true)return fail(res,'Acknowledge that this evidence is expired. Recording a review does not make it current or override eligibility.',409);
      }else if(clean(v.reason,400).length<10)return fail(res,'Explain what needs correcting and what the person should send (at least 10 characters).');
      if(v.due_date&&!T.validDate(v.due_date))return fail(res,'Choose a real due date.');
      path=`/api/admin/${worker?'documents':'participant-documents'}/${d.id}/${action==='verify-document'?'verify':'reject'}`;
    } else if(action==='request-document'){
      const catalog=worker?c.docMap:c.pdocMap,key=worker?v.doc_type:v.form_key;
      if(!Object.hasOwn(catalog,key))return fail(res,'Choose a document from this person’s checklist.');
      if(v.confirm!==true||clean(v.note,400).length<10)return fail(res,'Review the message and confirm sending the request.');
      if(v.due_date&&!T.validDate(v.due_date))return fail(res,'Choose a real due date.');
      if(c.openRequests(p.role,p.id).some(x=>x.doc_key===key))return fail(res,'A request for this document is already open. Check its existing message and due date.',409);
      subject=catalog[key].label;path=`/api/admin/${worker?'workers':'participants'}/${p.id}/request-document`;
    } else if(action==='screening'&&worker){
      if(v.confirm!==true||clean(v.note,300).length<10)return fail(res,'Record your source-check evidence and confirm the result.');
      if(v.expiry&&!T.validDate(v.expiry))return fail(res,'Choose a real clearance expiry date.');
      path=`/api/admin/screening/${p.id}`;subject='Worker screening database';
    } else if(action==='banning'&&worker){
      if(v.confirm!==true||!['result','aged_result','acqsc_result'].every(k=>['clear','banned','unchecked'].includes(v[k]))||clean(v.note,400).length<10)return fail(res,'Record each register separately and confirm what you checked.');
      path=`/api/admin/workers/${p.id}/banning`;subject='Banning registers';
    } else if(action==='recruitment'&&worker){
      if(v.confirm!==true)return fail(res,'Confirm the recruitment evidence.');values.worker_id=p.id;path='/api/admin/recruitment/checks';subject=clean(v.check_key,40);
    } else if(action==='review-plan'&&!worker){
      const plan=c.confirmedPlan(p.id);if(!plan||Number(v.plan_id)!==plan.id||v.confirm!==true)return fail(res,'Read and confirm the current support plan version.',409);
      path=`/api/admin/participants/${p.id}/plan-review`;subject=`Support plan v${plan.version}`;
    } else if(action==='activate'&&worker){
      const s=summary(p);if(!s.ready||s.profile.visible||v.confirm!==true)return fail(res,'Complete the outstanding eligibility checks and confirm the activation decision.',409);
      values={override:false};path=`/api/admin/workers/${p.id}/approve`;subject='Worker activation';
    } else return fail(res,'Choose an available review action.');
    const target=c.routes.find(r=>r.method==='POST'&&r.pattern.test(path));if(!target)return fail(res,'This review action is temporarily unavailable.',503);
    // Capture the established handler's response; do not bypass its validation or issue a second HTTP request.
    let status=500,body=null;const capture={writeHead(s){status=s;return this;},end(text){body=String(text||'');return this;}};
    await target.handler(req,capture,path.match(target.pattern),u,values,ip);
    let result;try{result=JSON.parse(body);}catch{return fail(res,'The review could not be completed. Reload and check the latest status.',500);}
    if(status>=200&&status<300){activity(p,u,{'verify-document':'Document verified','return-document':'Correction requested','request-document':'Document requested',screening:'Screening checked',banning:'Registers checked',recruitment:'Recruitment reviewed','review-plan':'Support plan reviewed',activate:'Worker activated'}[action],subject);workflow.sync(p.id);}
    json(res,status,result);
  });
  return {detail,token,tick:automation.tick};
};
