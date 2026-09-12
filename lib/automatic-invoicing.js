'use strict';
// Approved bookings are the durable source; the queue resumes after failures/restarts.
module.exports=function(c){
 const {db,now}=c;
 db.exec("CREATE TABLE IF NOT EXISTS billing_jobs(booking_id INTEGER PRIMARY KEY,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT NOT NULL DEFAULT '',invoice_no TEXT NOT NULL DEFAULT '')");
 let running=null;
 function enqueue(id){db.prepare("INSERT INTO billing_jobs(booking_id,next_at,updated_at) VALUES(?,?,?) ON CONFLICT(booking_id) DO UPDATE SET status='queued',next_at=excluded.next_at,updated_at=excluded.updated_at").run(id,now(),now());}
 function capture(){db.prepare("UPDATE billing_jobs SET status='queued',next_at=?,updated_at=? WHERE status='complete' AND booking_id IN (SELECT id FROM bookings WHERE approval_state='approved' AND COALESCE(claim_status,'')='' AND COALESCE(voided,0)=0)").run(now(),now());for(const b of db.prepare(`SELECT id FROM bookings b WHERE ${c.billable('b')} AND b.approval_state='approved' AND COALESCE(b.claim_status,'')='' AND COALESCE(b.voided,0)=0`).all())db.prepare('INSERT OR IGNORE INTO billing_jobs(booking_id,next_at,updated_at) VALUES(?,?,?)').run(b.id,now(),now());}
 function drain(){if(running)return running;running=(async()=>{capture();const jobs=db.prepare("SELECT * FROM billing_jobs WHERE status<>'complete' AND next_at<=? ORDER BY booking_id LIMIT 100").all(now());let completed=0,waiting=0;
  for(const j of jobs){const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(j.booking_id);if(!b||b.voided||b.claim_status){db.prepare("UPDATE billing_jobs SET status='complete',invoice_no=?,last_error='',updated_at=? WHERE booking_id=?").run(b?.invoice_no||'',now(),j.booking_id);continue;}
   if(b.approval_state!=='approved'){db.prepare("UPDATE billing_jobs SET status='waiting',last_error='Awaiting participant approval',next_at=?,updated_at=? WHERE booking_id=?").run(new Date(Date.now()+60000).toISOString(),now(),j.booking_id);waiting++;continue;}
   db.prepare("UPDATE billing_jobs SET status='processing',attempts=attempts+1,updated_at=? WHERE booking_id=?").run(now(),j.booking_id);
   try{const out=await c.runClaims(['ndia','plan','self','private'],'automatic approval',[j.booking_id]);const held=out.needs.find(x=>x.id===j.booking_id),fresh=db.prepare('SELECT claim_status,invoice_no FROM bookings WHERE id=?').get(j.booking_id);
    if(held||!fresh?.claim_status){db.prepare("UPDATE billing_jobs SET status='waiting',last_error=?,next_at=?,updated_at=? WHERE booking_id=?").run(held?held.flags.join(' '):'The charge is not ready yet.',new Date(Date.now()+60000).toISOString(),now(),j.booking_id);waiting++;}
    else{db.prepare("UPDATE billing_jobs SET status='complete',invoice_no=?,last_error='',updated_at=? WHERE booking_id=?").run(fresh.invoice_no||'',now(),j.booking_id);completed++;}
   }catch(e){db.prepare("UPDATE billing_jobs SET status='retry',last_error=?,next_at=?,updated_at=? WHERE booking_id=?").run(String(e.message).slice(0,500),new Date(Date.now()+Math.min(3600000,15000*2**Math.min(j.attempts,8))).toISOString(),now(),j.booking_id);waiting++;}
  }
  if(completed)c.wakeMail();return {completed,waiting};
 })().finally(()=>{running=null;});return running;}
 function wake(id){enqueue(id);setImmediate(()=>drain().catch(e=>console.error('[automatic-invoicing]',e.message)));}
 function status(){return {enabled:true,counts:db.prepare('SELECT status,count(*) count FROM billing_jobs GROUP BY status').all(),jobs:db.prepare("SELECT j.*,b.date,u.name AS participant FROM billing_jobs j LEFT JOIN bookings b ON b.id=j.booking_id LEFT JOIN users u ON u.id=b.participant_id ORDER BY j.updated_at DESC LIMIT 100").all()};}
 return {enqueue,capture,drain,wake,status};
};
