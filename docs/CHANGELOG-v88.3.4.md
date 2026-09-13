# The Care Web v88.3.4 — invoice flow and withdrawal

The withdrawal confirmation dialog referenced an undefined focus variable. It could close without resolving the confirmation, so the invoice request was never submitted. This release fixes that shared dialog and the related invoice lifecycle problems found while tracing it.

## Changes

- Withdraw invoice now submits after confirmation. Cancel and Escape settle correctly, focus is restored, a second dialog does not leave the first pending, and duplicate clicks are guarded.
- A withdrawal retains the issued invoice snapshot and records its reason and actor. Every linked shift is held until explicitly released or removed. Manual and automatic invoice runs respect the hold.
- Repeated withdrawal is idempotent. Reissue uses a fresh invoice number, reserving numbers found in active invoices, snapshots and withdrawal history.
- Original invoice emails still queued for sending are cancelled. The durable outbox suppresses stale retries after withdrawal. One transactional withdrawal notice is queued to the original payer, including the original plan manager after profile changes.
- A notice-queue failure rolls back the withdrawal and hold together. A missing payer address is visible in withdrawal history without preventing withdrawal.
- Card checkout retirement is queued durably. The provider is asked to expire the checkout; an already-expired session is verified by retrieval. Failures retry, and a checkout completed during retirement is kept for reconciliation. A late-created checkout is retired instead of attaching to a withdrawn or already-paid invoice.
- A stale full-value card link is retired after a partial payment. Remaining payment can be made by bank transfer. Late card payments/refunds preserve their original invoice reference for reconciliation and cannot settle a replacement invoice.
- One **Record payment** action replaces the misleading **Invoice paid** and duplicate **Mark paid** controls. Partial receipts and overpayments report their actual outcomes. The legacy per-shift endpoint cannot bypass an invoice’s payment ledger.
- Invoices appear once per invoice, with total, paid amount, remaining balance and email state. NDIA claims have a separate export section. Outstanding totals use remaining balances; payments recorded include partial receipts.
- Paid and withdrawn invoice histories are expandable. Participant history and PDF downloads retain access controls. Withdrawn PDFs are marked **WITHDRAWN / DO NOT PAY**, have no payable balance and show no card-payment action.
- Payment review opens the selected invoice’s records and carries its number into the refund/reversal review form. Existing recorded payments and unmatched receipts must be reconciled before withdrawal.
- A per-shift paid marker from an earlier release contributes to the legacy invoice’s partial paid balance, which is retained as opening evidence when another payment is recorded.
- Updated user guide, interactive fictional preview and source control register. Earlier v88.3.3 task labels and automatic website certificate monitoring are included.

## Apply the update

The cumulative changed-files ZIP applies over the supplied **v88.3.0, v88.3.1, v88.3.2 or v88.3.3** releases. There is no need to apply v88.3.3 separately. Extract and merge the ZIP contents into the existing repository root, preserving other folder contents and runtime data, then redeploy and refresh.

Default release 88.3.4; schema 88304; 386 routes and 94 tables. Two additive tables retain invoice withdrawals and card-link cleanup jobs. The ZIP excludes unchanged media and vendor assets. No source deletion is required.

## Validation and limits

The invoice/billing suite contains **50 passing checks**: 12 automatic billing unit scenarios, 24 billing API scenarios and 14 invoice lifecycle/dialog scenarios. The complete automated regression and release checks passed. Two consecutive upgrade boots from synthetic v88.3.0 and v88.3.3 databases preserved their existing records and uploaded bytes, with database integrity and foreign keys checked.

The browser rejected the local preview URL with ERR_BLOCKED_BY_CLIENT. Native browser appearance and real external-provider checks remain unverified. Card calls and email outcomes in tests are simulated; no real invoice, email, refund or payment was sent or changed here.

A message already with the email provider cannot be recalled. A card link is not guaranteed closed until the provider confirms it; that state is visible and failures retry. Completed payments require reconciliation. Uploaded NDIA claims still require action in the provider portal. These external states are not presented as completed merely because the local invoice was withdrawn.

Implementation references: [Stripe checkout expiration](https://docs.stripe.com/api/checkout/sessions/expire), [Stripe request idempotency](https://docs.stripe.com/api/idempotent_requests).
