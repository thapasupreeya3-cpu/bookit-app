'use strict';
const crypto=require('node:crypto'),fs=require('node:fs');
const T=require('./booking-time'),AV=require('./worker-availability');
module.exports=function mount(c,w){
 const {db,json,route}=c,{parse,hash,now}=w;
 const fail=(res,message,status=400)=>json(res,status,{error:message});
 const person=(req,u,scope)=>u?.role==='participant'?u:c.actFor(req,u,scope);
 const admin=u=>!!u?.admin;
 function add(method,rx,fn){route(method,rx,async(req,res,m,u,b={})=>{if(!u&&!String(req.url).startsWith('/api/calendar/'))return fail(res,'Please log in.',401);return fn(req,res,m,u,b);});}
 function tx(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
 const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
 function ownBooking(req,u,id,scope='bookings'){const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(Number(id));return b&&w.bookingAllowed(req,u,b,scope)?b:null;}
 function peopleForTask(u,req){if(admin(u))return null;if(u.role==='coordinator'){const p=person(req,u,null);return p?[p.id]:[];}return [u.id];}
 add('GET',/^\/api\/journey$/,(req,res,m,u)=>{
   const ids=peopleForTask(u,req);if(ids&&ids.length===0)return fail(res,'Choose the person you support.',403);
   if(!ids)w.syncAll();else ids.forEach(w.sync);
   let tasks=ids?db.prepare("SELECT * FROM journey_tasks WHERE user_id=? AND state<>'completed'").all(ids[0]):db.prepare("SELECT t.*,u.name AS person,u.role AS person_role FROM journey_tasks t JOIN users u ON u.id=t.user_id WHERE t.state<>'completed' ORDER BY COALESCE(t.due_at,'9999'),t.ready_at LIMIT 1000").all();
   if(u.role==='coordinator'){const scopes=c.linkScopes(c.activeLink(u.id,ids[0]));tasks=tasks.filter(t=>!t.scope||scopes.includes(t.scope));}
   const uid=ids?.[0]||u.id;
   const scopes=u.role==='coordinator'?c.linkScopes(c.activeLink(u.id,uid)):null;
   const next=scopes&&!scopes.includes('bookings')?[]:db.prepare(`SELECT id,date,start,hours,status,service,worker_id,participant_id FROM bookings WHERE ${u.role==='worker'?'worker_id':'participant_id'}=? AND date>=? AND status IN ('accepted','requested') ORDER BY date,start LIMIT 5`).all(uid,c.ymd());
   json(res,200,{tasks,next:next.map(b=>({...b,starts_at:c.bookingStart(b).toISOString(),ends_at:c.bookingEnd(b).toISOString(),other_name:db.prepare('SELECT name FROM users WHERE id=?').get(u.role==='worker'?b.participant_id:b.worker_id)?.name||''})),today:c.ymd(),as_of:now(),scopes,subject:ids?{id:uid,name:db.prepare('SELECT name FROM users WHERE id=?').get(uid)?.name}:null,role:admin(u)?'office':u.role,preferences:w.preferences(u.id),summary:{do_now:tasks.filter(t=>t.owner_kind==='person').length,office:tasks.filter(t=>t.owner_kind==='office').length}});
 });
 add('GET',/^\/api\/me\/action-alerts$/,(req,res,m,u)=>{
   const ids=peopleForTask(u,req);if(ids&&ids.length===0)return fail(res,'Choose the person you support.',403);
   if(!ids)w.syncAll();else ids.forEach(w.sync);
   let tasks=ids?db.prepare("SELECT * FROM journey_tasks WHERE user_id=? AND state<>'completed' AND owner_kind='person' AND kind<>'followup'").all(ids[0]):db.prepare("SELECT * FROM journey_tasks WHERE state<>'completed' AND owner_kind='office'").all();
   if(u.role==='coordinator'){const scopes=c.linkScopes(c.activeLink(u.id,ids[0]));tasks=tasks.filter(t=>!t.scope||scopes.includes(t.scope));}
   const today=c.ymd();tasks.sort((a,b)=>String(a.due_at||'9999').localeCompare(String(b.due_at||'9999'))||a.ready_at.localeCompare(b.ready_at));
   // The badge counts actionable groups, the same way the Next actions page groups checklists.
   const group=t=>{if(admin(u))return t.task_key;const dest=t.destination||'';if(dest.startsWith('#/account/credentials'))return 'credentials';if(dest.startsWith('#/account/training'))return 'training';return dest||t.task_key;};
   json(res,200,{count:new Set(tasks.map(group)).size,tasks:tasks.map(t=>({...t,overdue:!!t.due_at&&String(t.due_at).slice(0,10)<today})),today,as_of:now(),role:admin(u)?'office':u.role});
 });
 add('POST',/^\/api\/journey\/events$/,(req,res,m,u,b)=>{
   const task=db.prepare('SELECT * FROM journey_tasks WHERE task_key=?').get(clean(b.task_key,100));
   if(!task||(!admin(u)&&task.user_id!==person(req,u,task.scope)?.id&&task.user_id!==u.id))return fail(res,'Not your task.',403);
   if(!['started','resumed','failed','effort','saved','submitted','returned'].includes(b.event))return fail(res,'Choose a valid task event.');
   const key=`${task.task_key}:${b.event}:${clean(b.event_key,70)}`;if(db.prepare('SELECT 1 FROM journey_events WHERE event_key=?').get(key))return json(res,200,{ok:true,duplicate:true});const previous=b.event==='started'&&db.prepare("SELECT 1 FROM journey_events WHERE user_id=? AND event IN ('started','resumed') AND instr(event_key,?)=1 LIMIT 1").get(u.id,task.task_key+':');w.event(u.id,task.kind,previous?'resumed':b.event,key);if(b.event==='effort')db.prepare('UPDATE journey_events SET duration_ms=? WHERE event_key=?').run(Math.min(60000,Math.max(0,Number(b.duration_ms)||0)),key);json(res,200,{ok:true});
 });
 add('GET',/^\/api\/admin\/journey-queue$/,(req,res,m,u)=>{
   w.syncAll();const q=new URL(req.url,'http://x').searchParams;const offset=Math.max(0,Number(q.get('offset'))||0),search=clean(q.get('q'),80);
   const page=require('./task-queue').queue(db,{view:q.get('view'),search,offset,today:c.ymd(),as_of:now()});
   const staff=db.prepare("SELECT id,name FROM users WHERE is_admin=1 AND COALESCE(closed_at,'')=''").all();json(res,200,{...page,staff});
 });
 add('PATCH',/^\/api\/admin\/journey-tasks$/,(req,res,m,u,b)=>{
   const t=db.prepare('SELECT * FROM journey_tasks WHERE task_key=?').get(clean(b.task_key,100));if(!t)return fail(res,'Task not found.',404);
   if(t.owner_kind==='person')return fail(res,'This task belongs to the person. Office assignment is available for office actions only.',409);
   const owner=b.owner_id?db.prepare("SELECT id FROM users WHERE id=? AND is_admin=1 AND COALESCE(closed_at,'')=''").get(Number(b.owner_id)):null;if(b.owner_id&&!owner)return fail(res,'Choose an active office owner.');
   const due=b.due_at?new Date(b.due_at):null;if(due&&!Number.isFinite(+due))return fail(res,'Choose a real due date.');
   db.prepare('UPDATE journey_tasks SET owner_id=?,due_at=?,due_override=1,updated_at=? WHERE task_key=?').run(owner?.id||null,due?.toISOString()||null,now(),t.task_key);w.event(u.id,t.kind,'assigned',`${t.task_key}:assigned:${now()}`);json(res,200,{ok:true});
 });
 add('GET',/^\/api\/journey\/renewals$/,(req,res,m,u)=>{
   const p=u.role==='worker'?u:person(req,u,'documents');if(!p)return fail(res,'Document permission required.',403);const worker=u.role==='worker',table=worker?'worker_docs':'participant_docs',owner=worker?'worker_id':'participant_id',limit=c.ymd(new Date(Date.now()+60*864e5));
   const bookings=db.prepare(`SELECT id,date,start,hours,status FROM bookings WHERE ${worker?'worker_id':'participant_id'}=? AND status IN ('requested','accepted') AND date>=? ORDER BY date,start`).all(p.id,c.ymd());
   const rows=db.prepare(`SELECT * FROM ${table} WHERE ${owner}=? AND expiry_date<>'' AND expiry_date<=? AND COALESCE(review_state,'') NOT IN ('rejected','superseded') ORDER BY expiry_date`).all(p.id,limit).filter(d=>w.renewalNeeded(worker?'worker':'participant',p.id,d)).map(d=>({id:d.id,label:(worker?c.docMap[d.doc_type]:c.pdocMap[d.form_key])?.label||d.label,expires:d.expiry_date,kind:'document',destination:worker?'#/account/credentials?type='+d.doc_type:'#/account/documents',affected:bookings.filter(b=>b.date>=d.expiry_date)}));
   if(worker)for(const m of c.moduleState(p.id).modules.filter(m=>m.required&&m.expires_at&&m.expires_at<=limit))rows.push({id:m.key,label:m.title,expires:m.expires_at,kind:'training',destination:'#/account/training',affected:bookings.filter(b=>b.date>=m.expires_at)});
   json(res,200,{rows,received:db.prepare(`SELECT id,${worker?'doc_type':'form_key'} AS type,expiry_date FROM ${table} WHERE ${owner}=? AND COALESCE(verified_at,'')='' AND COALESCE(review_state,'') NOT IN ('rejected','superseded')`).all(p.id)});
 });
 add('GET',/^\/api\/journey\/intake$/,(req,res,m,u)=>{
   const p=u.role==='worker'?u:person(req,u,'plan');if(!p)return fail(res,'Plan permission required.',403);
   const account=c.sessionUser(p.id),r=db.prepare('SELECT * FROM journey_intake WHERE user_id=?').get(p.id),plan=c.confirmedPlan(p.id);
   json(res,200,{account_revision:hash([account.name,account.phone,account.suburb]),source:'Current account and saved intake',revision:r?.revision||0,data:{ec_name:plan?.ec_name||'',ec_phone:plan?.ec_phone||'',ec_relationship:plan?.ec_relationship||'',...parse(r?.data),name:account.name,phone:account.phone,suburb:account.suburb},updated_at:r?.updated_at||'',support_plan_changed:!!(r&&plan&&r.updated_at>plan.confirmed_at)});
 });
 add('PUT',/^\/api\/journey\/intake$/,(req,res,m,u,b)=>{
   const p=u.role==='worker'?u:person(req,u,'plan');if(!p)return fail(res,'Plan permission required.',403);
   const liveAccount=c.sessionUser(p.id);if(b.contacts_only!==true&&b.account_revision!==hash([liveAccount.name,liveAccount.phone,liveAccount.suburb]))return fail(res,'Your account details changed. Reload before replacing them.',409);
   const cur=db.prepare('SELECT * FROM journey_intake WHERE user_id=?').get(p.id);if(b.revision!==(cur?.revision||0))return fail(res,'These details changed. Reload before saving.',409);
   const data={};for(const k of ['name','phone','suburb','ec_name','ec_phone','ec_relationship','contact_preferences'])data[k]=clean(b.data?.[k],k==='contact_preferences'?500:120);
   if(b.contacts_only===true){const live=c.sessionUser(p.id),previous=parse(cur?.data),plan=c.confirmedPlan(p.id);for(const k of ['name','phone','suburb'])data[k]=live[k]||'';for(const k of ['ec_name','ec_phone','ec_relationship','contact_preferences'])if(!Object.hasOwn(b.data||{},k))data[k]=previous[k]??plan?.[k]??'';}
   if(data.name.length<2)return fail(res,'Enter a name.');
   tx(()=>{db.prepare('INSERT INTO journey_intake(user_id,revision,data,updated_at) VALUES(?,1,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1,data=excluded.data,updated_at=excluded.updated_at').run(p.id,JSON.stringify(data),now());db.prepare('UPDATE users SET name=?,phone=?,suburb=? WHERE id=?').run(data.name,data.phone,data.suburb,p.id);});
   w.event(u.id,'intake','saved',`intake:${p.id}:${(cur?.revision||0)+1}`);json(res,200,{ok:true,revision:(cur?.revision||0)+1,account_revision:hash([data.name,data.phone,data.suburb]),plan_update_offered:!!c.confirmedPlan(p.id)});
 });
 add('GET',/^\/api\/journey\/recruitment$/,(req,res,m,u)=>{
   if(u.role!=='worker'&&!admin(u))return fail(res,'Worker access required.',403);
   const uid=admin(u)?Number(new URL(req.url,'http://x').searchParams.get('worker')):u.id;
   const worker=db.prepare("SELECT id,name FROM users WHERE id=? AND role='worker'").get(uid);if(!worker)return fail(res,'Choose a worker.');
   json(res,200,{worker,checks:db.prepare('SELECT check_key,status,evidence,reviewed_at,reviewer_id FROM recruitment_checks WHERE worker_id=?').all(uid),missing:w.activationMissing(uid),slots:db.prepare("SELECT id,starts_at,ends_at,worker_id,revision FROM interview_slots WHERE starts_at>? AND (status='open' OR worker_id=?) ORDER BY starts_at LIMIT 50").all(now(),uid)});
 });
 add('POST',/^\/api\/admin\/recruitment\/checks$/,(req,res,m,u,b)=>{
   if(!['interview','references','employment'].includes(b.check_key)||!['pending','complete','needs-information'].includes(b.status))return fail(res,'Choose a valid review step and outcome.');
   if(!db.prepare("SELECT id FROM users WHERE id=? AND role='worker'").get(Number(b.worker_id)))return fail(res,'Worker not found.',404);
   if(clean(b.evidence,2000).length<15)return fail(res,'Record the review evidence and outcome in at least 15 characters.');
   db.prepare('INSERT INTO recruitment_checks(worker_id,check_key,status,evidence,reviewer_id,reviewed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(worker_id,check_key) DO UPDATE SET status=excluded.status,evidence=excluded.evidence,reviewer_id=excluded.reviewer_id,reviewed_at=excluded.reviewed_at').run(Number(b.worker_id),b.check_key,b.status,clean(b.evidence,2000),u.id,now());w.sync(Number(b.worker_id));w.event(u.id,'recruitment',b.status,`recruit:${b.worker_id}:${b.check_key}:${now()}`);json(res,200,{ok:true});
 });
 add('POST',/^\/api\/admin\/interview-slots$/,(req,res,m,u,b)=>{
   const start=new Date(b.starts_at),end=new Date(b.ends_at);if(!Number.isFinite(+start)||!Number.isFinite(+end)||start<=new Date()||end<=start||end-start>120*60000)return fail(res,'Choose a future interview of up to two hours.');
   if(db.prepare("SELECT id FROM interview_slots WHERE owner_id=? AND status<>'cancelled' AND starts_at<? AND ends_at>?").get(u.id,end.toISOString(),start.toISOString()))return fail(res,'That interview overlaps another slot.',409);
   const r=db.prepare('INSERT INTO interview_slots(starts_at,ends_at,owner_id) VALUES(?,?,?)').run(start.toISOString(),end.toISOString(),u.id);json(res,200,{ok:true,id:Number(r.lastInsertRowid)});
 });
 add('POST',/^\/api\/journey\/interview$/,(req,res,m,u,b)=>{
   if(u.role!=='worker')return fail(res,'Workers only.',403);
   if(b.cancel){const r=db.prepare("UPDATE interview_slots SET worker_id=NULL,status='open',revision=revision+1 WHERE worker_id=? AND starts_at>?").run(u.id,now());return json(res,200,{ok:true,cancelled:r.changes});}
   const slot=db.prepare('SELECT * FROM interview_slots WHERE id=?').get(Number(b.slot_id));if(!slot||slot.starts_at<=now()||slot.status!=='open'||slot.revision!==b.revision)return fail(res,'This slot changed. Choose an available interview.',409);
   for(const prior of db.prepare('SELECT id FROM interview_slots WHERE worker_id=? AND ends_at<=?').all(u.id,now())){w.event(u.id,'interview','past-reservation','interview:'+prior.id+':worker:'+u.id);db.prepare("UPDATE interview_slots SET worker_id=NULL,status='finished',revision=revision+1 WHERE id=?").run(prior.id);}
   if(db.prepare('SELECT id FROM interview_slots WHERE worker_id=?').get(u.id))return fail(res,'Cancel your existing slot before rescheduling.',409);
   db.prepare("UPDATE interview_slots SET worker_id=?,status='booked',revision=revision+1 WHERE id=?").run(u.id,slot.id);c.notify(u.id,'bookings',u.email,'Interview booked — The Care Web','Your interview is booked',`<p>${c.escHtml(slot.starts_at)}. Open your application for details.</p>`,'Open application',c.baseUrl(req)+'/#/journey?panel=recruitment');json(res,200,{ok:true});
 });
 add('GET',/^\/api\/journey\/bookings\/(\d+)$/,(req,res,m,u)=>{
   const b=ownBooking(req,u,m[1]);if(!b)return fail(res,'Not your visit.',403);
   const party=db.prepare('SELECT name FROM users WHERE id=?').get(u.role==='worker'?b.participant_id:b.worker_id);
   const permitted=u.admin||(u.role==='worker'?c.currentPlanAccess(u.id,b.participant_id):person(req,u,'plan')?.id===b.participant_id);const plan=c.confirmedPlan(b.participant_id);
   json(res,200,{booking:c.bookingPriceView?c.bookingPriceView(b):b,scope:c.scopeState?.(b),other_name:party?.name||'',notes:db.prepare('SELECT body,kind,created,addendum FROM shift_notes WHERE booking_id=? ORDER BY id').all(b.id),brief:permitted?c.workerBrief(b.participant_id):null,plan_id:permitted?plan?.id:null,plan_version:permitted?plan?.version:null,ack:permitted&&u.role==='worker'?c.planAck(b.participant_id,u.id):null,series:b.series_id?db.prepare('SELECT id,date,start,hours,status FROM bookings WHERE series_id=? AND worker_id=? ORDER BY date').all(b.series_id,b.worker_id):[]});
 });
 add('GET',/^\/api\/journey\/series\/(\d+)$/,(req,res,m,u)=>{
   if(u.role!=='worker')return fail(res,'Workers only.',403);
   const rows=db.prepare("SELECT * FROM bookings WHERE series_id=? AND worker_id=? AND status='requested' ORDER BY date,start").all(Number(m[1]),u.id);if(!rows.length)return fail(res,'No requests in this series.',404);
   const plan=c.confirmedPlan(rows[0].participant_id);if(!c.currentPlanAccess(u.id,rows[0].participant_id))return fail(res,'Plan access is not available for this request.',403);
   json(res,200,{visits:rows.map(b=>({id:b.id,date:b.date,start:b.start,hours:b.hours,revision:hash(b),pay:c.workerPay(u.id,b.sleepover?'sleepover':c.suggestCategory(b),b.hours)?.amount||0})),brief:c.workerBrief(rows[0].participant_id),plan_id:plan?.id||null,plan_version:plan?.version||null});
 });
 add('POST',/^\/api\/journey\/series\/(\d+)\/accept$/,(req,res,m,u,b)=>{
   if(u.role!=='worker')return fail(res,'Workers only.',403);
   const ids=[...new Set(b.ids||[])];if(!ids.length||ids.length>26||ids.some(x=>!Number.isInteger(x)))return fail(res,'Select up to 26 visits.');
   const visits=ids.map(id=>db.prepare('SELECT * FROM bookings WHERE id=?').get(id));
   if(visits.some(v=>!v||v.worker_id!==u.id||v.series_id!==Number(m[1])||v.status!=='requested'||b.revisions?.[v.id]!==hash(v)))return fail(res,'A selected visit changed. Review the series again.',409);
   const options=c.assignmentOptions(req,u,b,visits,{accept:true,proof:b});const fits=[];
   db.exec('BEGIN IMMEDIATE');try{
     for(const v of visits){const gate=c.workerBookingGate(u.id,v);if(gate){db.exec('ROLLBACK');return json(res,409,gate);}const fit=c.assignmentCheck(u.id,v,options);if(!fit.ok){db.exec('ROLLBACK');return fit.confirm?c.outOfAreaReply(res,fit):json(res,409,{...fit,date:v.date});}fits.push(fit);}
     for(let i=0;i<visits.length;i++){c.recordAssignmentAck(u.id,fits[i],b,req);c.noteOutOfArea(visits[i].id,fits[i],'worker',u);db.prepare("UPDATE bookings SET status='accepted',accepted_at=? WHERE id=? AND status='requested'").run(now(),visits[i].id);}
     c.bookingNotices.queue(req,'accepted',visits,{event_id:require('node:crypto').randomUUID()}).catch(e=>console.error('[booking-notice]',e.message));db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   w.event(u.id,'series','accepted','series:'+m[1]+':'+ids.sort().join(','));json(res,200,{ok:true,accepted:ids});
 });
 function impact(uid,patch){const prof=db.prepare('SELECT * FROM worker_profiles WHERE user_id=?').get(uid),next={...prof,...patch};return db.prepare("SELECT * FROM bookings WHERE worker_id=? AND status IN ('accepted','requested') AND date>=? ORDER BY date,start").all(uid,c.ymd()).filter(b=>!AV.availability(next,b).ok);}
 add('POST',/^\/api\/journey\/availability-preview$/,(req,res,m,u,b)=>{
   if(u.role!=='worker')return fail(res,'Workers only.',403);let patch;try{patch=AV.normalise(b.patch||{});}catch(e){return fail(res,e.message);}
   const affected=impact(u.id,patch),expires=Date.now()+15*60000;const profile=db.prepare('SELECT * FROM worker_profiles WHERE user_id=?').get(u.id);
   json(res,200,{affected:affected.map(v=>({id:v.id,date:v.date,start:v.start,hours:v.hours,status:v.status,urgent:c.bookingStart(v)<=new Date()})),expires,token:c.sign(hash({uid:u.id,patch,profile,affected,expires}))});
 });
 add('POST',/^\/api\/journey\/availability$/,(req,res,m,u,b)=>{
   if(u.role!=='worker')return fail(res,'Workers only.',403);let patch;try{patch=AV.normalise(b.patch||{});}catch(e){return fail(res,e.message);}
   const affected=impact(u.id,patch),profile=db.prepare('SELECT * FROM worker_profiles WHERE user_id=?').get(u.id);
   if(!b.confirm||!Number.isFinite(b.expires)||b.expires<Date.now()||b.expires>Date.now()+15*60000||b.token!==c.sign(hash({uid:u.id,patch,profile,affected,expires:b.expires})))return fail(res,'Review the current impact before saving.',409);
   const selected=[...new Set(b.cover_ids||[])];if(selected.some(id=>!affected.some(v=>v.id===id)))return fail(res,'Select only affected visits.');
   tx(()=>{const keys=Object.keys(patch);if(keys.length)db.prepare(`UPDATE worker_profiles SET ${keys.map(k=>k+'=?').join(',')} WHERE user_id=?`).run(...keys.map(k=>patch[k]),u.id);for(const id of selected)c.openCover(id,u.id,'Worker confirmed an availability change',req);});
   w.event(u.id,'availability','confirmed','leave:'+b.token);json(res,200,{ok:true,cover_requested:selected,kept:affected.filter(v=>!selected.includes(v.id)).map(v=>v.id)});
 });
 add('POST',/^\/api\/journey\/alternatives$/,(req,res,m,u,b)=>{
   const p=person(req,u,'bookings');if(!p)return fail(res,'Booking permission required.',403);
   if(!T.validDate(b.date)||!T.validTime(b.start)||!(Number(b.hours)>=2&&Number(b.hours)<=10)||!c.services.includes(b.service))return fail(res,'Choose a valid visit.');
   const worker=Number(b.worker_id),options=[];for(let day=0;day<14&&options.length<5;day++)for(const hour of [b.start,'09:00','11:00','13:00','15:00']){const d=new Date(b.date+'T12:00:00');d.setDate(d.getDate()+day);const v={worker_id:worker,participant_id:p.id,date:c.ymd(d),start:hour,hours:Number(b.hours),service:b.service,kind:'shift'};if(c.bookingStart(v)<=new Date())continue;const fit=c.assignmentCheck(worker,v,{});if(fit.ok&&!options.some(o=>o.date===v.date&&o.start===v.start))options.push({date:v.date,start:v.start,hours:v.hours});if(options.length>=5)break;}json(res,200,{options,estimate:true});
 });
 add('GET',/^\/api\/journey\/routines$/,(req,res,m,u)=>{const p=person(req,u,'bookings');if(!p)return fail(res,'Booking permission required.',403);json(res,200,{routines:db.prepare('SELECT * FROM booking_routines WHERE participant_id=? ORDER BY id DESC').all(p.id).map(x=>({...x,data:parse(x.data)}))});});
 add('POST',/^\/api\/journey\/routines$/,(req,res,m,u,b)=>{const visit=ownBooking(req,u,b.booking_id);const p=person(req,u,'bookings');if(!visit||!p)return fail(res,'Not your visit.',403);const data={worker_id:visit.worker_id,service:visit.service,start:visit.start,hours:visit.hours,sleepover:!!visit.sleepover};const r=db.prepare('INSERT INTO booking_routines(participant_id,label,data,updated_at) VALUES(?,?,?,?)').run(p.id,clean(b.label,80)||'My usual visit',JSON.stringify(data),now());json(res,200,{ok:true,id:Number(r.lastInsertRowid),data});});
 add('DELETE',/^\/api\/journey\/routines\/(\d+)$/,(req,res,m,u)=>{const p=person(req,u,'bookings');if(!p)return fail(res,'Booking permission required.',403);db.prepare('DELETE FROM booking_routines WHERE id=? AND participant_id=?').run(Number(m[1]),p.id);json(res,200,{ok:true});});
 add('POST',/^\/api\/journey\/followup$/,(req,res,m,u,b)=>{
   const visit=ownBooking(req,u,b.booking_id),p=person(req,u,'bookings');if(!visit||!p||visit.status!=='completed')return fail(res,'Choose a completed visit.',403);
   if(!['continue','change','help'].includes(b.answer))return fail(res,'Choose a next step.');
   const previous=db.prepare('SELECT answer FROM journey_followups WHERE booking_id=?').get(visit.id);if(previous){if(previous.answer!==b.answer)return fail(res,'Your earlier answer is saved. Open Change support to request a different arrangement.',409);return json(res,200,{ok:true,duplicate:true,next:previous.answer==='continue'?'book-again':'office-followup'});}
   tx(()=>{db.prepare('INSERT OR IGNORE INTO journey_followups(booking_id,participant_id,answer,note,created_at) VALUES(?,?,?,?,?)').run(visit.id,p.id,b.answer,clean(b.note,1000),now());if(b.answer!=='continue'&&!db.prepare("SELECT id FROM journey_transitions WHERE participant_id=? AND kind='followup' AND ref=?").get(p.id,visit.id))db.prepare('INSERT INTO journey_transitions(participant_id,kind,ref,reason,created_at) VALUES(?,?,?,?,?)').run(p.id,'followup',visit.id,clean(b.note,1000)||'Please contact me about my first visit.',now());});w.sync(p.id);json(res,200,{ok:true,next:b.answer==='continue'?'book-again':'office-followup'});
 });
 add('GET',/^\/api\/journey\/preferences$/,(req,res,m,u)=>{const p=person(req,u,'bookings');json(res,200,{preferences:w.preferences(u.id),approval_owner:p?db.prepare('SELECT user_id FROM approval_owners WHERE participant_id=?').get(p.id)?.user_id||p.id:null,approvers:p?[{id:p.id,name:p.name},...c.coordsFor(p.id,'bookings')].map(x=>({id:x.id,name:x.name})):[]});});
 add('PUT',/^\/api\/journey\/preferences$/,(req,res,m,u,b)=>{
   const p={digest:b.digest===true,quiet_from:clean(b.quiet_from,5),quiet_to:clean(b.quiet_to,5)};
   if((p.quiet_from||p.quiet_to)&&(!T.validTime(p.quiet_from)||!T.validTime(p.quiet_to)||p.quiet_from===p.quiet_to))return fail(res,'Choose different valid quiet-hour start and end times.');
   if(b.approval_owner!==undefined){const target=person(req,u,'bookings');if(!target)return fail(res,'Booking permission required.',403);const ids=[target.id,...c.coordsFor(target.id,'bookings').map(c=>c.id)];if(!ids.includes(Number(b.approval_owner)))return fail(res,'Choose a currently authorised approver.');db.prepare('INSERT INTO approval_owners(participant_id,user_id,updated_at) VALUES(?,?,?) ON CONFLICT(participant_id) DO UPDATE SET user_id=excluded.user_id,updated_at=excluded.updated_at').run(target.id,Number(b.approval_owner),now());}
   db.prepare('INSERT INTO journey_preferences(user_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(u.id,JSON.stringify(p),now());
   json(res,200,{ok:true});
 });
 add('GET',/^\/api\/admin\/deliveries$/,(req,res,m,u)=>{
   const summary={queued:0,retry:0,failed:0,sent:0,cancelled:0};
   for(const r of db.prepare('SELECT COALESCE(delivery_result,status) AS state,count(*) AS n FROM delivery_outbox GROUP BY COALESCE(delivery_result,status)').all())summary[r.state]=r.n;
   const rows=db.prepare("SELECT d.id,d.kind,d.recipient,d.subject,d.heading,d.booking_id,d.event_kind,d.status,d.attempts,d.next_at,d.created_at,d.sent_at,d.error,d.urgent,d.delivery_result,d.delivery_evidence,d.delivery_checked_at,u.name AS user_name FROM delivery_outbox d LEFT JOIN users u ON u.id=d.user_id ORDER BY CASE WHEN COALESCE(d.delivery_result,d.status) IN ('failed','bounced') THEN 0 WHEN d.status='retry' THEN 1 ELSE 2 END,d.id DESC LIMIT 200").all();
   json(res,200,{email_enabled:c.emailOn(),connection:c.emailConnection?c.emailConnection(u):{configured:c.emailOn(),account_email:u.email||''},summary,rows});
 });
 add('POST',/^\/api\/admin\/deliveries\/(\d+)\/retry$/,(req,res,m,u)=>{const row=db.prepare('SELECT * FROM delivery_outbox WHERE id=?').get(Number(m[1]));if(!row||!['failed','retry','queued'].includes(row.status))return fail(res,'Only unsent deliveries can be retried.');db.prepare("UPDATE delivery_outbox SET status='queued',next_at=?,error='',attempts=0 WHERE id=?").run(now(),row.id);w.event(u.id,'delivery','retry',`delivery:${row.id}:${now()}`);json(res,200,{ok:true});});
 add('GET',/^\/api\/admin\/journey-metrics$/,(req,res)=>{
   const q=new URL(req.url,'http://x').searchParams,from=q.get('from')||'1900-01-01',to=q.get('to')||'9999-12-31';if(!T.validDate(from)||!T.validDate(to)||from>to)return fail(res,'Choose a valid reporting date range.');
   const groups=new Map();for(const t of db.prepare('SELECT * FROM journey_tasks WHERE substr(ready_at,1,10) BETWEEN ? AND ?').all(from,to)){const key=t.kind+':'+t.owner_kind;if(!groups.has(key))groups.set(key,{kind:t.kind,owner_kind:t.owner_kind,waits:[],closed:0});const g=groups.get(key);g.waits.push(Math.max(0,(new Date(t.completed_at||now())-new Date(t.ready_at))/36e5));g.closed+=t.state==='completed'?1:0;}
   const tasks=[...groups.values()].map(g=>{g.waits.sort((a,b)=>a-b);const quant=p=>g.waits[Math.min(g.waits.length-1,Math.ceil(g.waits.length*p)-1)]||0;return {kind:g.kind,owner_kind:g.owner_kind,count:g.waits.length,completed:g.closed,median_hours:quant(.5),p90_hours:quant(.9)};});
   const events=db.prepare('SELECT task_kind,event,count(*) count,SUM(duration_ms)/60000.0 AS active_minutes FROM journey_events WHERE substr(at,1,10) BETWEEN ? AND ? GROUP BY task_kind,event').all(from,to);json(res,200,{from,to,tasks,events,note:'Waiting time begins when the task is first observed ready. Active effort counts visible-page interaction intervals, capped at 60 seconds per event. These are product measurements, not historical estimates. No care text is stored in events.'});
 });
 add('GET',/^\/api\/admin\/journey-settings$/,(req,res)=>json(res,200,{payroll_drafts_enabled:c.setting('payroll_drafts_enabled','off')==='on',payroll_cutover_date:c.setting('payroll_cutover_date',''),private_billing_ready:c.setting('private_billing_ready','off')==='on',private_gst_percent:c.setting('private_gst_percent','0'),private_billing_evidence:c.setting('private_billing_evidence',''),ai_document_processing:c.setting('ai_document_processing','off')==='on',ai_processing_evidence:c.setting('ai_processing_evidence','')}));
 add('POST',/^\/api\/admin\/journey-settings$/,(req,res,m,u,b)=>{
   if(['payroll_drafts_enabled','private_billing_ready','ai_document_processing'].some(k=>b[k]!==undefined&&typeof b[k]!=='boolean'))return fail(res,'Settings require true or false values.');
   if(b.payroll_drafts_enabled&&!T.validDate(b.payroll_cutover_date))return fail(res,'Confirm the payroll cutover date before enabling scheduled drafts.');
   if(b.private_gst_percent!==undefined&&!['0','10'].includes(String(b.private_gst_percent)))return fail(res,'Choose the applicable tax treatment: 0 or 10 percent.');
   if(b.ai_document_processing&&clean(b.ai_processing_evidence,1000).length<20)return fail(res,'Record approval of the document processing arrangement.');
   if(b.payroll_drafts_enabled!==undefined){if(b.payroll_drafts_enabled&&!T.validDate(b.payroll_cutover_date))return fail(res,'Confirm the payroll cutover date before enabling scheduled drafts.');c.setSetting('payroll_cutover_date',clean(b.payroll_cutover_date,10));c.setSetting('payroll_drafts_enabled',b.payroll_drafts_enabled?'on':'off');}
   if(b.private_billing_ready!==undefined){c.setSetting('private_billing_ready',b.private_billing_ready?'on':'off');c.setSetting('private_gst_percent',String(b.private_gst_percent||0));c.setSetting('private_billing_evidence',clean(b.private_billing_evidence,1000));}
   if(b.ai_document_processing!==undefined){if(b.ai_document_processing&&clean(b.ai_processing_evidence,1000).length<20)return fail(res,'Record approval of the document processing arrangement.');c.setSetting('ai_document_processing',b.ai_document_processing?'on':'off');c.setSetting('ai_processing_evidence',clean(b.ai_processing_evidence,1000));}
   w.event(u.id,'settings','updated','settings:'+now());json(res,200,{ok:true});
 });
 add('GET',/^\/api\/me\/billing$/,(req,res,m,u)=>{const p=person(req,u,'invoices');if(!p)return fail(res,'Invoice permission required.',403);const a=c.sessionUser(p.id);json(res,200,{user:{id:a.id,name:a.name,plan:a.plan,ndis_number:a.ndis_number,pm_email:a.pm_email,plan_start:a.plan_start,plan_end:a.plan_end}});});
 require('./process-finance')(c,w,{add,fail,person,ownBooking,tx,clean});
 require('./process-calendar')(c,w,{add,fail,person,clean});
 require('./process-assistance')(c,w,{add,fail,person,ownBooking,tx,clean});
};
