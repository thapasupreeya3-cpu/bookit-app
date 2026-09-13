'use strict';
// Exercise the actual address, booking and disclosure routes with disposable
// accounts. No email provider, maps service or payment provider is contacted.
process.env.TZ='Australia/Sydney';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..'),DIR=fs.mkdtempSync(path.join(os.tmpdir(),'careweb-location-http-'));
const results=[],stamp=new Date().toISOString(),password='Copper-Rainstorm!82';
const home={unit:'Unit 7',street:'41 Synthetic Garden Lane',suburb:'Ryde',state:'NSW',postcode:'2112',arrival_notes:'Synthetic access note: use the blue side gate.'};
const destination={mode:'other',unit:'Suite 2',street:'86 Synthetic Market Street',suburb:'Parramatta',state:'NSW',postcode:'2150',arrival_notes:'Synthetic appointment entrance beside reception.'};
let child,db,base,log='',owner,other,helper,worker,unassigned,admin,linkId,savedBooking,customBooking;
const ins=(table,values)=>Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
function booking(values={}){return ins('bookings',{participant_id:owner.id,worker_id:worker.id,service:'daily-tasks',date:'2030-03-13',start:'10:00',hours:2,status:'requested',created:stamp,...values});}
async function request(method,url,options={}){
  const response=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json',...(options.cookie?{Cookie:options.cookie}:{}),...(options.forId?{'X-Bookit-For':String(options.forId)}:{})},body:options.body===undefined?undefined:JSON.stringify(options.body),redirect:'manual'});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{}
  return {status:response.status,data,text,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
function ok(response,status=200){assert.equal(response.status,status,JSON.stringify(response.data)||response.text.slice(0,200));return response.data;}
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(error){results.push({name,result:'FAIL',error:error.stack});console.error('FAIL '+name+' '+error.stack);}}
async function register(label,role='participant'){
  const email='location-'+label+'@example.test',response=await request('POST','/api/register',{body:{role,name:'Synthetic location '+label,email,password,suburb:'Ryde NSW',plan:'private',services:['daily-tasks'],terms_accepted:true,terms_version:/const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(ROOT+'/server.js','utf8'))[1]}});
  return {id:ok(response).user.id,cookie:response.cookie,email};
}
async function login(id){const response=await request('POST','/api/login',{body:{email:db.prepare('SELECT email FROM users WHERE id=?').get(id).email,password:'demo1234'}});ok(response);return {id,cookie:response.cookie};}
const location=(id,person=owner,forId)=>request('GET','/api/bookings/'+id+'/location',{cookie:person?.cookie,forId});
const profile=(person=owner,forId)=>request('GET','/api/me/service-address',{cookie:person?.cookie,forId});
async function saveAddress(address,person=owner,forId){const before=ok(await profile(person,forId));return ok(await request('PUT','/api/me/service-address',{cookie:person.cookie,forId,body:{revision:before.revision,address}}));}
async function waitFor(fn){for(let n=0;n<100;n++){const value=fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('The expected location queue update did not finish.');}
function privateAbsent(value){const text=JSON.stringify(value);for(const secret of [home.street,home.unit,home.arrival_notes,destination.street,destination.arrival_notes])assert.ok(!text.includes(secret),'An exact address or arrival note escaped into a broad response: '+secret);}
async function main(){
  const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));base='http://127.0.0.1:'+port;
  const guard=path.join(DIR,'loopback-only.js');
  fs.writeFileSync(guard,`'use strict';
const local=value=>{const h=typeof value==='string'||value instanceof URL?new URL(value).hostname:(value.hostname||value.host||'');if(!['127.0.0.1','localhost','::1','[::1]'].includes(h))throw Error('Synthetic location test blocks external network');};
for(const name of ['node:http','node:https']){const m=require(name),request=m.request;m.request=function(...args){local(args[0]);return request.apply(this,args);};const get=m.get;m.get=function(...args){local(args[0]);return get.apply(this,args);};}
const fetch=global.fetch;global.fetch=function(input,...args){local(typeof input==='string'||input instanceof URL?input:input.url);return fetch.call(this,input,...args);};
`);
  const env={...require('../scripts/test-environment')(),PORT:String(port),BIND_HOST:'127.0.0.1',APP_URL:base,DB_PATH:path.join(DIR,'test.db'),DOCS_DIR:path.join(DIR,'docs'),PHOTOS_DIR:path.join(DIR,'photos'),SECRET_FILE:path.join(DIR,'secret'),SEED_DEMO:'on',ADMIN_MFA_REQUIRED:'off',TZ:'Australia/Sydney'};
  child=spawn(process.execPath,['--no-warnings','--require',guard,'server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  db=new DatabaseSync(env.DB_PATH);db.exec('PRAGMA busy_timeout=5000');
  owner=await register('owner');other=await register('other');helper=await register('helper');unassigned=await register('unassigned','worker');
  db.prepare("UPDATE users SET role='coordinator',verified=1 WHERE id=?").run(helper.id);db.prepare('UPDATE users SET verified=1 WHERE id=?').run(owner.id);db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  linkId=ins('account_links',{participant_id:owner.id,coordinator_id:helper.id,invite_email:helper.email,invite_token:'synthetic-location-link',scopes:JSON.stringify(['bookings']),status:'active',invited_at:stamp});
  admin=await login(1);worker=await login(10);
  db.exec(`UPDATE users SET suburb='Parramatta NSW' WHERE id=10;UPDATE worker_profiles SET visible=1,self_paused=0,days='[1,1,1,1,1,1,1]',service_areas='["Parramatta NSW"]',availability_windows=NULL,leave_dates='[]',services='["daily-tasks","personal-care"]' WHERE user_id=10;UPDATE module_completions SET expires_at='2032-01-01' WHERE worker_id=10`);

  await test('Address storage is optional and new legacy-style bookings retain their original locality',async()=>{
    const before=ok(await profile());assert.equal(before.complete,false);assert.equal(before.revision,0);
    const legacy=booking();const first=ok(await location(legacy));assert.equal(first.location.mode,'unconfirmed');assert.equal(first.location.suburb,'Ryde NSW');assert.equal(first.location.street,'');
    const saved=await saveAddress(home);assert.equal(saved.complete,true);assert.equal(saved.revision,1);
    assert.deepEqual(ok(await location(legacy)).location,first.location,'Saving a profile address must not move an existing visit');
    savedBooking=booking({date:'2030-03-14',status:'accepted'});assert.equal(ok(await location(savedBooking)).location.street,home.street);
  });
  await test('Address saves reject stale revisions and invalid state or postcode without losing the saved value',async()=>{
    const before=ok(await profile());
    ok(await request('PUT','/api/me/service-address',{cookie:owner.cookie,body:{revision:before.revision-1,address:{...home,street:'Stale overwrite'}}}),409);
    for(const address of [{...home,state:'ZZ'},{...home,postcode:'123'},{...home,street:{value:'invalid'}}])ok(await request('PUT','/api/me/service-address',{cookie:owner.cookie,body:{revision:before.revision,address}}),400);
    assert.deepEqual(ok(await profile()).address,home);assert.equal(ok(await profile()).revision,before.revision);
    ok(await profile(null),401);ok(await profile(worker),403);
    const mine=ok(await request('GET','/api/me',{cookie:owner.cookie}));privateAbsent(mine);
  });
  await test('Only an active helper with booking scope can read or edit the participant’s address',async()=>{
    assert.deepEqual(ok(await profile(helper,owner.id)).address,home);ok(await profile(helper),403);
    const before=ok(await profile(helper,owner.id));
    db.prepare('UPDATE account_links SET scopes=? WHERE id=?').run(JSON.stringify(['plan','documents']),linkId);
    ok(await profile(helper,owner.id),403);ok(await request('PUT','/api/me/service-address',{cookie:helper.cookie,forId:owner.id,body:{revision:before.revision,address:home}}),403);
    db.prepare("UPDATE account_links SET scopes='[\"bookings\"]',status='revoked' WHERE id=?").run(linkId);
    ok(await profile(helper,owner.id),403);ok(await location(savedBooking,helper,owner.id),404);
    db.prepare("UPDATE account_links SET status='active' WHERE id=?").run(linkId);
    assert.deepEqual(ok(await profile(admin,owner.id)).address,home);assert.equal(ok(await location(savedBooking,helper,owner.id)).location.street,home.street);
  });
  await test('Assigned accepted and completed workers see the visit address; other request and worker states do not',async()=>{
    for(const status of ['accepted','completed']){const id=booking({status});const data=ok(await location(id,worker));assert.equal(data.disclosure,'full');assert.equal(data.location.street,home.street);assert.equal(data.can_edit,false);}
    const requested=booking(),limited=ok(await location(requested,worker));assert.equal(limited.disclosure,'locality');assert.equal(limited.location.suburb,home.suburb);privateAbsent(limited);assert.ok(!Object.hasOwn(limited.location,'arrival_notes'));
    for(const values of [{status:'cancelled'},{status:'declined'},{status:'accepted',voided:1},{status:'accepted',worker_id:unassigned.id}]){const id=booking(values);ok(await location(id,worker),404);}
    ok(await location(savedBooking,other),404);ok(await location(savedBooking,unassigned),404);ok(await location(savedBooking,null),401);
    assert.equal(ok(await location(savedBooking,admin)).location.street,home.street);
  });
  await test('Blocking a worker relationship immediately removes exact visit access and acknowledgement rights',async()=>{
    const relation=ins('participant_workers',{participant_id:owner.id,worker_id:worker.id,relation:'blocked',added:stamp});
    try{
      ok(await location(savedBooking,worker),404);
      ok(await request('POST','/api/bookings/'+savedBooking+'/location/ack',{cookie:worker.cookie,body:{revision:ok(await location(savedBooking)).revision}}),404);
      assert.equal(ok(await location(savedBooking)).location.street,home.street);
    }finally{db.prepare('DELETE FROM participant_workers WHERE id=?').run(relation);}
    assert.equal(ok(await location(savedBooking,worker)).location.street,home.street);
  });
  await test('Calendar, booking list, public worker data and participant intake never gain exact address fields',async()=>{
    for(const [url,person] of [['/api/bookings?booking='+savedBooking,worker],['/api/bookings/calendar?date=2030-03-14',worker],['/api/journey',worker],['/api/journey/intake',owner],['/api/workers/10',null],['/api/workers',owner]]){
      privateAbsent(ok(await request('GET',url,{cookie:person?.cookie})));
    }
    const workerData=ok(await request('GET','/api/workers/10',{cookie:owner.cookie}));const record=workerData.worker||workerData;assert.deepEqual(record.service_areas,['Parramatta NSW']);assert.equal(record.suburb,'Parramatta NSW');
  });
  await test('Changing the saved address leaves all existing visit snapshots and broad booking records unchanged',async()=>{
    const before=ok(await location(savedBooking));const revised={...home,street:'19 Synthetic River Road',suburb:'Parramatta',postcode:'2150'};await saveAddress(revised);
    assert.deepEqual(ok(await location(savedBooking)).location,before.location);assert.equal(ok(await location(savedBooking)).revision,before.revision);
    const fresh=booking();assert.equal(ok(await location(fresh)).location.street,revised.street);
    await saveAddress(home);
  });
  await test('An explicit accepted-visit location change queues a private notice and a worker acknowledgement without resetting acceptance',async()=>{
    const before=ok(await location(savedBooking));
    // Demo recipients are deliberately skipped by the real outbox. Use a
    // synthetic address only during this notification test, then restore it.
    const demoEmail=db.prepare('SELECT email FROM users WHERE id=?').get(worker.id).email;
    db.prepare('UPDATE users SET email=? WHERE id=?').run('location-notice-worker@example.test',worker.id);
    try{
    ok(await request('PUT','/api/bookings/'+savedBooking+'/location',{cookie:owner.cookie,body:{revision:before.revision,location:destination}}),400);
    const changed=ok(await request('PUT','/api/bookings/'+savedBooking+'/location',{cookie:owner.cookie,body:{revision:before.revision,location:destination,confirm:true}}));
    assert.equal(changed.location.street,destination.street);assert.equal(changed.revision,before.revision+1);assert.equal(changed.needs_acknowledgement,true);assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(savedBooking).status,'accepted');
    const mail=await waitFor(()=>db.prepare('SELECT * FROM delivery_outbox WHERE event_key=?').get('location:'+savedBooking+':'+changed.revision));privateAbsent(JSON.parse(mail.payload));assert.equal(mail.recipient,db.prepare('SELECT email FROM users WHERE id=?').get(worker.id).email);
    const currentWorker=ok(await location(savedBooking,worker));assert.equal(currentWorker.can_acknowledge,true);
    const taskKey=worker.id+':location:'+savedBooking;
    const task=ok(await request('GET','/api/journey',{cookie:worker.cookie})).tasks.find(row=>row.task_key===taskKey);
    assert.ok(task,'The worker needs a visible task to review a changed location');assert.equal(task.owner_kind,'person');assert.match(task.destination,new RegExp('booking='+savedBooking+'$'));privateAbsent(task);
    ok(await request('POST','/api/bookings/'+savedBooking+'/location/ack',{cookie:unassigned.cookie,body:{revision:changed.revision}}),404);
    ok(await request('POST','/api/bookings/'+savedBooking+'/location/ack',{cookie:worker.cookie,body:{revision:before.revision}}),409);
    const ack=ok(await request('POST','/api/bookings/'+savedBooking+'/location/ack',{cookie:worker.cookie,body:{revision:changed.revision}}));assert.equal(ack.needs_acknowledgement,false);
    assert.ok(!ok(await request('GET','/api/journey',{cookie:worker.cookie})).tasks.some(row=>row.task_key===taskKey),'Acknowledgement clears the visible location task');
    ok(await request('PUT','/api/bookings/'+savedBooking+'/location',{cookie:owner.cookie,body:{revision:before.revision,location:home,confirm:true}}),409);
    assert.equal(db.prepare('SELECT count(*) n FROM delivery_outbox WHERE event_key LIKE ?').get('location:'+savedBooking+':%').n,1);
    }finally{db.prepare('UPDATE users SET email=? WHERE id=?').run(demoEmail,worker.id);}
  });
  await test('Completed, invoiced, cancelled, voided and past visits cannot have their recorded location rewritten',async()=>{
    for(const values of [{status:'completed'},{invoice_no:'INV-LOCATION-FIXTURE'},{status:'cancelled'},{status:'accepted',voided:1},{date:'2020-01-01',status:'accepted'}]){
      const id=booking(values),before=ok(await location(id));assert.equal(before.can_edit,false);
      ok(await request('PUT','/api/bookings/'+id+'/location',{cookie:owner.cookie,body:{revision:before.revision,location:destination,confirm:true}}),409);assert.deepEqual(ok(await location(id)).location,before.location);
    }
    ok(await request('PUT','/api/bookings/'+savedBooking+'/location',{cookie:worker.cookie,body:{revision:ok(await location(savedBooking)).revision,location:destination,confirm:true}}),404);
  });
  await test('A booking request uses its selected destination for area matching and worker acceptance',async()=>{
    const proposed={worker_id:worker.id,date:'2030-04-02',start:'11:00',service:'daily-tasks',intro:true,service_location:destination};
    customBooking=ok(await request('POST','/api/bookings',{cookie:owner.cookie,body:proposed})).id;
    assert.ok(customBooking);assert.equal(ok(await location(customBooking)).location.street,destination.street);assert.equal(ok(await location(customBooking,worker)).location.suburb,'Parramatta');
    const result=ok(await request('PATCH','/api/bookings/'+customBooking,{cookie:worker.cookie,body:{status:'accepted'}}));assert.ok(result.ok!==false);
    assert.equal(ok(await location(customBooking,worker)).location.street,destination.street);
    const outside=ok(await request('POST','/api/bookings',{cookie:owner.cookie,body:{...proposed,date:'2030-04-03',service_location:{mode:'saved',source_revision:ok(await profile()).revision}}}),409);assert.equal(outside.confirm,true);assert.ok(outside.out_of_area_token);assert.equal(db.prepare("SELECT count(*) n FROM bookings WHERE participant_id=? AND date='2030-04-03'").get(owner.id).n,0);
  });
  await test('Community meeting points remain private until acceptance and preserve explicit location text',async()=>{
    const meeting={mode:'community',meeting_point:'Synthetic library reception desk',suburb:'Parramatta',state:'NSW',postcode:'2150',arrival_notes:'Synthetic reception staff will point out the meeting desk.'};
    const id=ok(await request('POST','/api/bookings',{cookie:owner.cookie,body:{worker_id:worker.id,date:'2030-04-04',start:'11:00',service:'daily-tasks',intro:true,service_location:meeting}})).id;
    const full=ok(await location(id));assert.equal(full.location.meeting_point,meeting.meeting_point);assert.equal(full.complete,true);
    const limited=ok(await location(id,worker));assert.ok(!Object.hasOwn(limited.location,'meeting_point'));assert.ok(!JSON.stringify(limited).includes(meeting.arrival_notes));
    ok(await request('PATCH','/api/bookings/'+id,{cookie:worker.cookie,body:{status:'accepted'}}));assert.equal(ok(await location(id,worker)).location.meeting_point,meeting.meeting_point);
  });
  await test('An empty optional address can be saved without introducing a booking or invoice setup blocker',async()=>{
    const empty=Object.fromEntries(Object.keys(home).map(key=>[key,'']));const saved=await saveAddress(empty);assert.equal(saved.complete,false);
    const blockers=ok(await request('GET','/api/me/blockers',{cookie:owner.cookie}));assert.ok(!blockers.items.some(item=>/address|location/.test(item.key)));
    assert.ok(ok(await request('GET','/api/journey',{cookie:owner.cookie})).tasks.some(row=>row.task_key===owner.id+':location:address'&&row.destination==='#/account/address'));
    assert.equal(ok(await location(customBooking)).location.street,destination.street);await saveAddress(home);
  });
  await test('Account erasure and closure remove private address snapshots while retaining required delivered booking records',async()=>{
    for(const delivered of [false,true]){
      const person=await register(delivered?'close-delivered':'erase-undelivered');await saveAddress(home,person);
      const id=booking({participant_id:person.id,status:delivered?'completed':'requested',date:delivered?'2026-01-01':'2030-08-01'});
      assert.ok(db.prepare('SELECT booking_id FROM booking_locations WHERE booking_id=?').get(id));
      const closed=ok(await request('DELETE','/api/admin/users/'+person.id,{cookie:admin.cookie,body:{reason:'Synthetic privacy lifecycle verification only.',acknowledge:true}}));assert.equal(closed.mode,delivered?'deidentify':'erase');
      assert.equal(db.prepare('SELECT count(*) n FROM participant_addresses WHERE participant_id=?').get(person.id).n,0);
      const retained=db.prepare('SELECT * FROM booking_locations WHERE booking_id=?').get(id);assert.ok(!retained||!JSON.stringify(retained).includes(home.street));
      assert.equal(!!db.prepare('SELECT id FROM bookings WHERE id=?').get(id),delivered);
      ok(await location(id,worker),404);
    }
  });
}
(async()=>{try{await main();}catch(error){results.push({name:'Harness',result:'FAIL',error:error.stack});console.error(error);}finally{
  db?.close();if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await ended;}
  if(process.env.SERVICE_LOCATION_HTTP_RESULTS)fs.writeFileSync(process.env.SERVICE_LOCATION_HTTP_RESULTS,JSON.stringify({runtime:process.version,scope:'Real HTTP routes, disposable records, loopback-only network, no real messages or payments',results,serverLog:log},null,2)+'\n');
  fs.rmSync(DIR,{recursive:true,force:true});console.log(`service location HTTP: ${results.filter(result=>result.result==='PASS').length}/${results.length} passed`);process.exitCode=results.some(result=>result.result==='FAIL')?1:0;
}})();
