'use strict';
// Real SQLite transactions and mounted endpoint handlers. Synthetic identities;
// the notification transport records arguments and cannot contact a network.
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const createUpdates = require('../lib/booking-updates');
const createNotices = require('../lib/booking-notifications');
let passed = 0;
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,role TEXT,email TEXT,closed_at TEXT,is_admin INTEGER DEFAULT 0);
    CREATE TABLE account_links(coordinator_id INTEGER,participant_id INTEGER,scopes TEXT,status TEXT);
    CREATE TABLE bookings(id INTEGER PRIMARY KEY,participant_id INTEGER,worker_id INTEGER,service TEXT,date TEXT,start TEXT,hours REAL,status TEXT,accepted_at TEXT,cancelled_at TEXT,voided INTEGER,sleepover INTEGER,kind TEXT,service_location TEXT,notes TEXT);
    INSERT INTO users(id,name,role,email) VALUES(1,'First participant','participant','p1@example.test'),(2,'Worker','worker','w@example.test'),(3,'Helper','coordinator','h@example.test'),(4,'Other participant','participant','p4@example.test'),(5,'Other worker','worker','w5@example.test'),(6,'Office','participant','a@example.test');
    UPDATE users SET is_admin=1 WHERE id=6;
    INSERT INTO account_links VALUES(3,1,'["bookings"]','active'),(3,4,'["invoices"]','active');
    INSERT INTO bookings VALUES(11,1,2,'personal-care','2030-09-20','10:00',2,'requested',NULL,NULL,0,0,'shift','{"street":"PRIVATE STREET"}','PRIVATE CARE NOTE'),(12,1,2,'personal-care','2030-09-27','10:00',2,'requested',NULL,NULL,0,0,'shift','{"street":"PRIVATE STREET"}','PRIVATE CARE NOTE'),(14,4,5,'personal-care','2030-09-20','10:00',2,'requested',NULL,NULL,0,0,'shift',NULL,NULL);`);
  db.exec('ALTER TABLE bookings ADD COLUMN cover_state TEXT; ALTER TABLE bookings ADD COLUMN delivered_by_allied INTEGER;');
  db.exec("CREATE TABLE booking_locations(booking_id INTEGER PRIMARY KEY,data TEXT,revision INTEGER); INSERT INTO booking_locations VALUES(11,'{\"street\":\"PRIVATE STREET\"}',1),(12,'{}',1),(14,'{}',1);");
  const routes = [], sent = [];
  const c = {db, now:() => '2030-09-01T10:00:00.000Z', route:(method,pattern,handler) => routes.push({method,pattern,handler}), json:(res,status,data) => Object.assign(res,{status,data}),
    bookingStart:b => new Date(b.date+'T'+b.start+':00Z'), bookingEnd:b => new Date(+new Date(b.date+'T'+b.start+':00Z')+b.hours*36e5),
    actFor:(req,user,scope) => {
      const pid = Number(req.headers['x-bookit-for']), link = db.prepare("SELECT * FROM account_links WHERE coordinator_id=? AND participant_id=? AND status='active'").get(user.id,pid);
      return link && JSON.parse(link.scopes).includes(scope) ? db.prepare('SELECT * FROM users WHERE id=?').get(pid) : null;
    },
    coordsFor:pid => db.prepare("SELECT u.* FROM account_links l JOIN users u ON u.id=l.coordinator_id WHERE l.participant_id=? AND l.status='active' AND l.scopes LIKE '%bookings%'").all(pid),
    notify:async(...args) => {sent.push(args);}, baseUrl:()=>'https://synthetic.example.test', escHtml:String, prettyDate:String,serviceLabels:{'personal-care':'Personal care'}};
  c.bookingUpdates = createUpdates(c);
  const notices = createNotices(c);
  const user = id => {const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);return row ? {...row,admin:!!row.is_admin} : null;};
  const api = (method, uid, body, selected) => {
    const url = '/api/me/booking-updates' + (method==='POST'?'/read':''), res = {};
    const r = routes.find(r=>r.method===method&&r.pattern.test(url));
    r.handler({url,headers:{'x-bookit-for':selected}},res,[],uid?user(uid):null,body);
    return res;
  };
  const accept = (ids=[11], stamp='2030-09-01T09:00:00.000Z') => {
    for(const id of ids)db.prepare("UPDATE bookings SET status='accepted',accepted_at=? WHERE id=?").run(stamp,id);
    return c.bookingUpdates.recordAccepted(ids);
  };
  return {db,c,notices,sent,api,accept,close:()=>db.close()};
}
async function test(name,fn) {const f=fixture();try{await fn(f);passed++;console.log('PASS '+name);}finally{f.close();}}
(async()=>{
  await test('Accepted updates appear independently of a participant email address',async f=>{
    f.db.exec("UPDATE users SET email='' WHERE id=1; UPDATE bookings SET status='accepted',accepted_at='2030-09-01T09:00:00.000Z' WHERE id=11");
    await f.notices.queue({},'accepted',[11]);assert.equal(f.sent.length,0);
    const r=f.api('GET',1);assert.equal(r.status,200);assert.equal(r.data.count,1);assert.equal(r.data.updates[0].destination,'#/journey?panel=shift&booking=11');
    assert.doesNotMatch(JSON.stringify(r.data),/PRIVATE STREET|PRIVATE CARE NOTE|example.test/);
  });
  await test('Reading the endpoint never acknowledges a confirmation',f=>{
    f.accept();assert.equal(f.api('GET',1).data.count,1);assert.equal(f.api('GET',1).data.count,1);assert.equal(f.db.prepare('SELECT count(*) n FROM booking_acceptance_reads').get().n,0);
  });
  await test('Acknowledgments belong to each real viewer and survive module remount',f=>{
    const ids=f.accept();assert.equal(f.api('POST',1,{ids}).data.read,1);assert.equal(f.api('GET',1).data.count,0);
    assert.equal(f.api('GET',3,undefined,1).data.count,1);assert.equal(f.api('POST',3,{ids},1).data.read,1);
    createUpdates(f.c);assert.equal(f.api('GET',1).data.count,0);assert.equal(f.api('GET',3,undefined,1).data.count,0);assert.equal(f.api('POST',1,{ids}).data.read,0);
  });
  await test('The participant cannot select another person or acknowledge their confirmation',f=>{
    const ids=f.accept([11,14]);assert.equal(f.api('GET',1,undefined,4).data.updates[0].participant_id,1);
    assert.equal(f.api('POST',1,{ids}).status,403);assert.equal(f.api('GET',1).data.count,1);assert.equal(f.db.prepare('SELECT count(*) n FROM booking_acceptance_reads').get().n,0);
  });
  await test('Coordinator access requires the selected participant and live bookings scope',f=>{
    const ids=f.accept();assert.equal(f.api('GET',3).status,403);assert.equal(f.api('GET',3,undefined,4).status,403);assert.equal(f.api('GET',3,undefined,1).data.count,1);
    f.db.exec("UPDATE account_links SET scopes='[\"invoices\"]' WHERE participant_id=1");assert.equal(f.api('GET',3,undefined,1).status,403);assert.equal(f.api('POST',3,{ids},1).status,403);
    f.db.exec("UPDATE account_links SET scopes='[\"bookings\"]',status='revoked' WHERE participant_id=1");assert.equal(f.api('GET',3,undefined,1).status,403);
  });
  await test('Signed-out callers cannot read or acknowledge and worker or office accounts see no participant notifications',f=>{
    const ids=f.accept();for(const method of ['GET','POST'])assert.equal(f.api(method,null,{ids}).status,401);
    for(const uid of [2,6]){assert.equal(f.api('GET',uid).data.count,0);assert.equal(f.api('POST',uid,{ids}).status,403);}
  });
  await test('Repeated accepted-event handling creates one persisted confirmation',async f=>{
    const ids=f.accept();await f.notices.queue({},'accepted',[11],{event_id:'one'});await f.notices.queue({},'accepted',[11],{event_id:'retry'});
    assert.deepEqual(f.c.bookingUpdates.recordAccepted([11]),ids);assert.equal(f.api('GET',1).data.count,1);assert.equal(f.db.prepare('SELECT count(*) n FROM booking_acceptance_updates').get().n,1);
  });
  await test('Acceptance and its notification roll back together and are saved together',f=>{
    f.db.exec('BEGIN IMMEDIATE');f.accept();assert.equal(f.api('GET',1).data.count,1);f.db.exec('ROLLBACK');assert.equal(f.api('GET',1).data.count,0);assert.equal(f.db.prepare('SELECT status FROM bookings WHERE id=11').get().status,'requested');
    f.db.exec('BEGIN IMMEDIATE');f.accept();f.db.exec('COMMIT');assert.equal(f.api('GET',1).data.count,1);
  });
  await test('Each accepted occurrence in a repeating booking has its own acknowledgment',f=>{
    const ids=f.accept([11,12]);assert.equal(f.api('GET',1).data.count,2);assert.equal(f.api('POST',1,{ids:[ids[0]]}).data.count,1);assert.equal(f.api('GET',1).data.updates[0].booking_id,12);
  });
  await test('Moving then restoring a visit does not revive an obsolete confirmation',f=>{
    f.accept();f.db.exec("UPDATE bookings SET start='11:00' WHERE id=11;UPDATE bookings SET start='10:00' WHERE id=11");assert.equal(f.api('GET',1).data.count,0);
    f.accept([11],'2030-09-01T10:00:00.000Z');assert.equal(f.api('GET',1).data.count,1);
  });
  await test('Cancellation, reassignment and voiding invalidate the acceptance',f=>{
    for(const sql of ["status='cancelled'",'worker_id=5','voided=1']){
      f.db.exec("UPDATE bookings SET status='requested',worker_id=2,voided=0,service_location=NULL WHERE id=11");
      const ids=f.accept([11],'2030-09-01T09:00:00.'+String(sql.length).padStart(3,'0')+'Z');f.db.exec('UPDATE bookings SET '+sql+' WHERE id=11');assert.equal(f.api('GET',1).data.count,0);assert.equal(f.api('POST',1,{ids}).status,403);
    }
  });
  await test('Private location changes invalidate confirmation without copying the address',f=>{
    const ids=f.accept();f.db.exec("UPDATE booking_locations SET data='{\"street\":\"OTHER PRIVATE STREET\"}',revision=2 WHERE booking_id=11");assert.equal(f.api('GET',1).data.count,0);assert.equal(f.api('POST',1,{ids}).status,403);
    assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM booking_acceptance_updates').all()),/PRIVATE STREET/);
  });
  await test('Old completed-time confirmations and closed participant or worker accounts stay hidden',f=>{
    f.accept();f.db.exec("UPDATE users SET closed_at='2030-09-01' WHERE id=2");assert.equal(f.api('GET',1).data.count,0);
    f.db.exec('UPDATE users SET closed_at=NULL WHERE id=2');f.c.bookingUpdates.recordAccepted([11]);
    f.db.exec("UPDATE users SET closed_at='2030-09-01' WHERE id=1");assert.equal(f.api('GET',3,undefined,1).status,403);
    f.db.exec("UPDATE users SET closed_at=NULL WHERE id=1;UPDATE bookings SET date='2020-01-01',status='requested' WHERE id=11");f.accept([11],'2020-01-01T09:00:00.000Z');assert.equal(f.api('GET',1).data.count,0);
  });
  await test('A worker seeking cover cannot leave their former acceptance visible',f=>{
    f.accept();f.db.exec("UPDATE bookings SET cover_state='finding' WHERE id=11");assert.equal(f.api('GET',1).data.count,0);
    f.db.exec("UPDATE bookings SET cover_state='covered',worker_id=5 WHERE id=11");f.accept([11],'2030-09-01T10:00:00.000Z');assert.equal(f.api('GET',1).data.updates[0].worker_name,'Other worker');
    f.db.exec("UPDATE bookings SET delivered_by_allied=99,cover_state='allied' WHERE id=11");assert.equal(f.api('GET',1).data.count,0);
  });
  await test('Malformed and oversized acknowledgment requests have no effect',f=>{
    const ids=f.accept();for(const body of [null,[],1,'invalid',{},{ids:[]},{ids:['1']},{ids:[-1]},{ids:[1.5]},{ids:Array(101).fill(ids[0])}])assert.equal(f.api('POST',1,body).status,400);
    assert.equal(f.api('GET',1).data.count,1);
  });
  console.log('booking updates: '+passed+' passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
