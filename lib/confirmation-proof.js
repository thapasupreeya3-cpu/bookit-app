'use strict';
const crypto = require('node:crypto');

// Stable serialization binds a short-lived confirmation to its exact intent.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function create(secret, clock = Date.now) {
  const sign = payload => crypto.createHmac('sha256', secret).update('travel-confirmation-v1:' + payload).digest('base64url');
  return {
    issue(context, estimate, lifetime = 15 * 60 * 1000) {
      const payload = Buffer.from(JSON.stringify({ context, estimate, issued: clock(), expires: clock() + lifetime })).toString('base64url');
      return payload + '.' + sign(payload);
    },
    verify(token, context) {
      if (typeof token !== 'string' || token.length > 12000) return null;
      const [payload, mac, extra] = token.split('.');
      if (!payload || !mac || extra !== undefined) return null;
      const expected = Buffer.from(sign(payload)); const actual = Buffer.from(mac);
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
      try {
        const v = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (v.context !== context || !Number.isFinite(v.expires) || v.expires <= clock() || v.issued > clock() || !v.estimate || typeof v.estimate !== 'object') return null;
        return v;
      } catch { return null; }
    }
  };
}
module.exports = { create, digest, canonical };
