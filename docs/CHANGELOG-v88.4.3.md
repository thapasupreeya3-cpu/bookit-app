# The Care Web v88.4.3 — invoice-link payments

New customer payments must use the secure invoice link. Checkout offers Stripe card and PayTo when enabled for the account. Zai and ordinary BSB/account transfers are no longer offered to payers.

## Changes

- Removed bank-transfer instructions and receiving details from invoice pages, participant summaries, invoice PDFs, payment-failure messages and payment settings. Stale environment values or old account assignments cannot restore them.
- Retired receiving-account assignment. The old endpoint requires admin access and returns a clear 410 response without contacting the provider.
- Preserved existing payment evidence, receipt allocations, balances and finance history. Previously connected legacy transaction notifications can record real money already received for office reconciliation; they do not automatically allocate new deposits to invoices. Configuration alone cannot activate this legacy handling.
- Refresh unsent/retry invoice PDFs and payment reminders before transport. The original payer, invoice snapshot and logical event stay intact. Revised transport requests have a stable revision key and frozen content across retries. An earlier ambiguous delivery may have sent the old invoice; its revised message explicitly updates payment instructions. Sent/cancelled messages are not resent by this migration.
- Retained withdrawal, privacy and access checks during email preparation. Failure to prepare the secure link or original PDF retries without sending obsolete instructions.
- Simplified Payment connections to Stripe card and optional PayTo. The updated user guide and setup instructions follow the existing Lightsail website and actual admin navigation.
- Includes the billing-test timing correction already verified in the preceding repository update.

## Operation

Use **Admin → Settings → Payment connections** for configuration status and **Admin → Money → Payment tracking** for balances and payment exceptions. Configured Stripe confirmations continue to update invoices, stop reminders and queue receipts. No extra approval was added to ordinary payment processing.

Install using the existing `sudo bookit-update` procedure after publication to GitHub, or merge the changed-files ZIP over v88.3.4–v88.4.2 and redeploy. The schema remains **88401**. Preserve live records, uploads and protected settings.

## Limits

Previously emailed or downloaded PDFs cannot be recalled. This code does not close an external receiving account; money sent to old details may still arrive and needs reconciliation. Historical evidence is preserved rather than silently discarded.

This update does not enable recurring automatic debits, transfer worker wages or verify provider payouts into your bank. Existing plan-manager routing and NDIA claims remain. Validation uses synthetic accounts and payment-provider stubs; actual email delivery, live payments, bank settlement and the deployed browser have not been verified here. See `TEST-RESULTS.md` for release checks.
