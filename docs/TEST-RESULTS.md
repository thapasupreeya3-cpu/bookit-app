# Validation — v88.4.0

Verified on 13 September 2026 using the declared Node **22.23.2** runtime.

- `npm test` passed the entire existing suite and all new payment suites. Exact output: `validation/v88.4.0-full-test-output.txt`.
- New payment suite: 13 immediate-invoice, 38 payment-ledger, 24 payment-interface, 11 payroll-notification, 30 Zai adapter, 9 real HTTP and 3 payroll-recovery checks: **128/128 passed**.
- Existing invoice lifecycle: 17/17, billing: 24/24, automatic billing unit: 12/12. All other original suites passed, including permissions, navigation, calendar, launch, verification and task clarity.
- Syntax: 97 scripts compiled, no failures. Inventories identify 396 registered routes and 104 database tables, schema 88400.
- Two upgrades from v88.3.4 passed five verification cases: records, uploaded bytes and immutable invoice snapshots preserved; approved backlog issued once; historical unapproved and withdrawn-held work stayed unissued; repeated startup preserved cutover and invoice numbers. Database integrity and foreign keys passed. Evidence: `validation/v88.4.0-upgrade-verification.json`.
- The real HTTP suite uses a running application, isolated SQLite, synthetic accounts and a loopback provider stub. It verifies completion, immediate invoice/PDF/outbox, scoped review, checkout, signed callbacks, chunk-split UTF-8, duplicate confirmations and one receipt. Outgoing non-loopback requests are blocked. Evidence: `validation/v88.4.0-payment-http-results.json`.
- The refreshed block census covers 78 source/configuration files, with 2,909 explicit controls, 24,841 branches and zero parse errors. These are source controls, not a claim that each is an active user block.
- The updated guide has no duplicate IDs or unresolved internal anchors. The 41-case alert coverage records 15 implemented, 12 retained, 13 partial and one missing capability; it does not claim full automation of the remaining external integrations.

## Limits

No production database, real email recipient or actual money movement was used. The browser navigation attempt returned `ERR_BLOCKED_BY_CLIENT`, so rendered browser layout, mobile/assistive-technology behaviour and live deployment remain unverified. Provider credentials, receiving-account onboarding, real signed callbacks, inbox delivery and onward settlement require the deployment acceptance described in `PAYMENT-SETUP-v88.4.0.md`.

Stripe was connected in ChatGPT during this work, but no callable Stripe account tools were exposed to this session. No claim is made that the live account or its webhook configuration was inspected or changed. The site integration uses its own protected server settings. Zai activation and receiving-account assignments remain required for automatically tracked ordinary bank transfers. Wage transfers, payroll-provider results, payslips, automatic saved-method collection and business-bank settlement feeds are not implemented.
