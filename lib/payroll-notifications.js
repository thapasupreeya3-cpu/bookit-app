'use strict';

const {validDate}=require('./booking-time');

// These notices describe the existing office payroll ledger. They never initiate
// wages, calculate take-home pay, or turn a CSV export into a bank confirmation.
module.exports=function payrollNotifications(c,w){
  const {db}=c,now=w.now||(()=>new Date().toISOString());
  const parse=(value,fallback={})=>{try{return JSON.parse(value);}catch{return fallback;}};
  const esc=c.escHtml||(value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])));
  if(!db.prepare('PRAGMA table_info(payroll_batches)').all().some(column=>column.name==='expected_pay_date'))db.exec('ALTER TABLE payroll_batches ADD COLUMN expected_pay_date TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS payroll_notification_events(
    event_key TEXT PRIMARY KEY,batch_id INTEGER NOT NULL,worker_id INTEGER NOT NULL,
    stage TEXT NOT NULL CHECK(stage IN ('prepared','exported','acknowledged')),
    created_at TEXT NOT NULL,mail_state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS payroll_notice_due ON payroll_notification_events(mail_state,next_at);`);
  let running=null;

  function activeWorker(id){return db.prepare("SELECT id,email FROM users WHERE id=? AND role='worker' AND COALESCE(closed_at,'')=''").get(id);}
  function batchForWorker(id,workerId){return db.prepare(`SELECT b.*,COUNT(l.id) line_count FROM payroll_batches b
    JOIN payroll_lines l ON l.batch_id=b.id WHERE b.id=? AND l.worker_id=? AND l.status<>'excluded' GROUP BY b.id`).get(id,workerId);}
  function recorded(batch){return !!(batch?.status==='acknowledged'&&batch.acknowledged_at&&String(batch.external_ref||'').trim());}
  function relevant(row){
    const batch=batchForWorker(row.batch_id,row.worker_id);
    if(!activeWorker(row.worker_id)||!batch)return false;
    if(row.stage==='prepared')return ['draft','approved'].includes(batch.status);
    const included=db.prepare("SELECT 1 FROM payroll_lines WHERE batch_id=? AND worker_id=? AND status='included'").get(row.batch_id,row.worker_id);
    if(!included)return false;
    return row.stage==='exported'?batch.status==='exported':recorded(batch);
  }
  function mailFor(row){
    const batch=batchForWorker(row.batch_id,row.worker_id),worker=activeWorker(row.worker_id);
    if(!batch||!worker)return null;
    const words={
      prepared:['Your pay is being prepared','Pay preparation started','Your recorded work has been added to a pay batch. The office is preparing payroll.'],
      exported:['Your payroll export is ready','Payroll export created','The office has created the export for your payroll process. Payment has not been confirmed.'],
      acknowledged:['The office has recorded your pay result','Payment recorded by office','The office has recorded an external payment result for this batch. This is an office record; your bank has not confirmed receipt to this website.']
    }[row.stage];
    const expected=validDate(batch.expected_pay_date)?`<p>Expected pay date recorded by the office: <b>${esc(batch.expected_pay_date)}</b>.</p>`:'';
    const url=c.baseUrl?c.baseUrl({headers:{}}):'';
    return [worker.email,words[0]+' — The Care Web',words[1],`<p>${words[2]}</p><p>Pay period: ${esc(batch.from_date)} to ${esc(batch.to_date)}.</p>${expected}<p>Open Pay status to view your records.</p>`,'View pay status',url.replace(/\/$/,'')+'/#/journey?panel=payroll',undefined,[],{
      kind:'payroll',user_id:row.worker_id,event_key:row.event_key,payroll_update:true,transactional:true,
      payroll_batch_id:row.batch_id,payroll_worker_id:row.worker_id,payroll_stage:row.stage
    }];
  }
  function suppress(_row,args){
    const meta=args?.[8]||{};if(!meta.payroll_update)return '';
    return relevant({batch_id:Number(meta.payroll_batch_id),worker_id:Number(meta.payroll_worker_id),stage:meta.payroll_stage})?'':'Payroll status changed or worker access ended';
  }
  async function tick(){
    if(running)return running;
    running=(async()=>{
      let queued=0,retry=0,cancelled=0;
      for(const row of db.prepare("SELECT * FROM payroll_notification_events WHERE mail_state IN ('pending','retry') AND next_at<=? ORDER BY created_at,event_key LIMIT 100").all(now())){
        try{
          if(!relevant(row)){db.prepare("UPDATE payroll_notification_events SET mail_state='cancelled',error='Payroll status changed or worker access ended' WHERE event_key=?").run(row.event_key);cancelled++;continue;}
          const args=mailFor(row);
          if(!String(args?.[0]||'').trim())throw Error('The worker has no email address. Their pay status remains available in the website.');
          await w.enqueueMail(args);
          db.prepare("UPDATE payroll_notification_events SET mail_state='queued',attempts=attempts+1,error='' WHERE event_key=?").run(row.event_key);queued++;
        }catch(error){
          db.prepare("UPDATE payroll_notification_events SET mail_state='retry',attempts=attempts+1,next_at=?,error=? WHERE event_key=?").run(new Date(Date.parse(now())+Math.min(3600000,15000*2**Math.min(row.attempts,8))).toISOString(),String(error.message).slice(0,300),row.event_key);retry++;
        }
      }
      return {queued,retry,cancelled};
    })().finally(()=>{running=null;});
    return running;
  }
  function notify(batchId,stage){
    // Notification availability must not block an otherwise successful pay action.
    try{
      if(!['prepared','exported','acknowledged'].includes(stage))return {ok:false,error:'Unknown payroll notification stage.'};
      let count=0;
      for(const row of db.prepare("SELECT DISTINCT l.worker_id FROM payroll_lines l JOIN users u ON u.id=l.worker_id WHERE l.batch_id=? AND l.status<>'excluded' AND u.role='worker' AND COALESCE(u.closed_at,'')=''").all(Number(batchId))){
        const event={batch_id:Number(batchId),worker_id:row.worker_id,stage};if(!relevant(event))continue;
        count+=Number(db.prepare('INSERT OR IGNORE INTO payroll_notification_events(event_key,batch_id,worker_id,stage,created_at,next_at) VALUES(?,?,?,?,?,?)').run(`payroll:${batchId}:${stage}:${row.worker_id}`,Number(batchId),row.worker_id,stage,now(),now()).changes);
      }
      return {ok:true,queued:count};
    }catch(error){return {ok:false,error:'The payroll action is saved. Its update could not be queued.'};}
  }
  function describe(line){
    const expected=validDate(line.expected_pay_date)&&line.status!=='excluded'?line.expected_pay_date:null;
    const states={
      draft:['Being prepared','waiting','The office is preparing this pay batch.'],
      approved:['Approved for payroll','waiting','The pay batch is approved. Payment has not been confirmed.'],
      exported:['Export file created','waiting','A payroll file has been created. Payment has not been confirmed.']
    };
    let state=states[line.batch_status]||['Pay status awaiting review','waiting','The office will update this pay record.'];
    let paymentRecorded=false;
    if(line.status==='excluded')state=['Not included in this batch','neutral','This line was excluded from this pay batch.'];
    else if(line.status==='exception')state=['Office reviewing pay','waiting','The office is reviewing this line before payroll.'];
    else if(line.status==='included'&&recorded({status:line.batch_status,acknowledged_at:line.acknowledged_at,external_ref:line.external_ref})){
      paymentRecorded=true;state=['Payment recorded by office','success','The office recorded an external payment result. Bank receipt is not verified by this website.'];
    }
    return {status_label:state[0],status_tone:state[1],status_detail:state[2],payment_recorded:paymentRecorded,
      confirmation_source:paymentRecorded?'office_recorded':null,provider_confirmed:false,
      expected_pay_date:expected,expected_pay_date_source:expected?'office_recorded':null,
      payment_recorded_at:paymentRecorded?line.acknowledged_at:null,
      allocation_label:'Booking allocation estimate; this is not take-home pay',allocation_amount:line.amount};
  }
  function workerData(workerId){
    if(!activeWorker(Number(workerId)))return {lines:[],updates:[],provider_connected:false,payslips_connected:false};
    const lines=db.prepare(`SELECT l.id,l.batch_id,l.source_key,l.amount,l.status,l.resolution,l.components,
      b.status AS batch_status,b.from_date,b.to_date,b.expected_pay_date,b.acknowledged_at,b.external_ref
      FROM payroll_lines l JOIN payroll_batches b ON b.id=l.batch_id WHERE l.worker_id=? ORDER BY l.id DESC LIMIT 200`).all(Number(workerId)).map(line=>{
        const {components,...rest}=line;return {...rest,reviewed_components:parse(components,null),...describe(line)};
      });
    const updates=db.prepare('SELECT event_key,batch_id,stage,created_at,mail_state FROM payroll_notification_events WHERE worker_id=? ORDER BY created_at DESC,event_key DESC LIMIT 50').all(Number(workerId));
    return {lines,updates,provider_connected:false,payslips_connected:false,
      note:'Pay is processed through the office payroll system. Exported files are not bank confirmations. Payment recorded means the office recorded the external result.'};
  }
  function recordExpectedDate(batchId,value){
    const date=value===null||value===''?null:value;
    if(date!==null&&!validDate(date))return {ok:false,error:'Use a real expected pay date in YYYY-MM-DD format, or leave it blank.'};
    const result=db.prepare('UPDATE payroll_batches SET expected_pay_date=? WHERE id=?').run(date,Number(batchId));
    return {ok:!!result.changes,expected_pay_date:date};
  }
  const api={prepared:id=>notify(id,'prepared'),exported:id=>notify(id,'exported'),acknowledged:id=>notify(id,'acknowledged'),tick,workerData,describe,recordExpectedDate,suppress};
  if(w.deliveryHooks)w.deliveryHooks.payroll=suppress;
  return api;
};
