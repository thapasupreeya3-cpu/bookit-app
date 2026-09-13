'use strict';
// Durable submission markers separate newly submitted visits from the legacy
// approval backlog. A restart can never turn an old pending visit into a bill.
module.exports=function(c){
 const {db,now}=c;
 db.exec(`CREATE TABLE IF NOT EXISTS billing_jobs(booking_id INTEGER PRIMARY KEY,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT NOT NULL DEFAULT '',invoice_no TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS billing_policy(policy_key TEXT PRIMARY KEY,cutover_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS immediate_invoice_submissions(booking_id INTEGER PRIMARY KEY,submitted_at TEXT NOT NULL,funding TEXT NOT NULL);`);
 db.prepare("INSERT OR IGNORE INTO billing_policy(policy_key,cutover_at) VALUES('immediate-per-shift',?)").run(now());
 const cutover=db.prepare("SELECT cutover_at FROM billing_policy WHERE policy_key='immediate-per-shift'").get().cutover_at;
 let running=null;
 function enqueue(id){db.prepare("INSERT INTO billing_jobs(booking_id,next_at,updated_at) VALUES(?,?,?) ON CONFLICT(booking_id) DO UPDATE SET status='queued',next_at=excluded.next_at,updated_at=excluded.updated_at").run(id,now(),now());}
 function markSubmitted(id){
   const b=db.prepare('SELECT b.status,u.plan AS funding FROM bookings b JOIN users u ON u.id=b.participant_id WHERE b.id=?').get(id);
   if(!b||b.status!=='completed')return false;
   const stamp=now();
   db.prepare('INSERT OR IGNORE INTO immediate_invoice_submissions(booking_id,submitted_at,funding) VALUES(?,?,?)').run(id,stamp,b.funding||'');
   enqueue(id);return true;
 }
 function immediateEligible(b){
   if(!b||b.status!=='completed'||b.approval_state!=='pending')return false;
   const submitted=db.prepare('SELECT * FROM immediate_invoice_submissions WHERE booking_id=?').get(b.id);
   if(!submitted||submitted.submitted_at<cutover||!['self','private'].includes(submitted.funding))return false;
   const funding=b.funding??db.prepare('SELECT plan FROM users WHERE id=?').get(b.participant_id??b.pid)?.plan;
   return funding===submitted.funding;
 }
 const eligible=b=>b?.approval_state==='approved'||immediateEligible(b);
 function capture(){
   for(const b of db.prepare(`SELECT * FROM bookings b WHERE ${c.billable('b')} AND COALESCE(b.claim_status,'')='' AND COALESCE(b.voided,0)=0`).all()){
     if(!eligible(b))continue;
     db.prepare("UPDATE billing_jobs SET status='queued',next_at=?,updated_at=? WHERE booking_id=? AND status='complete'").run(now(),now(),b.id);
     db.prepare('INSERT OR IGNORE INTO billing_jobs(booking_id,next_at,updated_at) VALUES(?,?,?)').run(b.id,now(),now());
   }
 }
 function drain(){if(running)return running;running=(async()=>{capture();const jobs=db.prepare("SELECT * FROM billing_jobs WHERE status<>'complete' AND next_at<=? ORDER BY booking_id LIMIT 100").all(now());let completed=0,waiting=0;
  for(const j of jobs){const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(j.booking_id);if(!b||b.voided||b.claim_status){db.prepare("UPDATE billing_jobs SET status='complete',invoice_no=?,last_error='',updated_at=? WHERE booking_id=?").run(b?.invoice_no||'',now(),j.booking_id);continue;}
   if(!eligible(b)){db.prepare("UPDATE billing_jobs SET status='waiting',last_error=?,next_at=?,updated_at=? WHERE booking_id=?").run(b.approval_state==='queried'?'Timesheet question needs an answer.':'Awaiting participant approval',new Date(Date.now()+60000).toISOString(),now(),j.booking_id);waiting++;continue;}
   db.prepare("UPDATE billing_jobs SET status='processing',attempts=attempts+1,updated_at=? WHERE booking_id=?").run(now(),j.booking_id);
   try{const out=await c.runClaims(['ndia','plan','self','private'],b.approval_state==='approved'?'automatic approval':'automatic shift submission',[j.booking_id]);const held=out.needs.find(x=>x.id===j.booking_id),fresh=db.prepare('SELECT claim_status,invoice_no FROM bookings WHERE id=?').get(j.booking_id);
    if(held||!fresh?.claim_status){db.prepare("UPDATE billing_jobs SET status='waiting',last_error=?,next_at=?,updated_at=? WHERE booking_id=?").run(held?held.flags.join(' '):'The charge is not ready yet.',new Date(Date.now()+60000).toISOString(),now(),j.booking_id);waiting++;}
    else{db.prepare("UPDATE billing_jobs SET status='complete',invoice_no=?,last_error='',updated_at=? WHERE booking_id=?").run(fresh.invoice_no||'',now(),j.booking_id);completed++;}
   }catch(e){db.prepare("UPDATE billing_jobs SET status='retry',last_error=?,next_at=?,updated_at=? WHERE booking_id=?").run(String(e.message).slice(0,500),new Date(Date.now()+Math.min(3600000,15000*2**Math.min(j.attempts,8))).toISOString(),now(),j.booking_id);waiting++;}
  }
  if(completed)c.wakeMail();return {completed,waiting};
 })().finally(()=>{running=null;});return running;}
 function wake(id){enqueue(id);setImmediate(()=>drain().catch(e=>console.error('[automatic-invoicing]',e.message)));}
 function status(){return {enabled:true,immediate_submission:true,cutover_at:cutover,immediate_funding:['self','private'],approval_first_funding:['plan','ndia'],counts:db.prepare('SELECT status,count(*) count FROM billing_jobs GROUP BY status').all(),jobs:db.prepare("SELECT j.*,b.date,u.name AS participant FROM billing_jobs j LEFT JOIN bookings b ON b.id=j.booking_id LEFT JOIN users u ON u.id=b.participant_id ORDER BY j.updated_at DESC LIMIT 100").all()};}
 return {enqueue,capture,drain,wake,status,markSubmitted,immediateEligible};
};
