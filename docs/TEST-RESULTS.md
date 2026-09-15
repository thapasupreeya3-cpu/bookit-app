# v88.4.7 validation

- 59 new focused checks cover referral signup/progress HTTP behaviour (15), referral interface interactions (12), person-grouped task API behaviour (12), person-tab interface interactions (15), and five address/profile mount and legacy-link checks added to the existing settings suite.
- Existing address, access, booking, payment, invoice query and account email tests are included in the release suite. One old address-link assertion was updated to the intended profile destination after the first run exposed it; the corrected suite and remaining release gates were then run.
- Generated inventories identify 414 routes and 108 tables, schema 88404. There is no schema change in this release.
- Exact byte comparison checks that the current-only ZIP applied over local commit 7effea2 (v88.4.6) reproduces the complete target source. Unchanged media and earlier block-register files are excluded.
- The package verification JSON records release-suite outcomes, source hashes, archive contents and guide-link validation. A new database migration/upgrade rehearsal was not needed or performed for this schema-unchanged update.
- UI checks exercise markup and event handling in local harnesses. They are not a rendered browser sign-off. No live deployment, real email delivery, payment or wage transfer was performed.

# v88.4.6 validation

- New focused checks cover invoice query HTTP behaviour and attribution (18), invoice query interface interactions (17), account email HTTP/security/export behaviour (21), and email interface interactions (19), plus two profile mount checks in the existing settings suite.
- Current-base upgrade acceptance passed 5/5 from local commit ed8277277a6077031ae048deee945a8211edaf49 (v88.4.5) to v88.4.6. Two boots preserve existing users, sessions, queried/part-paid invoices, payment evidence, document records and uploaded bytes. The new account_email_changes table starts empty. Database integrity and foreign keys pass.
- Generated inventories identify 414 routes and 108 tables, schema 88404. The email-change table is additive; no existing email is changed on upgrade.
- This ZIP contains only files changed since v88.4.5. Exact byte comparison confirms its overlay reproduces the complete target source. Unchanged media and old block-register files are excluded.
- The guide has 75 unique IDs and 99 valid internal links.
- The complete automated suite and source verification results are recorded in the accompanying package-verification JSON. UI checks exercise rendered markup and event handling in local harnesses; they are not a visual browser sign-off.
- Synthetic local tests block external communications. No real email, payment, wage transfer or live deployment was performed. Actual inbox delivery and deployed browser appearance remain unverified; the earlier Chrome preview was blocked.

# v88.4.5 validation

- 46 new focused scenarios cover booking notification recipients and stale-state checks (17), actual HTTP booking lifecycle (8), HTTP email diagnostics with a local mock provider (10), and email interface/account settings (11).
- The complete automated suite exercises the existing payment, location, overnight, admin and safety workflows alongside these changes. Test results are recorded in the accompanying package verification report.
- Upgrade acceptance passed 5/5 from the trusted v88.3.4 baseline, preserving users, existing booking fields, invoice snapshots, withdrawals, document records and uploaded bytes over two boots.
- Generated inventories identify 403 routes and 107 tables, schema 88403. Four additive outbox label columns retain safe message metadata after body purging; existing queued payloads are backfilled.
- The cumulative ZIP is checked by exact byte overlay from v88.3.4, v88.4.0–v88.4.4, including both v88.4.3 source variants.
- The updated guide has 73 unique IDs and 97 valid internal links.
- All email tests use synthetic records and local mock transports with external traffic blocked. No real emails, payments or live deployment were performed. Provider configuration and inbox delivery on the existing website remain unverified; a public version check timed out.
- Rendered browser layout remains unverified. The previous Chrome preview attempt was blocked; this release does not claim a fresh browser pass.

# v88.4.4 validation

- Full `npm run check` passed on Node 22.23.2: syntax, generated route/table inventories, release documentation, source hashes and the complete automated test suite.
- 78 new focused checks passed: launch clarity 14, sleepover pricing 13, booking-price UI 20, active-support UI 13, real HTTP overnight flow 18.
- Upgrade acceptance passed 5/5 from v88.3.4, including two boots, preservation of original booking fields, exactly three new nullable fields, invoice snapshot and withdrawal history, document records and uploaded file bytes, database integrity and no duplicate backlog invoices.
- The cumulative ZIP is checked by exact byte overlay from v88.3.4, v88.4.0, v88.4.1, v88.4.2 and both v88.4.3 source variants.
- Test accounts and records were synthetic. No actual payment, wage transfer, email delivery or business/specialist sign-off was performed.
- Chrome refused the local preview with `ERR_BLOCKED_BY_CLIENT`; rendered layout remains unverified. The website has not been deployed by this source update.

# Validation — v88.4.3

Verified on 13 September 2026 with Node **22.23.2**.

- The full `npm test` suite passed. Evidence: `validation/v88.4.3-full-test-output.txt`.
- Invoice-link policy coverage includes **13 immediate-invoice, 43 payment automation, 26 payment interface, 11 real HTTP, 18 admin payment workspace and 13 mail-migration checks**. These are totals for the affected suites, including retained cases, not a count of newly added tests.
- Real HTTP tests use stale bank/provider configuration and a stored legacy receiving account. Private/public invoice APIs and PDFs expose no receiving details; the removed assignment endpoint enforces admin access and returns 410. Existing evidence and allocations remain exact; verified late legacy deposits require reconciliation.
- Mail tests prove original payer/snapshot preservation, revised PDF content, a stable transport revision across retries, and withdrawal/access/cancellation suppression during preparation. An earlier ambiguous send may have reached the recipient; the correction is labelled Updated payment instructions. Generic SMTP acknowledgement loss still cannot prove exactly-once delivery.
- Upgrade acceptance passed **5/5** across first and repeated boot from the trusted v88.3.4 baseline. Synthetic users, uploads and immutable invoices survived; approved backlog issued once. Evidence: `validation/v88.4.3-upgrade-verification.json`.
- Generated inventories identify **401 routes, 107 tables**, schema **88401**. The source census contains **2,983 explicit entries and 25,658 branches across 82 files**, with zero parse errors. These are source controls, not active user blockers.
- The guide and preview have valid inline scripts and internal guide links. Live browser rendering remains unverified; the prior preview attempt was blocked.

No live email, real charge, external receiving-account closure, worker wage transfer or onward settlement was performed. Repository publication and deployment are separate; the existing Lightsail website must install the release. Previously sent/downloaded invoice copies cannot be recalled. Current setup instructions are in `PAYMENT-SETUP-v88.4.0.md`; the earlier validation below is historical.

# Historical validation — v88.4.1

Verified on 13 September 2026 with Node **22.23.2**.

- The full `npm test` suite passed, including existing payment, billing, security, calendar and task tests. Evidence: `validation/v88.4.1-full-test-output.txt`.
- New location tests: **60/60 passed** — 25 storage/permission/migration cases, 4 assignment/calendar context cases, 18 interface cases and 13 real HTTP workflows. These include snapshots, helper revocation, blocked workers, accepted/requested disclosure, concurrent saves, signed travel confirmation, changed-location alerts, acknowledgements and account closure.
- The v88.3.4 upgrade test passed all five acceptance cases across first and repeated startup, preserving records, uploaded file bytes and issued invoice snapshots. Approved backlog processed once; old pending and withdrawn work stayed held. Evidence: `validation/v88.4.1-upgrade-verification.json`.
- Generated inventories contain **401 routes, 107 tables**, schema **88401**. The source census contains 2,961 explicit controls and 25,315 branches across 80 files, with zero parse errors. These are source controls, not 2,961 active user blockers.
- The guide has no duplicate IDs or unresolved internal fragments; the supplied corrected travel section is preserved byte-for-byte. New documentation contains no competitor name.
- Stripe connector read-only verification returned **The Care Web sandbox**, test mode. Its webhook endpoint list is empty. No live account, live charge, receiving-account assignment or real payment was created or changed.
- Browser navigation to the new local preview returned `ERR_BLOCKED_BY_CLIENT`. Rendered layout, mobile/assistive-technology behaviour and real email delivery remain unverified.

The cumulative ZIP includes the earlier payment implementation. Real bank-transfer reconciliation still needs the receiving-account integration and verified callbacks described in `PAYMENT-SETUP-v88.4.0.md`; connecting a Stripe sandbox does not establish those flows. Worker wage transfers, payroll-provider result feeds and onward business-bank settlement are not claimed by this release.

---

## Historical validation — v88.4.0

Verified on 13 September 2026 using the declared Node **22.23.2** runtime.

- `npm test` passed the entire existing suite and all new payment suites. Exact output: `validation/v88.4.0-full-test-output.txt`.
- New payment suite: 13 immediate-invoice, 38 payment-ledger, 24 payment-interface, 11 payroll-notification, 30 Zai adapter, 9 real HTTP and 3 payroll-recovery checks: **128/128 passed**.
- Existing invoice lifecycle: 17/17, billing: 24/24, automatic billing unit: 12/12. All other original suites passed, including permissions, navigation, calendar, launch, verification and task clarity.
- Syntax: 97 scripts compiled, no failures. Inventories identify 396 registered routes and 104 database tables, schema 88400.
- Two upgrades from v88.3.4 passed five verification cases: records, uploaded bytes and immutable invoice snapshots preserved; approved backlog issued once; historical unapproved and withdrawn-held work stayed unissued; repeated startup preserved cutover and invoice numbers. Database integrity and foreign keys passed. Evidence: `validation/v88.4.0-upgrade-verification.json`.
- The real HTTP suite uses a running application, isolated SQLite, synthetic accounts and a loopback provider stub. It verifies completion, immediate invoice/PDF/outbox, scoped review, checkout, signed callbacks, chunk-split UTF-8, duplicate confirmations and one receipt. Outgoing non-loopback requests are blocked. Evidence: `validation/v88.4.0-payment-http-results.json`.
- The refreshed block census covers 78 source/configuration files, with 2,909 explicit controls, 24,841 branches and zero parse errors. These are source controls, not a claim that each is an active user block.
- The updated guide has no duplicate IDs or unresolved internal anchors. The 41-case alert coverage records 15 implemented, 12 retained, 13 partial and one missing capability; it does not claim full automation of the remaining external integrations.

## Historical v88.4.0 limits

No production database, real email recipient or actual money movement was used. The browser navigation attempt returned `ERR_BLOCKED_BY_CLIENT`, so rendered browser layout, mobile/assistive-technology behaviour and live deployment remain unverified. Provider credentials, receiving-account onboarding, real signed callbacks, inbox delivery and onward settlement require the deployment acceptance described in `PAYMENT-SETUP-v88.4.0.md`.

The earlier payment implementation did not change a live Stripe account or its webhook configuration. The current connection check is recorded above. The site integration uses its own protected server settings. Zai activation and receiving-account assignments remain required for automatically tracked ordinary bank transfers. Wage transfers, payroll-provider results, payslips, automatic saved-method collection and business-bank settlement feeds are not implemented.
