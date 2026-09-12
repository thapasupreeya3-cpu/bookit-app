'use strict';
// Trusted viewer shell only. Uploaded bytes are fetched through the existing
// authenticated endpoint. PDFs use canvas; HTML uses an opaque, script-free
// child frame. Never give uploaded HTML scripts or same-origin privileges.
window.CareDocumentViewer=(()=>{
  const base='/vendor/pdfjs/',$=id=>document.getElementById(id);
  let pdf=null,loading=null,renderTask=null,loadNumber=0,drawNumber=0,pageNumber=1,rotation=0,zoom=1,loadingAbort=null;
  let mapsPromise=null,htmlPreview=false,embedded=false;
  try{embedded=window.self!==window.top;}catch{embedded=true;}
  class LocalBinaryDataFactory {
    async fetch({kind,filename}) {
      if(!/^[\w.-]+$/.test(filename))throw Error('Invalid viewer resource');
      if(kind==='cMapUrl'){
        mapsPromise ||= fetch(base+'cmaps.json',{credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error('Character maps unavailable');return r.json();}).catch(e=>{mapsPromise=null;throw e;});
        const maps=await mapsPromise,key=filename.replace(/\.bcmap$/,'');
        if(!Object.hasOwn(maps,key))throw Error('Character map unavailable');
        return Uint8Array.from(atob(maps[key]),c=>c.charCodeAt(0));
      }
      const folder={standardFontDataUrl:'standard_fonts',wasmUrl:'wasm'}[kind];if(!folder)throw Error('Invalid viewer resource');
      const r=await fetch(base+folder+'/'+filename,{credentials:'same-origin'});if(!r.ok)throw Error('Viewer resource unavailable');return new Uint8Array(await r.arrayBuffer());
    }
  }
  const status=(text,error=false,quiet=false)=>{const el=$('pdfStatus');el.textContent=text;el.setAttribute('role',error?'alert':'status');$('viewerFeedback').classList.toggle('is-quiet',quiet&&!error);$('retryPdf').hidden=!error;};
  function controls(){
    for(const id of ['previousPage','nextPage','pageNumber','zoomOut','zoomIn','fitPage','rotatePage','showText'])$(id).disabled=!pdf;
    if(pdf){$('previousPage').disabled=pageNumber<=1;$('nextPage').disabled=pageNumber>=pdf.numPages;$('pageNumber').max=String(pdf.numPages);$('pageNumber').value=String(pageNumber);$('pageTotal').textContent='/ '+pdf.numPages;$('zoomLabel').textContent=Math.round(zoom*100)+'%';$('previousPage').hidden=pdf.numPages===1;$('nextPage').hidden=pdf.numPages===1;$('zoomOut').disabled=zoom<=.5;$('zoomIn').disabled=zoom>=3;}
  }
  function clearCanvas(){const canvas=$('pdfCanvas');canvas.hidden=true;canvas.width=1;canvas.height=1;$('pdfText').textContent='';}
  async function draw(){
    if(!pdf)return;const n=++drawNumber,doc=pdf,currentPage=pageNumber;renderTask?.cancel();status('Loading page '+currentPage+'…',false,!$('pdfCanvas').hidden);controls();
    try{
      const page=await doc.getPage(currentPage);if(n!==drawNumber||doc!==pdf)return;
      if(renderTask)try{await renderTask.promise;}catch{}if(n!==drawNumber||doc!==pdf)return;
      const natural=page.getViewport({scale:1,rotation}),width=Math.max(200,$('pdfSurface').clientWidth-16),scale=width/natural.width*zoom;
      const viewport=page.getViewport({scale,rotation}),canvas=$('pdfCanvas');
      // Bound each canvas, including scans with enormous page dimensions.
      const outputScale=Math.min(window.devicePixelRatio||1,2,Math.sqrt(16000000/(viewport.width*viewport.height)),8192/viewport.width,8192/viewport.height);
      canvas.width=Math.max(1,Math.floor(viewport.width*outputScale));canvas.height=Math.max(1,Math.floor(viewport.height*outputScale));canvas.style.width=Math.floor(viewport.width)+'px';canvas.style.height=Math.floor(viewport.height)+'px';canvas.hidden=false;canvas.setAttribute('aria-label','Document page '+currentPage+' of '+doc.numPages);
      renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[outputScale,0,0,outputScale,0,0],background:'rgb(255,255,255)'});await renderTask.promise;if(n!==drawNumber||doc!==pdf)return;
      status('Page '+currentPage+' of '+doc.numPages,false,true);$('pdfSurface').scrollTop=0;
      try{const text=await page.getTextContent();if(n===drawNumber&&doc===pdf)$('pdfText').textContent=text.items.map(x=>(x.str||'')+(x.hasEOL?'\n':' ')).join('').trim()||'This page is a scan with no selectable text. Read the image above or download the original.';}catch{if(n===drawNumber&&doc===pdf)$('pdfText').textContent='Text is unavailable for this page. Read the page image above.';}
    }catch(e){if(n!==drawNumber||e.name==='RenderingCancelledException')return;clearCanvas();status('This page could not be displayed. Try Retry, or download the original PDF.',true);}
  }
  function fileUrl(){const p=new URLSearchParams(location.search),scope=p.get('scope'),id=p.get('id');if(!['worker','participant','plan'].includes(scope)||!/^\d+$/.test(id||'')||!Number.isSafeInteger(Number(id))||Number(id)<1)throw Error('Open a document from the worker or participant file.');return scope==='plan'?'/api/admin/participants/'+id+'/plan':'/api/'+(scope==='worker'?'documents':'participant-documents')+'/'+id+'/file';}
  function displayHtml(text,n){
    if(!text.trim())throw Error('The stored document is empty. Download it or ask for a replacement.');
    // The srcdoc frame has an empty sandbox: no scripts, forms, popups,
    // downloads, top navigation or same-origin access. The leading CSP further
    // blocks subresources except inline styles, data images and our two logos.
    // The shell's frame-src 'none' prevents this child navigating to a URL.
    // Keep original text untouched on the server, including accepted editions.
    const origin=location.origin;
    const policy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: "+origin+"/assets/careweb/logo-icon.png "+origin+"/assets/careweb/logo-wordmark.png; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    const frame=$('htmlDocument');
    frame.setAttribute('sandbox','');
    frame.onload=()=>{if(n===loadNumber&&htmlPreview)status('Document ready',false,true);};
    frame.srcdoc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="referrer" content="no-referrer"><style>.bar.no-print{display:none!important}html{overflow-wrap:anywhere}body{margin:0!important}@media screen and (max-width:650px){.sheet{padding:16px!important}}</style>'+text;
    frame.hidden=false;
    htmlPreview=true;$('pdfSurface').hidden=true;$('pdfControls').hidden=true;$('viewerToolbar').hidden=embedded;
  }
  async function start(){
    const n=++loadNumber;++drawNumber;loadingAbort?.abort();renderTask?.cancel();if(loading){try{await loading.destroy();}catch{}}if(n!==loadNumber)return;
    pdf=null;loading=null;htmlPreview=false;clearCanvas();controls();$('htmlDocument').hidden=true;$('htmlDocument').onload=null;$('htmlDocument').removeAttribute('srcdoc');$('pdfSurface').hidden=true;$('pdfControls').hidden=true;$('textPanel').hidden=true;$('showText').setAttribute('aria-expanded','false');$('viewerMore').open=false;$('viewerToolbar').hidden=embedded;$('pageTotal').textContent='';$('downloadPdf').hidden=true;status('Loading document…');
    let timeout;const controller=new AbortController();loadingAbort=controller;
    try{
      const url=fileUrl();$('downloadPdf').href=url+'?download=1';$('downloadPdf').hidden=embedded;
      timeout=setTimeout(()=>controller.abort(),30000);
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:loadingAbort.signal});
      const errors={401:'Your session has expired. Sign in to the site again, then retry.',403:'You do not have access to this document.',404:'The uploaded file could not be found on the server. Ask the office to check the stored copy.'};
      if(!response.ok)throw Error(errors[response.status]||'The document could not be loaded. Please retry.');
      const data=new Uint8Array(await response.arrayBuffer());clearTimeout(timeout);if(n!==loadNumber)return;
      if(data.length>32*1024*1024)throw Error('This document is too large for the preview. Download the original to open it.');
      const isPdf=String.fromCharCode(...data.slice(0,5))==='%PDF-',mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(!isPdf&&mime==='text/html'){displayHtml(new TextDecoder().decode(data),n);return;}
      if(!isPdf)throw Error('The stored file is not a readable PDF or HTML document. Download it or ask for a replacement.');
      $('pdfSurface').hidden=false;$('pdfControls').hidden=false;$('viewerToolbar').hidden=false;
      const lib=await import('/vendor/pdfjs/pdf.min.mjs');if(n!==loadNumber)return;
      lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
      loading=lib.getDocument({data,BinaryDataFactory:LocalBinaryDataFactory,useWorkerFetch:false,cMapUrl:base,cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',disableFontFace:true,enableXfa:false,isEvalSupported:false,canvasMaxAreaInBytes:16000000,maxImageSize:40000000});
      const loaded=await loading.promise;if(n!==loadNumber){await loaded.destroy();return;}pdf=loaded;pageNumber=1;rotation=0;zoom=1;await draw();
    }catch(e){if(n!==loadNumber)return;pdf=null;controls();clearCanvas();status(e.name==='AbortError'?'The document took too long to load. Check your connection and retry.':e.name==='PasswordException'?'This PDF is password-protected. Download it and open it in your PDF reader.':e.name==='InvalidPDFException'?'This PDF is damaged or unreadable. Download it or request a replacement.':e.message||'The viewer could not load. Download the original.',true);}
    finally{clearTimeout(timeout);}
  }
  async function change(action){if(!pdf)return;if(action==='previous')pageNumber=Math.max(1,pageNumber-1);if(action==='next')pageNumber=Math.min(pdf.numPages,pageNumber+1);if(action==='in')zoom=Math.min(3,zoom+.25);if(action==='out')zoom=Math.max(.5,zoom-.25);if(action==='fit')zoom=1;if(action==='rotate')rotation=(rotation+90)%360;await draw();}
  function mount(){
    for(const [id,action] of Object.entries({previousPage:'previous',nextPage:'next',zoomIn:'in',zoomOut:'out',fitPage:'fit',rotatePage:'rotate'}))$(id).addEventListener('click',()=>change(action));
    const toggleText=show=>{$('textPanel').hidden=!show;$('showText').setAttribute('aria-expanded',String(show));$('viewerMore').open=false;};
    $('showText').addEventListener('click',()=>{toggleText($('textPanel').hidden);$('closeText').focus();});$('closeText').addEventListener('click',()=>{toggleText(false);$('moreToggle').focus();});
    document.addEventListener('click',e=>{if(!$('viewerMore').contains(e.target))$('viewerMore').open=false;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('viewerMore').open=false;toggleText(false);}});
    $('rotatePage').addEventListener('click',()=>{$('viewerMore').open=false;});
    $('pageNumber').addEventListener('change',()=>{const v=Number($('pageNumber').value);if(pdf&&Number.isInteger(v)&&v>=1&&v<=pdf.numPages){pageNumber=v;draw();}else controls();});
    $('retryPdf').addEventListener('click',start);let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(draw,150);});
    window.addEventListener('pagehide',()=>{++loadNumber;++drawNumber;loadingAbort?.abort();renderTask?.cancel();loading?.destroy();});return start();
  }
  return {mount,start,change};
})();
window.CareDocumentViewer.mount();
