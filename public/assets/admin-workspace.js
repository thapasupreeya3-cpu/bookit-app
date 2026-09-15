/* One navigation for office work. This module never changes permissions or records. */
(function(){
 'use strict';
 const groups=['Today','People','Bookings','Money','Records','Reports','Settings'];
 const rows=[
 ['home','Today','Overview','#/admin','Find a task and see current office totals.'],
 ['tasks','Today','Next actions','#/journey?panel=tasks','Office actions, waiting on people and website alerts.'],
 ['contacts','Today','Contact messages','#/admin/today?section=contacts','Read enquiries sent through the website.'],
 ['deliveries','Today','Email delivery','#/journey?panel=deliveries','Check delivery results and retry failed messages.'],
 ['operations','Today','Website alerts','#/admin/assurance?tab=operations','Investigate operational issues and record follow-up.'],
 ['people','People','People directory','#/admin/people','Find an account and manage its visibility.'],
 ['verification','People','Verification','#/admin/verification','Review worker and participant documents and checks.'],
 ['recruitment','People','Recruitment','#/journey?panel=recruitment','Applications, interviews and worker checks.'],
 ['add-person','People','Add participant','#/admin/people?section=add','Open an account with recorded consent.'],
 ['referrals','People','Worker referrals','#/admin/people?section=referrals','Review qualification and record referral payments.'],
 ['reviews','People','Reviews','#/admin/people?section=reviews','Show or hide published feedback.'],
 ['pipeline','People','Onboarding progress','#/admin/people?section=pipeline','Track the steps before a first shift.'],
 ['additional-checks','People','Additional worker checks','#/admin/compliance?section=workers','Legacy screening and evidence controls.'],
 ['participant-records','People','Participant records','#/admin/compliance?section=participants','Participant files and support plans.'],
 ['bookings','Bookings','Booking list','#/admin/bookings','Find a recent shift and open its details.'],
 ['cover','Bookings','Find cover','#/admin/bookings?section=cover','Respond when a worker cannot attend.'],
 ['rosters','Bookings','Shared living rosters','#/admin/bookings?section=rosters','Manage houses and repeating rosters.'],
 ['groups','Bookings','Group bookings','#/admin/bookings?section=groups','Link or separate shared shifts.'],
 ['transitions','Bookings','Support changes','#/journey?panel=transitions','Review changes, handovers and affected bookings.'],
 ['support-arrangements','Bookings','Support arrangements','#/admin/assurance?tab=handoffs','Record arrangements for excluded activities.'],
 ['payments','Money','Invoices','#/payment-tracking?tab=invoices','View balances, payment status and invoice actions.'],
 ['receipts','Money','Received payments','#/payment-tracking?tab=receipts','Review received payments and their invoice allocations.'],
 ['payment-exceptions','Money','Payment exceptions','#/payment-tracking?tab=exceptions','Resolve payment failures and unmatched events.'],
 ['claims','Money','NDIA claims','#/admin/money?section=claims','Download claim files and record confirmed claim payments.'],
 ['unissued','Money','Unissued charges','#/admin/money?section=unissued','Review completed shifts waiting for processing.'],
 ['invoice-history','Money','Invoice history & withdrawal','#/admin/money?section=history','Withdraw an invoice, check notices and review history.'],
 ['fees','Money','Additional charges','#/admin/money?section=fees','Record eligible establishment fees or non-face-to-face work.'],
 ['payroll','Money','Worker pay','#/journey?panel=payroll','Prepare, review and track payroll batches.'],
 ['billing-review','Money','Corrections & refunds','#/admin/assurance?tab=billing','Review corrections and refund evidence.'],
 ['finance-review','Money','Finance evidence','#/journey?panel=finance','Payment events, manual receipts and evidence history.'],
 ['incidents','Records','Incidents','#/admin/records?section=incidents','Record incidents and track required follow-up.'],
 ['complaints','Records','Complaints','#/admin/records?section=complaints','Log, investigate and resolve complaints.'],
 ['scope','Records','Scope referrals','#/admin/records?section=scope','Track out-of-scope referrals and high-intensity enquiries.'],
 ['notes','Records','Shift notes','#/admin/records?section=notes','Read visit notes and resolve flagged concerns.'],
 ['forms','Records','Forms register','#/admin/documents?section=register','Find required forms and recorded evidence.'],
 ['policies','Records','Published policies','#/admin/documents?section=pages','Review policy pages published on the site.'],
 ['participant-documents','Records','Participant documents','#/admin/documents?section=screens','Open the participant documents provided on screen.'],
 ['audit','Records','Audit pack','#/admin/documents?section=audit','Build the evidence download.'],
 ['performance','Reports','Business performance','#/admin/reports','Review activity, retention and financial estimates.'],
 ['reports-workflow','Reports','Workflow times','#/journey?panel=metrics','See waiting times and progress through the service.'],
 ['evidence','Reports','Evidence history','#/admin/reports?section=evidence','Read the record of checks and their reviewers.'],
 ['charge-report','Reports','Completed charges','#/admin/reports?section=charges','Review completed shift amounts and estimates.'],
 ['email-settings','Settings','Email setup','#/journey?panel=deliveries&section=connection','See the sending address, email connection and a test to your own inbox.'],
 ['payment-settings','Settings','Payment connections','#/payment-tracking?tab=setup','Set up secure invoice payments by card and PayTo.'],
 ['automation-settings','Settings','Payroll, tax & documents','#/journey?panel=settings','Configure payroll cutover, invoice tax and document processing.'],
 ['pay-rates','Settings','Pay rates','#/admin/settings?section=pay','Review award comparisons, worker tiers and rate settings.'],
 ['ai','Settings','AI assistance','#/admin/ai','Configure optional assistance and review suggestions.'],
 ['assurance-settings','Settings','Incident & AI settings','#/admin/assurance?tab=configuration','Additional incident dates and AI provider assessments.'],
 ['website','Settings','Website access','#/admin/launch','Review preview access and demo data.'],
 ['launch-checks','Settings','Launch checks','#/admin/assurance?tab=checks','Review launch evidence and outstanding checks.'],
 ['self-test','Settings','System checks','#/admin/settings?section=checks','Run the existing diagnostic report.']
 ];
 const catalog=rows.map(([key,group,label,href,description])=>({key,group,label,href,description}));
 // Keep the complete tool catalogue for search and old links. The Money menu
 // groups related work, while each subsection still loads only its own screen.
 const moneySections=[
  {key:'invoices',label:'Invoices & payments',items:['payments','receipts','invoice-history']},
  {key:'charges',label:'Charges',items:['unissued','fees']},
  {key:'attention',label:'Needs attention',items:['payment-exceptions','billing-review','finance-review']},
  {key:'claims',label:'NDIA claims',items:['claims']},
  {key:'payroll',label:'Worker pay',items:['payroll']}
 ];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const entry=key=>catalog.find(x=>x.key===key)||catalog[0];
 const moneySection=key=>moneySections.find(x=>x.items.includes(key));
 function menuEntries(group){
  return group==='Money'?moneySections.map(section=>({...entry(section.items[0]),label:section.label,section:section.key})):catalog.filter(x=>x.group===group);
 }
 function moneyNavigation(item){
  const section=moneySection(item.key);if(!section||section.items.length<2)return '';
  return `<nav class="ca-money-sections" aria-label="${esc(section.label)} sections"><span class="ca-money-section-label">${esc(section.label)}</span><div>${section.items.map(key=>{const x=entry(key),href=key===item.key&&resolve()===key?location.hash:x.href;return `<a href="${esc(href)}"${key===item.key?' aria-current="page"':''}>${esc(x.label)}</a>`;}).join('')}</div></nav>`;
 }
 function resolve(hash=location.hash){
  const [path,query='']=hash.replace(/^#/,'').split('?'),p=new URLSearchParams(query),s=p.get('section');
  if(path==='/payment-tracking')return ({receipts:'receipts',exceptions:'payment-exceptions',setup:'payment-settings'})[p.get('tab')]||'payments';
  if(path==='/journey'&&p.get('panel')==='deliveries'&&s==='connection')return 'email-settings';
  if(path==='/journey')return ({tasks:'tasks',recruitment:'recruitment',payroll:'payroll',deliveries:'deliveries',transitions:'transitions',finance:'finance-review',metrics:'reports-workflow',settings:'automation-settings',shift:'bookings',series:'bookings'})[p.get('panel')]||'tasks';
  if(path==='/admin/verification')return 'verification';
  if(path==='/admin/assurance')return p.has('incident')?'incidents':({operations:'operations',checks:'launch-checks',handoffs:'support-arrangements',billing:'billing-review',configuration:'assurance-settings'})[p.get('tab')]||'operations';
  const sub=path.split('/')[2]||'';
  if(sub==='people')return ({add:'add-person',referrals:'referrals',reviews:'reviews',pipeline:'pipeline'})[s]||'people';
  if(sub==='bookings')return ({cover:'cover',rosters:'rosters',groups:'groups'})[s]||'bookings';
  if(sub==='money')return ({claims:'claims',unissued:'unissued',history:'invoice-history',fees:'fees',pay:'pay-rates'})[s]||'payments';
  if(sub==='records')return ({incidents:'incidents',complaints:'complaints',scope:'scope',notes:'notes'})[s]||'incidents';
  if(sub==='compliance')return ({workers:'additional-checks',participants:'participant-records',pipeline:'pipeline',log:'evidence',registers:'incidents'})[s]||'additional-checks';
  if(sub==='documents')return ({register:'forms',pages:'policies',screens:'participant-documents',audit:'audit'})[s]||'forms';
  if(sub==='reports')return ({evidence:'evidence',charges:'charge-report'})[s]||'performance';
  if(sub==='settings')return s==='pay'?'pay-rates':'self-test';
  if(sub==='today')return s==='contacts'?'contacts':'tasks';
  return ({growth:'performance',overview:'home',ai:'ai',launch:'website'})[sub]||'home';
 }
 function find(query){const words=String(query||'').toLowerCase().trim().split(/\s+/).filter(Boolean);return catalog.filter(x=>words.every(w=>(x.group+' '+x.label+' '+x.description+' '+(moneySection(x.key)?.label||'')).toLowerCase().includes(w)));}
 let serial=0;const listState=new Map();let owner='';
 function decorate(root,key){
  if(!root||!window.API?.me?.admin)return;
  key=key==='incident-detail'?'incidents':key==='booking-detail'?'bookings':key||resolve();
  const item=entry(key),section=moneySection(key),existing=root.querySelector(':scope > .ca-workspace');if(existing)return;
  const id='ca-'+(++serial),frame=document.createElement('div');frame.className='ca-workspace';
  frame.innerHTML=`<aside class="ca-sidebar"><details class="ca-menu" open><summary>Admin menu · ${esc(item.group)}</summary><nav aria-label="Admin sections">${groups.map(group=>`<details class="ca-group"${group===item.group?' open':''}><summary>${esc(group)}</summary><div>${menuEntries(group).map(x=>`<a href="${esc(x.href)}"${(x.section?x.section===section?.key:x.key===item.key)?' aria-current="page"':''}>${esc(x.label)}</a>`).join('')}</div></details>`).join('')}</nav></details></aside><div class="ca-main"><div class="ca-tool-search"><label for="${id}-search">Find an admin tool</label><input id="${id}-search" type="search" placeholder="Try invoices, worker pay or documents" autocomplete="off" aria-controls="${id}-results"><div id="${id}-results" class="ca-search-results" hidden></div><span class="sr-only" id="${id}-count" role="status"></span></div><p class="ca-breadcrumb"><a href="#/admin">Admin</a><span aria-hidden="true"> / </span>${esc(item.group)}<span aria-hidden="true"> / </span>${section&&section.items.length>1?`${esc(section.label)}<span aria-hidden="true"> / </span>`:''}<b>${esc(item.label)}</b></p>${moneyNavigation(item)}<div class="ca-content"></div></div>`;
  const content=frame.querySelector('.ca-content');while(root.firstChild)content.appendChild(root.firstChild);root.appendChild(frame);
  if(!content.querySelector('h1')){const header=document.createElement('header');header.className='ca-page-heading';header.innerHTML=`<h1>${esc(item.label)}</h1><p>${esc(item.description)}</p>`;content.prepend(header);}
  const input=frame.querySelector('input[type=search]'),results=frame.querySelector('.ca-search-results'),count=frame.querySelector('[role=status]');
  input.addEventListener('input',()=>{const q=input.value.trim(),matches=find(q);results.hidden=!q;results.innerHTML=q?(matches.length?matches.map(x=>`<a href="${esc(x.href)}"><strong>${esc(x.label)}</strong><span>${esc(x.group)} · ${esc(x.description)}</span></a>`).join(''):'<p>No tools match. Try a task such as payroll or documents.</p>'):'';count.textContent=q?`${matches.length} tools found`:'';});
  input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.value='';results.hidden=true;count.textContent='';}if(e.key==='ArrowDown'&&!results.hidden){e.preventDefault();results.querySelector('a')?.focus();}});
  const menu=frame.querySelector('.ca-menu');if(window.matchMedia?.('(max-width: 900px)').matches)menu.open=false;
  return content;
 }
 function paginate(container,{key='list',selector='tbody > tr',label='records',pageSize=20,scope='Loaded records'}={}){
  if(!container||container.dataset.caPaged)return;const rows=Array.from(container.querySelectorAll(selector));if(!rows.length)return;
  const account=String(window.API?.me?.id||'');if(owner!==account){listState.clear();owner=account;}const stateKey=account+'|'+location.hash.split('?')[0]+'|'+key;
  const state=listState.get(stateKey)||{q:'',page:1};listState.set(stateKey,state);container.dataset.caPaged='true';
  const controls=document.createElement('div');controls.className='ca-list-controls';const id='ca-list-'+(++serial);
  controls.innerHTML=`<label for="${id}">Search ${esc(label)}<input id="${id}" type="search" value="${esc(state.q)}" placeholder="Name, reference or status" autocomplete="off"></label><span role="status"></span><div class="ca-pages"><button type="button" data-ca-prev>Previous</button><button type="button" data-ca-next>Next</button></div>`;
  container.before(controls);const empty=document.createElement('p');empty.className='ca-empty';empty.textContent='No matching '+label+'. Clear the search to see all loaded records.';container.after(empty);
  const input=controls.querySelector('input'),status=controls.querySelector('[role=status]'),prev=controls.querySelector('[data-ca-prev]'),next=controls.querySelector('[data-ca-next]');
  const paint=()=>{const words=state.q.toLowerCase().trim().split(/\s+/).filter(Boolean),matched=rows.filter(row=>words.every(w=>row.textContent.toLowerCase().includes(w)));const pages=Math.max(1,Math.ceil(matched.length/pageSize));state.page=Math.min(Math.max(1,state.page),pages);const visible=new Set(matched.slice((state.page-1)*pageSize,state.page*pageSize));rows.forEach(row=>{row.hidden=!visible.has(row);});status.textContent=`${scope}: ${matched.length} of ${rows.length} · Page ${state.page} of ${pages}`;prev.disabled=state.page<=1;next.disabled=state.page>=pages;empty.hidden=matched.length>0;};
  input.addEventListener('input',()=>{state.q=input.value;state.page=1;paint();});prev.addEventListener('click',()=>{state.page--;paint();});next.addEventListener('click',()=>{state.page++;paint();});paint();return {paint,state};
 }
 window.CareAdmin={catalog,groups,entry,resolve,find,decorate,paginate,moneySections,menuEntries};
})();
