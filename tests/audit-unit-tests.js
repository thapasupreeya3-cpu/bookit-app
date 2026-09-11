'use strict';
const assert=require('node:assert/strict');
const proof=require('../lib/confirmation-proof');
const hours=require('../lib/active-hours');
const access=require('../lib/register-access');
const state=require('../public/assets/policy-register-state');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
const table=rows=>({tables:{0:rows}});
test('Confirmation hash ignores object key order, not changed values',()=>{
  assert.equal(proof.digest({a:1,b:2}),proof.digest({b:2,a:1}));assert.notEqual(proof.digest({a:1}),proof.digest({a:2}));
});
test('Confirmation rejects tampering, another intent, expiry and excessive input',()=>{
  let now=1000;const p=proof.create('unit-test-key',()=>now),t=p.issue('actor/visit',{source:'google',minutes:77});
  assert.equal(p.verify(t,'actor/visit').estimate.minutes,77);
  assert.equal(p.verify(t+'x','actor/visit'),null);assert.equal(p.verify(t,'another actor'),null);
  assert.equal(p.verify('x'.repeat(12001),'actor/visit'),null);now+=15*60000;assert.equal(p.verify(t,'actor/visit'),null);
});
test('Strict hours accept exact valid numeric inputs and reject all coerced shapes',()=>{
  for(const v of [0,2,2.25,8,'0','2.25'])assert.equal(hours.validate(v,8).hours,Number(v));
  for(const v of [null,undefined,'',true,false,[],[3],{},'   ','1e0','0x10',Infinity,NaN,-1,9,2.12])assert.ok(hours.validate(v,8).error,JSON.stringify(v));
  assert.equal(hours.validate(2.12,8).code,'active_hours_increment');
});
test('Append grants cannot replace, delete, reorder or change metadata',()=>{
  const a=table([['first'],['second']]);
  assert.equal(access.appendOnly(a,table([['first'],['second'],['third']])),true);
  for(const b of [table([['changed'],['second']]),table([['first']]),table([['second'],['first']]),{...a,by:{name:'other'}}])assert.equal(access.appendOnly(a,b),false);
});
test('Conflicting appends retain both people’s entries without mutating any input',()=>{
  const b=table([['saved']]),l=table([['saved'],['mine']]),r=table([['saved'],['theirs']]);
  const before=JSON.stringify([b,l,r]),merged=state.merge(b,l,r);
  assert.deepEqual(merged,{data:table([['saved'],['theirs'],['mine']]),conflicts:[]});assert.equal(JSON.stringify([b,l,r]),before);
});
test('Simultaneous existing-row edits require manual recovery and retain local text',()=>{
  const b=table([['saved']]),l=table([['my full draft']]),r=table([['their correction']]);
  assert.deepEqual(state.merge(b,l,r).conflicts,['0']);assert.equal(l.tables[0][0][0],'my full draft');
});
test('A response lost after a successful save can be reconciled without duplicate rows',()=>{
  const b=table([['saved']]),l=table([['saved'],['mine']]);assert.deepEqual(state.merge(b,l,l),{data:l,conflicts:[]});
});
test('Independent table edits combine while conflicting deletion never overwrites',()=>{
  const b={tables:{0:[['a']],1:[['b']]}},l={tables:{0:[['mine']],1:[['b']]}},r={tables:{0:[['a']],1:[['theirs']]}};
  assert.deepEqual(state.merge(b,l,r),{data:{tables:{0:[['mine']],1:[['theirs']]}},conflicts:[]});
  assert.deepEqual(state.merge(table([['a']]),table([]),table([['changed']])).conflicts,['0']);
});
console.log(passed+' audit unit groups passed');
