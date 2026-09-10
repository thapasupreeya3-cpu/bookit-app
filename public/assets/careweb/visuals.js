/* The Care Web v88.0.0: presentation-only enhancements.
   No business data, local storage, authentication, API or payment writes. */
(function(){
 'use strict';
 function pauseScenes(){
  document.querySelectorAll('[data-cw-media]').forEach(function(fig){
   if(!fig.closest('.page.active')){var v=fig.querySelector('video');if(v)v.pause();fig.classList.remove('cw-playing');var b=fig.querySelector('[data-cw-play]');if(b){b.setAttribute('aria-pressed','false');b.innerHTML='<span aria-hidden="true">▷</span> Watch a support moment';}}
  });
 }
 document.addEventListener('careweb:route',pauseScenes);
 document.addEventListener('visibilitychange',function(){if(document.hidden)document.querySelectorAll('[data-cw-media] video').forEach(function(v){v.pause();});});
 document.addEventListener('click',function(e){
  var b=e.target.closest('[data-cw-play]');if(!b)return;
  var fig=b.closest('[data-cw-media]'),v=fig.querySelector('video');if(!v)return;
  if(fig.classList.contains('cw-playing')){v.pause();fig.classList.remove('cw-playing');b.setAttribute('aria-pressed','false');b.innerHTML='<span aria-hidden="true">▷</span> Watch a support moment';return;}
  if(!v.getAttribute('src'))v.src='/assets/scenes/'+b.dataset.cwPlay+'.mp4';
  v.controls=true;v.muted=true;fig.classList.add('cw-playing');b.setAttribute('aria-pressed','true');b.textContent='Close video';
  var play=v.play();if(play&&play.catch)play.catch(function(){fig.classList.remove('cw-playing');b.setAttribute('aria-pressed','false');b.textContent='Try video again';});
 });
 document.querySelectorAll('[data-cw-play]').forEach(function(b){b.setAttribute('aria-pressed','false');});
 // Keep the responsive navigation usable with a keyboard at its new breakpoint.
 document.addEventListener('click',function(e){
  if(e.target.closest('#burger')) requestAnimationFrame(function(){var nav=document.getElementById('mainNav'),close=document.getElementById('navClose');if(nav&&nav.classList.contains('open')&&close)close.focus();});
  if(e.target.closest('#navClose')){var burger=document.getElementById('burger');if(burger)burger.focus();}
 });
 document.addEventListener('keydown',function(e){
  var nav=document.getElementById('mainNav');
  if(!nav||!nav.classList.contains('open')||!matchMedia('(max-width:1279px)').matches)return;
  if(e.key==='Escape'){setTimeout(function(){var burger=document.getElementById('burger');if(burger)burger.focus();},0);return;}
  if(e.key!=='Tab')return;
  var all=[].slice.call(nav.querySelectorAll('a[href],button:not([disabled]),[tabindex="0"]')).filter(function(el){return el.getClientRects().length&&!el.closest('[hidden]');});
  if(!all.length)return;var first=all[0],last=all[all.length-1],active=document.activeElement;
  if(e.shiftKey&&(active===first||!nav.contains(active))){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&(active===last||!nav.contains(active))){e.preventDefault();first.focus();}
 },true);
})();
