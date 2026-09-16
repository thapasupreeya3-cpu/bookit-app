# v88.4.16 validation

- **Full `npm test` passed** on Node22.23.2 (129.71 seconds). All 57 new
  scenarios passed. Syntax checking compiled 153 scripts with zero failures.
- **Upgrade verification passed 8/8** from v88.4.15 across two target boots,
  preserving existing rows, original quote/invoice bytes, detached visits,
  outbox counts and uploaded document/photo bytes. The receipt table starts
  empty and is not duplicated on restart.
- New recurring-booking checks: **17 real HTTP**, **17 routine interface**,
  **14 new recurring-price interface** and **9 submission/retry** scenarios.
  The full booking-price UI suite is now **39/39**.
- HTTP fixtures verify read-only preview, per-date conflicts, skip validation,
  atomic creation, correct signed quotes, public holidays, daylight saving,
  sleepovers, current helper access, travel confirmation, duplicate receipts
  and transactional notification rollback.
- Interface checks exercise compact patterns, upcoming weeks, overnight totals,
  cover labels, finite continuation, worker selection, selected-date totals,
  stale requests, authentication changes, focus and retry behavior.
- Submission checks execute the actual API client and booking form. Lost
  responses recover the committed request even after the price preview expires.
  Changed forms get a fresh review. Account switching during travel confirmation
  cannot redirect the retry to a different participant.
- The package-verification JSON records the full npm test result, the upgrade
  checks, declared Node **22.23.2**, exact source overlay and guide validation.
- Generated inventories identify **417 routes / 111 tables**, schema **88407**.
  The new booking_request_receipts table is additive.
- Local browser navigation returned **ERR_BLOCKED_BY_CLIENT**. UI tests use
  isolated event/markup harnesses; rendered desktop/mobile appearance remains
  unverified. No live booking, email, payment or deployment was performed.

# v88.4.15 validation

- Full `npm test` passed on Node **22.23.2**. The former billing test expecting
  split daytime/evening pricing was updated for the explicitly requested new
  method; weekend, holiday and support-item checks remain enforced.
- **33 new scenarios**: 15 pricing/migration cases, 13 real HTTP pricing-flow
  cases and five new booking-price UI cases. The price UI suite is **25/25**.
- Exact 19:20–22:20 and 19:00–22:00 weekday examples produce **$243.21** and
  one evening support line. Exactly 20:00 stays daytime; exactly midnight is
  evening. Night precedence, weekends, full/part-day holidays, fixed services,
  ratios and inactive sleepovers retain their intended treatment.
- Real HTTP tests verify signed quotes, stale keys, new request/acceptance/
  completion/invoice agreement, saved legacy quotes, records without snapshots,
  changed services/localities, existing completed and issued amounts, and
  short-notice cancellation at the earlier agreed charge.
- Independent comparison of **2,880 legacy calculations** matched the previous
  implementation across calendar boundaries, spring daylight saving, starts,
  durations, services and ratios. This is comparison evidence, separate from
  the count of new regression tests.
- Migration tests preserve existing quote, charge and invoice bytes, retain
  policy classifications across repeated initialization and assign the new
  policy to later inserts. No real database was migrated by this work.
- JavaScript syntax: **149 scripts, zero failures**, including four inline
  application scripts. Generated inventories: **416 routes, 110 tables**,
  schema **88406**. Inventory and release documentation verification passed.
- The current-only archive is verified by exact byte overlay on the hash-checked
  v88.4.14 source; the report records the archive and full source hashes.
  The guide's internal anchors are validated. Unchanged media is excluded.
- No fresh rendered browser check was performed for this small pricing update;
  the last local browser preview returned ERR_BLOCKED_BY_CLIENT. Browser layout
  and live inbox delivery remain unverified. No real invoice, customer payment,
  wage transfer or external message was created, and the site was not deployed.
- Numerical rate tables are unchanged. These tests verify software behaviour;
  they do not certify individual funding eligibility or September 2026 limits.

# v88.4.14 validation

- Full `npm test` passed on Node **22.23.2**. Existing booking, email, payment,
  worker readiness, profile, navigation and workflow suites remain passing.
- **41 new scenarios**: 15 notification persistence/access cases, 20 interface
  cases including keyboard focus, and six additions to the real booking HTTP
  suite. The full booking email HTTP suite now passes **14/14**.
- Actual HTTP tests cover ordinary and repeating acceptance, replacement cover,
  office-recorded worker agreement, helper revocation, rollback if recording
  fails, and persistence of confirmations/read receipts after server restart.
- Reading never acknowledges; explicit dismissal belongs to each viewer.
  Changed/cancelled visits and revoked access do not expose stale confirmations.
  The UI tests cover Calendar/List routing, background refresh, network retry,
  identity changes, injection prevention and focus preservation without scroll.
- Notification text contrast passes: normal 10.98:1, primary button 7.19:1,
  dark 11.04:1 and stale 10.02:1. These are measured colour checks, not a browser
  or assistive-technology certification.
- JavaScript syntax: **146 scripts, zero failures**, including four inline
  application scripts. Generated inventories: **416 routes, 110 tables**,
  schema **88405**. Release documentation verification passed.
- Homepage structure confirms removal of the opening park clip and sample
  worker/confirmation cards, with all six service clips and search retained.
- The notification migration is additive and repeatable. Existing synthetic
  records and read receipts survive reinitialization/restart. No separate full
  database-upgrade rehearsal from v88.4.13 was performed.
- The current-only ZIP is checked by exact byte overlay on the supplied v88.4.12
  source plus the delivered v88.4.13 update. The report records complete source
  hashes and checks guide anchors. No unchanged media/vendor files are included.
- Browser navigation to the local homepage returned **ERR_BLOCKED_BY_CLIENT**.
  Rendered layout and live inbox delivery remain unverified. The source was
  not deployed; no real email, payment, wage transfer or price change occurred.
- Pricing documentation describes current code and the supplied 2025–26 rules.
  This release does not certify September 2026 rate limits, change claim-item
  mappings, or implement the remaining overnight funding/agreement check.

# v88.4.13 validation

- Full `npm test` passed on Node **22.23.2**, including the existing booking,
  payment, profile, navigation and workflow suites.
- **15 new API lifecycle scenarios** cover blank applications, stale eight-task
  reconciliation, actual document review/removal, recruitment stages, screening
  and identity readiness, automatically withdrawn workers, safety restrictions,
  escalated help requests, activation and reviewer capacity.
- **Five new verification UI scenarios** run inside the verification suite,
  which now passes **51/51**. Process workflows pass **43/43**; their recruitment
  fixture now supplies evidence before expecting an office review task.
- JavaScript syntax: **142 scripts, zero failures**, including inline application
  scripts. Generated inventory: **414 routes and 108 tables**, schema **88404**.
- Readiness cache invalidation for interviews and bookings is installed at boot.
  The API tests seed stale task/queue records to verify reconciliation. No separate
  full database upgrade rehearsal was performed for this update.
- The guide has **78 unique IDs and 103 resolved internal links**. Exact archive
  overlay and full source hashes are checked against the supplied v88.4.12 ZIP;
  the accompanying report identifies the base/archive SHA-256 and changed files.
- Local API and UI interaction checks use synthetic records. They do not establish
  rendered browser appearance. No deployment, real email or financial transaction
  was performed; live browser appearance remains unverified.

# v88.4.8 validation

- Eight new Money-menu checks verify five main destinations, complete tool coverage, contextual tabs, preserved active invoice links, search aliases, escaped labels and unchanged access gating. The existing admin workspace suite now contains 57 checks; existing payment workspace checks cover 18 scenarios.
- Seventeen new navigation-position checks exercise delayed render completion, selected person targets, related tabs and pagination, Back/Forward, viewport height preservation, stale routes/accounts, user interaction during loading and local document tabs. Exact counts and outcomes are recorded in the accompanying package verification report.
- Release verification includes the complete functional suite, JavaScript/inline-script syntax, route and table inventories, release metadata, source hashes, guide links and exact ZIP overlay on v88.4.7 commit 8900b47.
- Schema 88404, 414 routes and 108 tables are unchanged. There is no new database migration in this release and no separate migration rehearsal was performed.
- A fresh browser attempt to open the local site returned ERR_BLOCKED_BY_CLIENT. Interaction harnesses do not establish visual browser rendering; deployed layout remains unverified.
- No website deployment, real email delivery or financial transaction was performed. The ZIP contains only the current update, with runtime data, unchanged assets and prior audit appendices excluded.

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
