"use strict";
const DESCRIPTION='Completed ordinary shifts only. Sleepovers, meet-and-greets, voided records and fee-only lines do not count.';
function hours(db,workerId){return Number(db.prepare("SELECT COALESCE(SUM(hours),0) AS h FROM bookings WHERE worker_id=? AND status='completed' AND COALESCE(kind,'shift')='shift' AND COALESCE(sleepover,0)=0 AND COALESCE(voided,0)=0").get(workerId).h);}
module.exports={hours,DESCRIPTION};
