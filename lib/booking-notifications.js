'use strict';
// Booking updates use the same durable outbox as other transactional mail.
// Keep arrival details, private addresses and shift notes behind sign-in.
const crypto = require('node:crypto');
module.exports = function bookingNotifications(c) {
  const {db} = c;
  const snapshot = b => ({id:b.id,participant_id:b.participant_id,worker_id:b.worker_id,service:b.service,date:b.date,start:b.start,hours:b.hours,status:b.status,accepted_at:b.accepted_at||'',cancelled_at:b.cancelled_at||'',cover_state:b.cover_state||'',delivered_by_allied:b.delivered_by_allied||''});
  const user = id => db.prepare('SELECT id,name,email,role,closed_at FROM users WHERE id=?').get(id);
  const current = id => db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  const active = u => u && !u.closed_at;
  const alive = u => active(u) && u.email;
  const same = (b,s) => b && !b.voided && ['participant_id','worker_id','service','date','start','hours','status','accepted_at','cancelled_at','cover_state','delivered_by_allied'].every(k => String(b[k]||'') === String(s[k]||''));
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
    if(!active(participant))return Promise.resolve([]);
    const recipients=new Map();
    function add(u,role,visits=rows) {
      if(!alive(u))return;
      const prior=recipients.get(u.id);
      recipients.set(u.id,{u,role,rows:prior?[...new Map([...prior.rows,...visits].map(b=>[b.id,b])).values()]:visits});
    }
    add(participant,'participant');
    for(const helper of c.coordsFor(pid,'bookings')){const u=user(helper.id);if(u?.role==='coordinator')add(u,'helper');}
    if(options.includeWorker||!['accepted','declined','covered'].includes(event)) {
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
      const titles={requested:workerRequest?'New booking request':'Booking request received',accepted:'Booking confirmed',covered:'Cover confirmed',declined:'Booking request declined',cancelled:'Booking cancelled',changed:removed?'Booking assignment changed':'Booking details changed',ended:'Repeating bookings ended'};
      const title=titles[event];if(!title)throw Error('Unknown booking notification event.');
      const label=c.escHtml(participant.name||'Participant');
      const descriptions={
        requested:workerRequest?`<p><b>${label}</b> has requested ${many?'repeating visits':'a visit'}. Please review the outstanding requests and accept or decline each visit.</p>`:`<p>Your ${many?'booking requests have':'booking request has'} been sent to the worker. <b>Waiting for the worker to respond.</b> We will email you when they accept or decline.</p>`,
        covered:`<p>Your visit will be delivered by <b>${c.escHtml(options.alliedName||'the confirmed partner provider')}</b>. Open the booking for the current cover arrangement and contact the office if you have a question.</p>`,
        accepted:role==='worker'?`<p>Your visit with <b>${label}</b> is confirmed. Open the booking for the details.</p>`:'<p>The worker has accepted the visit'+(many?'s':'')+'. Your booking'+(many?'s are':' is')+' confirmed.</p>',
        declined:'<p>The worker has declined the request'+(many?'s':'')+'. Open your bookings to choose another worker or arrange a different time.</p>',
        cancelled:'<p>The booking'+(many?'s have':' has')+' been cancelled. Open the booking record for the cancellation details and any applicable charge.</p>',
        changed:removed?'<p>You are no longer assigned to the affected visits. Check your diary for your current bookings.</p>':'<p>The booking details have changed. '+(visits.some(b=>b.status==='requested')?'The changed requests need a fresh worker response. ':'')+'Open your bookings for the current details.</p>',
        ended:'<p>The repeating booking has ended and the affected future visits have been cancelled. Past visits and separately moved visits remain in your booking history. Open the records for any applicable cancellation charges.</p>'
      };
      // This is an event receipt, not a promise that a later booking change
      // has not occurred. Requests in a series remain relevant while any
      // of its originally addressed visits still need this worker's reply.
      const detail=visits.map(b=>`<li>${c.escHtml(c.prettyDate(b.date))} at ${c.escHtml(b.start)} · ${Number(b.hours)} hours · ${c.escHtml(c.serviceLabels[b.service]||b.service)}${role!=='worker'?' · '+c.escHtml(event==='covered'?(options.alliedName||'Partner provider'):(user(b.worker_id)?.name||'Worker')):''}</li>`).join('');
      const helperIntro=role==='helper'?`<p>This booking update is for <b>${label}</b>. After signing in, select <b>${label}</b> as the participant you are helping, then open Bookings.</p>`:'';
      const html=helperIntro+descriptions[event]+`<p>${many?'Affected visits':'Visit'} at the time of this update:</p><ul>${detail}</ul>`+(workerRequest?options.workerHtml||'':'')+'<p>Your website booking record always shows the latest status and details.</p>';
      const states=visits.map(snapshot).sort((a,b)=>a.id-b.id);
      const key='booking-notice:'+crypto.createHash('sha256').update(JSON.stringify({event,event_id:options.event_id||'',recipient:u.id,states,previous:(options.previousRows||[]).map(snapshot)})).digest('hex');
      const meta={event_key:key,kind:'bookings',transactional:true,booking_lifecycle:true,booking_event:event,event_kind:workerRequest?'booking-request':'booking-'+event,booking_id:visits[0].id,booking_ids:states.map(b=>b.id),booking_states:states,booking_participant_id:pid,booking_recipient_role:role,booking_worker_removed:removed,expires_at:expiry(visits,event)};
      // CareFlow applies the helper's explicit participant context; Calendar
      // does not. A grouped helper receipt opens its first affected visit.
      const single=(visits.length===1||role==='helper')&&!removed;
      const link=c.baseUrl(req)+(single?'/#/journey?panel=shift&booking='+visits[0].id:'/#/bookings')+(role==='helper'?(single?'&':'?')+'for='+pid:'');
      all.push(c.notify(u.id,'bookings',u.email,title+' — The Care Web',title,html,workerRequest?'Review booking requests':'Open bookings',link,undefined,undefined,meta));
    }
    return Promise.all(all);
  }
  // These are explicit transactional events, never folded into a daily digest.
  // Only a link to the signed-in record leaves the site: notes and questions can
  // contain health information and must not be copied into ordinary email.
  function shiftRecipients(b,reviewOnly=false) {
    const participant=user(b.participant_id);
    if(!active(participant))return [];
    const people=[participant,...c.coordsFor(b.participant_id,'bookings').map(h=>user(h.id)).filter(u=>u?.role==='coordinator')].filter(alive);
    return reviewOnly&&c.approvalRecipients?c.approvalRecipients(b.participant_id,people):people;
  }
  function queueShift(req,event,value,options={}) {
    const b=current(typeof value==='object'?value.id:value);
    if(!b||b.voided||b.status!=='completed'||!active(user(b.participant_id)))return Promise.resolve([]);
    const reviewEvents=['review','answered','reminder','note-added'];
    const workerOnly=['submitted','approved','queried'].includes(event);
    let recipients=workerOnly?[user(b.worker_id)]:shiftRecipients(b,reviewEvents.includes(event));
    if(event==='deemed')recipients=[...recipients,user(b.worker_id)];
    recipients=[...new Map(recipients.filter(alive).map(u=>[u.id,u])).values()];
    const pending=['review','answered','reminder'].includes(event);
    const phase=pending||event==='note-added'?b.approval_from||b.completed_at||b.date:event==='queried'?b.query_at:event==='approved'||event==='deemed'?b.approved_at:b.completed_at;
    const title={submitted:'Shift completion saved',review:'Completed shift ready to review',completed:'Meet-and-greet completed',approved:'Timesheet approved',queried:'Question about your timesheet',answered:'Your question has been answered',reminder:'A timesheet is waiting for you',deemed:'Timesheet approved automatically','note-added':'A shift note has been updated'}[event];
    if(!title)throw Error('Unknown shift notification event.');
    const participant=user(b.participant_id),worker=user(b.worker_id);
    const label=`<b>${c.escHtml(c.prettyDate(b.date))} at ${c.escHtml(b.start)}</b>`;
    const deadline=c.prettyDate(c.ymd(new Date(Date.parse(b.approval_from||b.completed_at||b.date||new Date().toISOString())+(c.approvalDays||7)*864e5)));
    return Promise.all(recipients.map(u=>{
      const role=u.id===b.worker_id?'worker':u.id===b.participant_id?'participant':'helper';
      if(role==='worker'&&c.blockedPair?.(b.participant_id,u.id))return Promise.resolve('relationship-ended');
      const intro=role==='helper'?`<p>This update is for <b>${c.escHtml(participant.name||'the participant')}</b>. The link opens their shift after you sign in.</p>`:'';
      const texts={
        submitted:`<p>Your completion and shift note for ${label} have been saved. You do not need to submit them again.</p><p>${b.kind==='intro'?'The meet-and-greet is recorded.':'The shift details are ready for participant review. Check Earnings for the separate payroll status; this receipt is not a payment confirmation.'}</p>`,
        review:`<p><b>${c.escHtml(worker?.name||'Your worker')}</b> has submitted the completed shift for ${label}.</p><p>Read the shift note, then approve the details or report an issue. Please review by <b>${c.escHtml(deadline)}</b>.${b.invoice_no?' Any invoice and payment status are shown with the shift.':''}</p>`,
        completed:`<p>The meet-and-greet for ${label} has been recorded as completed. Open the booking to see the details.</p>`,
        approved:`<p>The shift details for ${label} have been approved. Check Earnings for the separate payroll status.</p>`,
        queried:`<p>A question has been raised about your shift for ${label}. Open the shift, read the question and add your answer to the note. The original note stays on the record.${b.invoice_no?' Invoice collection is paused while the issue is reviewed.':''}</p>`,
        answered:`<p><b>${c.escHtml(worker?.name||'Your worker')}</b> has answered the question about the shift for ${label}. Read the answer and approve it or ask another question by <b>${c.escHtml(deadline)}</b>.${b.invoice_no?' Invoice collection remains paused until explicit approval.':''}</p>`,
        reminder:`<p>The completed shift for ${label} is waiting for review. Read the shift note and approve the details by <b>${c.escHtml(deadline)}</b>, or report an issue to pause the review clock. If no question is raised, it is automatically approved after ${c.approvalDays||7} days.</p>`,
        deemed:`<p>The completed shift for ${label} has been approved automatically after the published review period. You can still raise a concern with the office.${role==='worker'?' Check Earnings for the separate payroll status.':' This notice does not confirm that payment was taken.'}</p>`,
        'note-added':`<p>An addendum has been saved for the shift on ${label}. Open the shift to read it. The original note remains unchanged.</p>`
      };
      const states=[snapshot(b)];
      const key=options.event_key?options.event_key(u):`shift-${event}:${b.id}:${u.id}:${phase||'recorded'}${options.note_id?':'+options.note_id:''}`;
      const meta={event_key:key,kind:'timesheets',transactional:true,booking_lifecycle:true,booking_shift_event:event,event_kind:'shift-'+event,booking_id:b.id,booking_ids:[b.id],booking_states:states,booking_participant_id:b.participant_id,booking_recipient_role:role,booking_shift_phase:phase||'',booking_note_id:options.note_id||null,requires_approval:pending,expires_at:new Date(Date.now()+30*864e5).toISOString()};
      const link=c.baseUrl(req||{headers:{}})+'/#/journey?panel=shift&booking='+b.id+(role==='helper'?'&for='+b.participant_id:'');
      return c.notify(u.id,'timesheets',u.email,title+' — The Care Web',title,intro+texts[event],event==='queried'?'Read and answer question':pending?'Review completed shift':'Open shift',link,undefined,undefined,meta);
    }));
  }
  function suppress(row,args) {
    const m=args[8]||{};if(!m.booking_lifecycle)return '';
    const recipient=user(row.user_id),p=user(m.booking_participant_id);
    if(!alive(recipient)||!active(p))return 'Booking account access ended';
    if(m.booking_recipient_role==='participant'&&recipient.id!==p.id)return 'Booking recipient changed';
    if(m.booking_recipient_role==='helper'&&(recipient.role!=='coordinator'||!c.coordsFor(p.id,'bookings').some(h=>h.id===recipient.id)))return 'Booking helper access ended';
    if(m.booking_recipient_role==='worker'&&c.blockedPair?.(p.id,recipient.id))return 'Booking relationship ended';
    if(m.booking_shift_event){
      const b=current(m.booking_id),event=m.booking_shift_event;
      if(!b||b.voided||b.status!=='completed'||b.participant_id!==m.booking_participant_id)return 'Shift no longer available';
      if(m.booking_recipient_role==='worker'&&b.worker_id!==recipient.id)return 'Shift worker changed';
      const s=m.booking_states?.[0];
      if(!s||!same(b,s))return 'Shift details changed';
      const reviewOnly=['review','answered','reminder','note-added'].includes(event);
      if(reviewOnly&&!shiftRecipients(b,true).some(u=>u.id===recipient.id))return 'Shift review owner changed';
      const phase=['review','answered','reminder','note-added'].includes(event)?b.approval_from||b.completed_at||b.date:event==='queried'?b.query_at:event==='approved'||event==='deemed'?b.approved_at:b.completed_at;
      if(String(phase||'')!==String(m.booking_shift_phase||''))return 'Shift review cycle changed';
      if(['review','answered','reminder'].includes(event)&&b.approval_state!=='pending')return 'Shift review completed or queried';
      if(event==='queried'&&b.approval_state!=='queried')return 'Shift question answered';
      if(['approved','deemed'].includes(event)&&b.approval_state!=='approved')return 'Shift approval superseded';
      return '';
    }
    const matches=(m.booking_states||[]).some(s=>{
      const b=current(s.id);
      // Acceptance is a factual receipt: normal completion must not erase it
      // during a transport retry. A move, reassignment or cancellation still does.
      const acceptedThenCompleted=m.booking_event==='accepted'&&s.status==='accepted'&&b?.status==='completed';
      if(!same(acceptedThenCompleted?{...b,status:'accepted'}:b,s))return false;
      if(m.event_kind==='booking-request')return b.worker_id===recipient.id&&b.status==='requested'&&Number(c.bookingStart(b))>Date.now();
      return m.booking_recipient_role!=='worker'||m.booking_worker_removed||b.worker_id===recipient.id;
    });
    return matches?'':'Booking update superseded or no longer available';
  }
  return {queue,queueShift,shiftRecipients,suppress};
};
