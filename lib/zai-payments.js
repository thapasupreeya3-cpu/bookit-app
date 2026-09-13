'use strict';

// Zai's public API contracts are linked in docs/zai-integration-contract.md.
// This adapter receives and verifies funds; it never withdraws, disburses or pays wages.
const crypto = require('node:crypto');

const ENDPOINTS = Object.freeze({
  sandbox: Object.freeze({
    auth: 'https://au-0000.sandbox.auth.assemblypay.com',
    core: 'https://test.api.promisepay.com',
    platform: 'https://sandbox.au-0000.api.assemblypay.com'
  }),
  live: Object.freeze({
    auth: 'https://au-0000.auth.assemblypay.com',
    core: 'https://secure.api.promisepay.com',
    platform: 'https://au-0000.api.assemblypay.com'
  })
});
const MAX_BODY_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/;

class ZaiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ZaiError';
    this.code = code;
    Object.assign(this, details);
  }
}
function fail(code, message, details) { throw new ZaiError(code, message, details); }
function uuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('invalid_input', `${name} must be a provider UUID.`);
  return value;
}
function userId(value) {
  if (typeof value !== 'string' || !USER_ID.test(value)) fail('invalid_input', 'The provider user ID is invalid.');
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_provider_response', `Zai returned invalid ${label}.`);
  return value;
}
function smallText(value, max = 280) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
}
function secretValid(secret) {
  return typeof secret === 'string' && /^[\x20-\x7e]{32,1024}$/.test(secret);
}

/** Verify the original byte sequence before parsing JSON. Timestamp is Unix seconds. */
function verifyWebhookSignature(rawBody, signatureHeader, secrets, { now = Date.now, toleranceSeconds = 300 } = {}) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody : typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : null;
  if (!raw || raw.length === 0 || raw.length > MAX_BODY_BYTES) fail('invalid_webhook', 'The bank notification body is invalid.');
  const keys = (Array.isArray(secrets) ? secrets : [secrets]).filter(secretValid);
  if (!keys.length) fail('not_configured', 'The bank notification signing key is not configured.');
  if (typeof signatureHeader !== 'string' || signatureHeader.length > 2048) fail('invalid_signature', 'The bank notification signature is missing or invalid.');
  let timestamp;
  const signatures = [];
  for (const token of signatureHeader.split(',')) {
    const part = token.trim();
    const eq = part.indexOf('=');
    if (eq < 1) fail('invalid_signature', 'The bank notification signature is invalid.');
    const prefix = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (prefix === 't') {
      if (timestamp !== undefined || !/^\d{1,12}$/.test(value)) fail('invalid_signature', 'The bank notification timestamp is invalid.');
      timestamp = value;
    } else if (prefix === 'v') {
      if (!/^[A-Za-z0-9_-]{43}$/.test(value)) fail('invalid_signature', 'The bank notification signature encoding is invalid.');
      signatures.push(Buffer.from(value, 'base64url'));
    }
  }
  const seconds = Number(timestamp);
  const tolerance = Number(toleranceSeconds);
  if (!Number.isFinite(tolerance) || tolerance < 1 || tolerance > 600 || !Number.isSafeInteger(seconds) || !timestamp || !signatures.length || Math.abs(Math.floor(now() / 1000) - seconds) > tolerance) {
    fail('invalid_signature', 'The bank notification signature has expired or is invalid.');
  }
  const signed = Buffer.concat([Buffer.from(`${timestamp}.`, 'ascii'), raw]);
  let matched = false;
  for (const key of keys) {
    const expected = crypto.createHmac('sha256', key).update(signed).digest();
    for (const signature of signatures) {
      if (signature.length === expected.length && crypto.timingSafeEqual(signature, expected)) matched = true;
    }
  }
  if (!matched) fail('invalid_signature', 'The bank notification signature is invalid.');
  return { raw, timestamp: seconds, payloadHash: crypto.createHash('sha256').update(raw).digest('hex') };
}

function createZaiClient({ env = process.env, fetch: fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 12000 } = {}) {
  const enabled = /^(true|1)$/i.test(String(env.ZAI_ENABLED || ''));
  const environment = String(env.ZAI_ENVIRONMENT || 'sandbox').toLowerCase();
  const endpoints = ENDPOINTS[environment];
  const fields = ['ZAI_CLIENT_ID', 'ZAI_CLIENT_SECRET', 'ZAI_SCOPE'];
  const missing = fields.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  if (!secretValid(env.ZAI_WEBHOOK_SECRET)) missing.push('ZAI_WEBHOOK_SECRET');
  if (!endpoints) missing.push('ZAI_ENVIRONMENT');
  let accessToken = null;
  let expiresAt = 0;
  let tokenPromise = null;
  const provisioning = new Map();

  function getStatus() {
    return { enabled, configured: enabled && missing.length === 0, environment, missing: [...missing] };
  }
  function requireConfig() {
    if (!getStatus().configured || typeof fetchImpl !== 'function') fail('not_configured', 'Automatic bank transfer tracking is not connected.');
  }
  async function jsonRequest(base, path, method = 'GET', body, bearer) {
    requireConfig();
    if (!Object.values(endpoints).includes(base) || !/^\/[A-Za-z0-9_./@+%-]+$/.test(path) || path.includes('..') || path.startsWith('//')) {
      fail('invalid_input', 'The provider request address is invalid.');
    }
    const controller = new AbortController();
    const duration = Number.isFinite(timeoutMs) ? Math.max(100, Math.min(timeoutMs, 30000)) : 12000;
    const timer = setTimeout(() => controller.abort(), duration);
    timer.unref?.();
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: controller.signal
      });
      if (!response || !Number.isInteger(response.status)) fail('invalid_provider_response', 'Zai returned an invalid response.');
      if (response.status < 200 || response.status >= 300) {
        // Provider bodies can contain customer or credential data. Never retain them in errors.
        try { await response.body?.cancel(); } catch (_) { /* response body may already be closed */ }
        fail('provider_http', `Zai request failed (${response.status}).`, { status: response.status, retryable: response.status === 429 || response.status >= 500 });
      }
      const length = Number(response.headers?.get?.('content-length'));
      if (length > MAX_RESPONSE_BYTES) fail('invalid_provider_response', 'Zai returned an oversized response.');
      let text;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let count = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            count += value.byteLength;
            if (count > MAX_RESPONSE_BYTES) { await reader.cancel(); fail('invalid_provider_response', 'Zai returned an oversized response.'); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        text = Buffer.concat(chunks).toString('utf8');
      } else {
        text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) fail('invalid_provider_response', 'Zai returned an oversized response.');
      }
      try { return JSON.parse(text); } catch (_) { fail('invalid_provider_response', 'Zai returned invalid JSON.'); }
    } catch (error) {
      if (error instanceof ZaiError) throw error;
      fail('provider_unavailable', 'The bank payment service could not be reached. It will need another attempt.', { retryable: true });
    } finally { clearTimeout(timer); }
  }
  async function token() {
    requireConfig();
    if (accessToken && now() < expiresAt) return accessToken;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      const data = object(await jsonRequest(endpoints.auth, '/tokens', 'POST', {
        grant_type: 'client_credentials', client_id: env.ZAI_CLIENT_ID, client_secret: env.ZAI_CLIENT_SECRET, scope: env.ZAI_SCOPE
      }), 'authentication data');
      if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16384 || data.token_type !== 'Bearer' || !Number.isFinite(data.expires_in) || data.expires_in < 1) {
        fail('invalid_provider_response', 'Zai returned an invalid authentication token.');
      }
      accessToken = data.access_token;
      expiresAt = now() + Math.max(0, Math.min(data.expires_in, 3600) - 60) * 1000;
      return accessToken;
    })();
    try { return await tokenPromise; } finally { tokenPromise = null; }
  }
  async function request(api, path, method = 'GET', body) {
    let bearer = await token();
    try { return await jsonRequest(endpoints[api], path, method, body, bearer); }
    catch (error) {
      // A safe GET may refresh an expired token once. POST is never blindly repeated.
      if (error.status !== 401 || method !== 'GET') throw error;
      if (accessToken === bearer) { accessToken = null; expiresAt = 0; }
      bearer = await token();
      return jsonRequest(endpoints[api], path, method, body, bearer);
    }
  }
  function verifyWebhook(rawBody, signatureHeader) {
    requireConfig();
    const checked = verifyWebhookSignature(rawBody, signatureHeader, [env.ZAI_WEBHOOK_SECRET, env.ZAI_WEBHOOK_SECRET_PREVIOUS], { now });
    let payload;
    try { payload = JSON.parse(checked.raw.toString('utf8')); } catch (_) { fail('invalid_webhook', 'The bank notification JSON is invalid.'); }
    object(payload, 'notification');
    const meta = { eventKey: `zai:${environment}:${checked.payloadHash}`, payloadHash: checked.payloadHash, environment };
    if (payload.message === 'Zai callback test') return { kind: 'test', ...meta };
    if (payload.transactions && !Array.isArray(payload.transactions)) {
      return { kind: 'transaction', transactionId: uuid(payload.transactions.id, 'Transaction ID'), ...meta };
    }
    if (payload.name === 'virtual_accounts') return { kind: 'virtual_account', virtualAccountId: uuid(payload.id, 'Virtual account ID'), ...meta };
    // The endpoint can safely acknowledge unrelated, authentic object notifications.
    return { kind: 'ignored', ...meta };
  }
  async function fetchReceivedTransaction(transactionId) {
    const id = uuid(transactionId, 'Transaction ID');
    const result = object(await request('core', `/transactions/${id}`), 'transaction response');
    const tx = object(result.transactions, 'transaction');
    if (tx.id !== id) fail('invalid_provider_response', 'The returned bank transaction does not match the requested transaction.');
    const identity = { provider: 'zai', environment, providerTransactionId: id, providerState: smallText(tx.state, 40) };
    if (tx.state !== 'successful' || tx.type !== 'deposit' || !['npp_payin', 'direct_credit'].includes(tx.type_method) || tx.debit_credit !== 'credit' || tx.account_type !== 'wallet_account') {
      return { ...identity, received: false, reason: 'not_a_confirmed_bank_deposit' };
    }
    if (tx.currency !== 'AUD') return { ...identity, received: false, reason: 'unsupported_currency' };
    if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0) fail('invalid_provider_response', 'The received bank amount is invalid.');
    uuid(tx.account_id, 'Wallet account ID');
    userId(tx.user_id);
    let supplementary;
    let supplementaryStatus = 'available';
    try {
      supplementary = object(await request('platform', `/transactions/${id}/supplementary_data`), 'payment reference');
      if (supplementary.type !== 'deposit' || supplementary.type_method !== tx.type_method) fail('invalid_provider_response', 'The payment reference does not match the transaction type.');
      const txLink = supplementary.links?.transactions;
      if (txLink && txLink !== `/transactions/${id}` && txLink !== `/transactions/${id}/`) fail('invalid_provider_response', 'The payment reference belongs to another transaction.');
    } catch (error) {
      if (error.code === 'invalid_provider_response') throw error;
      supplementaryStatus = error.status === 404 ? 'not_available' : 'retry_needed';
    }
    return {
      ...identity,
      received: true,
      status: 'received_at_provider',
      settlementStatus: 'not_confirmed',
      walletAccountId: tx.account_id,
      providerUserId: tx.user_id,
      amountCents: tx.amount,
      currency: 'AUD',
      method: tx.type_method,
      reference: smallText(supplementary?.remittance_information),
      supplementaryStatus,
      receivedAt: smallText(tx.created_at, 40),
      providerUpdatedAt: smallText(tx.updated_at, 40),
      verifiedAt: new Date(now()).toISOString()
    };
  }
  async function verifiedWallet(providerUserId, walletAccountId) {
    const owner = userId(providerUserId);
    const walletId = uuid(walletAccountId, 'Wallet account ID');
    const data = object(await request('core', `/users/${encodeURIComponent(owner)}/wallet_accounts`), 'user wallet response');
    const wallet = object(data.wallet_accounts, 'user wallet');
    if (wallet.id !== walletId || wallet.active !== true || wallet.currency !== 'AUD') {
      fail('account_mismatch', 'The active Australian dollar wallet does not belong to the selected provider user.');
    }
    return wallet;
  }
  function normaliseVirtualAccount(account, owner, walletId) {
    object(account, 'virtual account');
    uuid(account.id, 'Virtual account ID');
    if (account.wallet_account_id !== walletId || account.user_external_id !== owner || account.currency !== 'AUD') {
      fail('account_mismatch', 'The virtual account does not belong to the selected provider user and wallet.');
    }
    if (!['active', 'pending_activation', 'activation_failed'].includes(account.status)) fail('invalid_provider_response', 'The virtual account status is not recognised.');
    if (typeof account.routing_number !== 'string' || !/^\d{6}$/.test(account.routing_number) || typeof account.account_number !== 'string' || !/^\d{5,17}$/.test(account.account_number)) {
      fail('invalid_provider_response', 'Zai has not returned valid receiving bank details.');
    }
    const accountName = smallText(account.account_name || account.full_legal_account_name, 140);
    if (!accountName) fail('invalid_provider_response', 'Zai has not returned the receiving account name.');
    return {
      provider: 'zai', environment, providerUserId: owner, walletAccountId: walletId,
      virtualAccountId: account.id, status: account.status, active: account.status === 'active',
      bsb: account.routing_number, accountNumber: account.account_number, accountName,
      currency: 'AUD', verifiedAt: new Date(now()).toISOString()
    };
  }
  async function verifyAccountMapping({ userId: providerUserId, walletAccountId, virtualAccountId }) {
    const owner = userId(providerUserId);
    const walletId = uuid(walletAccountId, 'Wallet account ID');
    const vaId = uuid(virtualAccountId, 'Virtual account ID');
    await verifiedWallet(owner, walletId);
    const account = await request('platform', `/virtual_accounts/${vaId}`);
    if (account.id !== vaId) fail('account_mismatch', 'Zai returned a different virtual account.');
    return normaliseVirtualAccount(account, owner, walletId);
  }
  async function ensureVirtualAccount({ userId: providerUserId, walletAccountId, accountName }) {
    const owner = userId(providerUserId);
    const walletId = uuid(walletAccountId, 'Wallet account ID');
    if (typeof accountName !== 'string' || !/^[\x20-\x7e]{1,140}$/.test(accountName) || !accountName.trim()) {
      fail('invalid_input', 'The receiving account name must contain 1 to 140 printable ASCII characters.');
    }
    const provisionKey = `${owner}:${walletId}`;
    if (provisioning.has(provisionKey)) return provisioning.get(provisionKey);
    const job = (async () => {
      await verifiedWallet(owner, walletId);
      const data = object(await request('platform', `/wallet_accounts/${walletId}/virtual_accounts`), 'virtual account list');
      if (!Array.isArray(data.virtual_accounts)) fail('invalid_provider_response', 'Zai returned an invalid virtual account list.');
      const candidates = data.virtual_accounts.filter(a => ['active', 'pending_activation'].includes(a.status));
      if (candidates.length > 1) fail('account_selection_required', 'This provider wallet has several virtual accounts. Select the intended account explicitly.');
      if (candidates.length === 1) return { ...normaliseVirtualAccount(candidates[0], owner, walletId), created: false };
      // This POST is never retried. A subsequent attempt lists provider accounts first.
      const created = await request('platform', `/wallet_accounts/${walletId}/virtual_accounts`, 'POST', { account_name: accountName.trim() });
      return { ...normaliseVirtualAccount(created, owner, walletId), created: true };
    })();
    provisioning.set(provisionKey, job);
    try { return await job; } finally { provisioning.delete(provisionKey); }
  }
  return Object.freeze({ getStatus, verifyWebhook, fetchReceivedTransaction, verifyAccountMapping, ensureVirtualAccount });
}

module.exports = { createZaiClient, verifyWebhookSignature, ZaiError, ENDPOINTS };
