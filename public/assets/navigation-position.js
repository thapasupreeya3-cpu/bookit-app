/* Keep navigation beside the work being opened. No record or payment changes. */
(function(){
 'use strict';
 const get=id=>document.getElementById(id),query=selector=>document.querySelector(selector);
 const position=()=>({x:Number(window.scrollX)||0,y:Number(window.scrollY)||0});
 const identity=()=>String(window.API?.me?.id||'guest');
 const dialogOpen=()=>!!query('.modal-overlay.open, dialog[open], #rmDialog [role="dialog"]');
 const describe=hash=>{const [path,search='']=String(hash||'#/').slice(1).split('?');return {path,q:new URLSearchParams(search)};};
 const office=d=>/^\/admin(?:\/|$)/.test(d.path)||!!window.API?.me?.admin&&['/journey','/payment-tracking'].includes(d.path);
 const frame=fn=>window.requestAnimationFrame?requestAnimationFrame(fn):setTimeout(fn,0);
 let active=null,local=null,current=null,serial=0,input=0,back=false,owner=identity();
 const positions=new Map(),heights=new WeakMap();
 function release(n){if(n?.hold){const h=n.hold;h.state.holds.delete(h);h.node.style.minHeight=h.state.holds.size?Math.max(...Array.from(h.state.holds,x=>x.height))+'px':h.state.value;if(!h.state.holds.size)heights.delete(h.node);n.hold=null;}}
 function remember(){if(current&&(!active||active.done))positions.set(current.key,position());}
 function focus(el){if(!el?.focus)return;if(!el.hasAttribute?.('tabindex')&&!el.matches?.('a,button,input,select,textarea'))el.setAttribute?.('tabindex','-1');el.focus({preventScroll:true});}
 function offset(){return Math.max(16,(query('header.site')?.getBoundingClientRect?.().bottom||0)+12);}
 function move(point){window.scrollTo({left:point.x,top:Math.max(0,point.y),behavior:'instant'});}
 function reveal(el,force=false){if(!el?.getBoundingClientRect)return;const r=el.getBoundingClientRect(),top=offset(),bottom=Number(window.innerHeight)||800;if(force||r.top<top||r.top>bottom-120)move({x:position().x,y:position().y+r.top-top});}
 function hold(page){if(!page?.style||!page.getBoundingClientRect)return null;let state=heights.get(page);if(!state){state={value:page.style.minHeight,holds:new Set()};heights.set(page,state);}const h={node:page,state,height:Math.max(page.getBoundingClientRect().height||0,Number(page.offsetHeight)||0)};state.holds.add(h);page.style.minHeight=Math.max(...Array.from(state.holds,x=>x.height))+'px';return h;}
 function selector(n){
  const d=n.to,p=n.from,changed=key=>p?.q.get(key)!==d.q.get(key),same=p?.path===d.path;
  if(d.path==='/admin/verification')return d.q.get('person')&&(!same||changed('person'))?'#vfDetail':same&&['role','q','owner','status','offset','examples'].some(changed)?'#vfQueue':same?null:'.vf-workspace';
  if(d.path==='/journey'&&d.q.get('panel')==='shift')return '#flowShiftWork';
  if(d.path==='/journey'&&(d.q.get('panel')||'tasks')==='tasks'){
   if(d.q.get('person')&&(!same||changed('person')))return '#na-person-panel';
   if(same&&['category','task_page'].some(changed))return '.na-category-tabs';
   if(same&&changed('offset'))return '[data-na-person-tabs]';
  }
  if(office(d)){
   if(query('.page.active .ca-money-sections')&&n.hash!==n.previousHash)return '.page.active .ca-money-sections';
   if(!same||changed('panel'))return '.page.active .ca-content';
   if(['section','tab'].some(changed))return '.page.active .ca-section-links, .page.active .flow-subnav, .page.active .cp-office-tabs, .page.active .ca-content';
  }
  return null;
 }
 function begin({path,id}){
  remember();release(active);release(local);local=null;
  const who=identity();if(owner!==who){positions.clear();current=null;owner=who;}
  const hash=location.hash||'#/',to=describe(hash),from=current?.description,entry=history.state?.careNavigation;
  const restore=back&&entry?.hash===hash?positions.get(entry.key):null;back=false;
  const key=restore?entry.key:'care-'+(++serial);
  try{history.replaceState({...history.state,careNavigation:{key,hash}},'');if('scrollRestoration'in history)history.scrollRestoration='manual';}catch{}
  const same=!!from&&from.path===to.path&&(to.path!=='/journey'||(from.q.get('panel')||'tasks')===(to.q.get('panel')||'tasks'));
  const n={key,hash,to,from,previousHash:current?.hash,same,point:position(),restore,owner:who,input,done:false,hold:hold(get(id)),sidebar:query('.page.active .ca-sidebar')?.scrollTop};
  active=n;current={key,hash,description:to};return n;
 }
 function valid(n){return n===active&&n.hash===(location.hash||'#/')&&n.owner===identity();}
 function complete(n,rendered){
  if(!n)return;
  return Promise.resolve(rendered).then(()=>settle(n),()=>settle(n));
 }
 function settle(n){return new Promise(resolve=>frame(()=>{
  if(!valid(n)){release(n);resolve();return;}
  release(n);n.done=true;
  if(input!==n.input||dialogOpen()){remember();resolve();return;}
  const destination=selector(n),target=destination?query(destination):null;
  if(n.restore)move(n.restore);
  else if(target){if(n.same)move(n.point);reveal(target,!n.same);}
  else if(n.same)move(n.point);
  else move({x:0,y:0});
  const sidebar=query('.page.active .ca-sidebar');if(sidebar&&n.sidebar!=null&&n.from&&office(n.from)&&office(n.to))sidebar.scrollTop=n.sidebar;
  const selected=n.to.path==='/journey'?query('[data-na-person-tab][aria-selected="true"]'):null;
  focus(target||selected||get('main'));remember();resolve();
 }));}
 function update(render,{target,focus:focusSelector}={}){
  // Local file/document tabs do not create a hash route. Finish after their replacement DOM exists.
  release(local);
  const task={hash:location.hash,who:identity(),input,point:position(),hold:hold(query('.page.active'))};local=task;
  let result;try{result=render();}catch(err){release(task);throw err;}
  return Promise.resolve(result).then(()=>new Promise(resolve=>frame(()=>{
   if(local!==task){release(task);resolve();return;}
   release(task);local=null;if(task.hash!==location.hash||task.who!==identity()||task.input!==input||dialogOpen()){resolve();return;}
   move(task.point);reveal(target?query(target):null);focus(focusSelector?query(focusSelector):null);remember();resolve();
  })),err=>{release(task);throw err;});
 }
 window.addEventListener('scroll',remember,{passive:true});
 window.addEventListener('popstate',()=>{back=true;});
 for(const event of ['wheel','touchstart','pointerdown'])window.addEventListener(event,()=>{input++;},{passive:true});
 window.addEventListener('keydown',ev=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Tab',' '].includes(ev.key))input++;});
 window.CareNavigation={begin,complete,update};
})();
