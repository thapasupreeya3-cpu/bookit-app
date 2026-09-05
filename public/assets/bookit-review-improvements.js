/* The Care Web v86.13.0. Small interaction helpers; the existing app and design remain authoritative. */
'use strict';
window.BookItReview = (() => {
  const drafts=new WeakMap(),threads=new Map();
  let filter=null;
  const text=(value)=>esc(String(value??''));
  function bookingSummary(d){
    const b=(d.bookings||[]).filter(x=>['requested','accepted'].includes(x.status)&&new Date(`${x.date}T${x.start}:00`).getTime()+Number(x.hours)*36e5>Date.now()).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start))[0];
    const actions=(d.bookings||[]).filter(x=>vrole()==='worker'?x.status==='requested':x.status==='completed'&&['pending','queried'].includes(x.approval_state)).length;
    let next='No upcoming visit is booked.';
    if(b){const covering=['finding','office','uncovered','failed','referred','allied'].includes(b.cover_state);const state=covering?'Cover needs attention':b.status==='requested'?'Waiting for worker acceptance':'Confirmed';next=`<b>${text(b.other_name)}</b> · ${text(fmtAU(b.date))} at ${text(b.start)} · ${Number(b.hours)} hours<br><strong>${state}</strong>${covering?'<p>Do not assume the original worker is coming. The office is arranging or confirming cover.</p>':''}`;}
    return `<section class="review-panel" aria-label="Your next visit"><h2 style="font-size:1.25rem;margin:0 0 10px;">${vrole()==='worker'?'Your next shift':'Your next visit'}</h2><p>${next}</p><p>${actions?`<b>${actions} ${vrole()==='worker'?'requests':'timesheets'} need your attention.</b>`:'Your visits and their status are below.'}</p><p class="muted-sm"><a href="#/account">Account settings</a> · <a href="#/messages">Messages</a> · <a href="#/contact">Get help</a>${vrole()==='worker'?' · <a href="#/account/availability">Availability and service areas</a>':''}</p></section>`;
  }
  // A native dialog supplies keyboard focus containment and Escape. No generated image/modal service.
  function decisionDialog(title,content,button='Confirm',validate=()=>true){
    return new Promise(resolve=>{
      const d=document.createElement('dialog');d.className='review-dialog';
      d.innerHTML=`<h2 style="font-size:1.4rem;">${text(title)}</h2>${content}<p class="review-error" role="alert"></p><div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;"><button class="btn btn-primary" type="button" data-confirm>${text(button)}</button><button class="btn btn-secondary" type="button" data-cancel>Not now</button></div>`;
      document.body.appendChild(d);const previous=document.activeElement;
      let finished=false;
      const finish=value=>{if(finished)return;finished=true;d.close();d.remove();previous?.focus?.();resolve(value);};
      d.querySelector('[data-cancel]').onclick=()=>finish(null);d.oncancel=e=>{e.preventDefault();finish(null);};
      d.querySelector('[data-confirm]').onclick=()=>{try{const result=validate(d);if(result===false)return;finish(result===true?{}:result);}catch(e){d.querySelector('.review-error').textContent=e.message;}};
      d.showModal();d.querySelector('[data-cancel]').focus();
    });
  }
  function briefMarkup(brief){
    if(!brief)return '<p>No confirmed plan is currently on file. Contact the office whenever instructions are unclear.</p>';
    const plans=brief.plans||{};
    return `<p><b>Confirmed support plan version ${Number(brief.version||1)}</b></p>
      ${(brief.sections||[]).map(s=>`<h3 style="font-size:1.05rem;">${text(s.title)}</h3><p style="white-space:pre-wrap;">${text(s.body)}</p>`).join('')}
      ${brief.specialised?.length?`<h3>Specialised support</h3><p>${brief.specialised.map(x=>text(x.label)+': <b>'+(x.yes?'yes':'no')+'</b>').join(' · ')}</p>`:''}
      ${(plans.plans||[]).map(p=>`<p><a target="_blank" rel="noopener noreferrer" href="${text(p.url)}">${text(p.label)}</a>${p.doc_date?' — dated '+text(fmtAU(p.doc_date)):''}${p.expired?' — past review date: check with the office before relying on it.':''}</p>`).join('')}
      ${plans.withheld?`<p>${Number(plans.withheld)} clinical plans are not shared online. Arrangement for the day: ${text(plans.note||'ask the office')}.</p>`:''}
      ${brief.care_plans?.length?'<h3>Other care plans named</h3>'+brief.care_plans.map(p=>'<p>'+text(p.name)+(p.on_file?' — on file; ask the office if not linked above.':' — not yet filed.')+'</p>').join(''):''}
      <h3>Emergency contact</h3><p>${text(brief.emergency?.name||'Not recorded')} ${text(brief.emergency?.relationship)} ${text(brief.emergency?.phone)}</p>
      <h3>Before you start</h3><p>${text(brief.home_notice)}</p><p class="muted-sm">This is confidential health information. Read it, work from it, and do not forward it.</p>`;
  }
  async function acceptCover(cid){
    if(!Number.isSafeInteger(cid)||cid<1)throw Error('Refresh the page to load the current cover reference.');
    const r=await API.call(`/cover/${cid}/review`,{method:'POST',body:{}});
    const proof=await decisionDialog('Review this cover visit',`${briefMarkup(r.brief)}<p class="muted-sm">This preview expires and does not reserve the visit. Eligibility and the plan version are checked again when you accept.</p>${r.plan_id?'<label><input type="checkbox" data-read> I have read this confirmed version and will work from it.</label>':''}`,'Accept this visit',d=>{
      if(r.plan_id&&!d.querySelector('[data-read]').checked)throw Error('Read the plan and tick the acknowledgement.');
      return {plan_ack:!!r.plan_id,plan_id:r.plan_id,plan_version:r.plan_version};
    });
    if(!proof)return false;
    await API.call(`/cover/${cid}/claim`,{method:'POST',body:proof});return true;
  }
  async function officeEvidence(bid){
    // Exact booking may be older than the overview window. Dedicated admin lookup avoids guesses.
    const b=await API.call(`/admin/bookings/${bid}/assignment-evidence`);
    return decisionDialog('Record an exceptional assignment',`<p>The worker must have agreed. This records your account of that conversation, not a worker click.</p>${briefMarkup(b.brief)}<label><input type="checkbox" data-agreed> The named worker explicitly agreed to this visit.</label>${b.plan_id?'<p><label><input type="checkbox" data-read> I confirmed with the worker that they read this plan version.</label></p>':''}<label style="display:block;margin-top:12px;">Who spoke to the worker, when, and what was agreed?<textarea data-evidence rows="4" maxlength="2000" style="width:100%;font:inherit;"></textarea></label>`,'Record assignment',d=>{
      if(!d.querySelector('[data-agreed]').checked)throw Error('Explicit worker agreement is required.');
      const note=d.querySelector('[data-evidence]').value.trim();if(note.length<20)throw Error('Record the conversation in at least 20 characters.');
      if(b.plan_id&&!d.querySelector('[data-read]').checked)throw Error('Confirm the worker has read this plan version.');
      return {worker_agreed:true,consent_note:note,plan_read_confirmed:!!b.plan_id,plan_id:b.plan_id,plan_version:b.plan_version};
    });
  }
  function draftPayload(form){
    const id=form.dataset.noteForm;
    const p={note:form.querySelector('.note-body')?.value||'',scope:form.querySelector(`input[name="bkScope${id}"]:checked`)?.value==='yes',scope_detail:form.querySelector('.note-scope-detail')?.value||'',active_note:form.querySelector('.note-active-note')?.value||''};
    const active=form.querySelector('.note-active');if(active)p.active_hours=active.value;
    return p;
  }
  function draftStatus(form,message){const el=form.querySelector('.review-note-state');if(el)el.textContent=message;}
  async function loadDraft(form){
    if(drafts.has(form))return;
    const state={revision:0,loaded:false,dirty:false,conflict:false,saving:null,timer:null,closed:false};drafts.set(form,state);
    const controls=[...form.querySelectorAll('input,textarea,[data-note-save]')];controls.forEach(x=>x.disabled=true);
    try{
      const r=await API.call(`/bookings/${form.dataset.noteForm}/note-draft`);
      if(r.draft){const p=r.draft.payload;state.revision=r.draft.revision;
        const fields={'.note-body':p.note,'.note-scope-detail':p.scope_detail,'.note-active':p.active_hours,'.note-active-note':p.active_note};
        for(const [selector,value]of Object.entries(fields)){const el=form.querySelector(selector);if(el&&value!==undefined)el.value=value;}
        const radio=form.querySelector(`input[name="bkScope${form.dataset.noteForm}"][value="${p.scope?'yes':'no'}"]`);if(radio)radio.checked=true;
        const detail=form.querySelector('.note-scope-detail');if(detail)detail.hidden=!p.scope;
      }
      state.loaded=true;draftStatus(form,r.draft?'Saved draft recovered. This is not yet a completed shift record.':'Draft ready. Changes save securely to your account.');
    }catch(e){draftStatus(form,'Draft could not be loaded. Refresh before writing: '+e.message);}
    finally{controls.forEach(x=>x.disabled=!state.loaded);}
  }
  async function saveDraft(form,throwOnFailure=false){
    const st=drafts.get(form);if(!st||st.closed)return;
    clearTimeout(st.timer);
    if(st.saving)await st.saving;
    if(!st.loaded||st.conflict){if(throwOnFailure)throw Error('Resolve the draft loading or conflict warning before completing.');return;}
    if(!st.dirty)return;
    const payload=draftPayload(form);st.dirty=false;
    draftStatus(form,'Saving draft…');
    st.saving=(async()=>{try{
      const r=await API.call(`/bookings/${form.dataset.noteForm}/note-draft`,{method:'PUT',body:{revision:st.revision,payload}});
      st.revision=r.revision;draftStatus(form,st.dirty?'New changes waiting to save…':'Draft saved securely. The shift is not marked completed.');
    }catch(e){st.dirty=true;st.conflict=!!e.data?.draft_conflict||/another tab|draft changed/i.test(e.message);draftStatus(form,'Not saved: '+e.message);if(throwOnFailure)throw e;}finally{st.saving=null;}})();
    await st.saving;
    if(st.dirty&&!st.conflict&&throwOnFailure)throw Error('Some draft changes are not saved. Try saving again before completing.');
  }
  function finishDraft(form){const st=drafts.get(form);if(st){clearTimeout(st.timer);st.closed=true;st.dirty=false;}draftStatus(form,'Completed note filed. Draft removed.');}
  document.addEventListener('input',e=>{
    const form=e.target.closest('[data-note-form]');if(!form)return;const st=drafts.get(form);if(!st?.loaded)return;
    st.dirty=true;draftStatus(form,'Unsaved changes — saving…');clearTimeout(st.timer);st.timer=setTimeout(()=>saveDraft(form),700);
  });
  document.addEventListener('change',e=>{if(e.target.closest('[data-note-form]'))e.target.dispatchEvent(new Event('input',{bubbles:true}));});
  window.addEventListener('beforeunload',e=>{const dirty=[...document.querySelectorAll('[data-note-form]')].some(f=>drafts.get(f)?.dirty||drafts.get(f)?.saving);if(dirty){e.preventDefault();e.returnValue='';}});
  async function renderAvailability(){
    const wrap=document.getElementById('reviewAvailability');if(!wrap)return;
    try{
      const p=(await API.call('/me/profile',{noFor:true})).profile;
      const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
      const windows=p.availability_windows;
      wrap.innerHTML=`<form id="reviewAvailabilityForm" class="review-panel"><h2>Availability and service areas</h2><p>These settings apply to new requests, cover and reassignment. Existing accepted visits are not silently cancelled. Tell the office when an existing visit needs cover.</p><div class="review-grid"><label>Specific service areas (one per line, or separated by semicolons)<textarea name="service_areas" rows="4" placeholder="Ryde NSW; Parramatta NSW">${text((p.service_areas||[]).join('; '))}</textarea></label><label>Travel buffer between different participants (minutes)<input name="travel_buffer_minutes" type="number" min="0" max="180" value="${Number(p.travel_buffer_minutes||0)}"></label></div><p class="muted-sm">Leave areas empty to match only your profile suburb. Use the same suburb-and-state spelling as the visit, or a postcode. This is not automatic geocoding.</p><label><input name="explicit" type="checkbox" ${windows?'checked':''}> Use specific weekly time windows instead of usual weekdays</label><div class="review-grid" style="margin-top:14px;">${days.map((day,i)=>`<label>${day}<input name="day${i}" value="${text((windows?.[i]||[]).map(r=>r.start+'-'+r.end).join(', '))}" placeholder="09:00-12:00, 13:00-17:00"></label>`).join('')}</div><p class="muted-sm">An empty day means unavailable when specific windows are enabled. Split overnight availability at midnight, e.g. 22:00-24:00 and 00:00-08:00 on the next day.</p><label style="display:block;">Leave (inclusive dates; one range per line)<textarea name="leave" rows="4" style="width:100%;font:inherit;" placeholder="2026-12-20 to 2027-01-05">${text((p.leave_dates||[]).map(x=>x.from+' to '+x.to).join('\n'))}</textarea></label><button type="submit" class="btn btn-primary">Save availability</button><p class="review-availability-status" role="status"></p></form>`;
    }catch(e){wrap.textContent=e.message;}
  }
  async function todayActions(){
    const wrap=document.getElementById('reviewTodayActions');if(!wrap)return;
    try{const r=await API.call('/admin/today-actions');wrap.innerHTML=`<h3>Incident follow-ups</h3>${r.incidents.length?r.incidents.map(i=>`<section class="review-panel"><p><b>Incident #${i.id}</b> · ${text(i.participant)} · ${text(i.category)}</p><p><strong>${text(i.action)}</strong>${i.due?' · due '+text(new Date(i.due).toLocaleString('en-AU')):' · review in the register'}</p><label>Action owner <input data-incident-owner="${i.id}" value="${text(i.owner)}" maxlength="100"></label> <button class="btn btn-secondary btn-sm" type="button" data-save-owner="${i.id}">Save owner</button><p><a href="#/admin/compliance" data-review-incident>Open incident register</a></p></section>`).join(''):'<p>No open incidents in the register.</p>'}<p class="muted-sm">${text(r.note)}</p>`;}catch(e){wrap.textContent='Incident follow-ups could not load: '+e.message;}
  }
  function messageCursor(cid){return threads.get(cid)?.older_cursor;}
  function latestMessage(cid){const rows=threads.get(cid)?.rows;return rows?.size?Math.max(...rows.keys()):null;}
  function mergeMessages(cid,page,older){
    let st=threads.get(cid);
    if(!st){st={rows:new Map(),has_more:page.has_more,older_cursor:page.older_cursor};threads.set(cid,st);}
    for(const m of page.messages)st.rows.set(m.id,m);
    if(older){st.has_more=page.has_more;st.older_cursor=page.older_cursor;}
    // Keep only the active conversation in memory. No messages go into localStorage.
    for(const key of threads.keys())if(key!==cid)threads.delete(key);
    return {...page,messages:[...st.rows.values()].sort((a,b)=>a.id-b.id),has_more:st.has_more,older_cursor:st.older_cursor};
  }
  function workerQuery(){return filter?'?'+filter.toString():'';}
  document.addEventListener('submit',async e=>{
    if(e.target.id==='reviewAvailabilityForm'){
      e.preventDefault();const f=e.target,fd=new FormData(f),status=f.querySelector('.review-availability-status');
      try{const explicit=fd.has('explicit');const windows=explicit?Array.from({length:7},(_,i)=>String(fd.get('day'+i)||'').split(',').filter(x=>x.trim()).map(x=>{const m=/^\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*$/.exec(x);if(!m)throw Error('Use HH:MM-HH:MM time windows, separated by commas.');return {start:m[1],end:m[2]};})):null;
        const leave=String(fd.get('leave')||'').split('\n').filter(x=>x.trim()).map(x=>{const m=/^\s*(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(x);if(!m)throw Error('Use YYYY-MM-DD to YYYY-MM-DD for each leave range.');return {from:m[1],to:m[2]};});
        await API.call('/me/profile',{method:'POST',noFor:true,body:{service_areas:String(fd.get('service_areas')||'').split(/[;\n]/).map(x=>x.trim()).filter(Boolean),availability_windows:windows,leave_dates:leave,travel_buffer_minutes:Number(fd.get('travel_buffer_minutes'))}});
        status.textContent='Saved. Existing accepted visits have not been cancelled.';
      }catch(err){status.textContent=err.message;}
    }
    if(e.target.id==='reviewVisitFilter'){
      e.preventDefault();const fd=new FormData(e.target);filter=new URLSearchParams();for(const k of ['date','start','hours','place'])if(fd.get(k))filter.set(k,fd.get(k));
      // The Care Web's dd/mm date adapter exposes the ISO value on the element, not FormData.
      filter.set('date',e.target.elements.date.value);
      const service=document.getElementById('filterService').value;if(service)filter.set('service',service);
      const ok=await loadWorkersLive();document.getElementById('reviewVisitStatus').textContent=ok?'Showing workers matching the requested interval. Booking checks run again before acceptance.':'Worker results could not be loaded. Check the visit details and try again.';
    }
  });
  document.addEventListener('click',async e=>{
    if(e.target.closest('#reviewClearVisit')){filter=null;await loadWorkersLive();document.getElementById('reviewVisitStatus').textContent='Showing all workers; no particular visit checked.';}
    if(e.target.closest('#reviewOlderMessages')){const c=LIVE.convos.find(c=>c.id===LIVE.activeCid);if(c)await renderThreadOnline(c,true);}
    if(e.target.closest('[data-review-incident]'))CMP_TAB='registers';
    const owner=e.target.closest('[data-save-owner]');if(owner){try{const id=owner.dataset.saveOwner;await API.call('/admin/incidents/'+id,{method:'POST',body:{action:'owner',owner:document.querySelector(`[data-incident-owner="${id}"]`).value}});toast('Action owner saved.');}catch(err){toast(err.message);}}
  });
  document.addEventListener('change',e=>{if(e.target.id==='filterService'&&filter){if(e.target.value)filter.set('service',e.target.value);else filter.delete('service');loadWorkersLive();}});
  return {bookingSummary,acceptCover,officeEvidence,loadDraft,saveDraft,finishDraft,renderAvailability,todayActions,messageCursor,latestMessage,mergeMessages,workerQuery};
})();
