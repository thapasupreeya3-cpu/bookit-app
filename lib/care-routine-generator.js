'use strict';
// A routine is an open-ended rule. Only the next eight weeks become actual
// requests. The ledger retains skipped, cancelled and detached dates forever,
// so retries, restarts and single-visit edits cannot recreate them.
const dates=require('./care-routine-dates');
module.exports=function createCareRoutines(c){
  const {db}=c,now=c.now||(()=>new Date().toISOString());
  for(const [name,definition] of [['repeat_end_mode',"TEXT NOT NULL DEFAULT 'finite'"],['auto_extend','INTEGER NOT NULL DEFAULT 0'],['generated_through',"TEXT NOT NULL DEFAULT ''"]]){
    if(!db.prepare('PRAGMA table_info(booking_series)').all().some(col=>col.name===name))db.exec('ALTER TABLE booking_series ADD COLUMN '+name+' '+definition);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS care_routine_rules (
    series_id INTEGER PRIMARY KEY REFERENCES booking_series(id) ON DELETE CASCADE,
    config TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS care_routine_dates (
    series_id INTEGER NOT NULL REFERENCES booking_series(id) ON DELETE CASCADE,
    date TEXT NOT NULL,state TEXT NOT NULL,booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    message TEXT NOT NULL DEFAULT '',checked_at TEXT NOT NULL,
    PRIMARY KEY(series_id,date));
    CREATE INDEX IF NOT EXISTS care_routine_issue_dates ON care_routine_dates(state,date);`);
  const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
  const ledger=db.prepare(`INSERT INTO care_routine_dates(series_id,date,state,booking_id,message,checked_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(series_id,date) DO UPDATE SET state=excluded.state,booking_id=excluded.booking_id,message=excluded.message,checked_at=excluded.checked_at`);
  function record(id,plan,body,actor,ids){
    // A stored snapshot is deliberately not a reference to a mutable address.
    const location={...plan.serviceLocation};if(location.mode==='saved')location.mode='other';
    const config={sleepover:!!plan.sleepover,service_location:location,km:Math.max(0,Number(body.km)||0),km_from:String(body.km_from||'').slice(0,80),km_to:String(body.km_to||'').slice(0,80)};
    db.prepare('INSERT INTO care_routine_rules(series_id,config,updated_at) VALUES(?,?,?)').run(id,JSON.stringify(config),now());
    db.prepare('UPDATE booking_series SET repeat_end_mode=?,auto_extend=1,first_date=?,generated_through=? WHERE id=?').run(plan.endMode,plan.date,plan.allDates.at(-1),id);
    const byDate=new Map(plan.dates.map((date,i)=>[date,ids[i]]));
    for(const date of plan.allDates)ledger.run(id,date,byDate.has(date)?'created':'skipped',byDate.get(date)||null,'',now());
  }
  function adoptEdit(id,actor){
    const sr=db.prepare('SELECT * FROM booking_series WHERE id=?').get(id);
    if(sr?.auto_extend)db.prepare('UPDATE booking_series SET created_by=? WHERE id=?').run(actor.id,id);
  }
  function summary(sr){
    const today=c.ymd();
    const continues=!!sr.auto_extend&&!sr.ended_at&&!(sr.repeat_end_mode==='date'&&sr.until_date<today);
    return {repeat_end_mode:sr.repeat_end_mode||'finite',until_date:sr.until_date||'',auto_extend:continues,continues_automatically:continues,horizon_weeks:8,generated_through:sr.generated_through||'',
      generation_issues:sr.ended_at?[]:db.prepare("SELECT date,message FROM care_routine_dates WHERE series_id=? AND state='issue' AND date>=? ORDER BY date").all(sr.id,today)};
  }
  function recordFailure(id){
    const sr=db.prepare('SELECT * FROM booking_series WHERE id=?').get(id);if(!sr||sr.ended_at||!sr.auto_extend)return;
    db.exec('BEGIN IMMEDIATE');
    try{
      for(const date of dates.window(sr.first_date,sr.freq,sr.repeat_end_mode==='date'?sr.until_date:'',c.ymd())){
        if(+c.bookingStart({date,start:sr.start})<=Date.parse(now()))continue;
        const existing=db.prepare('SELECT state FROM care_routine_dates WHERE series_id=? AND date=?').get(sr.id,date);
        if(!existing||existing.state==='issue')ledger.run(sr.id,date,'issue',null,'This visit could not be requested because of a temporary service problem. Retry the dates or ask the office for help.',now());
      }
      db.exec('COMMIT');
    }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  function pendingDates(sr){
    if(!sr?.auto_extend||sr.ended_at)return [];
    return dates.window(sr.first_date,sr.freq,sr.repeat_end_mode==='date'?sr.until_date:'',c.ymd()).filter(date=>{
      if(+c.bookingStart({date,start:sr.start})<=Date.parse(now()))return false;
      const old=db.prepare('SELECT state FROM care_routine_dates WHERE series_id=? AND date=?').get(sr.id,date);
      if(old&&['created','skipped'].includes(old.state))return false;
      return !db.prepare('SELECT id FROM bookings WHERE series_id=? AND series_index=? LIMIT 1').get(sr.id,dates.index(sr.first_date,sr.freq,date)+1);
    });
  }
  function tick(seriesId,review=null){
    const list=db.prepare('SELECT * FROM booking_series WHERE auto_extend=1 AND ended_at IS NULL'+(seriesId?' AND id=?':'')+' ORDER BY id').all(...(seriesId?[Number(seriesId)]:[]));
    let created=0,issues=0;const failures=[];
    for(const saved of list){
      db.exec('BEGIN IMMEDIATE');
      try{
        const sr=db.prepare('SELECT * FROM booking_series WHERE id=?').get(saved.id);
        if(!sr||sr.ended_at||!sr.auto_extend){db.exec('COMMIT');continue;}
        const config=parse(db.prepare('SELECT config FROM care_routine_rules WHERE series_id=?').get(sr.id)?.config);
        const horizon=dates.window(sr.first_date,sr.freq,sr.repeat_end_mode==='date'?sr.until_date:'',c.ymd());
        const req=c.makeRequest(sr,config),added=[];
        for(const date of horizon){
          const old=db.prepare('SELECT * FROM care_routine_dates WHERE series_id=? AND date=?').get(sr.id,date);
          if(old&&['created','skipped'].includes(old.state))continue;
          // Catch-up never requests a shift whose start has passed. Keep the
          // previous issue in history; do not silently fabricate past visits.
          if(+c.bookingStart({date,start:sr.start})<=Date.parse(now()))continue;
          // Defensive compatibility: if a ledger row was restored from an
          // older backup, the existing occurrence still wins.
          const existing=db.prepare('SELECT id FROM bookings WHERE series_id=? AND series_index=? LIMIT 1').get(sr.id,dates.index(sr.first_date,sr.freq,date)+1);
          if(existing){ledger.run(sr.id,date,'created',existing.id,'',now());continue;}
          const checked=config?c.validate(sr,config,date,req,review):{error:'The routine details need to be reviewed before more visits can be requested.'};
          if(checked.error){ledger.run(sr.id,date,'issue',null,String(checked.error).slice(0,700),now());issues++;continue;}
          const id=c.insert(sr,config,date,checked);
          ledger.run(sr.id,date,'created',id,'',now());added.push(id);created++;
        }
        if(horizon.length)db.prepare('UPDATE booking_series SET generated_through=?,occurrences=(SELECT count(*) FROM care_routine_dates WHERE series_id=? AND state=\'created\') WHERE id=?').run(horizon.at(-1),sr.id,sr.id);
        // queue() writes the durable outbox synchronously; send occurs after
        // commit. A synchronous failure rolls back bookings and ledger too.
        if(added.length)c.bookingNotices.queue(req,'requested',added,{event_id:'routine:'+sr.id+':'+added.join(',')}).catch(e=>console.error('[care-routine-notice]',e.message));
        db.exec('COMMIT');
      }catch(error){
        try{db.exec('ROLLBACK');}catch{}
        if(seriesId)throw error;
        // One damaged routine must not stop unrelated people's future care.
        // Record safe date-level evidence; the job itself still reports failure.
        try{recordFailure(saved.id);}catch{}
        console.error('[care-routine:'+saved.id+']',error.message);failures.push(saved.id);
      }
    }
    if(failures.length)throw Error('Care routine generation failed for '+failures.join(', ')+'. Other routines were checked; review the routine issues.');
    return {created,issues};
  }
  return {record,adoptEdit,summary,tick,recordFailure,pendingDates};
};
