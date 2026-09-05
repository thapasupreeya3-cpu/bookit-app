#!/usr/bin/env node
'use strict';
/* Read-only upgrade triage. Run on the authorised host, never copy real data
   into a development environment. Only row identifiers and issue codes are
   returned. No names, notes, clinical information or automatic data repairs. */
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
process.env.TZ=process.env.TZ||'Australia/Sydney';
const time=require('../lib/booking-time'),referrals=require('../lib/referral-policy');
const file=process.argv[2]||process.env.DB_PATH;
if(!file||!fs.existsSync(file)){console.error('Usage: node scripts/review-existing-data.js /absolute/path/to/bookit.db');process.exit(2);}
const db=new DatabaseSync(path.resolve(file),{readOnly:true}),issues=[];
try{
 for(const b of db.prepare("SELECT id,worker_id,participant_id,date,start,hours,status FROM bookings WHERE status IN ('requested','accepted') AND COALESCE(voided,0)=0").all()){
  const error=time.intervalError(b);if(error)issues.push({kind:'invalid-open-visit',booking_id:b.id,issue:error});
  if(db.prepare("SELECT 1 FROM participant_workers WHERE participant_id=? AND worker_id=? AND relation='blocked'").get(b.participant_id,b.worker_id))issues.push({kind:'blocked-worker-on-open-visit',booking_id:b.id,worker_id:b.worker_id,participant_id:b.participant_id});
 }
 const threshold=Number(db.prepare("SELECT value FROM settings WHERE key='referral_qualify_hours'").get()?.value||50);
 for(const r of db.prepare('SELECT id,referee_id,paid_at FROM referrals WHERE qualified_at IS NOT NULL').all())if(referrals.hours(db,r.referee_id)<threshold)issues.push({kind:r.paid_at?'paid-referral-needs-review':'unpaid-referral-needs-review',referral_id:r.id});
 const cols=new Set(db.prepare('PRAGMA table_info(worker_profiles)').all().map(x=>x.name));
 const workers=cols.has('service_areas')?db.prepare("SELECT user_id FROM worker_profiles WHERE visible=1 AND (service_areas IS NULL OR service_areas='[]' OR service_areas='')").all():db.prepare('SELECT user_id FROM worker_profiles WHERE visible=1').all();
 for(const w of workers)issues.push({kind:'confirm-worker-service-areas',worker_id:w.user_id});
 console.log(JSON.stringify({generated_at:new Date().toISOString(),read_only:true,timezone:process.env.TZ,issues,notice:'Review these records in The Care Web. Do not delete or rewrite delivered evidence. Existing accepted visits have not been cancelled by this report.'},null,2));
}catch(e){console.error('Read-only review failed: '+e.message);process.exitCode=1;}finally{db.close();}
