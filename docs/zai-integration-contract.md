# Australian bank transfer tracking: Zai integration contract

This adapter connects authenticated Australian NPP and direct-entry deposit notifications to The Care Web's payment ledger. Provider account activation and credentials are required before it can receive real payment confirmations. No real Zai account was opened, customer enrolled, payment requested or funds moved while developing this change.

## Server configuration

Configure these variables on the application server. Keep credentials outside the repository and browser:

| Variable | Meaning |
| --- | --- |
| `ZAI_ENABLED` | `true` enables the integration. Other values leave it disabled. |
| `ZAI_ENVIRONMENT` | `sandbox` (default) or `live`. Other values are rejected. |
| `ZAI_CLIENT_ID` | Client ID supplied for the selected Zai platform. |
| `ZAI_CLIENT_SECRET` | Client secret for that same platform. |
| `ZAI_SCOPE` | Exact scope supplied by Zai; the application never invents it. |
| `ZAI_WEBHOOK_SECRET` | Printable ASCII signing key of at least 32 bytes, registered with Zai. |
| `ZAI_WEBHOOK_SECRET_PREVIOUS` | Optional prior registered key during a controlled rotation. |

Sandbox credentials and receipts must remain separate from live financial records. `getStatus()` exposes only readiness, environment and missing variable names.

The account must be approved by Zai for virtual accounts. Onboard the real payer through the agreed provider process and obtain its user, wallet and virtual account identifiers. Confirm the correct funding arrangement and business collection/settlement setup with Zai. Incoming money is received in a provider wallet; this adapter does not arrange onward transfers to the business bank or worker payments. [Virtual-account prerequisites](https://developer.hellozai.com/docs/virtual-accounts), [wallet behaviour](https://developer.hellozai.com/docs/wallet-accounts-1)

## Authenticated requests

The implementation has fixed allowlisted origins; notification payloads and administrator input cannot supply request URLs. Redirects are rejected. Requests time out, responses are size limited, and errors do not retain provider response bodies or secrets.

| Purpose | Sandbox origin | Live origin |
| --- | --- | --- |
| OAuth token | `https://au-0000.sandbox.auth.assemblypay.com` | `https://au-0000.auth.assemblypay.com` |
| Core transaction/user API | `https://test.api.promisepay.com` | `https://secure.api.promisepay.com` |
| Virtual accounts and supplementary data | `https://sandbox.au-0000.api.assemblypay.com` | `https://au-0000.api.assemblypay.com` |

`POST /tokens` uses the documented JSON client-credentials grant, client ID, client secret and scope. Tokens are cached in memory and refreshed ahead of expiry, with concurrent requests sharing one token acquisition. A rejected read may refresh authentication once; account-creation POSTs are never blindly repeated. [Core API and authentication](https://developer.hellozai.com/reference/overview), [token API](https://developer.hellozai.com/reference/token), [published core OpenAPI specification](https://api.swaggerhub.com/apis/AssemblyPlatforms/assembly-api/2.3/swagger.json), [virtual-account API origins](https://developer.hellozai.com/reference/overview-va)

## Exported interface

The CommonJS module exports `createZaiClient`, `verifyWebhookSignature`, `ZaiError` and the immutable `ENDPOINTS` map.

```js
const { createZaiClient } = require('./zai-payments');
const zai = createZaiClient(); // server environment; built-in fetch
// Tests may inject { env, fetch, now, timeoutMs }.
```

### `verifyWebhook(rawBody, signatureHeader)`

Pass the original request bytes and the `Webhooks-signature` header before parsing or rewriting the body. Zai signs the timestamp, a dot and raw body with HMAC-SHA256, encoded as unpadded base64url. The adapter requires a constant-time signature match and a timestamp within five minutes in either direction. It accepts a registered previous key during rotation. [Signature verification contract](https://developer.hellozai.com/docs/verify-webhook-signatures)

It returns one of these authenticated events:

- `{ kind: 'transaction', transactionId, eventKey, payloadHash, environment }`
- `{ kind: 'virtual_account', virtualAccountId, eventKey, payloadHash, environment }`
- `{ kind: 'test', ... }` for the signed provider registration test.
- `{ kind: 'ignored', ... }` for an unrelated signed object.

The transaction amount, reference, account and state in an incoming notification are never used as authoritative financial data. The callback URL in its payload is never followed. Zai transaction callbacks contain an object snapshot rather than a documented unique delivery ID, so the event key combines environment and the raw payload hash. Persist event reception and a retryable job before acknowledging it. Also deduplicate financial receipts by **provider + environment + provider transaction ID**, because a later snapshot or fresh signature can describe the same deposit. Updated callbacks may arrive out of order. [Webhook objects and delivery](https://developer.hellozai.com/docs/webhooks)

The registration callback documented by Zai contains `message: 'Zai callback test'`. A server may acknowledge this exact test payload without accounting effects while configuring the signing secret, but it must not accept unsigned transaction or account updates. This adapter itself requires a valid signature for every accepted event.

### `fetchReceivedTransaction(transactionId)`

This method performs `GET /transactions/{id}` on the core API. It accepts a deposit only when the fetched record has all of these properties:

| Field | Required value |
| --- | --- |
| `id` | Exact requested transaction ID |
| `state` | `successful` |
| `type` | `deposit` |
| `type_method` | `npp_payin` or `direct_credit` |
| `debit_credit` | `credit` |
| `account_type` | `wallet_account` |
| `currency` | `AUD` |
| `amount` | Positive safe integer, in cents |

An eligible result is:

```js
{
  received: true,
  provider: 'zai',
  environment, providerTransactionId, providerState,
  walletAccountId, providerUserId, amountCents,
  currency: 'AUD', method, reference, supplementaryStatus,
  status: 'received_at_provider',
  settlementStatus: 'not_confirmed',
  receivedAt, providerUpdatedAt, verifiedAt
}
```

Pending transactions, outgoing transfers and unsupported currencies return `received: false` with a reason. Invalid amounts or inconsistent response identities raise an error and must never generate a payment entry. [Transaction lookup](https://developer.hellozai.com/reference/showtransaction)

For eligible deposits it also fetches `GET /transactions/{id}/supplementary_data` from the platform API. It validates transaction linkage and payment type before using `remittance_information` as the reference. It does not return or store the sender's bank details. Missing supplementary data leaves `reference` empty with `supplementaryStatus: 'not_available'`; a temporary failure returns `retry_needed`. The confirmed receipt can still be recorded as unallocated, and later reference retrieval can resume automatically. The dedicated supplementary-data documentation permits NPP lookup in sandbox, and both NPP and direct-entry lookup in live; the older virtual-account guide describes a more limited sandbox. Treat actual missing data as unavailable rather than fabricating a reference. [Supplementary-data availability](https://developer.hellozai.com/reference/overview-2), [supplementary-data API](https://developer.hellozai.com/reference/showtransactionsupplementarydata-1)

### `verifyAccountMapping({ userId, walletAccountId, virtualAccountId })`

First, `GET /users/{id}/wallet_accounts` must confirm the active AUD wallet belongs to that provider user. Then `GET /virtual_accounts/{id}` must confirm the same wallet, same provider user and AUD currency. The result includes:

```js
{
  provider: 'zai', environment, providerUserId, walletAccountId,
  virtualAccountId, status, active, bsb, accountNumber, accountName,
  currency: 'AUD', verifiedAt
}
```

Only display transfer instructions to payers when `active === true`. These details come from the authenticated provider response, rather than unverified bank numbers entered in a form. PayID is not returned by the documented virtual-account response, so it is not invented or advertised by this adapter. [Show virtual account](https://developer.hellozai.com/reference/showvirtualaccount)

The application must bind this verified account to an explicitly selected local billing account, enforce uniqueness, preserve the mapping history and restrict changes to an authorised office user. A provider user ID is not proof of which local participant it belongs to. Never guess that relationship using names, email addresses or payment amount. A plan manager's combined payment may cover several participants and needs explicit remittance allocation.

### `ensureVirtualAccount({ userId, walletAccountId, accountName })`

This optional setup method works only with an already onboarded, verified provider user and wallet. It lists existing accounts first and reuses a single active or activating account. If several exist, it requires explicit selection. If none qualifies, it sends the documented create request with the real receiving account name; activation can remain pending. Account names must satisfy the provider's printable ASCII and 140-character limits. [List accounts](https://developer.hellozai.com/reference/listvirtualaccountbywalletaccount), [create account](https://developer.hellozai.com/reference/createvirtualaccount)

The helper shares concurrent requests within one process. The application must persist/lock provisioning intent across processes if it uses automatic provisioning. After an uncertain creation result, re-list accounts before issuing another create request. This method creates no customer identities and transfers no money.

## Invoice allocation and office display

Use the verified wallet and provider user to identify the configured billing account. Allocate a receipt automatically only through a unique invoice reference belonging to that billing account and environment, with an invoice that still accepts payment. Never match multiple invoices by amount alone. Keep partial and combined payments in a separate receipt-allocation ledger; never discard excess or unallocated money.

An unmatched confirmed deposit should show **Payment received — needs matching**, including the remaining unallocated amount. A matched deposit should update the invoice balance and queue the receipt exactly once. Pending provider states must not appear as paid. **Received by the payment provider** and **deposited into our business bank** are separate facts; this adapter verifies the former and leaves business-bank settlement unconfirmed.

If an invoice is withdrawn after bank details were sent, a later incoming transfer still exists. Preserve it as a receipt requiring allocation or refund review, and avoid treating it as payment of the withdrawn invoice. Duplicate and out-of-order callbacks must never create extra receipts, allocations or emails.

## Verification performed

Run `node --no-warnings tests/zai-payments-tests.js`. The deterministic suite covers authenticity, replay handling, server-read confirmation, account ownership, unsupported transactions, partial receipt amounts, absent references, OAuth reuse/refresh, provider failures and non-duplicating account provisioning. Test fixtures are synthetic and never reach a provider.

These tests establish local implementation behaviour against the cited public schemas. Provider onboarding, credentials, webhook registration, actual bank deposits, operational settlement configuration and real email delivery still require the connected environment. The integration does not claim those external steps have happened.
