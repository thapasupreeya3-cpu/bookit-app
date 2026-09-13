'use strict';

// Exact addresses live separately from the broad users/bookings projections.
// Each visit keeps its own copy; a profile edit never moves an existing visit.
module.exports=function createServiceLocations(c,w={}){
  const {db}=c,now=c.now||w.now||(()=>new Date().toISOString());
  const fields={unit:120,street:200,suburb:120,state:3,postcode:4,arrival_notes:1500};
  const states=new Set(['ACT','NSW','NT','QLD','SA','TAS','VIC','WA']);
  const parse=value=>{try{return JSON.parse(value);}catch{return {};}};
  const error=(message,status=400)=>Object.assign(new Error(message),{status});
  const empty=()=>Object.fromEntries(Object.keys(fields).map(key=>[key,'']));
  const esc=c.escHtml||(s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])));
  const columns=new Set(db.prepare('PRAGMA table_info(bookings)').all().map(x=>x.name));
  db.exec(`CREATE TABLE IF NOT EXISTS participant_addresses(
    participant_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,data TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,updated_by INTEGER);
    CREATE TABLE IF NOT EXISTS booking_locations(
    booking_id INTEGER PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,data TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,updated_by INTEGER);
    CREATE TABLE IF NOT EXISTS booking_location_notices(
    event_key TEXT PRIMARY KEY,booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,worker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
    next_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS booking_location_notice_due ON booking_location_notices(state,next_at);
    INSERT OR IGNORE INTO booking_locations(booking_id,data,revision,updated_at)
      SELECT b.id,json_object('mode','unconfirmed','unit','','street','','suburb',COALESCE(u.suburb,''),
      'state','','postcode','','arrival_notes','','meeting_point',''),1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM bookings b LEFT JOIN users u ON u.id=b.participant_id WHERE COALESCE(u.closed_at,'')='';
    CREATE TRIGGER IF NOT EXISTS booking_location_snapshot_insert AFTER INSERT ON bookings BEGIN
      INSERT OR IGNORE INTO booking_locations(booking_id,data,revision,updated_at)
      SELECT NEW.id,CASE WHEN a.data IS NOT NULL THEN json_set(a.data,'$.mode',
        CASE WHEN COALESCE(json_extract(a.data,'$.street'),'')<>'' THEN 'saved' ELSE 'unconfirmed' END,'$.meeting_point','')
        ELSE json_object('mode','unconfirmed','unit','','street','','suburb',COALESCE(u.suburb,''),
        'state','','postcode','','arrival_notes','','meeting_point','') END,
        1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM users u LEFT JOIN participant_addresses a ON a.participant_id=u.id WHERE u.id=NEW.participant_id AND COALESCE(u.closed_at,'')='';
    END;`);
  for(const [name,definition] of [['ack_revision','INTEGER NOT NULL DEFAULT 1'],['ack_worker_id','INTEGER']])if(!db.prepare('PRAGMA table_info(booking_locations)').all().some(col=>col.name===name))db.exec('ALTER TABLE booking_locations ADD COLUMN '+name+' '+definition);
  function tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  function text(value,key,max){
    if(value!==null&&value!==undefined&&typeof value!=='string')throw error('Enter text for '+key.replaceAll('_',' ')+'.');
    let out=String(value??'').trim();
    if(out.length>max)throw error(key.replaceAll('_',' ')+' is too long.');
    if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(out))throw error('Remove unsupported characters from '+key.replaceAll('_',' ')+'.');
    if(key!=='arrival_notes'&&/[\r\n\t]/.test(out))out=out.replace(/[\r\n\t]+/g,' ');
    return out;
  }
  function address(input={}){
    if(!input||typeof input!=='object'||Array.isArray(input))throw error('Enter address details.');
    const result={};for(const [key,max] of Object.entries(fields))result[key]=text(input[key],key,key==='state'?20:max);
    result.state=result.state.toUpperCase();
    if(result.state&&!states.has(result.state))throw error('Choose an Australian state or territory.');
    if(result.postcode&&!/^\d{4}$/.test(result.postcode))throw error('Use a four-digit Australian postcode.');
    return result;
  }
  function complete(loc){return loc?.mode==='unconfirmed'?false:!!(loc?.mode==='community'?String(loc.meeting_point||'').trim():loc?.street&&loc?.suburb&&loc?.state&&loc?.postcode);}
  function profile(id){
    const row=db.prepare('SELECT * FROM participant_addresses WHERE participant_id=?').get(Number(id));
    const value=row?{...empty(),...parse(row.data)}:{...empty(),suburb:db.prepare('SELECT suburb FROM users WHERE id=?').get(Number(id))?.suburb||''};
    return {address:value,revision:row?.revision||0,complete:complete(value),updated_at:row?.updated_at||''};
  }
  function resolve(participantId,input){
    const saved=profile(participantId);
    if(input===undefined||input===null)return {...saved.address,mode:saved.address.street?'saved':'unconfirmed',meeting_point:''};
    if(!input||typeof input!=='object'||Array.isArray(input))throw error('Choose a support location.');
    const mode=input.mode||'saved';
    if(!['saved','other','community','unconfirmed'].includes(mode))throw error('Choose a saved address, another address or a community meeting point.');
    if(mode==='saved'){
      if(input.source_revision!==undefined&&input.source_revision!==saved.revision)throw error('The saved address changed. Reload it before booking.',409);
      return {...saved.address,mode:saved.address.street?'saved':'unconfirmed',meeting_point:''};
    }
    const value=address(input),meeting_point=text(input.meeting_point,'meeting_point',240);
    return {...value,mode,meeting_point:mode==='community'?meeting_point:''};
  }
  function getPrivate(id){
    const row=db.prepare('SELECT * FROM booking_locations WHERE booking_id=?').get(Number(id));
    return row?{location:{...empty(),meeting_point:'',...parse(row.data)},revision:row.revision,complete:complete(parse(row.data)),updated_at:row.updated_at,changed:row.revision>1,ack_revision:row.ack_revision,ack_worker_id:row.ack_worker_id}:null;
  }
  function placeForBooking(b){
    if(typeof b?.service_place==='string')return b.service_place.trim();
    const loc=b?.service_location||getPrivate(b?.id)?.location;
    if(!loc)return '';
    let suburb=String(loc.suburb||'').trim(),state=String(loc.state||'').trim().toUpperCase(),postcode=String(loc.postcode||'').trim();
    const suffix=suburb.match(/\s+(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)(?:\s+(\d{4}))?$/i);
    if(suffix){suburb=suburb.slice(0,suffix.index);state=state||suffix[1].toUpperCase();postcode=postcode||suffix[2]||'';}
    else if(postcode&&suburb.endsWith(' '+postcode))suburb=suburb.slice(0,-postcode.length-1);
    return [suburb,state,postcode].filter(Boolean).join(' ');
  }
  function saveBooking(id,location,actor){
    // Safe inside the caller's booking transaction. Initial custom destinations
    // replace the insert-trigger default without being labelled later changes.
    const cur=getPrivate(id);const serialized=JSON.stringify(location);
    db.prepare(`INSERT INTO booking_locations(booking_id,data,revision,updated_at,updated_by) VALUES(?,?,1,?,?)
      ON CONFLICT(booking_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(Number(id),serialized,now(),Number(actor?.id||actor)||null);
    return {...getPrivate(id),changed:!!cur?.changed};
  }
  function participant(req,user){
    if(!user)return null;
    if(c.resolveParticipant)return c.resolveParticipant(req,user,'bookings');
    if(user.role==='participant')return user;
    if(user.admin){const id=Number(new URL(req.url,'http://x').searchParams.get('for')||req.headers?.['x-bookit-for']);return db.prepare("SELECT id,role FROM users WHERE id=? AND role='participant'").get(id)||null;}
    return c.actFor?.(req,user,'bookings')||null;
  }
  function owner(req,user,b){return !!(user?.admin||participant(req,user)?.id===b.participant_id);}
  function editable(b){
    if(!b||!['requested','accepted'].includes(b.status)||b.completed_at||b.invoice_no||b.voided||b.voided_at||b.billing_voided_at||b.cancelled_at)return false;
    try{return +c.bookingStart(b)>Date.parse(now());}catch{return false;}
  }
  function allowed(req,user,b){
    if(!b||!user)return '';
    if(owner(req,user,b))return 'full';
    if(user.role!=='worker'||b.worker_id!==user.id)return '';
    if(!participantActive(b.participant_id)||c.blockedPair?.(b.participant_id,b.worker_id))return '';
    if(['cancelled','declined','voided'].includes(b.status)||b.voided||b.voided_at||b.billing_voided_at||b.cancelled_at)return '';
    return ['accepted','completed'].includes(b.status)?'full':b.status==='requested'?'locality':'';
  }
  function summary(b,user,req){
    const disclosure=allowed(req,user,b);if(!disclosure)return null;
    const data=getPrivate(b.id);if(!data)return null;
    if(disclosure==='locality'){const {mode,suburb,state,postcode}=data.location;data.location={mode,suburb,state,postcode};data.complete=false;}
    const needs_acknowledgement=!!(b.status==='accepted'&&data.changed&&(data.ack_revision<data.revision||data.ack_worker_id!==b.worker_id));
    return {...data,disclosure,can_edit:owner(req,user,b)&&editable(b),needs_acknowledgement,can_acknowledge:needs_acknowledgement&&user.role==='worker'&&user.id===b.worker_id};
  }
  function stateKey(b){return JSON.stringify([b.id,b.participant_id,b.worker_id,b.status,b.date,b.start,b.hours,b.completed_at,b.invoice_no,b.voided,b.voided_at,b.billing_voided_at,b.cancelled_at,b.out_of_area]);}
  function fail(res,message,status=400,payload){return c.json(res,status,payload||{error:message});}
  function route(method,pattern,handler){c.route(method,pattern,async(req,res,m,user,body={})=>{
    if(!user)return fail(res,'Please sign in.',401);
    try{return await handler(req,res,m,user,body);}catch(e){if(e.status)return fail(res,e.message,e.status);throw e;}
  });}
  route('GET',/^\/api\/me\/service-address$/,(req,res,m,user)=>{const p=participant(req,user);if(!p)return fail(res,'Permission to manage this participant’s bookings is required.',403);return c.json(res,200,profile(p.id));});
  route('PUT',/^\/api\/me\/service-address$/,(req,res,m,user,body)=>{
    const p=participant(req,user);if(!p)return fail(res,'Permission to manage this participant’s bookings is required.',403);
    const value=address(body.address);tx(()=>{
      const cur=profile(p.id);if(body.revision!==cur.revision)throw error('Your address changed. Reload before saving.',409);
      db.prepare(`INSERT INTO participant_addresses(participant_id,data,revision,updated_at,updated_by) VALUES(?,?,1,?,?)
        ON CONFLICT(participant_id) DO UPDATE SET data=excluded.data,revision=participant_addresses.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(p.id,JSON.stringify(value),now(),user.id);
      db.prepare('UPDATE users SET suburb=? WHERE id=?').run(value.suburb,p.id);
    });return c.json(res,200,{ok:true,...profile(p.id)});
  });
  route('GET',/^\/api\/bookings\/(\d+)\/location$/,(req,res,m,user)=>{
    const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(Number(m[1])),data=summary(b,user,req);
    return data?c.json(res,200,data):fail(res,'Visit not found.',404);
  });
  route('PUT',/^\/api\/bookings\/(\d+)\/location$/,async(req,res,m,user,body)=>{
    const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(Number(m[1]));
    if(!b||!owner(req,user,b))return fail(res,'Visit not found.',404);
    if(!editable(b))return fail(res,'This visit’s saved location can no longer be changed.',409);
    if(body.confirm!==true)return fail(res,'Confirm the new meeting location before saving.');
    const current=getPrivate(b.id);if(body.revision!==current?.revision)return fail(res,'The visit location changed. Reload before saving.',409);
    const location=resolve(b.participant_id,body.location),changed=[...Object.keys(fields),'mode','meeting_point'].some(key=>current.location[key]!==location[key]);
    if(!changed)return c.json(res,200,{ok:true,...summary(b,user,req)});
    const review=await c.reviewLocationChange?.(req,user,body,b,location);
    if(review===false||review?.ok===false)return fail(res,review?.error||'Review this location change before saving.',review?.status||409,review?.payload);
    tx(()=>{
      const fresh=db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id),latest=getPrivate(b.id);
      if(!fresh||stateKey(fresh)!==stateKey(b)||latest?.revision!==body.revision||!owner(req,user,fresh)||!editable(fresh))throw error('This visit changed. Reload before updating its location.',409);
      if(body.location?.mode==='saved'&&body.location.source_revision!==undefined&&profile(b.participant_id).revision!==body.location.source_revision)throw error('The saved address changed. Reload it before updating the visit.',409);
      db.prepare('UPDATE booking_locations SET data=?,revision=revision+1,updated_at=?,updated_by=? WHERE booking_id=?').run(JSON.stringify(location),now(),user.id,b.id);
      if(b.status==='requested')db.prepare('UPDATE booking_locations SET ack_revision=revision,ack_worker_id=? WHERE booking_id=?').run(b.worker_id,b.id);
      if(columns.has('out_of_area'))db.prepare("UPDATE bookings SET out_of_area='' WHERE id=?").run(b.id);
      c.afterLocationChange?.(b,location,user,review);
      if(b.worker_id)db.prepare(`INSERT OR IGNORE INTO booking_location_notices(event_key,booking_id,worker_id,revision,created_at,next_at) VALUES(?,?,?,?,?,?)`).run(`location:${b.id}:${body.revision+1}`,b.id,b.worker_id,body.revision+1,now(),now());
    });
    void tick().catch(()=>{});
    return c.json(res,200,{ok:true,...summary(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id),user,req)});
  });
  route('POST',/^\/api\/bookings\/(\d+)\/location\/ack$/,(req,res,m,user,body)=>{
    const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(Number(m[1]));
    if(!b||user.role!=='worker'||b.worker_id!==user.id||b.status!=='accepted'||allowed(req,user,b)!=='full')return fail(res,'Visit not found.',404);
    const current=getPrivate(b.id);if(body.revision!==current?.revision)return fail(res,'The visit location changed again. Reload before confirming it.',409);
    db.prepare('UPDATE booking_locations SET ack_revision=revision,ack_worker_id=? WHERE booking_id=?').run(user.id,b.id);
    return c.json(res,200,{ok:true,...summary(b,user,req)});
  });
  let running=null;
  function participantActive(id){const person=db.prepare('SELECT role,closed_at FROM users WHERE id=?').get(id);return person&&person.role==='participant'&&!person.closed_at;}
  function relevant(row){const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(row.booking_id),worker=db.prepare('SELECT * FROM users WHERE id=?').get(row.worker_id);return b&&worker&&!worker.closed_at&&worker.role==='worker'&&participantActive(b.participant_id)&&!c.blockedPair?.(b.participant_id,b.worker_id)&&b.worker_id===row.worker_id&&!b.voided&&!b.voided_at&&['requested','accepted'].includes(b.status)&&getPrivate(b.id)?.revision===row.revision;}
  function suppress(_row,args){const meta=args?.[8]||{};if(meta.location_revision===undefined)return '';return relevant({booking_id:meta.booking_id,worker_id:meta.user_id,revision:meta.location_revision})?'':'Visit location changed or worker access ended';}
  async function tick(){
    if(running)return running;
    running=(async()=>{
      let queued=0,retry=0,cancelled=0;
      for(const row of db.prepare("SELECT * FROM booking_location_notices WHERE state IN ('pending','retry') AND next_at<=? ORDER BY created_at LIMIT 100").all(now())){
        try{
          if(!relevant(row)){db.prepare("UPDATE booking_location_notices SET state='cancelled',error='Visit changed or access ended' WHERE event_key=?").run(row.event_key);cancelled++;continue;}
          const worker=db.prepare('SELECT email FROM users WHERE id=?').get(row.worker_id),b=db.prepare('SELECT date,start FROM bookings WHERE id=?').get(row.booking_id);
          if(!worker?.email)throw Error('No worker email is available.');
          const args=[worker.email,'Visit location updated — The Care Web','Check your visit location',`<p>The agreed location for your visit on ${esc(b.date)} at ${esc(b.start)} has changed.</p><p>Open the visit to review the latest location and arrival instructions before travelling.</p>`,'View visit',String(c.appUrl||'').replace(/\/$/,'')+'/#/bookings?booking='+row.booking_id,undefined,[],{kind:'bookings',event_kind:'visit-changed',event_key:row.event_key,booking_id:row.booking_id,location_revision:row.revision,user_id:row.worker_id,transactional:true}];
          if(w.enqueueMail)await w.enqueueMail(args);else if(c.sendMail)await c.sendMail(...args);else throw Error('The message queue is not available.');
          db.prepare("UPDATE booking_location_notices SET state='queued',attempts=attempts+1,error='' WHERE event_key=?").run(row.event_key);queued++;
        }catch(e){db.prepare("UPDATE booking_location_notices SET state='retry',attempts=attempts+1,next_at=?,error=? WHERE event_key=?").run(new Date(Date.parse(now())+Math.min(3600000,15000*2**Math.min(row.attempts,8))).toISOString(),String(e.message||e).slice(0,300),row.event_key);retry++;}
      }return {queued,retry,cancelled};
    })().finally(()=>{running=null;});return running;
  }
  if(w.deliveryHooks)w.deliveryHooks.location=suppress;
  return {resolve,saveBooking,placeForBooking,getPrivate,summary,profile,address,complete,tick,relevant,suppress};
};
