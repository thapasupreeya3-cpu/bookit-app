"use strict";
const time = require('./booking-time');
const availability = require('./worker-availability');
// One policy for requests, invitations, cover, recurring edits, and office decisions.
// An invitation is not acceptance; current-plan evidence is required only at acceptance.
function evaluate(ctx, workerId, booking, options = {}) {
  const b = ctx.completeBooking(booking);
  if (!b) return {error:'Booking not found.',code:'missing_booking'};
  const invalid = time.intervalError(b); if (invalid) return {error:invalid,code:'invalid_interval'};
  const p = ctx.profile(workerId);
  if (!p || !p.visible || p.closed_at || !ctx.platformEligible(workerId,p.email)) return {error:'This worker is not currently cleared and available on The Care Web.',code:'platform'};
  if (b.participant_id && (ctx.participantClosed(b.participant_id) || ctx.blockedPair(b.participant_id,workerId))) return {error:'This worker is blocked for this participant or the participant’s account is closed.',code:'blocked_pair'};
  if (ctx.withdrawnFromOpenCover(workerId,b.id)) return {error:'This worker withdrew from this cover request. The office must resolve it rather than reassigning them automatically.',code:'withdrawn'};
  const training = ctx.moduleState(workerId);
  if (training.lock === 'hard') return {error:`Required training is ${training.overdue_days} days overdue. Complete it before taking new assignments.`,training_lock:'hard',code:'training'};
  let services; try { services=JSON.parse(p.services); } catch {services=[];}
  if (!Array.isArray(services) || !services.includes(b.service)) return {error:'The worker does not offer this support.',code:'service'};
  const place = b.participant_id ? ctx.participantPlace(b.participant_id) : undefined;
  const fit = availability.availability(p,b,place);
  let outOfArea = null;
  if (!fit.ok) {
    /* v86.14.0 — outside the worker's stated area is a warning, not a wall:
       the person choosing (participant, worker, or the office) sees how far
       it is and confirms; the confirmation is kept on the booking. Automatic
       pools (cover offers, the open-shift feed, "next free") never confirm on
       anyone's behalf, so for them this stays a refusal. */
    if (fit.code === 'service_area') {
      const travel = ctx.travel ? ctx.travel(p, place) : null;
      const confirmed = options.out_of_area_ok === true || (options.proof && options.proof.out_of_area_ok === true);
      if (!confirmed) return {...fit, code:'out_of_area', confirm:true, travel, error:`Out of area: this visit is ${travel && travel.known ? travel.text : 'outside ' + (travel && travel.reason ? 'the worker’s stated area (' + travel.reason + ')' : 'the worker’s stated area')}. Confirm to go ahead anyway.`};
      outOfArea = travel;
    } else return {...fit,error:fit.error};
  }
  const clash = ctx.bookingClash(workerId,b.date,b.start,b.hours,{excludeId:b.id||0,statuses:['accepted','completed','requested'],participantId:b.participant_id||-1,bufferMinutes:Number(p.travel_buffer_minutes||0)});
  if (clash) return {error:'This visit overlaps another booking or the worker’s travel buffer.',clash:true,clash_booking_id:clash.id,code:'diary'};
  if (options.accept && !options.office && +time.localStart(b) <= Date.now()) return {error:'This visit has already started. Contact the office.',code:'started'};
  const ack = b.kind === 'intro' ? {required:false,acked:true} : ctx.planAck(b.participant_id,workerId);
  if (options.accept && ack.required && !ack.acked) {
    const proof = options.proof || {};
    if (proof.plan_ack !== true || Number(proof.plan_id) !== ack.plan_id || Number(proof.plan_version) !== ack.version) return {error:'Read the current support plan and confirm its displayed version before accepting.',plan_ack_required:true,plan_id:ack.plan_id,version:ack.version,code:'plan_ack'};
  }
  return {ok:true,ack,fit,booking:b,profile:p,out_of_area:outOfArea};
}
module.exports = {evaluate};
