'use strict';
/* One worker-owned workspace for typed uploads and the existing evidence record. */
window.WorkerCredentials = (() => {
  const e = value => esc(String(value ?? ''));
  const call = (url, body) => API.call(url, body === undefined ? {noFor:true} : {noFor:true, method:'POST', body});
  const route = () => location.hash.split('?')[0] === '#/account/credentials';
  const owner = () => API.me?.id;
  let serial = 0, state = null;
  const button = (action, label, value='') => `<button type="button" data-cred-action="${action}" data-value="${e(value)}">${e(label)}</button>`;
  const platform = d => d.evidence_origin === 'platform-module';
  const reviewed = d => !!d.verified_at && !['rejected','superseded'].includes(d.review_state || d.review);
  const usable = d => (d.has_file || platform(d)) && !['rejected','superseded'].includes(d.review_state || d.review) && d.status !== 'expired';
  const icon = kind => `<svg class="cred-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle>${kind==='verified'?'<path d="m8 12 2.5 2.5L16 9"></path>':kind==='pending'?'<path d="M12 7v5l3 2"></path>':kind==='neutral'?'<path d="M8 12h8"></path>':'<path d="M12 7v6m0 4h.01"></path>'}</svg>`;
  const badge = (kind,text) => `<span class="cred-status is-${kind}">${icon(kind)}${e(text)}</span>`;
  function fileState(d) {
    if(d.review_state==='superseded') return 'neutral';
    if(d.review==='rejected' || d.review_state==='rejected' || d.status==='expired' || (!d.has_file && !platform(d))) return 'missing';
    if(d.status==='expiring') return 'attention';
    return platform(d) || reviewed(d) ? 'verified' : 'pending';
  }
  function label(d) {
    if(d.review === 'rejected' || d.review_state === 'rejected') return 'Replace requested';
    if(d.review_state === 'superseded') return 'Earlier record';
    if(d.status === 'expired') return 'Expired';
    if(platform(d)) return 'Completed in Training';
    if(!d.has_file) return 'Needs a file';
    return reviewed(d) ? (d.status === 'expiring' ? 'Verified · expiring soon' : 'Verified') : 'Awaiting office review';
  }
  function requirements(types, docs) {
    const held = types.filter(t => docs.some(d => d.doc_type === t.key && usable(d)));
    const checked = types.filter(t => docs.some(d => d.doc_type === t.key && usable(d) && reviewed(d)));
    const identity = list => list.some(t => t.points && t.primary) && list.reduce((sum,t) => sum + (t.points || 0), 0) >= 100;
    const idPoints = held.reduce((sum,t) => sum + (t.points || 0), 0);
    const core = types.filter(t => t.required || t.key === 'resume').map(t => ({key:t.key, title:t.label, keys:[t.key], have:held.includes(t), verified:checked.includes(t), help:t.help || '', type:t.key}));
    return [
      {key:'identity', title:'100 points of identity', keys:types.filter(t=>t.points).map(t=>t.key), have:identity(held), verified:identity(checked), help:`${idPoints} points uploaded. Include a primary document and at least 100 points in total. Each document type counts once.`, type:held.some(t=>t.primary)?'driver-licence':'passport-au'},
      {key:'work-rights', title:'Right to work in Australia', keys:['visa'], have:held.some(t=>t.rtw), verified:checked.some(t=>t.rtw), help:'Australian passport, birth or citizenship evidence above can cover this too. Otherwise add your visa evidence.', type:'visa', coveredBy:held.filter(t=>t.rtw && t.key!=='visa')},
      ...core
    ];
  }
  function fileRow(d) {
    const source = /\.(png|jpe?g)$/i.test(d.file_name || '') ? '/api/documents/'+Number(d.id)+'/file' : '/api/document-viewer?scope=worker&id='+Number(d.id);
    const name = d.file_name || d.type_label || d.doc_type;
    return `<div class="cred-file"><div class="cred-file-info"><b>${e(name)}</b>${badge(fileState(d),label(d))}<span class="cred-file-meta">${reviewed(d)?'Verified '+e(fmtAU(d.verified_at.slice(0,10)))+' · ':''}${d.expiry_date?'Expires '+e(fmtAU(d.expiry_date))+' · ':''}#${Number(d.id)}</span>${d.check_number?`<span>Reference: ${e(d.check_number)}</span>`:''}${d.review_note?`<p class="cred-review-note">${e(d.review_note)}</p>`:''}</div><div class="cred-actions">${d.has_file?`<a href="${source}" target="_blank" rel="noopener noreferrer" aria-label="View ${e(name)} (opens a new tab)">View</a>`:''}${platform(d)?'<a href="#/account/training">Open training</a>':button('replace',d.has_file?'Replace':'Add file',d.id)+button(d.verified_at?'request-removal':'remove',d.verified_at?'Request removal':'Remove',d.id)}</div></div>`;
  }
  function files(docs) {
    if(!docs.length) return '';
    const rows = [...docs].sort((a,b)=>b.id-a.id);
    return fileRow(rows[0]) + (rows.length>1?`<details class="cred-history"><summary>${rows.length-1} more file${rows.length===2?'':'s'} on record</summary>${rows.slice(1).map(fileRow).join('')}</details>`:'');
  }
  function options(types, categories) {
    const groups = [...categories];
    for(const t of types) if(!groups.some(c=>c.key===t.category)) groups.push({key:t.category,label:t.category || 'Other'});
    return '<option value="">Choose a document type…</option>'+groups.map(c=>`<optgroup label="${e(c.label)}">${types.filter(t=>t.category===c.key).map(t=>`<option value="${e(t.key)}">${e(t.label)}${t.points?' — '+t.points+' points':''}</option>`).join('')}</optgroup>`).join('');
  }
  function requirementRow(r,s) {
    const kind=r.verified?'verified':r.have?'pending':'missing';
    const module=s.docs.find(d=>r.keys.includes(d.doc_type) && platform(d) && usable(d));
    const covered=r.key==='work-rights' && r.coveredBy?.length;
    const evidence=r.key==='identity'?r.keys.filter(key=>s.docs.some(d=>d.doc_type===key)).map(key=>`<div class="cred-id-group"><b>${e(s.types.find(t=>t.key===key)?.label)}</b>${files(s.docs.filter(d=>d.doc_type===key && !platform(d)))}</div>`).join(''):files(s.docs.filter(d=>r.keys.includes(d.doc_type) && !platform(d)));
    return `<section class="cred-item" data-cred-requirement="${e(r.key)}"><div class="cred-item-head"><h4>${e(r.title)}</h4>${badge(kind,r.verified?'Verified':r.have?'Awaiting office review':'Needs files')}${button('add',r.have?'Add another':'Add file',r.type)}</div><p class="cred-hint">${e(r.help)}</p>${covered?`<p class="cred-coverage">Covered by ${r.coveredBy.map(t=>e(t.label)).join(' / ')} in your identity documents. ${button('identity','View supporting files')}</p>`:''}${module?`<p class="cred-coverage">${icon('verified')}Completed in <a href="#/account/training">Training</a>${module.verified_at?' · '+e(fmtAU(module.verified_at.slice(0,10))):''}. No separate upload needed for this completion.</p>`:''}${evidence}</section>`;
  }
  function page(s) {
    const reqs = requirements(s.types,s.docs), missing = reqs.filter(r=>!r.have), pending=reqs.filter(r=>r.have&&!r.verified), verified=reqs.filter(r=>r.verified);
    const kind=missing.length?'missing':pending.length?'pending':'verified';
    const title=missing.length?missing.length===1?'1 essential item needs a file':missing.length+' essential items need files':pending.length?'Essential files received':'Essential documents verified';
    const message=missing.length?missing.map(r=>r.title).join(' · '):pending.length?`${pending.length} essential ${pending.length===1?'requirement is':'requirements are'} awaiting office review. The files are on record; the office still needs to check them.`:`All ${verified.length} essential requirements are verified. View the status and review dates below.`;
    const used = new Set(reqs.flatMap(r=>r.keys));
    const extra = s.types.filter(t=>!used.has(t.key) && s.docs.some(d=>d.doc_type===t.key && !platform(d)));
    const unknown = s.docs.filter(d=>!s.types.some(t=>t.key===d.doc_type) && !platform(d));
    return `<section class="credentials-workspace" aria-label="Credentials and checks"><h2>Credentials &amp; checks</h2><p>Add or replace your files here. The office records verification after reviewing them.</p>
      <div class="cred-overview is-${kind}"><div class="cred-overview-main">${icon(kind)}<div><strong>${e(title)}</strong><p>${e(message)}</p></div><button type="button" data-cred-action="status" aria-controls="credChecklist">View document status</button></div></div>
      <details class="cred-explainer"><summary>How verification works</summary><p>The office reviews your evidence and records the result. <b>Verified</b> means the check has been recorded. <b>Awaiting office review</b> means the file has arrived and is waiting to be checked. <b>Needs files</b> means a current file still needs to be added or replaced.</p><p>Use View document status to see each item, its review date and any reason for a requested replacement. Uploading a file does not verify it.</p></details>
      ${s.requests.length?`<aside class="cred-requests"><h3>Requested by the office</h3>${s.requests.map(r=>`<p><b>${e(r.label || r.doc_key)}</b>${r.note?' — '+e(r.note):''} ${button('add','Add requested file',s.types.some(t=>t.key===r.doc_key)?r.doc_key:'')}</p>`).join('')}</aside>`:''}
      <div id="credNotice" role="status" aria-live="polite">${e(s.notice || '')}</div>
      <section class="cred-upload" aria-labelledby="credUploadTitle"><h3 id="credUploadTitle">Add a document</h3><label for="credType">Document type — full list</label><select id="credType">${options(s.types,s.categories)}</select><div id="credFormArea"><p class="cred-hint">Select the exact type first so your file is recorded in the right place.</p></div></section>
      <h3 id="credChecklistTitle" tabindex="-1">Essential documents</h3><div id="credChecklist" class="cred-checklist">${reqs.map(r=>requirementRow(r,s)).join('')}</div>
      <details class="cred-additional" ${extra.length || unknown.length?'open':''}><summary>Other checks, qualifications &amp; files (${extra.length+unknown.length})</summary><p>Requirements vary with your work: children’s checks, driving, medication and specialist skills. Choose any type from the full list above.</p>${extra.map(t=>`<section class="cred-item"><div class="cred-item-head"><h4>${e(t.label)}</h4>${button('add','Add file',t.key)}</div>${files(s.docs.filter(d=>d.doc_type===t.key && !platform(d)))}</section>`).join('')}${unknown.map(fileRow).join('')}</details>
      <div id="credAssistance"></div><p class="cred-hint">Your <a href="#/account/profile">profile photo</a> and <a href="#/account/training">online training modules</a> are managed separately. Earlier files remain on record when you upload a replacement.</p></section>`;
  }
  function current(s) { return state === s && route() && owner() === s.owner && s.wrap === document.getElementById('miniCreds') && !!s.wrap.closest('.page.active'); }
  function selectType(s,key,target=null,focus=false) {
    if(!current(s)) return;
    const select = s.wrap.querySelector('#credType'), area = s.wrap.querySelector('#credFormArea'), type=s.types.find(t=>t.key===key);
    select.value=type?.key || ''; select.disabled=!!target; s.target=target;
    s.wrap.querySelector('#credUploadTitle').textContent=target?'Replace this file':'Add a document';
    if(!type) {area.innerHTML='<p class="cred-hint">Select the exact type first so your file is recorded in the right place.</p>';if(focus)select.focus({preventScroll:true});return;}
    area.innerHTML=`<form id="credUploadForm"><p class="cred-hint">${e(type.help || '')}</p>${target?`<p>Replacing <b>${e(target.file_name || target.type_label)}</b> (#${Number(target.id)}). The earlier record stays available for review. ${button('cancel','Cancel replacement')}</p>`:''}<label>File <span class="cred-hint">PDF up to 4 MB · JPG/PNG photos resized automatically</span><input name="file" type="file" required accept="application/pdf,image/jpeg,image/png"></label>${type.needsLabel?`<label>Qualification name<input name="label" required maxlength="80" value="${e(target?.label || '')}"></label>`:''}${type.expiry!=='none'?`<label>Expiry date${type.expiry==='required'?' (required)':' (if shown)'}<input name="expiry_date" type="date" ${type.expiry==='required'?'required':''}></label>`:''}${type.numberLabel?`<label>${e(type.numberLabel)} (optional)<input name="check_number" maxlength="40" value="${e(target?.check_number || '')}"></label>`:''}<div class="cred-actions"><button type="submit" class="cred-primary">${target?'Upload replacement':'Upload file'}</button>${button('cancel','Cancel')}</div><p role="status" data-cred-form-status aria-live="polite"></p></form>`;
    if(focus){area.querySelector('input[type=file]').focus({preventScroll:true});s.wrap.querySelector('.cred-upload').scrollIntoView({block:'nearest',behavior:'instant'});}
  }
  async function refresh(s,notice) {
    const d=await call('/me/documents');if(!current(s))return;
    s.docs=d.documents || [];s.requests=d.requests || [];s.notice=notice;s.target=null;
    s.wrap.innerHTML=page(s);bind(s);loadAssistance(s);
  }
  async function upload(s,form) {
    if(s.saving || !current(s))return;
    const type=s.types.find(t=>t.key===s.wrap.querySelector('#credType').value),target=s.target;
    const out=form.querySelector('[data-cred-form-status]'),controls=[...form.querySelectorAll('input,button')],select=s.wrap.querySelector('#credType');
    if(!type){out.textContent='Choose a document type.';return;}
    const input=form.elements.file,file=input.files[0];
    if(!file){out.textContent='Choose a file.';return;}
    if(!['application/pdf','image/jpeg','image/png'].includes(file.type)){out.textContent='Choose a PDF, JPG or PNG.';return;}
    if(file.type==='application/pdf' && file.size>4*1024*1024){out.textContent='PDF files can be up to 4 MB.';return;}
    const body={doc_type:type.key,expiry_date:form.elements.expiry_date?.value || '',label:form.elements.label?.value || target?.label || '',check_number:form.elements.check_number?.value || '',...(target?{replaces_id:target.id}:{})};
    if(type.expiry==='required'&&!body.expiry_date){out.textContent='Enter the expiry date.';return;}
    s.saving=true; controls.forEach(c=>c.disabled=true);select.disabled=true;out.textContent='Uploading…';
    let saved=false;
    try{
      body.file=await fileToB64Shrunk(input,1600,.85);if(!current(s))return;if(!body.file)throw Error('Could not read this file.');
      const result=await call('/me/documents',body);saved=true;if(!current(s))return;
      await refresh(s,result.duplicate?'This exact file is already recorded under '+type.label+'. No duplicate was added.':type.label+' uploaded — awaiting office review.');
    }catch(err){if(current(s)){out.textContent=saved?'File saved, but the checklist could not refresh. Reopen Credentials to see it.':err.message;if(saved){input.value='';}}}
    finally{s.saving=false;if(current(s)){controls.forEach(c=>c.disabled=false);select.disabled=!!s.target;}}
  }
  async function act(s,b) {
    if(!current(s)||s.saving)return;
    const action=b.dataset.credAction,value=b.dataset.value;
    if(action==='status' || action==='identity') {
      const target=s.wrap.querySelector(action==='identity'?'[data-cred-requirement="identity"] h4':'#credChecklistTitle');
      if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'instant'});}
      return;
    }
    if(action==='add'){selectType(s,value,null,true);return;}
    if(action==='cancel'){selectType(s,'');return;}
    const d=s.docs.find(d=>d.id===Number(value));if(!d)return;
    if(action==='replace'){selectType(s,d.doc_type,d,true);return;}
    b.disabled=true;s.saving=true;
    try{
      if(action==='remove') {
        if(!await CareFlow.dialog('Remove this file?',`<p>Remove <b>${e(d.file_name || d.type_label)}</b> (#${d.id}) from ${e(d.type_label || d.doc_type)}? You may need to upload a new file to complete this requirement.</p>`,'Remove file'))return;
        if(!current(s))return;
        await call('/me/documents/'+d.id+'/delete',{});
        if(current(s))await refresh(s,'File removed. Your checklist has been updated.');
      }else if(action==='request-removal') {
        const reason=await CareFlow.dialog('Request removal of verified evidence',`<p>The office needs to review removal of <b>${e(d.file_name || d.type_label)}</b> (#${d.id}). It remains on file until reviewed.</p><label>Reason<textarea id="credRemovalReason" maxlength="1000" rows="3" required></textarea></label>`,'Send request',dialog=>{const v=dialog.querySelector('#credRemovalReason').value.trim();if(!v)throw Error('Enter a reason for removal.');return v;});
        if(reason===null || !current(s))return;
        const r=await call('/contact',{name:API.me.name,email:API.me.email,topic:'Verified worker document removal',body:`Worker #${s.owner} requests removal of document #${d.id}: ${d.type_label || d.doc_type}; file: ${d.file_name || '(details only)'}. Reason: ${reason}`});
        if(current(s))s.wrap.querySelector('#credNotice').textContent='Removal request sent. Reference '+r.ref+'. The file remains on record pending office review.';
      }
    }catch(err){if(current(s))s.wrap.querySelector('#credNotice').textContent=err.message;}
    finally{b.disabled=false;s.saving=false;}
  }
  function loadAssistance(s) {
    if(!window.CareFlow?.documentAssistance)return;
    const slot=s.wrap.querySelector('#credAssistance');
    CareFlow.documentAssistance(s.docs).then(html=>{if(current(s)&&slot===s.wrap.querySelector('#credAssistance'))slot.innerHTML=html;}).catch(()=>{});
  }
  function bind(s) {
    s.wrap.onclick=async event=>{const b=event.target.closest('[data-cred-action]');if(b){event.preventDefault();await act(s,b);}};
    s.wrap.onchange=event=>{if(event.target.id==='credType'&&!s.saving)selectType(s,event.target.value);};
    s.wrap.onsubmit=async event=>{if(event.target.id==='credUploadForm'){event.preventDefault();await upload(s,event.target);}};
  }
  async function render(wrap) {
    const generation=++serial,id=owner(),hash=location.hash;
    state=null;
    wrap.innerHTML='<p role="status">Loading your document checklist…</p>';
    try{
      const [catalogue,d]=await Promise.all([call('/doc-catalog'),call('/me/documents')]);
      if(generation!==serial || owner()!==id || location.hash!==hash || !wrap.closest('.page.active'))return;
      state={wrap,owner:id,types:catalogue.types || [],categories:catalogue.categories || [],docs:d.documents || [],requests:d.requests || [],target:null,saving:false};
      wrap.innerHTML=page(state);bind(state);loadAssistance(state);
      const type=new URLSearchParams(hash.split('?')[1]||'').get('type');if(type)selectType(state,type);
    }catch(err){if(generation===serial && owner()===id && location.hash===hash)wrap.innerHTML=`<div role="alert"><p>${e(err.message)}</p><button type="button" id="acctRetry" class="btn btn-secondary btn-sm">Try again</button></div>`;}
  }
  return {render};
})();
