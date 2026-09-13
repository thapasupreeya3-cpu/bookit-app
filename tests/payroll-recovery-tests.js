'use strict';
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const Finance=require('../lib/process-finance');
const dateOffset=days=>{const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);};
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
 CREATE TABLE bookings(id INTEGER PRIMARY KEY,worker_id INTEGER,date TEXT,status TEXT,worker_share REAL,active_extra_share REAL,voided INTEGER,approval_state TEXT,kind TEXT);
 CREATE TABLE standby(id INTEGER PRIMARY KEY,worker_id INTEGER,date TEXT,status TEXT);
 CREATE TABLE referrals(id INTEGER PRIMARY KEY,referrer_id INTEGER,qualified_at TEXT,paid_at TEXT);
 CREATE TABLE payroll_batches(id INTEGER PRIMARY KEY,from_date TEXT,to_date TEXT,created_at TEXT,created_by INTEGER,status TEXT DEFAULT 'draft');
 CREATE TABLE payroll_lines(id INTEGER PRIMARY KEY,batch_id INTEGER,source_key TEXT UNIQUE,worker_id INTEGER,data TEXT,amount REAL,status TEXT,exception TEXT);
 CREATE TABLE invoice_payment_evidence(id INTEGER PRIMARY KEY,invoice_no TEXT,reference TEXT,amount REAL,state TEXT);
 INSERT INTO users VALUES(1,'Synthetic worker');`);
 const settings={payroll_drafts_enabled:'on',payroll_cutover_date:dateOffset(-365)};
 const w={now:()=>new Date().toISOString(),parse:JSON.parse,hash:JSON.stringify,event(){}};
 const c={db,json(){},setting:(key,fallback)=>settings[key]??fallback,ymd:d=>(d||new Date()).toISOString().slice(0,10),payable:()=>"b.status='completed'",reviewReferrals(){}};
 const h={add(){},fail(){},clean:(x,n)=>String(x??'').slice(0,n),tx(fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
 Finance(c,w,h);const insert=(id,days)=>db.prepare("INSERT INTO bookings VALUES(?,1,?,'completed',100,0,0,'approved','shift')").run(id,dateOffset(days));
 return {db,w,settings,insert};
}
let total=0;function test(name,fn){fn();total++;console.log('PASS '+name);}
test('Scheduled recovery includes eligible work older than fourteen days across the complete cutover',()=>{const f=fixture();f.insert(1,-300);f.insert(2,-120);f.insert(3,-3);f.insert(4,-400);f.insert(5,0);f.insert(6,-60);f.db.prepare("INSERT INTO payroll_lines(batch_id,source_key,worker_id,data,amount,status,exception) VALUES(0,'booking:6',1,'{}',100,'included','')").run();const result=f.w.scheduledPayroll();assert.ok(result.created>=3);const keys=f.db.prepare('SELECT source_key FROM payroll_lines ORDER BY source_key').all().map(r=>r.source_key);assert.deepEqual(keys,['booking:1','booking:2','booking:3','booking:6']);assert.ok(f.db.prepare('SELECT * FROM payroll_batches').all().every(b=>b.status==='draft'&&Date.parse(b.to_date)-Date.parse(b.from_date)<=93*864e5));const before=f.db.prepare('SELECT count(*) n FROM payroll_batches').get().n;assert.equal(f.w.scheduledPayroll().empty,true);assert.equal(f.db.prepare('SELECT count(*) n FROM payroll_batches').get().n,before);f.db.close();});
test('Disabled preparation and a future cutover create no pay batches',()=>{const f=fixture();f.insert(1,-100);f.settings.payroll_drafts_enabled='off';assert.equal(f.w.scheduledPayroll().disabled,true);f.settings.payroll_drafts_enabled='on';f.settings.payroll_cutover_date=dateOffset(1);assert.equal(f.w.scheduledPayroll().empty,true);assert.equal(f.db.prepare('SELECT count(*) n FROM payroll_batches').get().n,0);f.db.close();});
test('An invalid cutover remains rejected without changing payroll records',()=>{const f=fixture();f.settings.payroll_cutover_date='2026-02-30';assert.throws(()=>f.w.scheduledPayroll(),/cutover date/);assert.equal(f.db.prepare('SELECT count(*) n FROM payroll_lines').get().n,0);f.db.close();});
console.log('payroll recovery: '+total+'/'+total+' passed');
