'use strict';
const crypto=require('node:crypto');
// RFC 5545: stable UID, monotonic SEQUENCE, UTC dates and explicit cancellation.
const stamp=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
module.exports=function(c,w,h){
 const {db,json}=c,{add,fail,person}=h,{hash,now}=w;
 db.exec('CREATE TABLE IF NOT EXISTS calendar_feed_events(feed_id INTEGER NOT NULL,booking_id INTEGER NOT NULL,signature TEXT NOT NULL,sequence INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(feed_id,booking_id))');
 function render(uid,pid,feedId){
   const u=c.sessionUser(uid);if(!u||db.prepare('SELECT closed_at FROM users WHERE id=?').get(uid)?.closed_at)return null;
   if(u.role==='coordinator'&&!c.linkScopes(c.activeLink(uid,pid)).includes('bookings'))return null;
   const col=u.role==='worker'?'worker_id':'participant_id',subject=u.role==='worker'?uid:pid;
   const out=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//The Care Web//Visits//EN','CALSCALE:GREGORIAN'],seen=new Set();
   const rows=db.prepare(`SELECT * FROM bookings WHERE ${col}=? AND COALESCE(voided,0)=0 AND status IN ('accepted','completed','cancelled') AND date>=? ORDER BY date,id`).all(subject,c.ymd(new Date(Date.now()-90*864e5)));
   for(const prev of db.prepare('SELECT * FROM calendar_feed_events WHERE feed_id=?').all(feedId))if(!rows.some(b=>b.id===prev.booking_id)){const b=JSON.parse(prev.data);b.status='cancelled';rows.push(b);}
   for(const b of rows){
     if(seen.has(b.id))continue;seen.add(b.id);
     const signature=hash([b.date,b.start,b.hours,b.sleepover,b.status]),old=db.prepare('SELECT * FROM calendar_feed_events WHERE feed_id=? AND booking_id=?').get(feedId,b.id),seq=old?old.sequence+(old.signature!==signature?1:0):0,prior=old?JSON.parse(old.data):null,at=old&&old.signature===signature?prior.changed_at:now();
     const minimal={id:b.id,date:b.date,start:b.start,hours:b.hours,sleepover:b.sleepover,status:b.status,changed_at:at};
     db.prepare('INSERT INTO calendar_feed_events(feed_id,booking_id,signature,sequence,data) VALUES(?,?,?,?,?) ON CONFLICT(feed_id,booking_id) DO UPDATE SET signature=excluded.signature,sequence=excluded.sequence,data=excluded.data').run(feedId,b.id,signature,seq,JSON.stringify(minimal));
     out.push('BEGIN:VEVENT',`UID:visit-${b.id}@thecareweb.local`,`SEQUENCE:${seq}`,`DTSTAMP:${stamp(at)}`,`LAST-MODIFIED:${stamp(at)}`,`DTSTART:${stamp(c.bookingStart(b))}`,`DTEND:${stamp(c.bookingEnd(b))}`,'SUMMARY:Care Web visit',`STATUS:${b.status==='cancelled'?'CANCELLED':'CONFIRMED'}`,'CLASS:PRIVATE','END:VEVENT');
   }
   out.push('END:VCALENDAR');return out.join('\r\n')+'\r\n';
 }
 add('POST',/^\/api\/journey\/calendar$/,(req,res,m,u,b)=>{
   const p=u.role==='worker'?u:person(req,u,'bookings');if(!p)return fail(res,'Booking permission required.',403);if(b.confirm!==true)return fail(res,'Confirm that your calendar provider may receive visit times.');
   const token=crypto.randomBytes(32).toString('hex'),expires=new Date(Date.now()+90*864e5).toISOString();
   db.prepare('UPDATE calendar_tokens SET revoked_at=? WHERE user_id=? AND participant_id=? AND revoked_at IS NULL').run(now(),u.id,p.id);
   const id=Number(db.prepare('INSERT INTO calendar_tokens(user_id,participant_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(u.id,p.id,hash(token),now(),expires).lastInsertRowid);json(res,200,{id,url:c.baseUrl(req)+'/api/calendar/'+token+'.ics',expires_at:expires});
 });
 add('GET',/^\/api\/journey\/calendar$/,(req,res,m,u)=>json(res,200,{feeds:db.prepare('SELECT id,participant_id,created_at,expires_at,revoked_at FROM calendar_tokens WHERE user_id=? ORDER BY id DESC').all(u.id)}));
 add('DELETE',/^\/api\/journey\/calendar\/(\d+)$/,(req,res,m,u)=>{db.prepare('UPDATE calendar_tokens SET revoked_at=? WHERE id=? AND user_id=?').run(now(),Number(m[1]),u.id);json(res,200,{ok:true});});
 add('GET',/^\/api\/calendar\/([a-f0-9]{64})\.ics$/,(req,res,m)=>{
   const t=db.prepare('SELECT * FROM calendar_tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(hash(m[1]),now());const body=t?render(t.user_id,t.participant_id,t.id):null;if(!body)return fail(res,'This calendar link is no longer available.',404);
   res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Referrer-Policy':'no-referrer','Cache-Control':'private, no-store','Content-Disposition':'inline; filename="careweb-visits.ics"'});res.end(body);
 });
 c.publicAPI.push(['GET',/^\/api\/calendar\/[a-f0-9]{64}\.ics$/]);
 w.calendar=render;
};
