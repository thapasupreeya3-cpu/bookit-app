"use strict";
const {localStart} = require('./booking-time');
function mayReadCurrent(ctx, workerId, participantId) {
  if (ctx.blockedPair(participantId,workerId)) return false;
  const p=ctx.profile(workerId);
  if (!p || p.closed_at || !p.visible || !ctx.platformEligible(workerId,p.email) || ctx.participantClosed(participantId)) return false;
  const active = ctx.activeBookings(workerId,participantId);
  if (active.some(b => +localStart(b)+Number(b.hours)*36e5 > Date.now() && !['finding','office','uncovered','failed','allied','referred','stood-down'].includes(b.cover_state))) return true;
  return ctx.activeOffers(workerId,participantId).some(b => +localStart(b)>Date.now() && ctx.candidate(workerId,b).ok);
}
module.exports={mayReadCurrent};
