# The Care Web v88.4.0 — immediate invoices and payment tracking

Completed self-managed/private shifts previously waited for a separate participant approval before an invoice existed. Ordinary bank transfers also lacked an integrated receipt-to-invoice matching path, and participants could miss review/payment work in the Calendar view. This release adds immediate per-shift invoices, secure review/payment pages, durable provider confirmation handling and a shared payment action surface.

## Invoice lifecycle

- Newly submitted self-managed/private shifts receive one invoice and one queued PDF email immediately. A recorded cutover and durable submission marker prevent surprise invoicing of historical unapproved pending work. Approved legacy work still recovers automatically.
- Participant approval remains explicit before website checkout. Issuing an invoice, opening a link, a worker’s answer, receiving money and deemed approval do not substitute for the payer’s explicit care review.
- Plan-managed work retains its approval-first route to the plan manager; NDIA-managed work retains its claim-file route and external submission step.
- The original invoice and the configured due-day setting are preserved. No recurring debit authority is assumed or created.
- Invoice emails and PDFs link to the website. Signed-in reviewers use an invoice page with the recorded charge and review decision. Limited public payment links confer no care-review authority.
- Questions pause collection/reminders for the affected invoice. Worker replies preserve the original note and leave collection paused until explicit review.
- Issued category/item changes are refused. An unpaid invoice can be withdrawn, corrected and reissued with a fresh number; a changed completed charge returns to pending review. Prior withdrawal, snapshot, payment and queued-mail protections remain.

## Provider payment handling

- Payment cleanup retains a valid new checkout for a part-paid invoice’s remaining balance; historic receipt evidence does not repeatedly close it. Stale sessions are retired individually.
- Adds on-demand Stripe card checkout and optional payer-initiated PayTo using the current balance. Durable attempts, stable request keys, retry handling and server-confirmed outcomes protect against duplicate or uncertain requests.
- Signed provider notifications update a durable receipt/allocation ledger. Processing, failure, partial receipt, paid, disputed and withdrawn states stay distinct. Checkout return URLs do not mark invoices paid.
- Adds a Zai adapter for authenticated AUD wallet-deposit lookup, signed notifications, verified active virtual-account mapping, environment-separated transaction identities and remittance references.
- Known receiving accounts and unique invoice references can match automatically. Partial allocations reduce only the correct invoice; excess, missing references, conflicts and withdrawn/disputed cases remain visible for matching.
- Invoice receipts and overdue/payment-failure messages use the existing durable outbox. Paid/disputed/withdrawn/processing states suppress inappropriate collection reminders.
- **Payment tracking** shows balances, received and unallocated money, delivery status, provider readiness, receiving-account assignments and actionable exceptions. Business-bank settlement remains explicitly unconfirmed.

## User guidance and worker pay

- Adds a common Actions badge and makes actionable invoice review/payment tasks available in Calendar and List. Labels accompany colours and direct users to the relevant invoice.
- Adds worker pay notifications and an optional office-recorded expected pay date. Payroll exports are labelled as exports; external payment acknowledgements are labelled **Payment recorded by office**.
- Preserves existing payroll component review and independent approval. Actual wage transfers, payroll-provider confirmations and payslip retrieval still require the selected external payroll process.
- Updates `docs/USER-GUIDE.html` and adds `docs/PAYMENT-SETUP-v88.4.0.md`. Previous verification, documents, navigation, task clarity and calendar guidance is retained.

## Apply and verify

Apply the release package according to its included update instructions over the supported source baseline, preserving database, uploads and protected environment settings. Version/schema identity, generated inventories, hashes and upgrade evidence are recorded by the release packaging process. Do not replace a complete repository with a changed-files ZIP.

The release includes new tests for immediate invoicing/cutover, invoice and payment permissions, provider events/retries, bank matching, user actions and truthful payroll notifications. The immediate-invoicing suite passed 13 local scenarios; existing billing 24, lifecycle 17 and automatic-billing unit 12 scenarios passed during implementation. Use the final verification report for the complete release result.

Local tests use synthetic accounts and simulated provider responses. This changelog does not claim real provider onboarding, live bank deposits, actual email delivery, bank settlement or wage transfers. Browser/deployment checks are reported separately when performed. Server payment credentials and verified provider receiving accounts remain separate from any connected ChatGPT app.
