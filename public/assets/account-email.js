'use strict';
/* Email is an account identity. Requests never change it until the new address is confirmed. */
window.CareAccountEmail=(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mounted=new WeakMap();
  const identity=()=>`${API.me?.id||''}:${API.actingFor?.id||''}`;
  const stamp=value=>value?new Date(value).toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'}):'';
  function clearSession(){API.me=null;API.actingFor=null;API.blockers=null;API.unread=0;try{sessionStorage.removeItem('bk_for');}catch{}window.updateAuthUI?.();}
  const button=(label,attr,primary=false)=>`<button type="button" class="btn btn-${primary?'primary':'secondary'} btn-sm" ${attr}>${label}</button>`;
  function lifecycle(host){const marker={},who=identity(),hash=location.hash;mounted.set(host,marker);return ()=>host.isConnected&&mounted.get(host)===marker&&identity()===who&&location.hash===hash;}
  function status(host,message,bad=false){const out=host.querySelector('[data-ae-status]');if(out){out.textContent=message;out.classList.toggle('ae-error',bad);out.setAttribute('role',bad?'alert':'status');}}
  function delivery(pending){const d=pending.delivery||{};if(['failed','dead','error','not-queued','cancelled','suppressed'].includes(d.state))return `<p class="ae-error"><b>Verification email needs attention.</b> ${esc(d.error||'It could not be sent. Check the address and request another link.')}</p>`;if(d.state==='retry')return `<p class="ae-error"><b>Verification email delayed — retry scheduled.</b> ${esc(d.error||'The email service will try again automatically.')}</p>`;if(d.state==='sent')return '<p>Verification email sent. Check the new inbox and spam folder.</p>';return '<p>Verification email queued. It has not been confirmed as sent yet.</p>';}
  function markup(data,{admin=false,name='' }={}){
    const pending=data.pending,canChange=data.can_change!==false;
    return `<section class="info-card ae-card" aria-label="${admin?'Participant e':'E'}mail address"><h3>${admin?'Participant email address':'Email address'}</h3>${admin?`<p>For <b>${esc(name||'this participant')}</b></p>`:API.actingFor?'<p class="ae-context">This is your signed-in account. The participant’s email appears separately below.</p>':''}<p class="ae-current"><b>Current email</b><span>${esc(data.email||'No email address recorded')}</span></p><p><span class="ae-badge ${data.verified?'ae-confirmed':'ae-waiting'}">${data.verified?'✓ Email confirmed':'◷ Email not confirmed'}</span></p><p class="muted-sm">Used to sign in and receive account and booking emails. Plan-manager invoice emails are a separate billing setting. Issued invoices keep their original payer details.</p>${pending?`<div class="ae-pending"><h4>◷ Waiting for the new email to be confirmed</h4><p><b>Requested address:</b> <span class="ae-address">${esc(pending.new_email)}</span></p><p>The current email stays in use until the link in the new inbox is confirmed.</p>${delivery(pending)}${pending.expires_at?`<p class="muted-sm">Link expires ${esc(stamp(pending.expires_at))}.</p>`:''}<div class="ae-actions">${button('Check verification status','data-ae-refresh')}${canChange?button('Cancel email change','data-ae-cancel-request'):''}</div></div>`:''}${data.email_enabled===false?`<p class="ae-error" role="status">Email sending is unavailable. ${admin?'<a href="#/journey?panel=deliveries&amp;section=connection">Open email setup</a>':'<a href="#/contact">Contact the office</a>'} to restore it before requesting a change.</p>`:''}${canChange?`<details class="ae-editor" data-ae-editor><summary>${pending?'Request a different address or a new link':'Change email'}</summary><p>${admin?'Confirm the participant asked for this change, then enter your own admin password. The participant must confirm the new inbox.':'Enter your current password. We will send a confirmation link to the new address.'}</p><form data-ae-form><label>New email address<input type="email" name="new_email" maxlength="120" autocomplete="email" required value="${esc(pending?.new_email||'')}"></label><label>${admin?'Your admin password':'Current password'}<input type="password" name="current_password" autocomplete="current-password" required></label>${admin?'<label>Reason for this change<textarea name="reason" rows="2" minlength="10" maxlength="1000" required placeholder="For example, the participant reported an incorrect address"></textarea></label><label class="ae-consent"><input type="checkbox" name="participant_consent" required><span>The participant has requested or agreed to this email change.</span></label>':''}<div class="ae-actions"><button type="submit" class="btn btn-primary btn-sm" ${data.email_enabled===false?'disabled':''}>Send verification link</button>${button('Close','data-ae-close')}</div></form></details>`:'<p>This email is read-only. The account holder or office can request a verified change.</p>'}<p data-ae-status role="status" aria-live="polite"></p></section>`;
  }
  async function mount(host,options={}){
    if(!host)return;const current=lifecycle(host),admin=Number.isSafeInteger(Number(options.participantId))&&Number(options.participantId)>0;
    if(!API.me||(admin&&!API.me.admin)){host.innerHTML='<p class="ae-error">Sign in with permission to view this email address.</p>';return;}
    const prefix=admin?'/admin/participants/'+Number(options.participantId):'/me';let data,busy=false;
    host.innerHTML='<section class="info-card ae-card"><h3>Email address</h3><p>Loading current email…</p></section>';
    function paint(message=''){
      if(!current())return;
      host.innerHTML=markup(data,{admin,name:options.name});if(message)status(host,message);
      host.querySelector('[data-ae-refresh]')?.addEventListener('click',()=>mount(host,options));
      const editor=host.querySelector('[data-ae-editor]'),form=host.querySelector('[data-ae-form]');
      host.querySelector('[data-ae-close]')?.addEventListener('click',()=>{form?.reset();if(editor){editor.open=false;editor.querySelector('summary')?.focus();}status(host,'');});
      form?.addEventListener('submit',async event=>{
        event.preventDefault();if(busy||!current())return;
        const value=name=>String(form.querySelector(`[name="${name}"]`)?.value||'');
        const password=form.querySelector('[name="current_password"]'),body={new_email:value('new_email').trim(),current_password:value('current_password')};
        if(admin){body.reason=value('reason').trim();body.participant_consent=form.querySelector('[name="participant_consent"]').checked;}
        busy=true;const controls=[...form.querySelectorAll('input,textarea,button')];controls.forEach(n=>n.disabled=true);status(host,'Requesting a verification email…');
        try{const result=await API.call(prefix+'/email-change',{method:'POST',noFor:true,body});if(!current())return;data=result;paint(result.message||'Verification email queued. The current address remains in use until the new inbox is confirmed.');}
        catch(error){if(current())status(host,error.message,true);}
        finally{busy=false;if(password)password.value='';if(current())controls.forEach(n=>{if(n.isConnected)n.disabled=false;});}
      });
      host.querySelector('[data-ae-cancel-request]')?.addEventListener('click',async()=>{
        if(busy||!current())return;busy=true;const id=data.pending?.id,controls=[...host.querySelectorAll('input,textarea,button')],wasDisabled=new Map(controls.map(n=>[n,n.disabled]));controls.forEach(n=>n.disabled=true);status(host,'Cancelling this email change…');
        try{const result=await API.call(prefix+'/email-change/cancel',{method:'POST',noFor:true,body:{request_id:id}});if(!current())return;data=result;paint(result.message||'Email change cancelled. The current address is unchanged.');}
        catch(error){if(current())status(host,error.message,true);}
        finally{busy=false;if(current())controls.forEach(n=>{if(n.isConnected)n.disabled=wasDisabled.get(n);});}
      });
    }
    try{data=await API.call(prefix+'/email',{noFor:true});if(!current())return;if(!admin){API.me.email=data.email;API.me.verified=data.verified;}paint();}
    catch(error){if(current()){host.innerHTML=`<section class="info-card ae-card"><h3>Email address</h3><p class="ae-error" role="alert">${esc(error.message)}</p>${error.status===401?'<a class="btn btn-primary btn-sm" href="#/login">Sign in again</a>':button('Load email address','data-ae-retry')}</section>`;host.querySelector('[data-ae-retry]')?.addEventListener('click',()=>mount(host,options));if(error.status===401)clearSession();}}
  }
  async function mountParticipantContact(host){
    if(!host)return;const current=lifecycle(host),id=Number(API.actingFor?.id);host.innerHTML='';
    if(API.me?.role!=='coordinator'||!id)return;
    host.innerHTML='<section class="info-card ae-card"><h3>Participant contact email</h3><p>Loading the selected participant…</p></section>';
    try{const data=await API.call('/coordinator/clients',{noFor:true});if(!current())return;const participant=data.clients?.find(p=>Number(p.id)===id);if(!participant)throw Error('Access to this participant is no longer available.');host.innerHTML=`<section class="info-card ae-card"><h3>Participant contact email</h3><p>For <b>${esc(participant.name)}</b></p><p class="ae-address">${esc(participant.email||'No email address available')}</p><p class="muted-sm">Read-only. The participant or office can request an email change. Your own sign-in email is shown separately above.</p></section>`;}
    catch(error){if(current())host.innerHTML=`<section class="info-card ae-card"><h3>Participant contact email</h3><p class="ae-error" role="alert">${esc(error.message)}</p><a href="#/clients">Review people you can assist</a></section>`;}
  }
  async function renderConfirmation(host=document.getElementById('emailChangeConfirm')){
    if(!host)return;const current=lifecycle(host),token=new URLSearchParams(location.hash.split('?')[1]||'').get('token')||'';
    host.innerHTML='<h1>Confirm your new email</h1><p>Checking this verification link…</p>';
    const failure=error=>{host.innerHTML=`<h1>Email change not completed</h1><p class="ae-error" role="alert">${esc(error.message)}</p><p>Your email was not changed by this attempt. If the link expired or was replaced, request another from Profile → Your details → Email address.</p><a class="btn btn-secondary" href="#/account/profile">Open my profile</a>`;};
    try{if(!token)throw Error('Open the complete verification link from your new inbox.');const preview=await API.call('/email-change/confirm?token='+encodeURIComponent(token),{noFor:true});if(!current())return;
      host.innerHTML=`<h1>Confirm your new email</h1><p>Use <b>${esc(preview.new_email_hint)}</b> as your new sign-in and account email?</p><p>Confirming signs this account out on all devices. Sign in again with the new email and your existing password.</p>${button('Confirm email change','data-ae-confirm',true)}<p data-ae-status role="status" aria-live="polite"></p>`;
      let busy=false;host.querySelector('[data-ae-confirm]').addEventListener('click',async event=>{if(busy||!current())return;busy=true;event.currentTarget.disabled=true;status(host,'Confirming your email…');try{const result=await API.call('/email-change/confirm',{method:'POST',noFor:true,body:{token}});if(!current())return;host.innerHTML=`<h1>✓ Email changed</h1><p>${esc(result.message||'Your new email is confirmed. Use it with your existing password to sign in.')}</p><a class="btn btn-primary" href="#/login" data-ae-login>Continue to sign in</a>`;if(result.requires_login)clearSession();}
        catch(error){if(current()){status(host,error.message,true);event.currentTarget.disabled=false;}}finally{busy=false;}});
    }catch(error){if(current())failure(error);}
  }
  return {mount,mountParticipantContact,renderConfirmation};
})();
