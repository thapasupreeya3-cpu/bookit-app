"use strict";

(() => {
  const focusableSelector = [
    'a[href]:not([tabindex="-1"])', 'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])', 'textarea:not([disabled]):not([tabindex="-1"])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  const state = new WeakMap();

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true';
  }

  function dialogIsOpen(dialog) {
    return visible(dialog) && (dialog.matches('dialog[open]') || dialog.getAttribute('aria-modal') === 'true' || dialog.classList.contains('open') || dialog.classList.contains('active') || dialog.classList.contains('show'));
  }

  function activate(dialog) {
    if (state.has(dialog)) return;
    if (!dialog.hasAttribute('role') && dialog.tagName !== 'DIALOG') dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const keydown = event => {
      if (event.key === 'Escape') {
        const close = dialog.querySelector('[data-close-modal], .modal-close, [aria-label*="close" i]');
        if (close instanceof HTMLElement) close.click();
        else if (dialog.tagName === 'DIALOG' && typeof dialog.close === 'function') dialog.close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll(focusableSelector)].filter(visible);
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    state.set(dialog, { opener, keydown });
    queueMicrotask(() => {
      const initial = dialog.querySelector('[autofocus]') || [...dialog.querySelectorAll(focusableSelector)].find(visible) || dialog;
      if (initial instanceof HTMLElement) initial.focus({ preventScroll: true });
    });
  }

  function deactivate(dialog) {
    const saved = state.get(dialog);
    if (!saved) return;
    dialog.removeEventListener('keydown', saved.keydown);
    state.delete(dialog);
    if (saved.opener?.isConnected) saved.opener.focus({ preventScroll: true });
  }

  function sync() {
    document.querySelectorAll('[role="dialog"], dialog, .modal').forEach(dialog => {
      if (dialogIsOpen(dialog)) activate(dialog); else deactivate(dialog);
    });
  }

  const observer = new MutationObserver(sync);
  if (document.documentElement) observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class','open','hidden','aria-hidden','aria-modal'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true }); else sync();
})();
