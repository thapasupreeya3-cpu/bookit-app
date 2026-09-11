/* Three-way register recovery. No draft is persisted in browser storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PolicyRegisterState = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
  var equal = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  function extendsRows(rows, base) { return rows.length >= base.length && base.every(function (r, i) { return equal(r, rows[i]); }); }
  function merge(base, local, remote) {
    var result = copy(remote), conflicts = [];
    result.tables = result.tables || {};
    var keys = new Set(Object.keys(base.tables || {}).concat(Object.keys(local.tables || {}), Object.keys(remote.tables || {})));
    keys.forEach(function (key) {
      var b = (base.tables || {})[key] || [], l = (local.tables || {})[key] || [], r = (remote.tables || {})[key] || [];
      if (equal(l, r)) result.tables[key] = copy(r);
      else if (equal(l, b)) result.tables[key] = copy(r);
      else if (equal(r, b)) result.tables[key] = copy(l);
      else if (extendsRows(l, b) && extendsRows(r, b)) result.tables[key] = copy(r.concat(l.slice(b.length)));
      else conflicts.push(key); // Never guess row identity when both people edited existing rows.
    });
    return { data: result, conflicts: conflicts };
  }
  return { merge: merge, copy: copy, equal: equal };
});
