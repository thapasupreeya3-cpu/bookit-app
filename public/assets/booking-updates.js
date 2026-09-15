'use strict';
/* Accepted bookings are server-confirmed updates, separate from actions needing a response. */
window.CareBookingUpdates = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api = () => window.API;
  const root = () => document.getElementById('bookingUpdates');
  const eligible = () => !!(api()?.online && api()?.me && !api().me.admin &&
    (api().me.role === 'participant' || (api().me.role === 'coordinator' && api().actingFor?.id)));
  const identity = () => eligible() ? [api().me.id, api().me.role, api().actingFor?.id || '',
    (api().actingFor?.scopes || []).slice().sort().join(',')].join(':') : '';
  let who = '', serial = 0, flight = null, lastRead = 0, data = null, stale = false, busy = false, message = '', painted = '';
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return 'Date to confirm';
    const d = new Date(value + 'T12:00:00Z');
    return Number.isNaN(d.getTime()) ? 'Date to confirm' : d.toLocaleDateString('en-AU', {weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  }
  function time(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
    const hour = Number(match[1]);
    return (hour % 12 || 12) + ':' + match[2] + (hour < 12 ? ' am' : ' pm');
  }
  function details(update) {
    const hours = Number(update.hours), start = time(update.start);
    return date(update.date) + (start ? ' at ' + start : '') +
      (Number.isFinite(hours) && hours > 0 ? ' · ' + hours + (hours === 1 ? ' hour' : ' hours') : '');
  }
  function rows(value) {
    const seen = new Set();
    return (Array.isArray(value?.updates) ? value.updates : []).filter(update => {
      if (!update || !Number.isSafeInteger(Number(update.booking_id)) || Number(update.booking_id) <= 0 ||
          !['string','number'].includes(typeof update.id) || !String(update.id) || seen.has(String(update.id))) return false;
      seen.add(String(update.id)); return true;
    });
  }
  function destination(update) {
    return '#/journey?panel=shift&booking=' + Number(update.booking_id) +
      (api()?.me?.role === 'coordinator' && api()?.actingFor?.id ? '&for=' + encodeURIComponent(api().actingFor.id) : '');
  }
  function item(update) {
    const label = details(update), name = String(update.worker_name || 'Your worker');
    return '<div class="cbu-item"><div class="cbu-detail"><strong>' + escape(name) + '</strong><p>' + escape(label) + '</p>' +
      (api()?.me?.role === 'coordinator' ? '<p>For ' + escape(update.participant_name || api().actingFor?.name || 'your selected participant') + '</p>' : '') +
      '</div><div class="cbu-buttons"><a href="' + escape(destination(update)) + '" data-cbu-view="' + escape(update.id) + '">View booking<span class="sr-only"> with ' + escape(name) + '</span></a>' +
      '<button type="button" data-cbu-dismiss="' + escape(update.id) + '" aria-label="Dismiss booking accepted update for ' + escape(name + ', ' + label) + '" aria-disabled="' + busy + '">Dismiss</button></div></div>';
  }
  function focusedControl(host) {
    const active = document.activeElement;
    if (!active || !host.contains(active)) return null;
    for (const attribute of ['data-cbu-dismiss','data-cbu-view','data-cbu-refresh','data-cbu-more']) {
      if (active.hasAttribute?.(attribute)) return {attribute,value:active.getAttribute(attribute)};
    }
    return null;
  }
  function restoreFocus(host, control, dismissed) {
    if (!control) return;
    const same = Array.from(host.querySelectorAll('[' + control.attribute + ']')).find(node => node.getAttribute(control.attribute) === control.value);
    if (same) { same.focus({preventScroll:true}); return; }
    if (!dismissed.some(id => String(id) === control.value)) return;
    const next = host.querySelector('[data-cbu-view]');
    const nav = document.getElementById('navBookings');
    const target = next || (nav?.getClientRects?.().length ? nav : document.getElementById('main'));
    target?.focus({preventScroll:true});
  }
  function paint({dismissed=[]} = {}) {
    const host = root(); if (!host) return;
    const focus = focusedControl(host);
    const updates = rows(data), count = Math.max(updates.length, Number(data?.count) || 0);
    if (!eligible() || (!updates.length && !stale && !message)) {
      host.hidden = true; host.innerHTML = ''; painted = ''; restoreFocus(host,focus,dismissed); return;
    }
    const title = updates.length ? stale ? 'Booking update — last confirmed status' : count === 1 ? 'Booking accepted' : count + ' bookings accepted' : 'Booking updates';
    const html = '<section class="cbu-notice" aria-label="Booking updates" aria-busy="' + busy + '"' + (stale ? ' data-stale="true"' : '') + '>' +
      '<div class="cbu-heading"><span class="cbu-icon" aria-hidden="true">' + (stale ? '◷' : '✓') + '</span><strong>' + title + '</strong></div>' +
      (updates.length ? item(updates[0]) : '') +
      (updates.length > 1 ? '<details class="cbu-more"><summary data-cbu-more>' + (updates.length - 1) + ' more accepted booking' + (updates.length === 2 ? '' : 's') + '</summary><div class="cbu-list">' + updates.slice(1).map(item).join('') + '</div></details>' : '') +
      (count > updates.length ? '<p class="cbu-foot">Showing ' + updates.length + ' recent updates. <a href="#/bookings">Open all bookings</a>.</p>' : '') +
      (stale ? '<p class="cbu-feedback">Could not refresh booking updates. ' + (updates.length ? 'These are the last confirmed details. ' : '') + '<button type="button" data-cbu-refresh>Try again</button></p>' : '') +
      (message ? '<p class="cbu-feedback" role="status">' + escape(message) + '</p>' : '') +
      '<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">' + escape(updates.length ? title + '. ' + updates[0].worker_name + ', ' + details(updates[0]) : stale ? 'Booking updates could not refresh.' : message) + '</p></section>';
    // Keep keyboard focus and an open list stable during identical background polls.
    if (html !== painted) {
      const expanded = !!host.querySelector('details')?.open;
      host.innerHTML = html; painted = html;
      if (expanded && host.querySelector('details')) host.querySelector('details').open = true;
      restoreFocus(host,focus,dismissed);
    }
    host.hidden = false;
    host.onclick = event => {
      const button = event.target.closest('[data-cbu-dismiss],[data-cbu-refresh]');
      if (!button || !host.contains(button) || button.disabled || busy) return;
      event.preventDefault();
      if (button.hasAttribute('data-cbu-refresh')) return refresh(true);
      return acknowledge([button.dataset.cbuDismiss]);
    };
  }
  function reset(next) {
    who = next; serial++; flight = null; lastRead = 0; data = null; stale = false; busy = false; message = ''; paint();
  }
  async function call(path, options = {}) {
    let timer;
    try {
      return await Promise.race([api().call(path, options), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Booking updates took too long to load.')), 20000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function refresh(force = false) {
    const key = identity(); if (key !== who) reset(key);
    if (!key || document.hidden || busy) return;
    if (flight) return flight.promise;
    if (!force && Date.now() - lastRead < 14000) return;
    const request = {serial:++serial,promise:null}; flight = request;
    request.promise = (async () => {
      try {
        const value = await call('/me/booking-updates');
        if (request.serial !== serial || identity() !== key) return;
        data = value; stale = false; message = ''; lastRead = Date.now(); paint();
      } catch (error) {
        if (request.serial !== serial || identity() !== key) return;
        if (error.status === 401 || error.status === 403) { data = null; stale = false; message = ''; }
        else stale = true;
        lastRead = Date.now(); paint();
      } finally { if (flight === request) flight = null; }
    })();
    return request.promise;
  }
  async function acknowledge(ids) {
    const key = identity(); if (!key || key !== who || busy) return false;
    const selected = rows(data).filter(update => ids.some(id => String(id) === String(update.id))).map(update => update.id);
    if (!selected.length) return false;
    serial++; flight = null; busy = true; message = ''; paint();
    try {
      await call('/me/booking-updates/read', {method:'POST',body:{ids:selected}});
      if (identity() !== key || who !== key) return false;
      data = {...data,count:Math.max(0,(Number(data?.count) || rows(data).length) - selected.length),updates:rows(data).filter(update => !selected.some(id => String(id) === String(update.id)))};
      stale = false; paint({dismissed:selected}); return true;
    } catch (error) {
      if (identity() !== key || who !== key) return false;
      if (error.status === 401 || error.status === 403) { data = null; stale = false; message = ''; }
      else message = 'Could not dismiss this update. Please try again.';
      return false;
    } finally {
      if (identity() === key && who === key) { busy = false; paint(); }
      else if (identity() !== who) reset(identity());
    }
  }
  function sync() { return refresh(true); }
  function changed(path) { if (/^\/(bookings|series)(\/|$)|\/cover(\/|$)/.test(path)) return refresh(true); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
  window.addEventListener('focus', () => refresh(true));
  window.addEventListener('hashchange', () => refresh(true));
  setInterval(() => refresh(), 15000);
  return {sync,changed,refresh,acknowledge,details};
})();
CareBookingUpdates.sync();
