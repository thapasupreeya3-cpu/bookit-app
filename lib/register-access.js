'use strict';
const {canonical} = require('./confirmation-proof');
function appendOnly(previous = {}, next = {}) {
  const a={...previous},b={...next};delete a.tables;delete b.tables;
  if(canonical(a)!==canonical(b))return false;
  const before=previous.tables||{},after=next.tables||{};
  return Object.entries(before).every(([key,rows])=>Array.isArray(after[key]) && after[key].length>=rows.length && rows.every((row,i)=>canonical(row)===canonical(after[key][i])));
}
module.exports={appendOnly};
