/* The Care Web policy pages: the fill layer.
   A register page (kind 'register') keeps its entries on the server, shared
   with the office and explicitly authorised workers: any table on the page that has a header
   row and nothing else is an entry table, and this script adds "Add entry",
   edit and delete beneath it. A form or template page gets a "Fill in on
   screen" mode: every checklist item becomes a tick box with a space to
   write, the page gains a completed-by block, and the copy is saved to the
   signed-in person's own file on The Care Web (or printed, for anyone).
   Nothing here runs on policies, procedures or plans. */
(function () {
  'use strict';
  var root = document.getElementById('policy-fill');
  if (!root) return;
  var slug = root.getAttribute('data-slug');
  var kind = root.getAttribute('data-kind');
  var canSave = root.getAttribute('data-can-save') === '1';
  var who = root.getAttribute('data-who') || '';
  var body = document.querySelector('.policy-body');
  if (!body) return;
  var api = '/api/policy-fill/' + encodeURIComponent(slug);

  var css = document.createElement('style');
  css.textContent = [
    '.fill-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:.6em 0 1em;padding:10px 12px;border:1px solid #d8d3cb;border-radius:8px;background:#faf8f5;font-size:.93em}',
    '.fill-bar button,.fill-panel button,.fill-row-actions button{font:inherit;font-size:.92em;padding:5px 11px;border:1px solid #8a8378;border-radius:6px;background:#fff;cursor:pointer}',
    '.fill-bar button.primary,.fill-panel button.primary{background:#2f5d50;color:#fff;border-color:#2f5d50}',
    '.fill-bar .status{color:#555;margin-left:auto}',
    '.fill-scroll{overflow-x:auto;margin:1em 0}',
    '.fill-scroll table.grid{margin:0;min-width:100%}',
    '.fill-scroll table.grid td{white-space:pre-wrap;min-width:9em}',
    '.fill-empty td{color:#777;font-style:italic}',
    '.fill-row-actions{white-space:nowrap}',
    '.fill-row-actions button{padding:2px 8px;font-size:.85em;margin-right:4px}',
    '.fill-panel{border:1px solid #d8d3cb;border-radius:8px;padding:12px 14px;margin:.6em 0 1.2em;background:#fff}',
    '.fill-panel h4{margin:0 0 .6em;font-size:1em}',
    '.fill-panel label{display:block;margin:0 0 .7em;font-size:.92em}',
    '.fill-panel label span{display:block;margin-bottom:3px;color:#333}',
    '.fill-panel textarea,.fill-panel input,.fill-by input,.fill-by textarea{font:inherit;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #b9b3aa;border-radius:6px}',
    '.fill-panel textarea{min-height:2.6em;resize:vertical}',
    '.fill-panel .actions{display:flex;gap:8px;margin-top:.4em}',
    '.policy-body.filling li{list-style:none;margin:0 0 .55em;padding-left:0}',
    '.policy-body.filling li label.fi{display:flex;gap:8px;align-items:flex-start}',
    '.policy-body.filling li label.fi input[type=checkbox]{margin-top:.35em;flex:none}',
    '.policy-body.filling li .fi-text{flex:1 1 55%}',
    '.policy-body.filling li .fi-val{flex:1 1 40%;min-width:9em;font:inherit;font-size:.92em;padding:3px 6px;border:0;border-bottom:1px solid #8a8378;background:transparent}',
    '.fill-by{border-top:1px solid #d8d3cb;margin-top:1.6em;padding-top:1em}',
    '.fill-by h3{margin:.2em 0 .6em}',
    '.fill-by .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(14em,1fr));gap:10px}',
    '.fill-by label{display:block;font-size:.92em}',
    '.fill-by label span{display:block;margin-bottom:3px;color:#333}',
    '.fill-by textarea{min-height:4em;resize:vertical}',
    '@media print{.fill-bar,.fill-panel,.fill-row-actions,.no-print{display:none!important}.policy-body.filling li .fi-val{border-bottom:1px solid #000}}'
  ].join('\n');
  document.head.appendChild(css);

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function today() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function when(iso) { if (!iso) return ''; var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso); return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : iso; }
  function get(cb) {
    fetch(api, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw new Error(j.error || r.status); }); })
      .then(cb, function (e) { cb(null, e); });
  }
  function post(data, baseId, cb) {
    fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ data: data, base_id: baseId }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || r.status), { status: r.status }); return j; }); })
      .then(function (j) { cb(j); }, function (e) { cb(null, e); });
  }

  /* ------------------------------------------------------------------ */
  if (kind === 'register') registerMode();
  else formMode();

  function registerMode() {
    var model=window.PolicyRegisterState;
    var permission=root.getAttribute('data-permission') || 'none';
    var canRead=permission!=='none',canEdit=permission==='edit';
    var tables=Array.prototype.slice.call(body.querySelectorAll('table.grid')).filter(function(t){return t.rows.length===1&&t.rows[0].querySelector('th');});
    if(!tables.length)return;
    var state={id:null,data:{tables:{}},base:{tables:{}},loaded:false,busy:false,dirty:false,editing:null,recovery:false};
    var status=el('span',{'class':'status','role':'status','aria-live':'polite'});
    var notice=permission==='none'?'Saved entries are restricted. Ask the office for access.':permission==='read'?'You can read this register. Ask the office if you need to add an entry.':permission==='append'?'You can add new entries. Ask the office to correct an existing entry.':'You can add and correct entries in this register. Earlier saved versions are retained.';
    var top=el('div',{'class':'fill-bar no-print'},[el('span',{text:notice}),status]);body.insertBefore(top,body.firstChild);
    var recovery=el('section',{'class':'fill-panel no-print','aria-label':'Recover unsaved entries',hidden:''});top.after(recovery);
    var mutations=[],panels=[];
    var retry=el('button',{type:'button',text:'Retry save',hidden:'',onclick:function(){save();}});
    var discard=el('button',{type:'button',text:'Discard unsaved changes',hidden:'',onclick:function(){if(!confirm('Discard only your unsaved changes? The last saved version will remain.'))return;state.data=model.copy(state.base);state.dirty=false;closeEditor();renderAll();showSaved();}});
    top.appendChild(retry);top.appendChild(discard);
    function busy(on){state.busy=on;mutations.forEach(function(b){b.disabled=on||!state.loaded||state.dirty||!!state.editing;});panels.forEach(function(p){p.querySelectorAll('button,textarea').forEach(function(b){b.disabled=on;});});retry.hidden=!state.dirty;retry.disabled=on;discard.hidden=!state.dirty;discard.disabled=on;}
    function closeEditor(){if(state.editing){state.editing.panel.hidden=true;state.editing=null;}busy(false);}
    function showSaved(){status.textContent=state.saved_at?'Last saved '+when(state.saved_at)+(state.saved_by?' by '+state.saved_by:''):'No entries saved yet.';busy(false);}
    function renderAll(){tables.forEach(function(t){t._render();});busy(state.busy);}
    function preserveCopy(label,data){var ta=el('textarea',{rows:'7',readonly:'','aria-label':label});ta.value=JSON.stringify(data,null,2);recovery.appendChild(el('label',null,[el('span',{text:label}),ta]));return ta;}
    function showConflict(){
      recovery.hidden=false;recovery.innerHTML='';
      recovery.appendChild(el('h4',{text:'Your unsaved entries are safe on this page'}));
      preserveCopy('Your unsaved version — select and copy if needed',state.data);
      recovery.appendChild(el('p',{text:'Loading the latest saved version. No local entries will be replaced.'}));
      get(function(latest,err){
        if(err){recovery.appendChild(el('p',{text:'Could not load the latest version: '+err.message+'. Your changes remain above.'}));return;}
        var remote=latest.data&&latest.data.tables?latest.data:{tables:{}};
        var detail=el('details',null,[el('summary',{text:'Review the latest saved entries'}),el('pre',{text:JSON.stringify(remote,null,2)})]);recovery.appendChild(detail);
        recovery.appendChild(el('button',{type:'button',text:'Combine with latest and retry',onclick:function(){
          if(state.busy)return;
          var merged=model.merge(state.base,state.data,remote);
          if(merged.conflicts.length){status.textContent='Both versions changed existing rows. Copy your draft below, then load the latest version and reapply the correction.';return;}
          state.id=latest.id;state.base=model.copy(remote);state.data=merged.data;state.dirty=true;closeEditor();renderAll();save();
        }}));
        recovery.appendChild(el('button',{type:'button',text:'Load latest and keep my draft below',onclick:function(){
          if(state.busy)return;
          state.id=latest.id;state.base=model.copy(remote);state.data=model.copy(remote);state.saved_at=latest.saved_at;state.saved_by=latest.saved_by;state.dirty=false;state.recovery=true;
          closeEditor();renderAll();status.textContent='Latest version loaded. Your unsaved copy remains below; reapply the needed entries.';
          recovery.querySelectorAll('button').forEach(function(b){b.disabled=true;});
          recovery.appendChild(el('button',{type:'button',text:'I have finished with the saved draft copy',onclick:function(){if(confirm('Have you saved or copied everything you need from this draft?')){state.recovery=false;recovery.hidden=true;}}}));
        }}));
      });
    }
    function save(){
      if(state.busy||!state.loaded||!canSave)return;
      busy(true);status.textContent='Saving…';
      post(state.data,state.id,function(j,err){
        if(err){state.dirty=true;busy(false);status.textContent='Not saved: '+err.message+' Your changes remain on this page.';if(err.status===409)showConflict();return;}
        state.id=j.id;state.saved_at=j.saved_at;state.saved_by=j.saved_by;state.base=model.copy(state.data);state.dirty=false;
        closeEditor();renderAll();showSaved();if(!state.recovery)recovery.hidden=true;
      });
    }
    tables.forEach(function(table,i){
      var cols=Array.prototype.map.call(table.rows[0].cells,function(c){return c.textContent.trim();});
      var wrap=el('div',{'class':'fill-scroll'});table.parentNode.insertBefore(wrap,table);wrap.appendChild(table);
      if(canEdit)table.rows[0].appendChild(el('th',{'class':'fill-row-actions no-print',text:'Actions'}));
      var panel=el('div',{'class':'fill-panel no-print',hidden:''});panels.push(panel);
      var bar=el('div',{'class':'fill-bar no-print'});wrap.after(bar);bar.after(panel);
      function rows(){return state.data.tables[String(i)]||[];}
      function render(){
        while(table.rows.length>1)table.deleteRow(1);
        if(!rows().length){var tr=table.insertRow();tr.className='fill-empty';var td=tr.insertCell();td.colSpan=cols.length+(canEdit?1:0);td.textContent=canRead?'No entries yet.':'Saved entries are restricted.';return;}
        rows().forEach(function(row,index){var tr=table.insertRow();cols.forEach(function(_,c){tr.insertCell().textContent=row[c]||'';});if(canEdit){
          var act=tr.insertCell();act.className='fill-row-actions no-print';
          var edit=el('button',{type:'button',text:'Edit',onclick:function(){openPanel(index);}});
          var del=el('button',{type:'button',text:'Delete',onclick:function(){if(!confirm('Remove this entry from the current register? Earlier saved versions remain on file.'))return;var next=rows().slice();next.splice(index,1);state.data.tables[String(i)]=next;state.dirty=true;renderAll();save();}});
          mutations.push(edit,del);act.appendChild(edit);act.appendChild(del);
        }});
      }
      function openPanel(index){
        if(!state.loaded||state.busy||state.dirty||state.editing)return;
        panel.innerHTML='';panel.hidden=false;var original=model.copy(state.data),pendingIndex=index;
        state.editing={panel:panel,dirty:false};panel.appendChild(el('h4',{text:index==null?'New entry':'Edit entry'}));
        var inputs=cols.map(function(c,ci){var ta=el('textarea',{rows:'2'});ta.value=index==null?'':rows()[index][ci]||'';ta.addEventListener('input',function(){state.editing.dirty=true;if(pendingIndex!=null){var next=rows().slice();next[pendingIndex]=inputs.map(function(t){return t.value.trim();});state.data.tables[String(i)]=next;}status.textContent='Unsaved entry — save it before leaving this page.';});panel.appendChild(el('label',null,[el('span',{text:c}),ta]));return ta;});
        panel.appendChild(el('div',{'class':'actions'},[
          el('button',{type:'button','class':'primary',text:'Save entry',onclick:function(){var row=inputs.map(function(t){return t.value.trim();});if(!row.some(Boolean)){alert('Write something in at least one column.');return;}var next=rows().slice();if(pendingIndex==null){pendingIndex=next.length;next.push(row);}else next[pendingIndex]=row;state.data.tables[String(i)]=next;state.dirty=true;renderAll();save();}}),
          el('button',{type:'button',text:'Cancel entry',onclick:function(){if((state.dirty||state.editing.dirty)&&!confirm('Discard this unsaved entry?'))return;state.data=original;state.dirty=false;closeEditor();renderAll();showSaved();}})
        ]));busy(false);inputs[0].focus();
      }
      if(canSave){var add=el('button',{type:'button','class':'primary',text:'Add entry',onclick:function(){openPanel(null);}});mutations.push(add);bar.appendChild(add);}
      bar.appendChild(el('button',{type:'button',text:'Print, or save as PDF',onclick:function(){window.print();}}));table._render=render;render();
    });
    window.addEventListener('beforeunload',function(e){if(state.dirty||state.busy||state.editing&&state.editing.dirty||state.recovery){e.preventDefault();e.returnValue='';}});
    busy(false);
    if(canRead){status.textContent='Loading entries…';get(function(j,err){if(err){status.textContent='Could not load entries: '+err.message;return;}state.id=j.id;state.data=j.data&&j.data.tables?j.data:{tables:{}};state.base=model.copy(state.data);state.saved_at=j.saved_at;state.saved_by=j.saved_by;state.loaded=true;renderAll();showSaved();});}
  }

  function formMode() {
    var items = Array.prototype.slice.call(body.querySelectorAll('li'));
    var state = { id: null, saved_at: '', saved_by: '', filling: false };
    var status = el('span', { class: 'status' });
    var fillBtn = el('button', { type: 'button', class: 'primary', text: 'Fill in on screen', onclick: startFilling });
    var saveBtn = el('button', { type: 'button', class: 'primary', text: 'Save to my file', style: 'display:none', onclick: save });
    var clearBtn = el('button', { type: 'button', text: 'Clear', style: 'display:none', onclick: function () { if (confirm('Clear everything typed on this page?')) apply({}); } });
    var bar = el('div', { class: 'fill-bar no-print' }, [
      fillBtn, saveBtn, clearBtn,
      el('button', { type: 'button', text: 'Print, or save as PDF', onclick: function () { window.print(); } }),
      status
    ]);
    body.insertBefore(bar, body.firstChild);
    var by = null;

    function startFilling() {
      if (state.filling) return;
      state.filling = true;
      body.classList.add('filling');
      fillBtn.style.display = 'none';
      clearBtn.style.display = '';
      items.forEach(function (li, i) {
        var text = li.textContent.trim();
        li.setAttribute('data-fi', String(i));
        var cb = el('input', { type: 'checkbox' });
        var val = el('input', { type: 'text', class: 'fi-val', placeholder: '\u2026', 'aria-label': 'Your answer for: ' + text });
        var lab = el('label', { class: 'fi' }, [cb, el('span', { class: 'fi-text', text: text }), val]);
        li.textContent = ''; li.appendChild(lab);
      });
      by = el('div', { class: 'fill-by' }, [
        el('h3', { text: 'Completed by' }),
        el('div', { class: 'cols' }, [
          el('label', null, [el('span', { text: 'Name' }), el('input', { type: 'text', 'data-by': 'name', value: who })]),
          el('label', null, [el('span', { text: 'Role or relationship' }), el('input', { type: 'text', 'data-by': 'role' })]),
          el('label', null, [el('span', { text: 'Date' }), el('input', { type: 'text', 'data-by': 'date', value: today() })])
        ]),
        el('label', { style: 'margin-top:10px' }, [el('span', { text: 'Notes, answers to open questions, and anything else' }), el('textarea', { 'data-by': 'notes' })])
      ]);
      body.appendChild(by);
      if (canSave) {
        saveBtn.style.display = '';
        status.textContent = 'Loading your saved copy\u2026';
        get(function (j, err) {
          if (err) { status.textContent = 'Could not load a saved copy: ' + err.message; return; }
          state.id = j.id; state.saved_at = j.saved_at; state.saved_by = j.saved_by;
          if (j.data && j.data.items) apply(j.data);
          showStatus();
        });
      } else {
        status.textContent = 'Type into the page, then print it. Sign in to save a copy to your Care Web file.';
      }
    }
    function collect() {
      var out = { items: [], by: {} };
      items.forEach(function (li) {
        var lab = li.querySelector('label.fi'); if (!lab) return;
        out.items.push({ label: lab.querySelector('.fi-text').textContent, checked: lab.querySelector('input[type=checkbox]').checked, value: lab.querySelector('.fi-val').value });
      });
      if (by) Array.prototype.forEach.call(by.querySelectorAll('[data-by]'), function (f) { out.by[f.getAttribute('data-by')] = f.value; });
      return out;
    }
    function apply(data) {
      var saved = (data && data.items) || [];
      items.forEach(function (li, i) {
        var lab = li.querySelector('label.fi'); if (!lab) return;
        var s = saved[i] && saved[i].label === lab.querySelector('.fi-text').textContent ? saved[i] : null;
        lab.querySelector('input[type=checkbox]').checked = !!(s && s.checked);
        lab.querySelector('.fi-val').value = s ? (s.value || '') : '';
      });
      var b = (data && data.by) || {};
      if (by) Array.prototype.forEach.call(by.querySelectorAll('[data-by]'), function (f) {
        var k = f.getAttribute('data-by');
        f.value = k in b ? b[k] : (k === 'name' ? who : k === 'date' ? today() : '');
      });
    }
    function showStatus() { status.textContent = state.saved_at ? 'Saved ' + when(state.saved_at) + (state.saved_by ? ' by ' + state.saved_by : '') : 'Not saved yet.'; }
    function save() {
      status.textContent = 'Saving\u2026';
      post(collect(), state.id, function (j, err) {
        if (err) { status.textContent = 'Could not save: ' + err.message; return; }
        state.id = j.id; state.saved_at = j.saved_at; state.saved_by = j.saved_by;
        showStatus();
      });
    }
  }
})();
