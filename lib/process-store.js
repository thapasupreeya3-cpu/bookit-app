'use strict';
const crypto=require('node:crypto'),fs=require('node:fs');
const parse=(s,d={})=>{try{return JSON.parse(s);}catch{return d;}};
const now=()=>new Date().toISOString(),hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
module.exports=function createStore(c){
 const {db}=c;
 const deliveryHooks={};
 const schemas=[
 `CREATE TABLE IF NOT EXISTS journey_tasks(task_key TEXT PRIMARY KEY,user_id INTEGER NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,detail TEXT DEFAULT '',destination TEXT NOT NULL,scope TEXT DEFAULT '',owner_kind TEXT NOT NULL,owner_id INTEGER,state TEXT NOT NULL DEFAULT 'ready',created_at TEXT NOT NULL,ready_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,due_at TEXT,version INTEGER DEFAULT 1)`,
 `CREATE TABLE IF NOT EXISTS journey_events(id INTEGER PRIMARY KEY,user_id INTEGER,task_kind TEXT NOT NULL,event TEXT NOT NULL,event_key TEXT NOT NULL UNIQUE,at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS delivery_outbox(id INTEGER PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,user_id INTEGER,kind TEXT NOT NULL DEFAULT '',recipient TEXT NOT NULL,payload TEXT NOT NULL,access_stamp TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER DEFAULT 0,next_at TEXT NOT NULL,created_at TEXT NOT NULL,sent_at TEXT,error TEXT DEFAULT '',lease_until TEXT,expires_at TEXT,urgent INTEGER DEFAULT 0)`,
 `CREATE TABLE IF NOT EXISTS invoice_snapshots(invoice_no TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS journey_intake(user_id INTEGER PRIMARY KEY,revision INTEGER DEFAULT 0,data TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS recruitment_checks(worker_id INTEGER NOT NULL,check_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',evidence TEXT DEFAULT '',reviewer_id INTEGER,reviewed_at TEXT,PRIMARY KEY(worker_id,check_key))`,
 `CREATE TABLE IF NOT EXISTS interview_slots(id INTEGER PRIMARY KEY,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,owner_id INTEGER NOT NULL,worker_id INTEGER UNIQUE,status TEXT DEFAULT 'open',revision INTEGER DEFAULT 1)`,
 `CREATE TABLE IF NOT EXISTS journey_preferences(user_id INTEGER PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS approval_owners(participant_id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS calendar_tokens(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,participant_id INTEGER,token_hash TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT)`,
 `CREATE TABLE IF NOT EXISTS calendar_events(booking_id INTEGER PRIMARY KEY,signature TEXT NOT NULL,sequence INTEGER NOT NULL,changed_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS booking_routines(id INTEGER PRIMARY KEY,participant_id INTEGER NOT NULL,label TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS payroll_batches(id INTEGER PRIMARY KEY,from_date TEXT NOT NULL,to_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL,created_by INTEGER NOT NULL,approved_by INTEGER,approved_at TEXT,exported_at TEXT,external_ref TEXT DEFAULT '',acknowledged_at TEXT,acknowledged_by INTEGER)`,
 `CREATE TABLE IF NOT EXISTS payroll_lines(id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL REFERENCES payroll_batches(id),source_key TEXT UNIQUE NOT NULL,worker_id INTEGER NOT NULL,data TEXT NOT NULL,amount REAL NOT NULL,status TEXT NOT NULL DEFAULT 'draft',exception TEXT DEFAULT '',resolution TEXT DEFAULT '',external_ref TEXT DEFAULT '')`,
 `CREATE TABLE IF NOT EXISTS journey_followups(booking_id INTEGER PRIMARY KEY,participant_id INTEGER NOT NULL,answer TEXT NOT NULL,note TEXT DEFAULT '',created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS journey_transitions(id INTEGER PRIMARY KEY,participant_id INTEGER NOT NULL,kind TEXT NOT NULL,ref INTEGER,reason TEXT NOT NULL,state TEXT DEFAULT 'open',owner_id INTEGER,created_at TEXT NOT NULL,completed_at TEXT)`,
 `CREATE TABLE IF NOT EXISTS document_assistance(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,doc_id INTEGER NOT NULL,result TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'review',created_at TEXT NOT NULL,decision TEXT,reviewed_at TEXT)`
 ,`CREATE TABLE IF NOT EXISTS pipeline_stage_times(user_id INTEGER PRIMARY KEY,stage TEXT NOT NULL,entered_at TEXT NOT NULL)`
 ,`CREATE TABLE IF NOT EXISTS invoice_payment_evidence(id INTEGER PRIMARY KEY,invoice_no TEXT NOT NULL,reference TEXT UNIQUE NOT NULL,amount REAL NOT NULL,recorded_by INTEGER NOT NULL,recorded_at TEXT NOT NULL,note TEXT NOT NULL)`
 ]; schemas.forEach(sql=>db.exec(sql));
 for(const [table,col,definition]of [['support_plans','revision','INTEGER NOT NULL DEFAULT 1'],['incidents','booking_id','INTEGER'],['incidents','event_key',"TEXT DEFAULT ''"],['journey_tasks','due_override','INTEGER DEFAULT 0'],['journey_events','duration_ms','INTEGER DEFAULT 0']])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(x=>x.name===col))db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
 db.exec('CREATE INDEX IF NOT EXISTS delivery_due ON delivery_outbox(status,next_at); CREATE INDEX IF NOT EXISTS journey_task_owner ON journey_tasks(owner_kind,state,user_id); CREATE INDEX IF NOT EXISTS journey_event_time ON journey_events(at)');
 function event(uid,kind,action,key){db.prepare('INSERT OR IGNORE INTO journey_events(user_id,task_kind,event,event_key,at) VALUES(?,?,?,?,?)').run(uid||null,kind,action,key,now());}
 function preferences(uid){return {digest:false,quiet_from:'',quiet_to:'',...parse(db.prepare('SELECT data FROM journey_preferences WHERE user_id=?').get(uid)?.data)};}
 function accessStamp(uid){const u=db.prepare('SELECT role,closed_at,email FROM users WHERE id=?').get(uid);if(!u)return '';return hash({u,links:u.role==='coordinator'?db.prepare("SELECT id,participant_id,scopes,status,revoked_at FROM account_links WHERE coordinator_id=? ORDER BY id").all(uid):[]});}
 function enqueueMail(args){
   const [to,subject,heading,body,cta,url,reply,attachments,meta={}]=args;const dest=String(to||'').trim().toLowerCase();
   if(!dest||/@demo\.(bookit\.life|thecareweb\.com\.au)$/.test(dest))return Promise.resolve('skipped-demo');
   const user=db.prepare('SELECT id FROM users WHERE lower(email)=?').get(dest),uid=meta.user_id||user?.id||null;
   const urgent=meta.kind==='invoice'||meta.transactional===true||meta.event_kind==='booking-request'||meta.event_kind==='visit-changed'||(meta.response_deadline&&Date.parse(meta.response_deadline)<=Date.now()+24*36e5)||['security','compliance','cover'].includes(meta.kind)||/new booking request|cover|incident|confirm your email|password|screening|clearance|invitation/i.test(subject);
   const payload=[dest,subject,heading,body,cta,url,reply,(attachments||[]).map(a=>({...a,buffer:undefined,base64:Buffer.from(a.buffer).toString('base64')}))];
   const stamp=uid?accessStamp(uid):'';const key=meta.event_key||hash({payload,day:/INV-\d/.test(subject)?'invoice':now().slice(0,10)});
   payload.push(meta);
   const p=uid?preferences(uid):{};let next=new Date();
   if(!urgent&&p.digest){next.setHours(8,0,0,0);if(next<=new Date())next.setDate(next.getDate()+1);}
   db.prepare('INSERT OR IGNORE INTO delivery_outbox(event_key,user_id,kind,recipient,payload,access_stamp,next_at,created_at,urgent,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(key,uid,meta.kind||'',dest,JSON.stringify(payload),stamp,next.toISOString(),now(),urgent?1:0,meta.expires_at||null);
   return Promise.resolve('queued');
 }
 function suppress(row){
   if(row.expires_at&&row.expires_at<=now())return 'expired';
   const args=parse(row.payload,[]),meta=args[8]||{};
   if(row.event_key?.startsWith('invoice:')&&api.invoiceDeliveryInvalid?.(row.event_key.slice(8)))return 'Invoice withdrawn or no longer active';
   if(meta.verification_followup&&deliveryHooks.verification){const why=deliveryHooks.verification(row,args);if(why)return why;}
   if(meta.event_kind==='booking-request'){const booking=db.prepare('SELECT status,worker_id FROM bookings WHERE id=?').get(meta.booking_id);if(!booking||booking.status!=='requested'||booking.worker_id!==row.user_id)return 'booking request resolved or reassigned';}
   if(meta.requires_approval&&db.prepare('SELECT approval_state FROM bookings WHERE id=?').get(meta.booking_id)?.approval_state!=='pending')return 'task completed or queried';
   try{const link=new URL(args[5]);if(link.pathname==='/cover'&&link.searchParams.has('o')){const offer=db.prepare('SELECT o.*,c.status AS cover_status FROM cover_offers o JOIN cover c ON c.id=o.cover_id WHERE o.id=?').get(Number(link.searchParams.get('o')));if(!offer||offer.response||offer.cover_status!=='open'||offer.expires_at<=now())return 'cover offer no longer available';}}catch{}

   if(!row.user_id)return '';
   const u=db.prepare('SELECT role,closed_at FROM users WHERE id=?').get(row.user_id);
   if(!u||u.closed_at||accessStamp(row.user_id)!==row.access_stamp)return 'access changed';
   if(row.kind!=='invoice'&&row.kind&&c.mailPrefs(row.user_id)[row.kind]===false)return 'notification preference';
   return '';
 }
 async function drain(){
   if(!c.emailOn())return {disabled:true,queued:db.prepare("SELECT count(*) n FROM delivery_outbox WHERE status IN ('queued','retry')").get().n};
   db.prepare("UPDATE delivery_outbox SET status='retry',lease_until=NULL WHERE status='sending' AND lease_until<?").run(now());
   const rows=db.prepare("SELECT * FROM delivery_outbox WHERE status IN ('queued','retry') AND next_at<=? ORDER BY urgent DESC,id LIMIT 100").all(now());let sent=0,failed=0;const done=new Set();
   for(const row of rows){
     if(done.has(row.id))continue;
     const pref=row.user_id?preferences(row.user_id):{};
     let group=(!row.urgent&&pref.digest&&!parse(row.payload,[])[7]?.length)?rows.filter(x=>!done.has(x.id)&&!x.urgent&&x.user_id===row.user_id&&x.recipient===row.recipient&&!parse(x.payload,[])[7]?.length):[row];
     group=group.filter(x=>{done.add(x.id);const why=suppress(x);if(why){db.prepare("UPDATE delivery_outbox SET status='cancelled',error=?,payload='[]' WHERE id=?").run(why,x.id);return false;}return true;});
     if(!group.length)continue;
     const hh=new Date().toTimeString().slice(0,5);
     if(!row.urgent&&pref.quiet_from&&pref.quiet_to&&(pref.quiet_from<pref.quiet_to?hh>=pref.quiet_from&&hh<pref.quiet_to:hh>=pref.quiet_from||hh<pref.quiet_to)){for(const x of group)db.prepare('UPDATE delivery_outbox SET next_at=? WHERE id=?').run(new Date(Date.now()+15*60000).toISOString(),x.id);continue;}
     group=group.filter(x=>db.prepare("UPDATE delivery_outbox SET status='sending',lease_until=?,attempts=attempts+1 WHERE id=? AND status IN ('queued','retry')").run(new Date(Date.now()+120000).toISOString(),x.id).changes);
     if(!group.length)continue;
     try{let args=parse(group[0].payload,[]);args[7]=(args[7]||[]).map(a=>({...a,buffer:Buffer.from(a.base64,'base64')}));
       if(!row.urgent&&pref.digest&&!args[7].length)args=[row.recipient,'Your Care Web daily updates','Your next actions',`<p>You have ${group.length} routine updates. Open your next actions to see what still needs attention.</p>`,'Open next actions',c.baseUrl({headers:{}})+'/#/journey'];
       await c.sendMailDirect(...args);for(const x of group)db.prepare("UPDATE delivery_outbox SET status='sent',sent_at=?,error='',lease_until=NULL,payload='[]' WHERE id=?").run(now(),x.id);sent+=group.length;
     }catch(e){for(const x of group){const attempts=x.attempts+1;db.prepare("UPDATE delivery_outbox SET status=?,next_at=?,error=?,lease_until=NULL WHERE id=?").run(attempts>=5&&x.kind!=='invoice'?'failed':'retry',new Date(Date.now()+(x.kind==='invoice'?Math.min(3600000,15000*2**Math.min(attempts,8)):row.urgent?15000:Math.min(3600000,30000*2**attempts))).toISOString(),String(e.message).slice(0,300),x.id);failed++;}}
   }
   return {sent,failed};
 }
 function storeInvoice(inv){if(inv)db.prepare('INSERT OR IGNORE INTO invoice_snapshots(invoice_no,data,created_at) VALUES(?,?,?)').run(inv.invoice_no,JSON.stringify(inv),now());}
 function invoiceSnapshot(no){const r=db.prepare('SELECT data FROM invoice_snapshots WHERE invoice_no=?').get(no);if(!r)return null;const inv=parse(r.data,null);if(!inv)return null;const rows=db.prepare('SELECT id,claim_status,paid_at,pay_url,total,active_extra_total,km_total,status FROM bookings WHERE invoice_no=?').all(no);if(!rows.length)return null;const paid=rows.every(r=>r.claim_status==='paid');const legacyPaid=paid?inv.total:Math.round(rows.filter(r=>r.claim_status==='paid').reduce((n,r)=>n+(r.total||0)+(r.active_extra_total||0)+(r.status==='cancelled'?0:(r.km_total||0)),0)*100)/100;const ledger=api.paymentBalance?.(no,inv.total,legacyPaid);return {...inv,paid:ledger?.paid??(paid?inv.total:0),balance:ledger?.balance??(paid?0:inv.total),paid_at:paid?rows[0].paid_at:'',pay_url:rows[0].pay_url||''};}
 function bookingAllowed(req,u,b,scope='bookings'){return !!(u&&(u.admin||(u.role==='worker'?b.worker_id===u.id:c.actFor(req,u,scope)?.id===b.participant_id)));}
 function duplicateDocument(uid,type,buf){const digest=hash(buf);for(const d of db.prepare("SELECT id,file_path FROM worker_docs WHERE worker_id=? AND doc_type=? AND review_state<>'rejected'").all(uid,type))try{if(d.file_path&&hash(fs.readFileSync(d.file_path))===digest)return d.id;}catch{}return null;}
 function approvalRecipients(pid,people){const owner=db.prepare('SELECT user_id FROM approval_owners WHERE participant_id=?').get(pid)?.user_id;return owner&&people.some(p=>p.id===owner)?people.filter(p=>p.id===owner):people;}
 function workerBlockers(uid){
   const u=db.prepare('SELECT * FROM users WHERE id=?').get(uid),p=db.prepare('SELECT * FROM worker_profiles WHERE user_id=?').get(uid);if(!u||!p)return [];
   const tasks=[];const add=(key,label,yours,where,why='',blocking=true,due=null)=>tasks.push({key,section:key.startsWith('training')?'training':'credentials',label,yours,where,why,blocking,due});
   if(!u.verified)add('verify-email','Confirm your email address',true,'#/account');
   if(!p.photo)add('photo','Add your profile photo',true,'#/account/profile');
   const docs=db.prepare("SELECT * FROM worker_docs WHERE worker_id=? AND COALESCE(review_state,'')<>'rejected'").all(uid);
   const issued=new Set(db.prepare('SELECT doc_id FROM module_completions WHERE worker_id=? AND passed=1 AND doc_id IS NOT NULL').all(uid).map(d=>d.doc_id));
   const current=docs.filter(d=>(d.file_path||issued.has(d.id))&&(!d.expiry_date||d.expiry_date>=c.ymd())&&d.review_state!=='superseded');
   const types=[...new Set(current.map(d=>d.doc_type))].map(key=>c.docMap[key]||{});
   const points=types.reduce((n,t)=>n+(t.points||0),0);
   const sum={id_ok:types.some(t=>t.primary)&&points>=100,id_points:points,right_to_work:types.some(t=>t.rtw)};
   if(!sum.id_ok)add('identity','Complete your identity documents',true,'#/account/credentials',`${sum.id_points} of 100 identity points on file`);
   if(!sum.right_to_work)add('right-to-work','Add your work-rights evidence',true,'#/account/credentials');
   for(const key of ['ndis-screening','ndis-orientation','first-aid','cpr']){
     const list=current.filter(d=>d.doc_type===key);const good=list.find(d=>d.verified_at);
     if(!list.length)add('upload-'+key,'Add current '+(c.docMap[key]?.label||key),true,'#/account/credentials?type='+key);
     else if(!good)add('verify-'+key,'Office review: '+(c.docMap[key]?.label||key),false,'#/journey', 'Received; awaiting verification');
   }
   if(!current.some(d=>d.doc_type==='resume'))add('resume','Add your resume / CV',true,'#/account/credentials?type=resume','Add your resume to the document checklist.',false);
   if(!p.visible&&!p.self_paused)for(const key of ['interview','references','employment'])if(db.prepare('SELECT status FROM recruitment_checks WHERE worker_id=? AND check_key=?').get(uid,key)?.status!=='complete')add('recruit-'+key,'Office review: '+key,false,'#/journey?panel=recruitment','The office records the evidence and outcome.');
   const st=c.platformStatus(uid);
   if(st.screening?.status!=='cleared')add('screening-status','Office confirms screening status',false,'#/journey');
   for(const r of st.registers||[])if(r.result!=='clear'||r.age_days===null||r.age_days>c.banningWindowDays())add('register-'+r.key,'Office check: '+r.short,false,'#/journey');
   for(const m of c.moduleState(uid).modules.filter(m=>m.required&&(!m.done||m.overdue_days>0)))add('training-'+m.key,m.title,true,'#/account/training','Complete or renew this module',m.overdue_days>=14,m.expires_at?m.expires_at.slice(0,10)+'T23:59:59Z':null);
   if(!p.visible&&!p.self_paused)add('activation','Office activation decision',false,'#/journey',st.blocks.join(' '));
   if(p.self_paused)add('paused','Your profile is paused for new work',true,'#/account','Existing eligible shifts can still be completed.',false);
   return tasks;
 }
 function activationMissing(uid){
   const p=db.prepare('SELECT visible FROM worker_profiles WHERE user_id=?').get(uid);if(p?.visible)return [];
   const checks=['interview','references','employment'];const missing=[];
   for(const key of checks)if(db.prepare('SELECT status FROM recruitment_checks WHERE worker_id=? AND check_key=?').get(uid,key)?.status!=='complete')missing.push(key+' review');
   const docs=db.prepare("SELECT DISTINCT doc_type FROM worker_docs WHERE worker_id=? AND verified_at IS NOT NULL AND verified_at<>'' AND COALESCE(review_state,'')='approved' AND (expiry_date IS NULL OR expiry_date='' OR expiry_date>=?)").all(uid,c.ymd()).map(d=>c.docMap[d.doc_type]||{});
   if(!docs.some(d=>d.primary)||docs.reduce((n,d)=>n+(d.points||0),0)<100)missing.push('verified identity evidence');if(!docs.some(d=>d.rtw))missing.push('verified work-rights evidence');
   for(const key of ['first-aid','ndis-orientation'])if(!db.prepare("SELECT id FROM worker_docs WHERE worker_id=? AND doc_type=? AND verified_at IS NOT NULL AND verified_at<>'' AND COALESCE(review_state,'')<>'rejected' AND (expiry_date='' OR expiry_date IS NULL OR expiry_date>=?)").get(uid,key,c.ymd()))missing.push('verified '+key);
   return missing;
 }
 function projection(uid){
   const u=db.prepare('SELECT * FROM users WHERE id=?').get(uid);if(!u||u.closed_at||u.is_admin||u.role==='coordinator'||c.isDemoWorker(u.email))return [];
   const out=[],add=(key,kind,label,owner,destination,detail='',scope='',due=null)=>out.push({task_key:`${uid}:${key}`,user_id:uid,kind,label,owner_kind:owner,destination,detail,scope,due_at:due});
   if(u.role==='participant'){
     for(const b of c.firstBookingBlockers(uid,true))add('setup:'+b.key,'setup',b.what,b.yours?'person':'office',b.where,b.why,b.section==='billing'?'invoices':b.section==='support-plan'?'plan':'documents');
     for(const kind of ['intro','shift']){
       const first=db.prepare("SELECT id,kind,date FROM bookings WHERE participant_id=? AND status='completed' AND kind=? ORDER BY date,id LIMIT 1").get(uid,kind);
       if(first&&!db.prepare('SELECT 1 FROM journey_followups WHERE booking_id=?').get(first.id)&&!db.prepare("SELECT 1 FROM complaints WHERE resolved_at IS NULL AND (lower(COALESCE(source_name,''))=lower(?) OR lower(COALESCE(source_email,''))=lower(?))").get(u.name,u.email)&&!db.prepare("SELECT 1 FROM journey_transitions WHERE participant_id=? AND state='open'").get(uid))add('followup:'+first.id,'followup',kind==='intro'?'How did your first meeting go?':'How did your first visit go?','person',`#/journey?panel=followup&booking=${first.id}`,'Choose whether to continue or ask for a change.','bookings');
     }
   }else{
     for(const b of workerBlockers(uid))if(b.key!=='paused'&&!b.key.startsWith('recruit-'))add('setup:'+b.key,'setup',b.label,b.yours?'person':'office',b.where,b.why,'',b.due);
     if(!db.prepare('SELECT (visible OR self_paused) AS ready FROM worker_profiles WHERE user_id=?').get(uid)?.ready)for(const key of ['interview','references','employment'])if(db.prepare('SELECT status FROM recruitment_checks WHERE worker_id=? AND check_key=?').get(uid,key)?.status!=='complete')add('recruit:'+key,'recruitment',key[0].toUpperCase()+key.slice(1)+' review','office','#/journey?panel=recruitment','Your application stays visible here while the office reviews it.');
   }
   const col=u.role==='worker'?'worker_id':'participant_id';
   for(const b of db.prepare(`SELECT * FROM bookings WHERE ${col}=? AND (status IN ('requested','accepted') OR (status='completed' AND approval_state IN ('pending','queried'))) ORDER BY date,id`).all(uid)){
     const date=b.date+' '+b.start;
     if(u.role==='worker'&&b.status==='requested')add('accept:'+b.id,'booking','Review visit '+date,'person',`#/journey?panel=shift&booking=${b.id}`,'Review before accepting.','',c.bookingStart(b).toISOString());
     if(u.role==='worker'&&b.status==='accepted'&&c.bookingEnd(b)<new Date())add('complete:'+b.id,'shift','Finish visit '+date,'person',`#/journey?panel=shift&booking=${b.id}`,'Record actual support and the outcome.');
     if(b.status==='completed'&&((u.role==='participant'&&b.approval_state==='pending')||(u.role==='worker'&&b.approval_state==='queried')))add('review:'+b.id,'review',b.approval_state==='queried'?'Answer a timesheet question':'Review timesheet '+date,'person',`#/journey?panel=shift&booking=${b.id}`,'','bookings');
     if(['office','uncovered','failed'].includes(b.cover_state))add('cover:'+b.id,'cover','Cover needs attention '+date,'office',`#/journey?panel=shift&booking=${b.id}`,'Contact the participant and resolve staffing.','bookings',c.bookingStart(b).toISOString());
   }
   const table=u.role==='worker'?'worker_docs':'participant_docs',idcol=u.role==='worker'?'worker_id':'participant_id';
   for(const d of db.prepare(`SELECT * FROM ${table} WHERE ${idcol}=? AND COALESCE(review_state,'') NOT IN ('rejected','superseded')`).all(uid)){
     const key=d.doc_type||d.form_key,label=(u.role==='worker'?c.docMap[key]:c.pdocMap[key])?.label||d.label||key;
     if(!d.verified_at&&d.file_path)add('doc-review:'+d.id,'document',`Review received ${label}`,'office','#/admin/compliance','Received '+String(d.uploaded_at||'').slice(0,10),'documents');
     if(d.expiry_date&&d.expiry_date<=c.ymd(new Date(Date.now()+60*864e5))) {
       const replacement=db.prepare(`SELECT id FROM ${table} WHERE ${idcol}=? AND ${u.role==='worker'?'doc_type':'form_key'}=? AND id<>? AND expiry_date>? AND COALESCE(review_state,'')<>'rejected'`).get(uid,key,d.id,d.expiry_date);
       if(!replacement)add('renew:'+d.id,'renewal','Renew '+label,'person',u.role==='worker'?'#/account/credentials?type='+key:'#/account/documents','Expires '+d.expiry_date,'documents',d.expiry_date+'T23:59:59Z');
     }
   }
   for(const r of c.openRequests(u.role,uid))add('request:'+r.id,'document',r.label,'person',u.role==='worker'?'#/account/credentials?type='+r.doc_key:'#/account/documents',r.note,'documents',r.due_date?r.due_date+'T23:59:59Z':null);
   for(const t of db.prepare("SELECT * FROM journey_transitions WHERE participant_id=? AND state='open'").all(uid))add('transition:'+t.id,'transition','Agree '+t.kind.replaceAll('-',' '),'office','#/journey?panel=transitions',t.reason,'bookings');
   return out;
 }
 function sync(uid){
   const list=projection(uid),keys=new Set(list.map(x=>x.task_key)),stamp=now();
   for(const t of list){const old=db.prepare('SELECT * FROM journey_tasks WHERE task_key=?').get(t.task_key);
     if(!old){db.prepare('INSERT INTO journey_tasks(task_key,user_id,kind,label,detail,destination,scope,owner_kind,created_at,ready_at,updated_at,due_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(t.task_key,t.user_id,t.kind,t.label,t.detail,t.destination,t.scope,t.owner_kind,stamp,stamp,stamp,t.due_at);event(uid,t.kind,'ready',t.task_key+':ready:'+stamp);}
     else {const reopen=old.state==='completed';db.prepare("UPDATE journey_tasks SET label=?,detail=?,destination=?,scope=?,owner_kind=?,due_at=CASE WHEN due_override=1 THEN due_at ELSE ? END,updated_at=?,state=CASE WHEN state='completed' THEN 'ready' ELSE state END,completed_at=NULL,ready_at=CASE WHEN state='completed' THEN ? ELSE ready_at END,version=version+? WHERE task_key=?").run(t.label,t.detail,t.destination,t.scope,t.owner_kind,t.due_at,stamp,stamp,reopen?1:0,t.task_key);if(reopen)event(uid,t.kind,'ready',t.task_key+':ready:'+stamp);}
   }
   for(const old of db.prepare("SELECT * FROM journey_tasks WHERE user_id=? AND state<>'completed'").all(uid))if(!keys.has(old.task_key)){db.prepare("UPDATE journey_tasks SET state='completed',completed_at=?,updated_at=? WHERE task_key=?").run(stamp,stamp,old.task_key);event(uid,old.kind,'completed',old.task_key+':complete:'+old.version);}
   return db.prepare("SELECT * FROM journey_tasks WHERE user_id=? AND state<>'completed' ORDER BY CASE owner_kind WHEN 'person' THEN 0 ELSE 1 END,COALESCE(due_at,'9999'),ready_at").all(uid);
 }
 function syncOffice(){
   const owner=db.prepare("SELECT id FROM users WHERE is_admin=1 AND COALESCE(closed_at,'')='' ORDER BY id LIMIT 1").get();if(!owner)return;
   const rows=[],add=(key,kind,label,dest,detail='',due=null)=>rows.push({key:'office:'+key,kind,label,dest,detail,due});
   for(const d of db.prepare("SELECT id,kind,status,error,next_at FROM delivery_outbox WHERE status IN ('failed','retry')").all())add('delivery:'+d.id,'delivery','Resolve message delivery', '#/journey?panel=deliveries',d.error,d.next_at);
   for(const j of db.prepare("SELECT job,last_error FROM job_runs WHERE COALESCE(last_error,'')<>''").all())add('job:'+j.job,'job','Investigate '+j.job,'#/admin/operations',j.last_error);
   for(const b of db.prepare("SELECT id,status FROM payroll_batches WHERE status IN ('draft','approved','exported')").all())add('payroll:'+b.id,'payroll','Review pay batch #'+b.id,'#/journey?panel=payroll&batch='+b.id,b.status);
   for(const p of db.prepare("SELECT id,invoice_no,note FROM invoice_payment_evidence WHERE state='exception'").all())add('receipt:'+p.id,'invoice','Reconcile payment for '+p.invoice_no,'#/journey?panel=finance',p.note);
   for(const i of db.prepare("SELECT id,notify_due,commission_notified_at,report_due,report_filed_at FROM incidents WHERE status<>'closed'").all())add('incident:'+i.id,'incident','Follow up incident #'+i.id,'#/admin/compliance','Review the incident register.',!i.commission_notified_at?i.notify_due:!i.report_filed_at?i.report_due:null);
   for(const t of [...(api.verificationOfficeTasks?.()||[]),...(api.launchOfficeTasks?.()||[])])add(t.key,t.kind,t.label,t.dest,t.detail,t.due);
   const keys=new Set(rows.map(x=>x.key));for(const t of rows){const old=db.prepare('SELECT * FROM journey_tasks WHERE task_key=?').get(t.key);if(!old){db.prepare("INSERT INTO journey_tasks(task_key,user_id,kind,label,detail,destination,owner_kind,created_at,ready_at,updated_at,due_at) VALUES(?,?,?,?,?,?,'office',?,?,?,?)").run(t.key,owner.id,t.kind,t.label,t.detail,t.dest,now(),now(),now(),t.due);event(owner.id,t.kind,'ready',t.key+':'+now());}else {const reopen=old.state==='completed',at=now();db.prepare("UPDATE journey_tasks SET label=?,detail=?,destination=?,state='ready',ready_at=CASE WHEN state='completed' THEN ? ELSE ready_at END,version=version+?,completed_at=NULL,updated_at=?,due_at=CASE WHEN due_override=1 THEN due_at ELSE ? END WHERE task_key=?").run(t.label,t.detail,t.dest,at,reopen?1:0,at,t.due,t.key);if(reopen)event(owner.id,t.kind,'ready',t.key+':ready:'+at);}}
   for(const t of db.prepare("SELECT * FROM journey_tasks WHERE task_key LIKE 'office:%' AND state<>'completed'").all())if(!keys.has(t.task_key)){db.prepare("UPDATE journey_tasks SET state='completed',completed_at=?,updated_at=? WHERE task_key=?").run(now(),now(),t.task_key);event(t.user_id,t.kind,'completed',t.task_key+':complete:'+t.version);}
 }
 function syncAll(){for(const u of db.prepare("SELECT id FROM users WHERE role IN ('participant','worker') AND COALESCE(closed_at,'')='' AND is_admin=0").all())sync(u.id);syncOffice();return {open:db.prepare("SELECT count(*) n FROM journey_tasks WHERE state<>'completed'").get().n};}

 function stageTime(uid,stage){const old=db.prepare('SELECT * FROM pipeline_stage_times WHERE user_id=?').get(uid);if(old?.stage===stage)return old.entered_at;const at=now();db.prepare('INSERT INTO pipeline_stage_times(user_id,stage,entered_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET stage=excluded.stage,entered_at=excluded.entered_at').run(uid,stage,at);event(uid,'pipeline','stage-entered','stage:'+uid+':'+stage+':'+at);return at;}
 function renewalNeeded(scope,uid,d){const table=scope==='worker'?'worker_docs':'participant_docs',owner=scope==='worker'?'worker_id':'participant_id',key=scope==='worker'?'doc_type':'form_key';if(['rejected','superseded'].includes(d.review_state))return false;return !db.prepare(`SELECT 1 FROM ${table} WHERE ${owner}=? AND ${key}=? AND id<>? AND expiry_date>? AND COALESCE(review_state,'') NOT IN ('rejected','superseded')`).get(uid,d[key],d.id,d.expiry_date||'');}
 function closePersonal(uid){
   api.closeVerification?.(uid);
   db.prepare('DELETE FROM calendar_feed_events WHERE feed_id IN (SELECT id FROM calendar_tokens WHERE user_id=? OR participant_id=?)').run(uid,uid);
   for(const [table,col]of [['journey_tasks','user_id'],['journey_events','user_id'],['journey_intake','user_id'],['journey_preferences','user_id'],['document_assistance','user_id'],['pipeline_stage_times','user_id'],['recruitment_checks','worker_id'],['booking_routines','participant_id']])db.prepare(`DELETE FROM ${table} WHERE ${col}=?`).run(uid);
   db.prepare('DELETE FROM calendar_tokens WHERE user_id=? OR participant_id=?').run(uid,uid);db.prepare('DELETE FROM approval_owners WHERE user_id=? OR participant_id=?').run(uid,uid);
   db.prepare("UPDATE interview_slots SET worker_id=NULL,status=CASE WHEN starts_at>? THEN 'open' ELSE 'finished' END,revision=revision+1 WHERE worker_id=?").run(now(),uid);
   db.prepare("UPDATE delivery_outbox SET status='cancelled',payload='[]',recipient='',access_stamp='',error='Account closed',lease_until=NULL WHERE user_id=?").run(uid);
 }
 function cleanup(){db.prepare("DELETE FROM delivery_outbox WHERE status IN ('sent','cancelled') AND created_at<?").run(new Date(Date.now()-90*864e5).toISOString());return syncAll();}
 const api={deliveryHooks,closePersonal,event,preferences,accessStamp,enqueueMail,drain,storeInvoice,invoiceSnapshot,bookingAllowed,duplicateDocument,approvalRecipients,workerBlockers,activationMissing,sync,syncAll,cleanup,stageTime,renewalNeeded,parse,hash,now};
 return api;
};
