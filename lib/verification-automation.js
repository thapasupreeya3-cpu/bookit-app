'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const T = require('./booking-time');

module.exports = function verificationAutomation(c, w, review) {
  const {db} = c, {summary, getPerson, staff, activity} = review;
  const now = () => new Date().toISOString();
  const parse = (s, fallback = {}) => { try { return JSON.parse(s); } catch { return fallback; } };
  const clean = (s, limit = 1000) => String(s ?? '').trim().slice(0, limit);
  const problem = (message, status = 400) => Object.assign(new Error(message), {status});
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  db.exec(`CREATE TABLE IF NOT EXISTS verification_queue (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, dirty INTEGER NOT NULL DEFAULT 1,
    date_key TEXT DEFAULT '', role TEXT DEFAULT '', state TEXT DEFAULT '', name TEXT DEFAULT '', email TEXT DEFAULT '', suburb TEXT DEFAULT '',
    demo INTEGER DEFAULT 0, owner_id INTEGER, due_date TEXT DEFAULT '', received_at TEXT DEFAULT '', data TEXT DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS verification_queue_filter ON verification_queue(role,state,owner_id,due_date);
    CREATE TABLE IF NOT EXISTS verification_reviewers (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, available INTEGER NOT NULL DEFAULT 0,
      roles TEXT NOT NULL DEFAULT '["worker","participant"]', capacity INTEGER NOT NULL DEFAULT 20);
    CREATE TABLE IF NOT EXISTS verification_followups (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_keys TEXT NOT NULL,
      note TEXT NOT NULL, due_date TEXT DEFAULT '', interval_days INTEGER NOT NULL, max_reminders INTEGER NOT NULL,
      reminders_sent INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      approved_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS verification_followups_one_active ON verification_followups(user_id) WHERE status='active';
    CREATE TABLE IF NOT EXISTS verification_plan_snapshots (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(verification_cases)').all().some(x => x.name === 'auto_assign')) {
    db.exec('ALTER TABLE verification_cases ADD COLUMN auto_assign INTEGER NOT NULL DEFAULT 1');
    db.exec('UPDATE verification_cases SET auto_assign=0'); // Preserve pre-upgrade manual ownership choices.
  }
  // Invalidate only the affected person's projection, including changes made by legacy screens.
  const sources = [['users','id'],['worker_profiles','user_id'],['worker_docs','worker_id'],['participant_docs','participant_id'],
    ['support_plans','participant_id'],['recruitment_checks','worker_id'],['module_completions','worker_id'],['verification_cases','user_id'],['verification_followups','user_id'],['verification_plan_snapshots','user_id']];
  const mark = ref => `INSERT INTO verification_queue(user_id) SELECT ${ref} WHERE EXISTS(SELECT 1 FROM users WHERE id=${ref}) ON CONFLICT(user_id) DO UPDATE SET dirty=1;`;
  for (const [table, col] of sources) for (const event of ['INSERT','UPDATE','DELETE']) {
    const refs = event === 'UPDATE' ? ['OLD','NEW'] : [event === 'DELETE' ? 'OLD' : 'NEW'];
    const sql = table === 'users' && event === 'DELETE' ? 'DELETE FROM verification_queue WHERE user_id=OLD.id;' : refs.map(ref => mark(`${ref}.${col}`)).join('');
    db.exec(`CREATE TRIGGER IF NOT EXISTS vf_dirty_${table}_${event} AFTER ${event} ON ${table} BEGIN ${sql}${table==='users' ? 'UPDATE verification_queue SET dirty=1 WHERE owner_id='+refs[0]+'.id;' : ''} END`);
  }
  for (const event of ['INSERT','UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS vf_dirty_settings_${event} AFTER ${event} ON settings BEGIN UPDATE verification_queue SET dirty=1; END`);
  db.exec("INSERT OR IGNORE INTO verification_queue(user_id) SELECT id FROM users WHERE role IN ('worker','participant') AND is_admin=0 AND COALESCE(closed_at,'')=''");

  function refreshQueue(role = '') {
    let rebuilt = 0;
    const timeKey=c.ymd()+':'+Math.floor(Date.now()/300000); // Bound staleness of elapsed-time screening checks.
    const rows = db.prepare("SELECT user_id FROM verification_queue WHERE (dirty=1 OR date_key<>?) AND (?='' OR user_id IN (SELECT id FROM users WHERE role=?))").all(timeKey, role, role);
    const save = db.prepare('UPDATE verification_queue SET dirty=0,date_key=?,role=?,state=?,name=?,email=?,suburb=?,demo=?,owner_id=?,due_date=?,received_at=?,data=? WHERE user_id=?');
    for (const row of rows) {
      const p = getPerson(row.user_id);
      if (!p) { db.prepare('DELETE FROM verification_queue WHERE user_id=?').run(row.user_id); continue; }
      const s = summary(p);
      const data = {id:s.id,name:s.name,role:s.role,email:s.email,suburb:s.suburb,email_confirmed:s.email_confirmed,demo:s.demo,
        state:s.state,state_label:s.state_label,ready:s.ready,next:s.next,pending_count:s.pending_count,document_count:s.document_count,
        received_at:s.received_at,case:{owner_id:s.case.owner_id,owner_name:s.case.owner_name,due_date:s.case.due_date},overdue:overdue(s)};
      save.run(timeKey,p.role,s.state,p.name,p.email||'',p.suburb||'',s.demo?1:0,s.case.owner_id||null,s.case.due_date||'',s.received_at||'',JSON.stringify(data),p.id);
      rebuilt++;
    }
    return rebuilt;
  }
  function overdue(s) { return !!s.case.due_date && s.case.due_date < c.ymd() && ['review','ready','blocked'].includes(s.state); }
  function queue(q, actor) {
    const role=q.get('role')||'worker', status=q.get('status')||'all', owner=q.get('owner')||'all', search=clean(q.get('q'),100).toLowerCase(), offset=Number(q.get('offset')||0);
    if (!['worker','participant'].includes(role)||!['all','review','waiting','ready','active','blocked','overdue'].includes(status)||!['all','mine','unassigned'].includes(owner)||!Number.isInteger(offset)||offset<0) throw problem('Choose valid queue filters.');
    refreshQueue(role);
    let where="role=? AND (?=1 OR demo=0) AND (?='' OR instr(lower(name),?)>0 OR instr(lower(email),?)>0 OR instr(lower(suburb),?)>0)";
    const values=[role,q.get('examples')==='1'?1:0,search,search,search,search];
    if (owner==='mine') { where+=' AND owner_id=?'; values.push(actor.id); }
    if (owner==='unassigned') where+=' AND owner_id IS NULL';
    const counts={all:0,review:0,waiting:0,ready:0,active:0,blocked:0,overdue:0};
    for (const r of db.prepare(`SELECT state,count(*) n FROM verification_queue WHERE ${where} GROUP BY state`).all(...values)) { counts[r.state]=r.n; counts.all+=r.n; }
    const late="due_date<>'' AND due_date<? AND state IN ('review','ready','blocked')";
    counts.overdue=db.prepare(`SELECT count(*) n FROM verification_queue WHERE ${where} AND ${late}`).get(...values,c.ymd()).n;
    if (status==='overdue') { where+=' AND '+late; values.push(c.ymd()); }
    else if (status!=='all') { where+=' AND state=?'; values.push(status); }
    const total=db.prepare(`SELECT count(*) n FROM verification_queue WHERE ${where}`).get(...values).n;
    const rows=db.prepare(`SELECT data FROM verification_queue WHERE ${where} ORDER BY CASE state WHEN 'blocked' THEN 0 WHEN 'review' THEN 1 WHEN 'ready' THEN 2 WHEN 'waiting' THEN 3 ELSE 4 END,COALESCE(NULLIF(due_date,''),'9999'),COALESCE(NULLIF(received_at,''),'9999'),name,user_id LIMIT 30 OFFSET ?`).all(...values,offset).map(r=>parse(r.data));
    return {role,counts,total,offset,limit:30,rows,updated_at:now()};
  }
  function settings() {
    const config={enabled:c.setting('verification_auto_assign','off')==='on',review_days:Number(c.setting('verification_review_days','2'))||2,
      reviewers:staff().map(p=>({ ...p,available:false,roles:['worker','participant'],capacity:20,...(() => { const r=db.prepare('SELECT * FROM verification_reviewers WHERE user_id=?').get(p.id); return r ? {available:!!r.available,roles:parse(r.roles,[]),capacity:r.capacity} : {}; })() }))};
    return {...config,revision:crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex')};
  }
  function saveSettings(v, actor) {
    if (v.confirm!==true || typeof v.enabled!=='boolean'||!Number.isInteger(v.review_days)||v.review_days<1||v.review_days>20||!Array.isArray(v.reviewers)) throw problem('Confirm the reviewer availability and a deadline between 1 and 20 business days.');
    if(v.revision!==settings().revision)throw problem('Automation settings changed. Reopen settings before saving.',409);
    const people=staff(), ids=new Set();
    for (const r of v.reviewers) {
      if (!people.some(p=>p.id===r.id)||ids.has(r.id)||typeof r.available!=='boolean'||!Array.isArray(r.roles)||!r.roles.length||r.roles.some(x=>!['worker','participant'].includes(x))||!Number.isInteger(r.capacity)||r.capacity<1||r.capacity>200) throw problem('Choose current reviewers, roles and a capacity between 1 and 200 files.');
      ids.add(r.id);
    }
    if(v.enabled&&!v.reviewers.some(r=>r.available)) throw problem('Mark at least one reviewer available before enabling assignment.');
    tx(()=>{db.exec('UPDATE verification_reviewers SET available=0');for(const r of v.reviewers)db.prepare('INSERT INTO verification_reviewers(user_id,available,roles,capacity) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET available=excluded.available,roles=excluded.roles,capacity=excluded.capacity').run(r.id,r.available?1:0,JSON.stringify([...new Set(r.roles)]),r.capacity);
      c.setSetting('verification_auto_assign',v.enabled?'on':'off');c.setSetting('verification_review_days',String(v.review_days));
      w.event(actor.id,'verification','settings-updated','verification-settings:'+now());});
    return settings();
  }
  function dueDate(days) { const d=new Date(c.ymd()+'T12:00:00');while(days){d.setDate(d.getDate()+1);if(![0,6].includes(d.getDay()))days--;}return c.ymd(d); }
  function claim(p, actor) {
    const old=db.prepare('SELECT * FROM verification_cases WHERE user_id=?').get(p.id);
    if(old?.owner_id&&old.owner_id!==actor.id) throw problem('This file is already assigned. Review the owner before changing it.',409);
    db.prepare("INSERT INTO verification_cases(user_id,owner_id,due_date,updated_at,actor_id,auto_assign) VALUES(?,?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET owner_id=excluded.owner_id,due_date=CASE WHEN due_date='' THEN excluded.due_date ELSE due_date END,updated_at=excluded.updated_at,actor_id=excluded.actor_id,auto_assign=0").run(p.id,actor.id,dueDate(settings().review_days),now(),actor.id);
    activity(p,actor,'Review claimed','Assigned to '+actor.name);
  }
  function candidates(p, s=summary(p)) {
    const result=[], used=new Set();
    const add=(key,label,where,docKey)=>{if(docKey&&used.has(docKey))return;if(docKey)used.add(docKey);result.push({key,label,where});};
    const requests=c.openRequests(p.role,p.id);
    for(const r of requests) add('request:'+r.id,r.label,p.role==='worker'?'#/journey?panel=uploads&type='+r.doc_key:'#/account/documents',r.doc_key);
    for(const t of s.tasks.filter(t=>t.yours&&t.key!=='paused')) {
      const docKey=t.key.startsWith('upload-')?t.key.slice(7):({'ndis-plan':'p-ndis-plan'})[t.key]||t.key;
      add('task:'+t.key,t.label,t.where,docKey);
    }
    return result;
  }
  const remaining=f=>{const p=getPerson(f.user_id);if(!p||c.isDemoWorker(p.email))return [];const keys=new Set(parse(f.item_keys,[]));return candidates(p).filter(x=>keys.has(x.key));};
  function followups(p, items=candidates(p)) { return db.prepare('SELECT * FROM verification_followups WHERE user_id=? ORDER BY id DESC LIMIT 10').all(p.id).map(f=>({...f,item_keys:undefined,remaining:items.filter(x=>parse(f.item_keys,[]).includes(x.key))})); }
  function messageArgs(f, stage, items) {
    const p=getPerson(f.user_id);if(!p)return null;
    return [p.email,stage?'Your outstanding Care Web setup items':'Your Care Web setup checklist','Your next steps',
      (stage?'':`<p>${c.escHtml(f.note)}</p>`)+`<p>These ${items.length} item${items.length===1?' still needs':'s still need'} your attention:</p><ul>${items.map(x=>`<li>${c.escHtml(x.label)}</li>`).join('')}</ul><p>Open your account to complete them or ask the office for help.${f.due_date?' Requested by '+c.escHtml(f.due_date)+'.':''}</p>`,
      'Open my checklist',c.baseUrl({headers:{}})+'/#/journey',undefined,undefined,
      {user_id:p.id,kind:'messages',event_key:`verification-followup:${f.id}:${stage}`,verification_followup:f.id,verification_stage:stage}];
  }
  function startFollowup(p, v, actor) {
    const available=candidates(p), keys=[...new Set(Array.isArray(v.keys)?v.keys:[])];
    if(v.confirm!==true||!keys.length||keys.some(k=>!available.some(x=>x.key===k))||clean(v.note).length<10)throw problem('Select current outstanding items, review the message and confirm sending.');
    if(v.due_date&&!T.validDate(v.due_date))throw problem('Choose a real due date.');
    if(v.due_date&&v.due_date<c.ymd())throw problem('The requested date cannot be in the past.');
    if(![3,7,14].includes(Number(v.interval_days))||![0,1,2,3].includes(Number(v.max_reminders)))throw problem('Choose a supported reminder interval and limit.');
    if(c.isDemoWorker(p.email))throw problem('Example accounts cannot receive checklist messages.');
    return tx(()=>{
      if(db.prepare("SELECT id FROM verification_followups WHERE user_id=? AND status='active'").get(p.id))throw problem('A combined request is already active. Stop it before approving a replacement.',409);
      db.prepare("UPDATE verification_followups SET status='replaced',updated_at=? WHERE user_id=? AND status='needs-office'").run(now(),p.id);
      const id=Number(db.prepare('INSERT INTO verification_followups(user_id,item_keys,note,due_date,interval_days,max_reminders,next_at,approved_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.id,JSON.stringify(keys),clean(v.note),clean(v.due_date,10),Number(v.interval_days),Number(v.max_reminders),now(),actor.id,now(),now()).lastInsertRowid);
      const f=db.prepare('SELECT * FROM verification_followups WHERE id=?').get(id),items=available.filter(x=>keys.includes(x.key));
      w.enqueueMail(messageArgs(f,0,items));activity(p,actor,'Combined checklist requested',`${keys.length} items; up to ${v.max_reminders} follow-ups`);
      return {ok:true,id,queued:true};
    });
  }
  function stopFollowup(p, id, actor) {
    const f=db.prepare("SELECT * FROM verification_followups WHERE id=? AND user_id=? AND status IN ('active','needs-office')").get(Number(id),p.id);
    if(!f)throw problem('That active request is no longer available.',409);
    db.prepare("UPDATE verification_followups SET status='stopped',updated_at=? WHERE id=?").run(now(),f.id);
    db.prepare("UPDATE delivery_outbox SET status='cancelled',payload='[]',error='Follow-up stopped' WHERE event_key LIKE ? AND status IN ('queued','retry')").run(`verification-followup:${f.id}:%`);
    activity(p,actor,'Automatic follow-ups stopped','Checklist #'+f.id);
    return {ok:true};
  }
  function prepareDelivery(row, args) {
    const meta=args[8]||{};if(!meta.verification_followup)return '';
    const f=db.prepare('SELECT * FROM verification_followups WHERE id=?').get(meta.verification_followup);
    if(!f||f.status!=='active')return 'Follow-up is no longer active';
    const items=remaining(f);if(!items.length){db.prepare("UPDATE verification_followups SET status='completed',updated_at=? WHERE id=?").run(now(),f.id);return 'All requested items are complete';}
    const fresh=messageArgs(f,meta.verification_stage,items);
    if(!fresh||fresh[0].toLowerCase()!==row.recipient)return 'Recipient changed';
    row.payload=JSON.stringify(fresh);db.prepare('UPDATE delivery_outbox SET payload=? WHERE id=?').run(row.payload,row.id);return '';
  }
  function tick() {
    return tx(()=>{
      refreshQueue();let assigned=0,reminders=0,completed=0;
      const config=settings();
      if(config.enabled) {
        const reviewers=config.reviewers.filter(r=>r.available).map(r=>({...r,load:db.prepare("SELECT count(*) n FROM verification_queue WHERE owner_id=? AND state IN ('review','ready','blocked')").get(r.id).n}));
        const rows=db.prepare("SELECT q.user_id,q.role FROM verification_queue q LEFT JOIN verification_cases v ON v.user_id=q.user_id WHERE q.demo=0 AND q.state IN ('review','ready','blocked') AND q.owner_id IS NULL AND COALESCE(v.auto_assign,1)=1 ORDER BY COALESCE(NULLIF(q.received_at,''),'9999'),q.user_id").all();
        for(const row of rows){const owner=reviewers.filter(r=>r.roles.includes(row.role)&&r.load<r.capacity).sort((a,b)=>a.load-b.load||a.id-b.id)[0];if(!owner)continue;
          db.prepare("INSERT INTO verification_cases(user_id,owner_id,due_date,updated_at,auto_assign) VALUES(?,?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET owner_id=excluded.owner_id,due_date=CASE WHEN due_date='' THEN excluded.due_date ELSE due_date END,updated_at=excluded.updated_at").run(row.user_id,owner.id,dueDate(config.review_days),now());
          activity(getPerson(row.user_id),{id:null,name:'Automatic assignment'},'Review assigned',owner.name);owner.load++;assigned++;
        }
      }
      for(const f of db.prepare("SELECT * FROM verification_followups WHERE status IN ('active','needs-office') ORDER BY id").all()){
        const items=remaining(f);
        if(!items.length){db.prepare("UPDATE verification_followups SET status='completed',updated_at=? WHERE id=?").run(now(),f.id);completed++;continue;}
        if(f.status==='needs-office')continue;
        const last=db.prepare('SELECT status,sent_at FROM delivery_outbox WHERE event_key=?').get(`verification-followup:${f.id}:${f.reminders_sent}`);
        if(last?.status==='failed'||last?.status==='cancelled'){db.prepare("UPDATE verification_followups SET status='needs-office',updated_at=? WHERE id=?").run(now(),f.id);continue;}
        if(last?.status!=='sent')continue; // Disabled mail or pending retries never consume reminder stages.
        if(!Number.isFinite(Date.parse(last.sent_at))){db.prepare("UPDATE verification_followups SET status='needs-office',updated_at=? WHERE id=?").run(now(),f.id);continue;}
        const at=new Date(Math.max(Date.parse(last.sent_at)+f.interval_days*864e5,f.due_date?Date.parse(f.due_date+'T23:59:59'):0)).toISOString();
        db.prepare('UPDATE verification_followups SET next_at=? WHERE id=? AND next_at<>?').run(at,f.id,at);
        if(at>now())continue;
        if(f.reminders_sent>=f.max_reminders){db.prepare("UPDATE verification_followups SET status='needs-office',updated_at=? WHERE id=?").run(now(),f.id);continue;}
        const stage=f.reminders_sent+1;w.enqueueMail(messageArgs(f,stage,items));db.prepare('UPDATE verification_followups SET reminders_sent=?,updated_at=? WHERE id=?').run(stage,now(),f.id);reminders++;
      }
      refreshQueue();return {assigned,reminders,completed};
    });
  }
  function officeTasks() {
    refreshQueue();const tasks=db.prepare("SELECT user_id,name,role,due_date FROM verification_queue WHERE demo=0 AND due_date<>'' AND due_date<? AND state IN ('review','ready','blocked')").all(c.ymd()).map(x=>({key:'verification:'+x.user_id,kind:'verification',label:'Overdue verification: '+x.name,dest:'#/admin/verification?role='+x.role+'&person='+x.user_id,detail:'The office review deadline has passed.',due:x.due_date+'T23:59:59Z'}));
    for(const f of db.prepare("SELECT f.id,f.user_id,u.name,u.role FROM verification_followups f JOIN users u ON u.id=f.user_id WHERE f.status='needs-office' AND COALESCE(u.closed_at,'')=''").all())tasks.push({key:'verification-followup:'+f.id,kind:'verification',label:'Follow up with '+f.name,dest:'#/admin/verification?role='+f.role+'&person='+f.user_id,detail:'Automatic follow-ups ended or could not be delivered. Contact the person or approve a new checklist.'});
    return tasks;
  }
  function planValues(p) { return Object.fromEntries(c.planQuestions.map(q=>[q.key,p[q.key]??''])); }
  function recordPlanReview(plan, actor) { db.prepare('INSERT INTO verification_plan_snapshots(user_id,plan_id,version,data,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?)').run(plan.participant_id,plan.id,plan.version,JSON.stringify(planValues(plan)),actor.name||actor.email,now()); }
  function planChanges(p) {
    if(p.role!=='participant')return null;
    const current=c.confirmedPlan(p.id);if(!current)return null;
    const snap=db.prepare('SELECT * FROM verification_plan_snapshots WHERE user_id=? ORDER BY id DESC LIMIT 1').get(p.id);
    if(!snap&&current.reviewed_at)return {baseline:null,version:current.version,reviewed_at:current.reviewed_at,changes:[]};
    const older=snap?null:db.prepare("SELECT * FROM support_plans WHERE participant_id=? AND id<>? AND COALESCE(reviewed_at,'')<>'' ORDER BY reviewed_at DESC,id DESC LIMIT 1").get(p.id,current.id);
    const before=snap?parse(snap.data):older?planValues(older):null;
    return {baseline:before?(snap?'saved office review':'previous retained reviewed plan'):null,version:snap?.version||older?.version||null,
      reviewed_at:snap?.reviewed_at||older?.reviewed_at||null,changes:before?c.planQuestions.filter(q=>JSON.stringify(before[q.key]??'')!==JSON.stringify(current[q.key]??'')).map(q=>({key:q.key,label:q.q||q.key,before:before[q.key]??'',after:current[q.key]??''})):[]};
  }
  function assistance(p) {
    if(p.role!=='worker')return {enabled:false,suggestions:[]};
    const rows=db.prepare('SELECT * FROM document_assistance WHERE user_id=? ORDER BY id DESC LIMIT 40').all(p.id),seen=new Set(),suggestions=[];
    for(const r of rows){if(seen.has(r.doc_id))continue;seen.add(r.doc_id);const d=db.prepare('SELECT * FROM worker_docs WHERE id=? AND worker_id=?').get(r.doc_id,p.id),result=parse(r.result);
      if(!d||!d.file_path||d.verified_at||['rejected','superseded'].includes(d.review_state)||r.decision==='rejected')continue;
      try{if(w.hash(fs.readFileSync(d.file_path))!==result.source_hash)continue;}catch{continue;}
      suggestions.push({id:r.id,doc_id:d.id,status:r.status,decision:r.decision,expiry_date:result.expiry_date||'',check_number:result.check_number||'',issuer:result.issuer||'',source_text:result.source_text||'',confidence:result.confidence||0});
    }
    return {enabled:c.setting('ai_document_processing','off')==='on'&&c.AI.live()&&c.AI.on('credential-extract')&&c.AI.onshore()&&!!c.AI.endpoint(),suggestions};
  }
  function applyAssistance(p,v,actor) {
    const s=assistance(p).suggestions.find(x=>x.id===Number(v.suggestion_id)&&x.doc_id===Number(v.document_id));
    if(!s)throw problem('This suggestion is no longer current. Reload the original evidence.',409);
    if(v.confirm!==true||!['accepted','modified','rejected'].includes(v.decision)||(v.expiry_date&&!T.validDate(v.expiry_date)))throw problem('Review the suggested fields against the original evidence and confirm.');
    tx(()=>{if(v.decision!=='rejected')db.prepare('UPDATE worker_docs SET expiry_date=?,check_number=? WHERE id=? AND worker_id=?').run(clean(v.expiry_date,10),clean(v.check_number,100),s.doc_id,p.id);
      db.prepare("UPDATE document_assistance SET status='reviewed',decision=?,reviewed_at=? WHERE id=?").run(v.decision,now(),s.id);activity(p,actor,'Document suggestions reviewed',v.decision==='rejected'?'Suggestions rejected':'Fields saved; evidence still requires verification');});
    return {ok:true,verified:false};
  }
  function closePersonal(uid) { for(const table of ['verification_queue','verification_followups','verification_plan_snapshots','verification_reviewers'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(uid); }
  w.deliveryHooks.verification=prepareDelivery;w.verificationOfficeTasks=officeTasks;w.recordPlanReview=recordPlanReview;w.closeVerification=closePersonal;
  return {queue,refreshQueue,settings,saveSettings,claim,candidates,followups,startFollowup,stopFollowup,tick,planChanges,assistance,applyAssistance};
};
