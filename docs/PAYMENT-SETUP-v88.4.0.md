# The Care Web v88.4.0 — payment setup and operation

This release implements the site’s payment workflow. Provider credentials, approved receiving accounts and an external payroll process are separate operational connections. A connected ChatGPT app does not supply this application server with payment keys or activate its receiving accounts.

## What runs automatically

| Event | Application behaviour |
| --- | --- |
| Worker submits a newly completed self-managed/private shift | Calculates the charge, creates one immutable invoice for that shift, and queues its PDF email. No routine office or holiday sign-off. |
| Participant or authorised reviewer opens the invoice | Shows the recorded support, amount, due date and current review/payment state. They explicitly confirm the details before online checkout is available. |
| Participant approves | Keeps the invoice number and recorded charge. Approval and payment are separate: the person can approve and pay, or approve and pay by the due date. |
| Plan-managed shift | Requests review first, then sends the invoice to the recorded plan manager. The participant is not asked to pay personally. |
| NDIA-managed shift | Requests review first, then prepares the claim records. External portal submission is still an office action. |
| Confirmed customer payment | Updates the ledger once, reduces the balance, queues a receipt, and stops further reminders when paid. Returning from checkout is insufficient evidence. |
| Confirmed bank deposit with a unique matching reference | Identifies the assigned participant billing account and applies the amount to that account’s referenced active invoice. Excess funds remain unallocated. |
| Question or withdrawal | Pauses collection/reminders or withdraws the invoice, preserves history, and retires checkout links with retries. In-flight money is reconciled when confirmed. |
| Temporary provider or message failure | Retains a durable job and retries. Office actions identify unresolved exceptions. |

The first boot records the immediate-invoicing cutover. Each new worker submission adds its own durable marker. Previously pending, unapproved shifts are not retrospectively invoiced merely because the software was installed; already approved, unissued work continues through recovery. One shift receives one invoice, including catch-up runs.

The existing `invoice_due_days` setting remains unchanged. Its fallback is 14 days. This release does not replace existing agreement terms with a new seven-day rule, and immediate invoice issue does not authorise an automatic debit. Saved-method charging and automatic recurring debits are not added.

## Where people work

- **Participant/reviewer:** the Actions prompt, Bookings in Calendar or List, or Statements → invoice. The invoice page is `#/invoice?invoice=INVOICE-NUMBER`.
- **Office:** **Payment tracking**, at `#/payment-tracking`, with invoice balances, email state, received payments, unallocated amounts, provider readiness and specific exceptions. The Money overview links to it.
- **Worker:** **Pay status**, at `#/journey?panel=payroll`, for the existing payroll batch and office-recorded expected date/status.

The compact Actions count includes actionable review/payment work. Text labels accompany colours. A person awaiting an office answer is shown as waiting, rather than being asked to approve the same disputed charge again.

## Invoice and payment links

The invoice email and PDF include a link into The Care Web. The PDF’s **View & pay invoice online** label is clickable. A signed-in reviewer can inspect and approve the invoice; a helper needs the participant’s active **bookings** scope to review care, and the separate **invoices** scope to manage payment.

The `/pay/<token>` page is an opaque, expiring payment link for the payer. Possessing this link does not give care-review authority. It excludes participant contact/address/NDIS details and care notes. It can show payment options only when the invoice’s review and collection state permit them. Keep these links private because they grant access to the limited payment page.

For plan-managed invoices, the original payer receives the payment link after the required shift review. The signed-in participant sees the plan-manager route. Account and invoice permissions are enforced again by the server.

## Stripe card payments and optional PayTo

Configure these values in the application server’s protected environment, outside the repository and public assets:

| Variable | Required configuration |
| --- | --- |
| `APP_URL` | The real public HTTPS origin for this deployment. |
| `STRIPE_SECRET_KEY` | The server API key for the intended Stripe account and mode. |
| `STRIPE_WEBHOOK_SECRET` | The signing secret for this deployment’s webhook endpoint and mode. Both this and the API key are required before checkout is offered. |
| `STRIPE_PAYTO_ENABLED` | Set to `true` only when PayTo is enabled and supported for the account. Without it, the site offers card checkout only. |
| `BANK_DETAILS` | Existing ordinary bank-transfer fallback, if used. These details do not enable automatic bank-feed reconciliation by themselves. |

Register the HTTPS endpoint **`/api/stripe/webhook`** in the matching provider environment. The implementation handles these checkout/payment outcomes:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

Refund, dispute and other unsupported financial events remain reconciliation items; this release does not automatically issue refunds. Retain any relevant refund/dispute event subscriptions from the existing setup.

A checkout request uses the current remaining balance and a durable request identifier. Repeated clicks reuse the appropriate existing attempt. Confirmations are matched to known invoice/checkout records and their amounts. Delayed bank methods remain **Processing** until success is confirmed. Old full-value links are retired after a partial payment; a subsequent checkout uses the new balance. An uncertain request older than the provider idempotency window is escalated for review rather than blindly recreated.

PayTo here is a payer-initiated bank payment through checkout. It is not automatic wage payment or an authorisation to debit later shifts. The application does not store card numbers or bank login credentials.

Provider references: [Stripe webhooks](https://docs.stripe.com/webhooks), [Checkout fulfilment](https://docs.stripe.com/checkout/fulfillment), [PayTo](https://docs.stripe.com/payments/payto).

## Zai: ordinary bank transfers

Zai receiving accounts support customers who transfer using their own bank’s BSB/account payment screen. They require provider onboarding and active receiving-account identifiers. The application does not create customer identities, complete provider onboarding, or automatically create receiving accounts through the office screen.

| Variable | Required configuration |
| --- | --- |
| `ZAI_ENABLED` | `true` enables the adapter. |
| `ZAI_ENVIRONMENT` | `sandbox` or `live`; default is `sandbox`. |
| `ZAI_CLIENT_ID` | Provider-issued ID for that environment. |
| `ZAI_CLIENT_SECRET` | Provider-issued secret for that environment. |
| `ZAI_SCOPE` | Exact scope supplied by the provider. |
| `ZAI_WEBHOOK_SECRET` | Registered printable-ASCII signing key, 32–1,024 characters. |
| `ZAI_WEBHOOK_SECRET_PREVIOUS` | Optional previous registered signing key during rotation. |

1. Complete the provider’s approved onboarding and settlement arrangement. Obtain the real Zai user ID, AUD wallet account ID and active virtual account ID for the intended participant billing account.
2. Register the application’s **`/api/zai/webhook`** endpoint for transaction notifications using its configured signing secret. Transaction notifications require a timely `Webhooks-signature` validated against the original request bytes. The exact one-field setup probe `{"message":"Zai callback test"}` may also be acknowledged without a signature; it creates no payment, account assignment or accounting event.
3. In **Payment tracking → Receiving account assignments**, select the correct participant and enter those three provider identifiers. Choose **Verify & save receiving account**.
4. The server fetches the provider records to confirm the user, wallet, virtual account, active state and AUD currency. It saves the provider-confirmed BSB/account details. It does not trust bank numbers typed into the form or guess the participant from an email/name.
5. Give the payer the invoice payment page’s current receiving details and invoice number. PDFs generated after the verified assignment include those details. An earlier PDF cannot update itself; the payment page carries the current verified instructions.
6. On a signed notification, the site re-fetches the transaction from Zai. Only a successful incoming AUD wallet deposit of the supported type is accepted as received. Pending and outgoing transactions cannot mark an invoice paid.

The receiving-account assignment and financial event keys include the provider environment. Use isolated staging financial records for sandbox tests. Never use simulated receipts to settle live customer invoices.

An exact invoice reference in the verified remittance information enables automatic allocation. A missing reference, ambiguous reference, unknown receiving-account assignment, withdrawn invoice, disputed invoice or excess amount leaves money visibly unallocated. **Match payment** allows an authorised office user to allocate an appropriate amount to an active invoice for that receiving billing account. The same allocation request cannot count twice.

Several invoices for the same participant can be matched through separate allocations. A combined payment covering different participants needs finance reconciliation; this version does not automatically split money across different participant receiving-account assignments. Do not record the same deposit again as a new receipt to work around the allocation restriction.

A late transfer remains a real receipt even if the invoice was withdrawn. It cannot silently pay the replacement invoice. Missing remittance data is retried where available, while the confirmed receipt remains visible.

See [zai-integration-contract.md](zai-integration-contract.md) for the exact authenticated API contracts and [Zai virtual accounts](https://developer.hellozai.com/docs/virtual-accounts) for provider prerequisites.

## Received, allocated and settled are different

| Display | Meaning |
| --- | --- |
| Awaiting review | The completed support still needs explicit review before online checkout. |
| Unpaid | An active invoice has a balance owing. |
| Processing | The provider has not confirmed the final payment outcome. |
| Part-paid | A confirmed, allocated receipt has reduced the balance. |
| Paid | The invoice balance has been fully covered by recorded payment evidence. |
| Payment received — needs matching | Funds were confirmed, but all or part remains unallocated. |
| Under review | A question has paused collection for this invoice. |
| Withdrawn | The invoice is retained in history and must not be paid. |
| Bank settlement not confirmed | This integration has not verified onward deposit into the business’s bank account. |

**Paid** is an invoice-ledger status. It is not proof that the payment provider has deposited the money into the business bank, or that the worker has received wages. Provider fees, onward settlement and business-bank reconciliation still use the provider/accounting records. This release does not initiate Zai wallet withdrawals or perform Stripe payout reconciliation.

## Questions, corrections and reminders

A participant can report a problem before or after approval. The question is preserved as a note, the relevant invoice is placed under review, and its automatic collection/reminders are paused. A worker’s answer adds to the original note; it does not approve the answer on the participant’s behalf or resume collection. The participant explicitly approves when satisfied.

An issued charge cannot be silently repriced through the category/item controls. For an unpaid correction, withdraw the invoice, correct its held shift, then release it. A changed charge returns to pending review and receives a fresh invoice number. Paid or unmatched money must be reconciled before withdrawal. Existing independent refund/reversal approvals remain in place; recording an external refund does not send it.

Unpaid approved invoices receive an overdue reminder on the first overdue day, then on the weekly overdue milestones, with a unique message key. Paid, withdrawn, disputed and processing invoices are excluded. Confirmation failures and checkout connection problems have durable retries. A provider outage does not undo the saved shift or participant’s review. The office receives a named exception when follow-up is needed.

Email **queued** means waiting for delivery; **sent** means accepted by the configured transport, not proof the recipient read it or that payment occurred. Real SMTP/Resend delivery must be enabled separately. A message already accepted by the provider cannot be recalled.

## Worker pay

The existing payroll workflow remains separate from customer collection: prepare a batch, record independently calculated components, obtain the required separate approval, export it, process it externally and record the actual external reference. The office may add an expected pay date.

Workers now receive status updates for pay preparation, export and the office-recorded payment result. Labels distinguish **Being prepared**, **Approved for payroll**, **Export file created** and **Payment recorded by office**. The last label means an office record exists; the website has not received bank confirmation of wages.

Automatic wage transfers, a connected payroll-provider result feed, payslip imports and automatic recurring participant debits are not part of this release. Existing booking-share figures remain allocation estimates rather than take-home pay.

## Deployment acceptance

The changes have local tests with synthetic accounts and simulated providers. Do not describe these as live bank, inbox, payroll or settlement tests. The release’s final verification report records the completed local checks and any browser checks actually performed.

Before live collection, confirm the deployed public origin, matching provider mode/credentials and webhook registration; verify the correct receiving-account assignment; exercise a controlled provider payment and its confirmation, partial balance, duplicate notification and receipt delivery; and reconcile the actual onward settlement in the business-bank/provider records. These are environment activation checks, not recurring office gates on each shift.
