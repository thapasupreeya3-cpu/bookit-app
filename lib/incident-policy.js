'use strict';
const T=require('./booking-time');
const VERSION='2026-09-12-awareness-v1';
const serious=new Set(['death','serious-injury','abuse-neglect','unlawful-contact','sexual-misconduct']);
const text='Reportable-incident deadlines run from provider awareness. Notify within 24 hours, except unauthorised restrictive practice without harm: five business days. Submit the five-day form within five business days of awareness. Record any separately requested final report with its stated deadline.';
function businessDays(iso,n,holidays=[]){const d=new Date(iso);let count=0;while(count<n){d.setDate(d.getDate()+1);const date=T.dateString?T.dateString(d):`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;if(d.getDay()!==0&&d.getDay()!==6&&!holidays.includes(date))count++;}return d.toISOString();}
function normalize(value,fallback){if(!value)return fallback;const d=new Date(value);if(!Number.isFinite(+d)||+d>Date.now()+60000)throw Error('Enter a valid past date and time.');return d.toISOString();}
function deadlines(input,holidays=[]){const created=input.created||new Date().toISOString(),aware=normalize(input.provider_aware_at,created),occurred=normalize(input.occurred_at,aware);if(Date.parse(occurred)>Date.parse(aware))throw Error('Provider awareness cannot be before the incident occurred.');const reportable=serious.has(input.category)||input.category==='restrictive-practice',harm=input.harm===false||input.harm===0?'no':input.harm===true||input.harm===1?'yes':'unknown',five=reportable?businessDays(aware,5,holidays):null;return {provider_aware_at:aware,occurred_at:occurred,harm_state:harm,reportable:reportable?1:0,notify_due:reportable?(input.category==='restrictive-practice'&&harm==='no'?five:new Date(Date.parse(aware)+24*36e5).toISOString()):null,report_due:five,rule_version:VERSION,awareness_review_required:input.provider_aware_at?0:1};}
module.exports={VERSION,text,businessDays,deadlines,mount(c){const{db,now,setting}=c;
 const columns={provider_aware_at:'TEXT',harm_state:"TEXT DEFAULT 'unknown'",rule_version:'TEXT',awareness_review_required:'INTEGER DEFAULT 1',notification_reference:'TEXT',report_reference:'TEXT',final_report_due:'TEXT',final_report_filed_at:'TEXT',final_report_reference:'TEXT'};
 for(const[name,type]of Object.entries(columns))if(!db.prepare('PRAGMA table_info(incidents)').all().some(x=>x.name===name))db.exec(`ALTER TABLE incidents ADD COLUMN ${name} ${type}`);
 db.exec('CREATE TABLE IF NOT EXISTS incident_obligation_events(id INTEGER PRIMARY KEY,incident_id INTEGER NOT NULL,action TEXT NOT NULL,actor_id INTEGER NOT NULL,at TEXT NOT NULL,effective_at TEXT,reference TEXT,note TEXT)');
 const holidays=(iso=now())=>{let extra=[];try{extra=JSON.parse(setting('incident_holidays','[]')).filter(T.validDate);}catch{}const y=new Date(iso).getFullYear();return [...new Set([...extra,...(c.holidays?.stateDates(y)||[]),...(c.holidays?.stateDates(y+1)||[])])];};
 // Do not invent historical awareness or completion. Existing deadlines become conservative provisional reminders.
 for(const i of db.prepare("SELECT * FROM incidents WHERE COALESCE(rule_version,'')='' AND reportable=1").all()){
  const d=deadlines({category:i.category,created:i.created,occurred_at:i.created},holidays(i.created));
  db.prepare('UPDATE incidents SET provider_aware_at=?,notify_due=?,report_due=?,rule_version=?,awareness_review_required=1,notify_stage=NULL,report_stage=NULL WHERE id=?').run(d.provider_aware_at,d.notify_due,d.report_due,VERSION,i.id);
 }
 function apply(id,input){const d=deadlines(input,holidays(input.provider_aware_at||input.created||now()));db.prepare('UPDATE incidents SET provider_aware_at=?,occurred_at=?,harm_state=?,reportable=?,notify_due=?,report_due=?,rule_version=?,awareness_review_required=? WHERE id=?').run(d.provider_aware_at,d.occurred_at,d.harm_state,d.reportable,d.notify_due,d.report_due,VERSION,d.awareness_review_required,id);return d;}
 function action(i,b,u){const record=(effective,ref,note)=>db.prepare('INSERT INTO incident_obligation_events(incident_id,action,actor_id,at,effective_at,reference,note) VALUES(?,?,?,?,?,?,?)').run(i.id,b.action,u.id,now(),effective||null,ref||'',note||'');
  const ref=String(b.reference||'').trim().slice(0,200),note=String(b.note||b.lessons||'').trim().slice(0,2000);
  if(b.action==='review-awareness'){if(!b.provider_aware_at||b.confirm!==true||note.length<10)throw Error('Confirm provider awareness and record the source of that time.');const d=apply(i.id,{...i,...b,created:i.created});record(d.provider_aware_at,'',note);return;}
  if(b.action==='final-request'){if(b.confirm!==true||ref.length<4||!b.due_at||!Number.isFinite(Date.parse(b.due_at)))throw Error('Record the Commission request reference and the exact deadline.');db.prepare('UPDATE incidents SET final_report_due=? WHERE id=?').run(new Date(b.due_at).toISOString(),i.id);record(null,ref,note);return;}
  if(['notified','report-filed','final-filed'].includes(b.action)){
   if(b.confirm!==true||ref.length<4||!b.filed_at)throw Error('Record the submission reference and actual submission time, then confirm.');const at=normalize(b.filed_at);if(Date.parse(at)<Date.parse(i.provider_aware_at))throw Error('Submission cannot precede recorded provider awareness.');
   const fields={notified:['commission_notified_at','notification_reference'],'report-filed':['report_filed_at','report_reference'],'final-filed':['final_report_filed_at','final_report_reference']}[b.action];
   if(i[fields[0]])throw Error('This submission is already recorded. Its original evidence is preserved.');if(b.action==='final-filed'&&!i.final_report_due)throw Error('Record the requested final-report deadline first.');
   db.prepare(`UPDATE incidents SET ${fields[0]}=?,${fields[1]}=?,status='investigating' WHERE id=?`).run(at,ref,i.id);
   if(b.action==='report-filed'&&i.category==='restrictive-practice'&&i.harm_state==='no'&&!i.commission_notified_at)db.prepare('UPDATE incidents SET commission_notified_at=?,notification_reference=? WHERE id=?').run(at,ref,i.id);
   record(at,ref,note);return;
  }
  if(b.action==='close'){
   if(i.reportable&&(i.awareness_review_required||!i.commission_notified_at||!i.report_filed_at||(i.final_report_due&&!i.final_report_filed_at)))throw Error('Resolve the awareness review and every outstanding reporting obligation before closing.');if(note.length<10)throw Error('Record the outcome and lessons before closing.');db.prepare("UPDATE incidents SET status='closed',closed_at=?,lessons=? WHERE id=?").run(now(),note,i.id);record(null,'',note);return;
  }
  if(b.action==='investigating'){db.prepare("UPDATE incidents SET status='investigating' WHERE id=?").run(i.id);record();return;}
  throw Error('Unknown incident action.');
 }
 return {apply,action,holidays};
}};
