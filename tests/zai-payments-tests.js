'use strict';

// Deterministic contract fixtures only. No network requests or real money movements.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createZaiClient, verifyWebhookSignature, ENDPOINTS } = require('../lib/zai-payments');
const TX = '10000000-0000-4000-8000-000000000001';
const WALLET = '20000000-0000-4000-8000-000000000001';
const VA = '30000000-0000-4000-8000-000000000001';
const OWNER = 'fixture-payer-1';
const NOW = Date.parse('2026-09-13T00:00:00Z');
const KEY = 'synthetic-test-key-not-a-real-secret-123456';
const ENV = {
  ZAI_ENABLED: 'true', ZAI_ENVIRONMENT: 'sandbox', ZAI_CLIENT_ID: 'synthetic-client',
  ZAI_CLIENT_SECRET: 'synthetic-not-live', ZAI_SCOPE: 'synthetic/scope', ZAI_WEBHOOK_SECRET: KEY
};
function signed(raw, seconds = NOW / 1000, key = KEY) {
  return `t=${seconds},v=${crypto.createHmac('sha256', key).update(`${seconds}.`).update(raw).digest('base64url')}`;
}
function transaction(overrides = {}) {
  return { id: TX, amount: 31062, currency: 'AUD', type: 'deposit', type_method: 'npp_payin', state: 'successful', debit_credit: 'credit', account_type: 'wallet_account', account_id: WALLET, user_id: OWNER, created_at: '2026-09-13T00:00:00Z', updated_at: '2026-09-13T00:00:00Z', ...overrides };
}
function supplementary(overrides = {}) {
  return { type: 'deposit', type_method: 'npp_payin', remittance_information: 'TCW-12345', links: { transactions: `/transactions/${TX}/` }, debtor_account: 'sensitive-fixture-should-not-be-retained', ...overrides };
}
function virtual(overrides = {}) {
  return { id: VA, routing_number: '123456', account_number: '100000017', wallet_account_id: WALLET, user_external_id: OWNER, currency: 'AUD', status: 'active', account_name: 'The Care Web fixture', ...overrides };
}
function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function setup({ env = {}, routes = {}, now = () => NOW } = {}) {
  const calls = [];
  const fakeFetch = async (url, options) => {
    const request = { url, ...options };
    calls.push(request);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    if (url.endsWith('/tokens')) {
      if (routes.token) return routes.token(request);
      return response({ access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 3600 });
    }
    assert.match(options.headers.Authorization, /^Bearer synthetic-/);
    const path = new URL(url).pathname;
    if (routes[path]) return typeof routes[path] === 'function' ? routes[path](request) : response(routes[path]);
    if (path === `/transactions/${TX}`) return response({ transactions: transaction() });
    if (path === `/transactions/${TX}/supplementary_data`) return response(supplementary());
    if (path === `/users/${OWNER}/wallet_accounts`) return response({ wallet_accounts: { id: WALLET, active: true, currency: 'AUD' } });
    if (path === `/virtual_accounts/${VA}`) return response(virtual());
    if (path === `/wallet_accounts/${WALLET}/virtual_accounts`) return response({ virtual_accounts: [virtual()] });
    throw new Error('Unexpected test request');
  };
  return { client: createZaiClient({ env: { ...ENV, ...env }, fetch: fakeFetch, now }), calls };
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
test('disabled integration never calls the provider or exposes credentials', async () => {
  const { client, calls } = setup({ env: { ZAI_ENABLED: 'false' } });
  assert.equal(client.getStatus().configured, false);
  await assert.rejects(client.fetchReceivedTransaction(TX), { code: 'not_configured' });
  assert.equal(calls.length, 0);
  assert.ok(!JSON.stringify(client.getStatus()).includes(ENV.ZAI_CLIENT_SECRET));
});
test('invalid environment cannot redirect credentials', async () => {
  const { client, calls } = setup({ env: { ZAI_ENVIRONMENT: 'https://evil.invalid' } });
  await assert.rejects(client.fetchReceivedTransaction(TX), { code: 'not_configured' });
  assert.equal(calls.length, 0);
});
test('missing or invalid signing key leaves integration unconfigured', async () => {
  const { client } = setup({ env: { ZAI_WEBHOOK_SECRET: 'short' } });
  assert.ok(client.getStatus().missing.includes('ZAI_WEBHOOK_SECRET'));
  await assert.rejects(client.fetchReceivedTransaction(TX), { code: 'not_configured' });
});
test('Zai base64url signature accepts exact raw JSON, rejecting altered bytes', () => {
  const { client } = setup();
  const raw = Buffer.from('{ "transactions": { "id": "' + TX + '" } }');
  const event = client.verifyWebhook(raw, signed(raw));
  assert.equal(event.transactionId, TX);
  assert.equal(event.kind, 'transaction');
  assert.match(event.eventKey, /^zai:sandbox:[a-f0-9]{64}$/);
  const changed = Buffer.from(JSON.stringify(JSON.parse(raw)));
  assert.throws(() => client.verifyWebhook(changed, signed(raw)), { code: 'invalid_signature' });
});
test('replay tolerance rejects stale and future signatures', () => {
  const raw = Buffer.from('{}');
  for (const seconds of [NOW / 1000 - 301, NOW / 1000 + 301]) {
    assert.throws(() => verifyWebhookSignature(raw, signed(raw, seconds), KEY, { now: () => NOW }), { code: 'invalid_signature' });
  }
});
test('timestamp duplication and invalid signature encodings fail closed', () => {
  const raw = Buffer.from('{}');
  for (const header of [`${signed(raw)},t=${NOW / 1000}`, 't=1,v=aaaa', undefined, 't=NaN,v=x', 'v=x']) {
    assert.throws(() => verifyWebhookSignature(raw, header, KEY, { now: () => NOW }), { code: 'invalid_signature' });
  }
});
test('key rotation accepts prior configured key without accepting an unknown key', () => {
  const prior = 'synthetic-previous-key-not-real-12345678';
  const { client } = setup({ env: { ZAI_WEBHOOK_SECRET_PREVIOUS: prior } });
  const raw = Buffer.from(JSON.stringify({ message: 'Zai callback test' }));
  assert.equal(client.verifyWebhook(raw, signed(raw, NOW / 1000, prior)).kind, 'test');
  assert.throws(() => client.verifyWebhook(raw, signed(raw, NOW / 1000, 'another-synthetic-key-not-real-12345678')), { code: 'invalid_signature' });
});
test('signed tests and virtual-account updates parse without changing money', () => {
  const { client, calls } = setup();
  const raw = Buffer.from(JSON.stringify({ name: 'virtual_accounts', id: VA, event: 'status_updated', link: 'https://evil.invalid' }));
  assert.equal(client.verifyWebhook(raw, signed(raw)).virtualAccountId, VA);
  assert.equal(calls.length, 0);
});
test('webhook rejects objects in place of raw bytes, invalid JSON and oversized bodies', () => {
  const { client } = setup();
  assert.throws(() => client.verifyWebhook({}, ''), { code: 'invalid_webhook' });
  const malformed = Buffer.from('{');
  assert.throws(() => client.verifyWebhook(malformed, signed(malformed)), { code: 'invalid_webhook' });
  const huge = Buffer.alloc(256 * 1024 + 1, 32);
  assert.throws(() => client.verifyWebhook(huge, signed(huge)), { code: 'invalid_webhook' });
});
test('verified deposit uses authenticated lookup and integer cents, not webhook money', async () => {
  const { client, calls } = setup();
  const result = await client.fetchReceivedTransaction(TX);
  assert.equal(result.amountCents, 31062);
  assert.equal(result.received, true);
  assert.equal(result.reference, 'TCW-12345');
  assert.equal(result.status, 'received_at_provider');
  assert.equal(result.settlementStatus, 'not_confirmed');
  assert.equal(result.walletAccountId, WALLET);
  assert.ok(!JSON.stringify(result).includes('sensitive-fixture'));
  assert.equal(calls[0].url, `${ENDPOINTS.sandbox.auth}/tokens`);
  assert.equal(calls[1].url, `${ENDPOINTS.sandbox.core}/transactions/${TX}`);
  assert.equal(calls[2].url, `${ENDPOINTS.sandbox.platform}/transactions/${TX}/supplementary_data`);
  assert.deepEqual(JSON.parse(calls[0].body), { grant_type: 'client_credentials', client_id: ENV.ZAI_CLIENT_ID, client_secret: ENV.ZAI_CLIENT_SECRET, scope: ENV.ZAI_SCOPE });
});
test('API response transaction ID must match requested ID', async () => {
  const { client } = setup({ routes: { [`/transactions/${TX}`]: { transactions: transaction({ id: VA }) } } });
  await assert.rejects(client.fetchReceivedTransaction(TX), { code: 'invalid_provider_response' });
});
test('outgoing payments, holds, refunds and foreign currencies do not count as received', async () => {
  for (const fields of [{ state: 'pending' }, { type: 'refund' }, { type_method: 'credit_card' }, { debit_credit: 'debit' }, { account_type: 'item' }, { currency: 'USD' }]) {
    const { client, calls } = setup({ routes: { [`/transactions/${TX}`]: { transactions: transaction(fields) } } });
    assert.equal((await client.fetchReceivedTransaction(TX)).received, false);
    assert.equal(calls.length, 2);
  }
});
test('invalid, negative, fractional and unsafe amounts cannot reach the ledger', async () => {
  for (const amount of [0, -100, 1.5, '31062', Number.MAX_SAFE_INTEGER + 1]) {
    const { client } = setup({ routes: { [`/transactions/${TX}`]: { transactions: transaction({ amount }) } } });
    await assert.rejects(client.fetchReceivedTransaction(TX), { code: 'invalid_provider_response' });
  }
});
test('missing reference still reports received funds for office matching', async () => {
  const { client } = setup({ routes: { [`/transactions/${TX}/supplementary_data`]: () => response({ errors: 'missing fixture' }, 404) } });
  const received = await client.fetchReceivedTransaction(TX);
  assert.equal(received.received, true);
  assert.equal(received.supplementaryStatus, 'not_available');
  assert.equal(received.reference, '');
});
test('temporary supplementary failure preserves receipt and requests a later reference lookup', async () => {
  const { client } = setup({ routes: { [`/transactions/${TX}/supplementary_data`]: () => response({ errors: 'outage' }, 503) } });
  const received = await client.fetchReceivedTransaction(TX);
  assert.equal(received.received, true);
  assert.equal(received.supplementaryStatus, 'retry_needed');
});
test('supplementary data for another transaction or method is rejected', async () => {
  for (const fields of [{ links: { transactions: `/transactions/${VA}` } }, { type_method: 'direct_credit' }]) {
    const { client } = setup({ routes: { [`/transactions/${TX}/supplementary_data`]: supplementary(fields) } });
    await assert.rejects(client.fetchReceivedTransaction(TX), { code: 'invalid_provider_response' });
  }
});
test('direct entry credits are supported independently from NPP', async () => {
  const { client } = setup({ routes: { [`/transactions/${TX}`]: { transactions: transaction({ type_method: 'direct_credit' }) }, [`/transactions/${TX}/supplementary_data`]: supplementary({ type_method: 'direct_credit' }) } });
  assert.equal((await client.fetchReceivedTransaction(TX)).method, 'direct_credit');
});
test('parallel requests share the OAuth token and do not authenticate on every read', async () => {
  const { client, calls } = setup();
  await Promise.all([client.fetchReceivedTransaction(TX), client.fetchReceivedTransaction(TX)]);
  assert.equal(calls.filter(call => call.url.endsWith('/tokens')).length, 1);
});
test('expired OAuth token is refreshed before use', async () => {
  let clock = NOW;
  const { client, calls } = setup({ now: () => clock });
  await client.fetchReceivedTransaction(TX);
  clock += 3600 * 1000;
  await client.fetchReceivedTransaction(TX);
  assert.equal(calls.filter(call => call.url.endsWith('/tokens')).length, 2);
});
test('a GET authentication failure refreshes once, never indefinitely', async () => {
  let count = 0;
  const { client, calls } = setup({ routes: { [`/transactions/${TX}`]: () => ++count === 1 ? response({}, 401) : response({ transactions: transaction() }) } });
  assert.equal((await client.fetchReceivedTransaction(TX)).received, true);
  assert.equal(calls.filter(call => call.url.endsWith('/tokens')).length, 2);
  const always401 = setup({ routes: { [`/transactions/${TX}`]: () => response({}, 401) } });
  await assert.rejects(always401.client.fetchReceivedTransaction(TX), { code: 'provider_http', status: 401 });
  assert.equal(always401.calls.length, 4);
});
test('explicit live mode uses only documented live origins', async () => {
  const { client, calls } = setup({ env: { ZAI_ENVIRONMENT: 'live' } });
  assert.equal((await client.fetchReceivedTransaction(TX)).environment, 'live');
  assert.deepEqual(calls.map(call => new URL(call.url).origin), [ENDPOINTS.live.auth, ENDPOINTS.live.core, ENDPOINTS.live.platform]);
});
test('path injection and forged webhook callback URLs never cause requests', async () => {
  const { client, calls } = setup();
  for (const id of ['../tokens', 'https://evil.invalid', `${TX}?token=x`]) await assert.rejects(client.fetchReceivedTransaction(id), { code: 'invalid_input' });
  assert.equal(calls.length, 0);
});
test('mapping verifies both user wallet and receiving virtual account', async () => {
  const { client } = setup();
  const mapping = await client.verifyAccountMapping({ userId: OWNER, walletAccountId: WALLET, virtualAccountId: VA });
  assert.equal(mapping.active, true);
  assert.equal(mapping.bsb, '123456');
  assert.equal(mapping.accountNumber, '100000017');
  assert.equal(mapping.accountName, 'The Care Web fixture');
  assert.equal(mapping.providerUserId, OWNER);
});
test('another user or wallet cannot be mapped using matching bank details', async () => {
  for (const overrides of [{ user_external_id: 'other-payer' }, { wallet_account_id: TX }, { currency: 'USD' }]) {
    const { client } = setup({ routes: { [`/virtual_accounts/${VA}`]: virtual(overrides) } });
    await assert.rejects(client.verifyAccountMapping({ userId: OWNER, walletAccountId: WALLET, virtualAccountId: VA }), { code: 'account_mismatch' });
  }
  const { client } = setup({ routes: { [`/users/${OWNER}/wallet_accounts`]: { wallet_accounts: { id: TX, active: true, currency: 'AUD' } } } });
  await assert.rejects(client.verifyAccountMapping({ userId: OWNER, walletAccountId: WALLET, virtualAccountId: VA }), { code: 'account_mismatch' });
});
test('pending activation retains receiving details but is never advertised as active', async () => {
  const { client } = setup({ routes: { [`/virtual_accounts/${VA}`]: virtual({ status: 'pending_activation' }) } });
  const mapping = await client.verifyAccountMapping({ userId: OWNER, walletAccountId: WALLET, virtualAccountId: VA });
  assert.equal(mapping.active, false);
  assert.equal(mapping.status, 'pending_activation');
});
test('provisioning reuses existing receiving account without posting', async () => {
  const { client, calls } = setup();
  const mapping = await client.ensureVirtualAccount({ userId: OWNER, walletAccountId: WALLET, accountName: 'The Care Web' });
  assert.equal(mapping.created, false);
  assert.equal(calls.filter(call => call.method === 'POST' && !call.url.endsWith('/tokens')).length, 0);
});
test('provisioning one verified wallet is shared across concurrent requests', async () => {
  const { client, calls } = setup({ routes: { [`/wallet_accounts/${WALLET}/virtual_accounts`]: req => req.method === 'POST' ? response(virtual({ status: 'pending_activation' }), 202) : response({ virtual_accounts: [] }) } });
  const args = { userId: OWNER, walletAccountId: WALLET, accountName: 'The Care Web' };
  const results = await Promise.all([client.ensureVirtualAccount(args), client.ensureVirtualAccount(args)]);
  assert.equal(results[0].active, false);
  assert.equal(results[1].virtualAccountId, VA);
  const posts = calls.filter(call => call.method === 'POST' && !call.url.endsWith('/tokens'));
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body), { account_name: 'The Care Web' });
});
test('ambiguous provider accounts require explicit selection rather than a guessed account', async () => {
  const { client, calls } = setup({ routes: { [`/wallet_accounts/${WALLET}/virtual_accounts`]: { virtual_accounts: [virtual(), virtual({ id: TX })] } } });
  await assert.rejects(client.ensureVirtualAccount({ userId: OWNER, walletAccountId: WALLET, accountName: 'The Care Web' }), { code: 'account_selection_required' });
  assert.equal(calls.filter(call => call.method === 'POST' && !call.url.endsWith('/tokens')).length, 0);
});
test('provider creation errors are not blindly retried and response secrets are not logged', async () => {
  const { client, calls } = setup({ routes: { [`/wallet_accounts/${WALLET}/virtual_accounts`]: req => req.method === 'POST' ? response({ errors: 'sensitive-secret-value' }, 503) : response({ virtual_accounts: [] }) } });
  await assert.rejects(client.ensureVirtualAccount({ userId: OWNER, walletAccountId: WALLET, accountName: 'The Care Web' }), error => error.code === 'provider_http' && !error.message.includes('sensitive-secret-value'));
  assert.equal(calls.filter(call => call.method === 'POST' && !call.url.endsWith('/tokens')).length, 1);
});
test('oversized or non-JSON provider responses are rejected', async () => {
  for (const data of ['<html>error</html>', JSON.stringify({ oversized: 'x'.repeat(1024 * 1024) })]) {
    const { client } = setup({ routes: { [`/transactions/${TX}`]: () => new Response(data, { status: 200 }) } });
    await assert.rejects(client.fetchReceivedTransaction(TX), { code: 'invalid_provider_response' });
  }
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  }
  process.stdout.write(`Zai payment adapter: ${passed}/${tests.length} passed\n`);
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
