'use strict';
/* Address forms stay separate from public profiles. Each visit uses its own saved snapshot. */
window.CareLocations=(()=>{
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=['unit','street','suburb','state','postcode','arrival_notes'];
  const stateOptions=['','NSW','VIC','QLD','ACT','NT','SA','TAS','WA'];
  const choices=[['saved','Saved address'],['other','Another address'],['community','Community meeting point'],['unconfirmed','Confirm later']];
  const subject=()=>`${window.API?.me?.id||''}:${window.API?.actingFor?.id||''}`;
  const scoped=()=>window.API?.actingFor?.id?'?for='+Number(API.actingFor.id):'';
  const chooserStates=new WeakMap(),mounted=new WeakMap();
  let generation=0;
  function input(name,label,value='',extra=''){return `<label>${escape(label)}<input name="${name}" value="${escape(value)}" ${extra}></label>`;}
  function addressFields(address={},community=false){return `<div class="sl-fields">${community?input('meeting_point','Meeting point',address.meeting_point,'maxlength="160" placeholder="Place name and where to meet"'):''}${input('unit','Unit / apartment (optional)',address.unit,'maxlength="40" autocomplete="address-line2"')}${input('street','Street address',address.street,'maxlength="160" autocomplete="address-line1"')}${input('suburb','Suburb',address.suburb,'maxlength="80" autocomplete="address-level2"')}<label>State / territory<select name="state" autocomplete="address-level1">${stateOptions.map(state=>`<option value="${state}" ${state===String(address.state||'')?'selected':''}>${state||'Choose state'}</option>`).join('')}</select></label>${input('postcode','Postcode',address.postcode,'maxlength="4" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{4}"')}<label class="sl-full">Parking, access and arrival instructions (optional)<textarea name="arrival_notes" rows="3" maxlength="1000" placeholder="For example, step-free entrance on the left">${escape(address.arrival_notes)}</textarea></label></div>`;}
  function readFields(host){return Object.fromEntries([...fields,'meeting_point'].map(name=>[name,String(host.querySelector(`[name="${name}"]`)?.value||'').trim()]));}
  function locality(address={}){return [address.suburb,address.state,address.postcode].filter(Boolean).join(' ');}
  function addressText(address={},full=true){return full?[address.meeting_point,[address.unit,address.street].filter(Boolean).join(' / '),locality(address)].filter(Boolean).join(', '):locality(address);}
  function status(host,text,bad=false){const node=host.querySelector('[data-sl-status]');if(node){node.textContent=text;node.classList.toggle('sl-error',bad);}}
  function workerAreas(worker){const areas=Array.isArray(worker.service_areas)?worker.service_areas.map(x=>String(x).trim()).filter(Boolean):[];return `<section class="sl-worker-areas" aria-label="Location and travel"><h3>Areas I cover</h3>${areas.length?'<p>'+areas.map(x=>`<span class="sl-area">${escape(x)}</span>`).join(' ')+'</p>':'<p>Ask this worker which areas they can cover.</p>'}<p class="muted-sm">Ask about visits outside these areas. Any travel estimate uses stated areas; it is not the worker’s current location or arrival time.</p></section>`;}
  async function selectLinkedParticipant(){
    const id=Number(new URLSearchParams(location.hash.split('?')[1]||'').get('for'));
    if(API.me?.role!=='coordinator'||!id||id===Number(API.actingFor?.id))return;
    const who=API.me.id,hash=location.hash;
    const result=await API.call('/coordinator/clients',{noFor:true});
    if(API.me?.id!==who||location.hash!==hash)return;
    const client=result.clients?.find(x=>Number(x.id)===id);
    if(!client)throw Error('Access to this person is no longer available.');
    API.actingFor={...client,id:Number(client.id)};
  }
  async function mountSettings(host){
    if(!host)return;
    const initial=++generation;let requestSubject=subject(),requestHash=location.hash;host.innerHTML='<p>Loading address &amp; arrival details…</p>';
    try{
      await selectLinkedParticipant();
      if(initial!==generation||!host.isConnected)return;
      if(API.me?.role==='coordinator'&&!API.actingFor){host.innerHTML='<h2>Address &amp; arrival details</h2><p><a href="#/clients">Choose a person from My clients</a> to manage their support address.</p>';return;}
      const identity=subject(),hash=location.hash;requestSubject=identity;requestHash=hash;
      const current=()=>initial===generation&&host.isConnected&&identity===subject()&&hash===location.hash;
      const data=await API.call('/me/service-address');if(!current())return;
      host.innerHTML=`<article class="info-card sl-settings"><h2>Address &amp; arrival details</h2>${API.actingFor?`<p>For <b>${escape(API.actingFor.name)}</b></p>`:''}<p>Save where support usually starts. You can choose a different place for each booking.</p><p class="sl-privacy">Your street address and arrival instructions are private. Your assigned worker sees them after accepting the booking.</p><form data-sl-address-form>${addressFields(data.address)}<div class="sl-actions"><button class="btn btn-primary" type="submit">Save address</button><button class="btn btn-secondary" type="button" data-sl-reload hidden>Review latest saved address</button></div><p data-sl-status role="status" aria-live="polite">${data.complete?'Address saved.':'Add your support location when you are ready. You can still browse and book.'}</p></form><p class="muted-sm">Changing this address applies to new bookings. Existing visits keep their agreed location. Open a booking to change that visit.</p></article>`;
      let revision=data.revision,busy=false;
      host.querySelector('[data-sl-reload]').onclick=()=>mountSettings(host);
      host.querySelector('form').onsubmit=async event=>{
        event.preventDefault();if(busy||!current())return;
        busy=true;const button=host.querySelector('button[type="submit"]');button.disabled=true;status(host,'Saving address…');
        try{
          const values=readFields(host),address=Object.fromEntries(fields.map(name=>[name,values[name]]));
          const saved=await API.call('/me/service-address',{method:'PUT',body:{address,revision}});if(!current())return;
          revision=saved.revision;
          if(!API.actingFor){API.me.suburb=saved.address?.suburb||'';const suburb=document.getElementById('detSuburb');if(suburb)suburb.value=API.me.suburb;}
          status(host,saved.complete?'Address saved. Existing bookings keep their agreed location.':'Details saved. Add the remaining address details when ready.');
          host.querySelector('[data-sl-reload]').hidden=true;
          window.CarePayments?.refreshAlerts?.(true);
        }catch(error){if(current()){status(host,error.status===409?'A newer address has been saved. Your edits are still here; review the latest address before trying again.':error.message,true);if(error.status===409)host.querySelector('[data-sl-reload]').hidden=false;}}
        finally{busy=false;if(current())button.disabled=false;}
      };
    }catch(error){if(initial===generation&&host.isConnected&&requestSubject===subject()&&requestHash===location.hash){host.innerHTML=`<article class="info-card"><h2>Address &amp; arrival details</h2><p class="sl-error" role="alert">${escape(error.message)}</p>${error.status===403?'<p>Managing this address needs permission to manage bookings. Contact the participant or office.</p>':'<button type="button" class="btn btn-secondary" data-sl-retry>Try again</button>'}</article>`;host.querySelector('[data-sl-retry]')?.addEventListener('click',()=>mountSettings(host));}}
  }
  function chooserMarkup(state){const mode=state.mode;return `<label class="sl-choose">Where will support start?<select data-sl-mode>${choices.map(([value,label])=>`<option value="${value}" ${mode===value?'selected':''}>${state.editing&&value==='other'?'Current or another address':label}</option>`).join('')}</select></label><div data-sl-fields>${mode==='saved'?`<div class="sl-saved"><p>${state.loading?'Loading saved address… If you send now, your latest saved address will be used.':state.saved?.complete?escape(addressText(state.saved.address)):'No complete saved address yet.'}</p>${!state.loading&&!state.saved?.complete?`<p><a href="#/account/address${scoped()}" data-close-modal>Add your support location</a>, enter another place, or confirm it later.</p>`:''}${state.saved?.address?.arrival_notes?`<p class="sl-arrival">${escape(state.saved.address.arrival_notes)}</p>`:''}</div>`:mode==='unconfirmed'?'<p class="sl-notice">Location to be confirmed. Agree a meeting place before the visit; you can update this booking later.</p>':addressFields(state.draft,mode==='community')}</div><p class="muted-sm">This location is saved for this booking${state.editing?' only':' and its repeating dates, if any'}. Exact details are shared with the assigned worker after acceptance.</p>`;}
  function paintChooser(host,state){
    host.innerHTML=chooserMarkup(state);
    const select=host.querySelector('[data-sl-mode]');
    select.onchange=()=>{if(['other','community'].includes(state.mode))state.draft=readFields(host);state.mode=select.value;paintChooser(host,state);host.querySelector('[data-sl-mode]')?.focus();};
  }
  async function mountChooser(host,initial){
    if(!host)return;
    const state={mode:initial?initial.mode==='saved'?'other':initial.mode||'unconfirmed':'saved',draft:{...initial},editing:!!initial,saved:null,loading:true,identity:subject()};
    chooserStates.set(host,state);paintChooser(host,state);
    try{const data=await API.call('/me/service-address');if(chooserStates.get(host)!==state||state.identity!==subject()||!host.isConnected)return;if(['other','community'].includes(state.mode))state.draft=readFields(host);state.saved=data;state.loading=false;paintChooser(host,state);}
    catch(error){if(chooserStates.get(host)!==state||state.identity!==subject()||!host.isConnected)return;if(['other','community'].includes(state.mode))state.draft=readFields(host);state.loading=false;state.error=error.message;if(state.mode==='saved'){state.mode='unconfirmed';paintChooser(host,state);host.insertAdjacentHTML('beforeend',`<p class="sl-notice" role="status">Saved address could not be loaded. Enter a place or confirm it later.</p>`);}}
  }
  function chooserValue(host){
    const state=chooserStates.get(host);if(!state||state.identity!==subject())return {mode:'unconfirmed'};
    if(state.mode==='saved')return {mode:'saved',...(state.saved?{source_revision:state.saved.revision}:{})};
    if(state.mode==='unconfirmed'){const area=state.draft?.suburb?state.draft:state.saved?.address||API.actingFor||API.me||{};return {mode:'unconfirmed',suburb:String(area.suburb||''),state:String(area.state||''),postcode:String(area.postcode||'')};}
    return {mode:state.mode,...readFields(host)};
  }
  function bookingView(data){
    const full=data.disclosure==='full',address=data.location||{},text=addressText(address,full);
    const usable=full&&data.complete&&text;
    const directions=usable?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(text):'';
    return `<section class="sl-booking"><div class="sl-heading"><b>${full?'Agreed meeting place':'Booking area'}</b>${data.changed?'<span class="sl-chip">↻ Location updated</span>':''}</div>${text?`<p class="sl-address">${escape(text)}</p>`:'<p class="sl-notice">Location to be confirmed. Agree a meeting place before the visit.</p>'}${!full?'<p class="muted-sm">Exact meeting details are available after you accept this booking.</p>':address.arrival_notes?`<p class="sl-arrival"><b>Arrival instructions</b><br>${escape(address.arrival_notes)}</p>`:''}${full&&!data.complete&&text?'<p class="sl-notice">Some meeting details are still to be confirmed.</p>':''}${full&&data.needs_acknowledgement&&!data.can_acknowledge?'<p class="sl-notice">Waiting on the worker to review the updated location. The booking remains accepted.</p>':''}${data.changed&&data.updated_at?`<p class="muted-sm">Updated ${escape(new Date(data.updated_at).toLocaleString('en-AU'))}. Check the latest meeting details.</p>`:''}<div class="sl-actions">${directions?`<a class="btn btn-secondary btn-sm" href="${escape(directions)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Directions on Google Maps ↗</a>`:''}${full&&data.can_edit?'<button class="btn btn-secondary btn-sm" type="button" data-sl-edit>Change support location</button>':''}${full&&data.can_acknowledge&&data.needs_acknowledgement?'<button class="btn btn-primary btn-sm" type="button" data-sl-ack>Confirm location seen</button>':''}</div>${directions?'<p class="muted-sm">Opening directions shares the meeting address with Google Maps.</p>':''}<div data-sl-edit-host></div><button type="button" class="btn btn-secondary btn-sm" data-sl-booking-reload hidden>Review latest location</button><p data-sl-status role="status" aria-live="polite"></p></section>`;
  }
  async function mountBooking(host,id){
    if(!host||!Number.isSafeInteger(Number(id))||Number(id)<1)return;
    const marker={},identity=subject(),hash=location.hash;mounted.set(host,marker);
    const current=()=>mounted.get(host)===marker&&identity===subject()&&host.isConnected&&hash===location.hash;
    host.innerHTML='<p>Loading support location…</p>';
    try{
      const data=await API.call('/bookings/'+Number(id)+'/location');if(!current())return;
      host.innerHTML=bookingView(data);
      host.querySelector('[data-sl-booking-reload]').onclick=()=>mountBooking(host,id);
      host.querySelector('[data-sl-ack]')?.addEventListener('click',async event=>{
        if(!current())return;const button=event.currentTarget;button.disabled=true;
        try{await API.call('/bookings/'+Number(id)+'/location/ack',{method:'POST',body:{revision:data.revision}});if(!current())return;await mountBooking(host,id);if(identity===subject()&&hash===location.hash&&host.isConnected)status(host,'Location seen. Your booking is unchanged.');}
        catch(error){if(current()){status(host,error.status===409?'The location has changed again. Reload the latest details before confirming.':error.message,true);button.disabled=false;if(error.status===409)host.querySelector('[data-sl-booking-reload]').hidden=false;}}
      });
      host.querySelector('[data-sl-edit]')?.addEventListener('click',async()=>{
        if(!current())return;const editor=host.querySelector('[data-sl-edit-host]');
        editor.innerHTML='<form class="sl-editor"><h3>Change this visit’s location</h3><div data-sl-edit-chooser></div><p>The assigned worker will receive a location update. Other visits keep their current location.</p><label class="sl-confirm"><input type="checkbox" name="confirm" required> Use this location for this visit.</label><div class="sl-actions"><button type="submit" class="btn btn-primary btn-sm">Save this visit’s location</button><button type="button" class="btn btn-secondary btn-sm" data-sl-cancel>Cancel</button></div><p data-sl-status role="status" aria-live="polite"></p></form>';
        const chooser=editor.querySelector('[data-sl-edit-chooser]');await mountChooser(chooser,data.location);if(!current())return;
        editor.querySelector('[data-sl-cancel]').onclick=()=>{editor.innerHTML='';host.querySelector('[data-sl-edit]')?.focus();};
        let busy=false;editor.querySelector('form').onsubmit=async event=>{
          event.preventDefault();if(busy||!current())return;
          if(!editor.querySelector('[name="confirm"]').checked){status(editor,'Confirm the location change before saving.',true);return;}
          const button=editor.querySelector('button[type="submit"]');busy=true;button.disabled=true;status(editor,'Saving this visit’s location…');
          try{await API.call('/bookings/'+Number(id)+'/location',{method:'PUT',body:{location:chooserValue(chooser),revision:data.revision,confirm:true}});if(!current())return;await mountBooking(host,id);if(identity===subject()&&hash===location.hash&&host.isConnected)status(host,'Location saved for this visit. The worker’s update is queued.');}
          catch(error){if(current()){status(editor,error.status===409&&error.data?.code!=='out_of_area'?'This booking has changed. Your edits are still here. Review the latest location before saving again.':error.message,true);if(error.status===409&&error.data?.code!=='out_of_area')host.querySelector('[data-sl-booking-reload]').hidden=false;}}
          finally{busy=false;if(current()&&button.isConnected)button.disabled=false;}
        };
      });
    }catch(error){if(current()){host.innerHTML=`<p class="sl-error" role="alert">${escape(error.message)}</p><button type="button" class="btn btn-secondary btn-sm" data-sl-retry>Reload support location</button>`;host.querySelector('[data-sl-retry]').onclick=()=>mountBooking(host,id);}}
  }
  function mountList(root){root?.querySelectorAll('[data-service-location-details]').forEach(detail=>{detail.addEventListener('toggle',()=>{if(detail.open){const host=detail.querySelector('[data-service-location-booking]');if(host&&!mounted.has(host))mountBooking(host,Number(detail.dataset.serviceLocationDetails));}});});}
  return {mountSettings,mountChooser,chooserValue,mountBooking,mountList,workerAreas,addressFields,addressText,bookingView,chooserMarkup};
})();
