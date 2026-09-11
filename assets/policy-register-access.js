/* The office manages scoped register grants from the register itself. */
(function () {
  'use strict';
  var root=document.getElementById('policy-fill');
  if(!root||root.dataset.admin!=='1'||root.dataset.kind!=='register')return;
  var api='/api/admin/policy-register-access/'+encodeURIComponent(root.dataset.slug);
  var panel=document.createElement('details');panel.className='fill-panel no-print';
  var heading=document.createElement('summary');heading.textContent='Manage access to this register';panel.appendChild(heading);root.after(panel);
  var content=document.createElement('div');panel.appendChild(content);
  function el(tag,text){var n=document.createElement(tag);if(text)n.textContent=text;return n;}
  function field(label,input){var l=el('label');l.append(el('span',label),input);return l;}
  function option(select,value,text){var o=el('option',text);o.value=value;select.appendChild(o);}
  async function request(body){var r=await fetch(api,{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});var j=await r.json();if(!r.ok)throw Error(j.error||'Access could not be updated.');return j;}
  var loading=false;
  async function load(){
    if(loading)return;loading=true;content.textContent='Loading access…';
    try{
      var data=await request();content.innerHTML='';
      content.appendChild(el('p','Only the office has access until you grant it. A grant exposes the whole register, including its existing entries. Use a separate register for each participant; never share a mixed participant register with an individual care team.'));
      var scopeForm=el('form'),scope=el('select');option(scope,'','Office-wide register — explicit grants only');data.participants.forEach(function(p){option(scope,p.id,p.name);});scope.value=data.participant_id||'';
      scopeForm.appendChild(field('Participant scope',scope));scopeForm.appendChild(el('p','A participant scope also requires the worker to have current access to that participant’s care. Changing this scope revokes all worker grants; it does not move or relabel existing entries.'));
      var scopeSave=el('button','Save scope');scopeSave.type='submit';scopeForm.appendChild(scopeSave);content.appendChild(scopeForm);
      var grantForm=el('form'),worker=el('select'),permission=el('select'),expiry=el('input');
      option(worker,'','Choose an approved worker');data.workers.forEach(function(w){option(worker,w.id,w.name);});worker.required=true;
      [['read','Read entries'],['append','Read and add new entries'],['edit','Read, add and correct entries']].forEach(function(p){option(permission,p[0],p[1]);});
      expiry.type='date';expiry.required=true;expiry.value=new Date(Date.now()+30*864e5).toISOString().slice(0,10);
      grantForm.append(field('Worker',worker),field('Allowed actions',permission),field('Access expires after this date',expiry));
      var grantSave=el('button','Save access');grantSave.type='submit';grantForm.appendChild(grantSave);content.appendChild(grantForm);
      var status=el('p');status.setAttribute('role','status');content.appendChild(status);
      async function mutate(body){scopeSave.disabled=grantSave.disabled=true;try{await request(body);loading=false;await load();}catch(e){status.textContent=e.message;scopeSave.disabled=grantSave.disabled=false;}}
      scopeForm.onsubmit=function(e){e.preventDefault();if(confirm('Confirm the register contains only the records appropriate to this scope. Changing scope removes all worker grants.'))mutate({action:'scope',participant_id:scope.value?Number(scope.value):null});};
      grantForm.onsubmit=function(e){e.preventDefault();mutate({worker_id:Number(worker.value),permission:permission.value,expires_at:new Date(expiry.value+'T23:59:59').toISOString()});};
      content.appendChild(el('h4','Current grants'));
      if(!data.grants.length)content.appendChild(el('p','No worker grants. The office keeps access.'));
      data.grants.forEach(function(g){var row=el('p',g.name+' · '+g.permission+' · expires '+new Date(g.expires_at).toLocaleString('en-AU')+' ');var revoke=el('button','Revoke');revoke.type='button';revoke.onclick=function(){mutate({worker_id:g.worker_id,permission:'none'});};row.appendChild(revoke);content.appendChild(row);});
    }catch(e){content.textContent=e.message;}finally{loading=false;}
  }
  panel.addEventListener('toggle',function(){if(panel.open)load();});
})();
