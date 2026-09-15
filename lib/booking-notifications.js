'use strict';
// Booking updates use the same durable outbox as other transactional mail.
// Keep arrival details, private addresses and shift notes behind sign-in.
const crypto = require('node:crypto');
module.exports = function bookingNotifications(c) {
  const {db} = c;
  const snapshot = b => ({id:b.id,participant_id:b.participant_id,worker_id:b.worker_id,service:b.service,date:b.date,start:b.start,hours:b.hours,status:b.status,accepted_at:b.accepted_at||'',cancelled_at:b.cancelled_at||''});
  const user = id => db.prepare('SELECT id,name,email,role,closed_at FROM users WHERE id=?').get(id);
  const current = id => db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  const alive = u => u && !u.closed_at && u.email;
  const same = (b,s) => b && !b.voided && ['participant_id','worker_id','service','date','start','hours','status','accepted_at','cancelled_at'].every(k => String(b[k]||'') === String(s[k]||''));
  const expiry = (rows,event) => {
    const times=rows.map(b=>Number(c.bookingStart(b))).filter(Number.isFinite);
    const latest=times.length?Math.max(...times):Date.now();
    return new Date(event==='requested'?latest:Math.min(Date.now()+7*864e5,Math.max(Date.now()+864e5,latest))).toISOString();
  };
  function queue(req,event,values,options={}) {
    const rows=values.map(b=>current(typeof b==='object'?b.id:b)).filter(b=>b&&!b.voided);
    if(!rows.length)return Promise.resolve([]);
    const ids=[...new Set(rows.map(b=>b.participant_id))];
    if(ids.length!==1)throw Error('Booking notices must belong to one participant.');
    // Save in-site confirmations before checking email availability or opt-outs.
    if(event==='accepted')c.bookingUpdates?.recordAccepted(rows);
    else c.bookingUpdates?.invalidateChanged(rows);
    const pid=ids[0],participant=user(pid);
    if(!alive(participant))return Promise.resolve([]);
    const recipients=new Map();
    function add(u,role,visits=rows) {
      if(!alive(u))return;
      const prior=recipients.get(u.id);
      recipients.set(u.id,{u,role,rows:prior?[...new Map([...prior.rows,...visits].map(b=>[b.id,b])).values()]:visits});
    }
    add(participant,'participant');
    for(const helper of c.coordsFor(pid,'bookings')){const u=user(helper.id);if(u?.role==='coordinator')add(u,'helper');}
    if(!['accepted','declined'].includes(event)) {
      for(const wid of new Set(rows.map(b=>b.worker_id).filter(Boolean)))add(user(wid),'worker',rows.filter(b=>b.worker_id===wid));
      if(event==='changed')for(const wid of new Set((options.previousRows||[]).map(b=>b.worker_id).filter(Boolean))){
        const visits=rows.filter(b=>(options.previousRows||[]).some(old=>old.id===b.id&&old.worker_id===wid));
        if(visits.length)add(user(wid),'worker',visits);
      }
    }
    const all=[];
    for(const {u,role,rows:visits} of recipients.values()) {
      if(role==='worker'&&c.blockedPair?.(pid,u.id))continue;
      const workerRequest=role==='worker'&&['requested','changed'].includes(event)&&visits.some(b=>b.worker_id===u.id&&b.status==='requested');
      const removed=role==='worker'&&visits.every(b=>b.worker_id!==u.id);
      const many=visits.length>1;
      const titles={requested:workerRequest?'New booking request':'Booking request received',accepted:'Booking confirmed',declined:'Booking request declined',cancelled:'Booking cancelled',changed:removed?'Booking assignment changed':'Booking details changed',ended:'Repeating bookings ended'};
      const title=titles[event];if(!title)throw Error('Unknown booking notification event.');
      const label=c.escHtml(participant.name||'Participant');
      const descriptions={
        requested:workerRequest?`<p><b>${label}</b> has requested ${many?'repeating visits':'a visit'}. Please review the outstanding requests and accept or decline each visit.</p>`:`<p>Your ${many?'booking requests have':'booking request has'} been sent to the worker. <b>Waiting for the worker to respond.</b> We will email you when they accept or decline.</p>`,
        accepted:'<p>The worker has accepted the visit'+(many?'s':'')+'. Your booking'+(many?'s are':' is')+' confirmed.</p>',
        declined:'<p>The worker has declined the request'+(many?'s':'')+'. Open your bookings to choose another worker or arrange a different time.</p>',
        cancelled:'<p>The booking'+(many?'s have':' has')+' been cancelled. Open the booking record for the cancellation details and any applicable charge.</p>',
        changed:removed?'<p>You are no longer assigned to the affected visits. Check your diary for your current bookings.</p>':'<p>The booking details have changed. '+(visits.some(b=>b.status==='requested')?'The changed requests need a fresh worker response. ':'')+'Open your bookings for the current details.</p>',
        ended:'<p>The repeating booking has ended and the affected future visits have been cancelled. Past visits and separately moved visits remain in your booking history. Open the records for any applicable cancellation charges.</p>'
      };
      // This is an event receipt, not a promise that a later booking change
      // has not occurred. Requests in a series remain relevant while any
      // of its originally addressed visits still need this worker's reply.
      const detail=visits.map(b=>`<li>${c.escHtml(c.prettyDate(b.date))} at ${c.escHtml(b.start)} · ${Number(b.hours)} hours · ${c.escHtml(c.serviceLabels[b.service]||b.service)}${role!=='worker'?' · '+c.escHtml(user(b.worker_id)?.name||'Worker'):''}</li>`).join('');
      const helperIntro=role==='helper'?`<p>This booking update is for <b>${label}</b>. After signing in, select <b>${label}</b> as the participant you are helping, then open Bookings.</p>`:'';
      const html=helperIntro+descriptions[event]+`<p>${many?'Affected visits':'Visit'} at the time of this update:</p><ul>${detail}</ul>`+(workerRequest?options.workerHtml||'':'')+'<p>Your website booking record always shows the latest status and details.</p>';
      const states=visits.map(snapshot).sort((a,b)=>a.id-b.id);
      const key='booking-notice:'+crypto.createHash('sha256').update(JSON.stringify({event,event_id:options.event_id||'',recipient:u.id,states,previous:(options.previousRows||[]).map(snapshot)})).digest('hex');
      const meta={event_key:key,kind:'bookings',transactional:true,booking_lifecycle:true,booking_event:event,event_kind:workerRequest?'booking-request':'booking-'+event,booking_id:visits[0].id,booking_ids:states.map(b=>b.id),booking_states:states,booking_participant_id:pid,booking_recipient_role:role,booking_worker_removed:removed,expires_at:expiry(visits,event)};
      const link=c.baseUrl(req)+'/#/bookings'+(visits.length===1?'?booking='+visits[0].id:'');
      all.push(c.notify(u.id,'bookings',u.email,title+' — The Care Web',title,html,workerRequest?'Review booking requests':'Open bookings',link,undefined,undefined,meta));
    }
    return Promise.all(all);
  }
  function suppress(row,args) {
    const m=args[8]||{};if(!m.booking_lifecycle)return '';
    const recipient=user(row.user_id),p=user(m.booking_participant_id);
    if(!alive(recipient)||!alive(p))return 'Booking account access ended';
    if(m.booking_recipient_role==='participant'&&recipient.id!==p.id)return 'Booking recipient changed';
    if(m.booking_recipient_role==='helper'&&(recipient.role!=='coordinator'||!c.coordsFor(p.id,'bookings').some(h=>h.id===recipient.id)))return 'Booking helper access ended';
    if(m.booking_recipient_role==='worker'&&c.blockedPair?.(p.id,recipient.id))return 'Booking relationship ended';
    const matches=(m.booking_states||[]).some(s=>{
      const b=current(s.id);if(!same(b,s))return false;
      if(m.event_kind==='booking-request')return b.worker_id===recipient.id&&b.status==='requested'&&Number(c.bookingStart(b))>Date.now();
      return m.booking_recipient_role!=='worker'||m.booking_worker_removed||b.worker_id===recipient.id;
    });
    return matches?'':'Booking update superseded or no longer available';
  }
  return {queue,suppress};
};
