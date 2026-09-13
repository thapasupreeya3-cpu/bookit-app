# Current release: v88.4.0

See [CHANGELOG-v88.4.0.md](CHANGELOG-v88.4.0.md), [PAYMENT-SETUP-v88.4.0.md](PAYMENT-SETUP-v88.4.0.md) and [TEST-RESULTS.md](TEST-RESULTS.md) for this payment update. Earlier release notes below are historical.

# The Care Web v88.3.0 — changes and finding register

Source baseline: v88.2.12. Prepared 12 September 2026. This release contains source corrections and operational controls; it does not certify the live site ready to launch.

The cumulative changed-files ZIP includes all prior supplied updates and excludes unchanged media. Extract and merge its contents at the existing repository root. Preserve deployed databases, uploads, photos and secrets. See UPDATE-INSTRUCTIONS.txt.

## Changes that affect daily work

- Enrolled users sign in with MFA after password reset; old sessions are revoked.
- Private photos and document reviews enforce relationship/evidence rules.
- Incident clocks use provider awareness and harm; five-day and requested final reports have separate evidence.
- Billing waits for current rule review; exceptional charges use itemised approval. Payroll requires reviewed components and a different approver.
- Partial receipts and independently approved reversals update the ledger; provider disputes/refunds stay visible for reconciliation.
- Admin → Launch & operations adds owned alerts, review evidence, support arrangements, billing review and configuration.
- Worker file lists show missing items first; document search, review browsing, direct visit links and draft retry reduce repeated steps.
- The complete HTML guide covers v88.2.1–v88.2.12 and this release, with refreshed inventories and corrected older instructions.

## Every finding

| ID | Finding | Resolution and remaining evidence |
|---|---|---|
| A01 | Require the second factor after password reset | Implemented: password reset revokes sessions; MFA assurance is required for enrolled sessions and office access; security changes require a fresh factor. |
| A02 | Apply relationship checks to participant photos | Implemented: participant photo access uses owner, active helper scope, care relationship and office permissions; private/no-store responses. |
| A03 | Respect unpublished worker photo visibility | Implemented: public worker photos require a publishable eligible profile; closed or withdrawn profiles lose anonymous access. |
| A04 | Correct incident reporting clocks and completion workflow | Implemented: awareness/harm-based deadlines, separate five-day/final-report evidence, immutable event history and incomplete-obligation closure gate. Safeguarding lead must review migrated incidents and the real procedure. |
| A05 | Enforce the same evidence rules on every verification endpoint | Implemented: shared evidence/revision checks on legacy and workspace verification routes; missing files and stale decisions are refused. |
| A06 | Reject empty or weak production signing secrets | Implemented: production checks the selected secret, including empty env/file values, short and predictably repeated values. |
| A07 | Include every referenced file in backup completeness checks | Implemented: all discovered file-bearing columns participate in backup completeness; missing policies/outside roots fail. Actual off-instance restore remains an external acceptance step. |
| A08 | Document the applicable digital-platform registration pathway | External evidence required: actual certificate, conditions, services and current digital-platform registration pathway must be confirmed by the provider. Acceptance template and in-app evidence register supplied. |
| A09 | Validate time bands, holidays and current NDIS prices before automatic issue | Implemented guarded billing: current rule/agreement approval and dated jurisdiction calendar are required; boundary/holiday/night/travel/cancellation/shared cases are held for itemised review. No new authoritative rate catalogue was invented or certified. |
| A10 | Validate full employment entitlements outside the booking share calculation | Implemented guarded payroll: booking figures labelled estimates; every included line requires reviewed gross wages, super, allowances and calculation reference; separate approver. Full entitlements remain the external payroll specialist’s calculation. |
| A11 | Complete real-browser and production-like launch journeys | External acceptance required: local browser URL is blocked; Node 24.19.0 tests do not establish Node 22 or deployed-browser acceptance. Concrete staging matrix supplied. |
| A12 | Keep external calendars consistent with voided visits | Implemented: voided/reassigned visits retain stable cancellation tombstones and sequences in subscribed calendars. |
| A13 | Deliver time-sensitive booking requests before they become stale | Implemented: structured time-sensitive requests bypass digests; resolved/expired requests are rechecked before transport; routine digest scheduling retained. |
| A14 | Define partial payment, refund and dispute lifecycles | Implemented: partial receipts, outstanding balances, immutable signed amounts, idempotent checkout evidence, independently approved reversals and provider refund/dispute reconciliation queue. Provider sandbox settlement remains external. |
| A15 | Verify actual email delivery and escalation | Implemented: transport acceptance is distinguished from delivery; actual delivery/bounce/failure evidence and owned fallback follow-up can be recorded. Real mailbox/provider drill required. |
| A16 | Monitor dependencies and job freshness beyond database liveness | Implemented: private operational checks for writable/free storage, job freshness/failure, old mail, complete local backup evidence, imminent unanswered visits and recorded TLS expiry. External monitoring/alert delivery still require configuration. |
| A17 | Test complete tasks to WCAG 2.2 AA with assistive technology | Retained accessible controls and added focus/target/reflow styles for new screens. Assistive-technology task acceptance remains external; supplied keyboard, zoom and screen-reader matrix. |
| A18 | Stabilise header, menus, route focus and scroll | Retained previous header/menu/route-scroll fixes and regression coverage. Direct calendar-return date and scoped render checks added. Actual device layout remains external. |
| A19 | Prove previews and per-file actions across supported formats | Retained local PDF/HTML/image viewer and exact-file controls; 46 verification scenarios cover access/actions. Real supported-browser preview fixture matrix supplied. |
| A20 | Make unsupported high-intensity needs an owned pre-visit handoff | Implemented: named excluded-support arrangements with independent review; plan/visit changes invalidate approval; acceptance paths check readiness; worker brief and office tasks show the arrangement. |
| A21 | Complete the data and retention inventory, including external processors | Supplied table-group/data-flow/processor inventory, legal-hold and retention decision procedure, evidence fields and deletion/restore test. Actual retention periods/contracts require provider confirmation. |
| A22 | Treat the Australian region setting as a declaration, not proof | Implemented: exact endpoint allowlist plus current provider/model/region assessment, consent gate and blocked redirects/private destinations. Real provider contractual/data-location evidence remains external. |
| A23 | Commission an independent access-control and application security review | Independent security review remains external. Supplied ASVS/object-access/recovery/export test scope and evidence register; synthetic regressions are not a penetration test. |
| A24 | Measure capacity and failure behaviour on the deployed architecture | Deployed capacity acceptance remains external. Supplied load/failure profiles, invariant checks, recovery thresholds and escalation procedure. |
| A25 | Separate approval of money movements from preparation | Implemented: payroll preparers/line reviewers cannot approve their batch; reversals require a different approver and once-only consumption. Separate named office accounts required. |
| A26 | Show one actionable task per obligation with clear ownership | Retained grouped actionable tasks, office/person separation and ownership; added operational and excluded-support obligations to office tasks. User cohort validation remains external. |
| A27 | Use a short resumable path and reuse confirmed details | Implemented account-revision guard and updated form; retained resumable intake, contact-only updates and authoritative Settings links. |
| A28 | Make essential missing files immediately scannable | Implemented missing-first essential checklist and document-type search while retaining all 25 types and exact-file actions. |
| A29 | Reduce review clicks while preserving decision quality | Implemented session-opened evidence markers and non-submitting Alt-arrow navigation; retained guided review, current-evidence guard and draft preservation. |
| A30 | Give each visit one stable detail destination | Implemented calendar-to-visit workspace links with selected-date return and existing List controls available. |
| A31 | Explain match quality and offer practical alternatives | Retained requested-interval/service/area matching explanations and practical alternative-date API; clarified interpretation in guide. User validation of matching quality remains a measured research task. |
| A32 | Keep active participant and permission boundaries visible | Implemented permitted-scope text in the acting-for banner; retained explicit participant selection, stop control and server-side per-request grants. |
| A33 | Improve note reliability under poor connectivity | Implemented saved/recovered timestamps and explicit draft retry without shift completion; retained draft conflicts, failure messages and close warning. No offline persistence promise. |
| A34 | Separate evidence receipt, module completion and competence | Retained distinct uploaded evidence and Training records; clarified competence/scope limitations in guide and review instructions. Worker-specific skill assessment remains human. |
| A35 | Keep referral rewards easy to find and unambiguous | Retained direct Refer a friend shortcut and Earnings access; guide distinguishes qualifying rewards, reviewed batch and externally acknowledged payment. |
| A36 | Audit public promises and make help contextual | Corrected affected help/manual and legacy payroll labels; public-claims inspection inventory and owner sign-off procedure supplied. Registration/price promises still need actual provider evidence. |
| A37 | Consolidate domain rules and make risky changes independently testable | Implemented shared evidence, incident, photo/session, billing-review and ledger policies with focused regressions; original assignment/permission services retained. |
| A38 | Track the runtime and vendored assets as dependencies | Supplied dependency provenance and hashes for runtime declaration, lockfile, PDF.js, fonts and existing vendors; advisory/runtime support scan and Node 22 release acceptance remain external. |
| A39 | Offer passkeys after repairing recovery | Research option, not implemented: passkey pilot specification and recovery/accessibility acceptance supplied. TOTP/recovery fixes ship now; no untested authentication method enabled. |
| A40 | Pilot document extraction as reviewable suggestions | Governed document-suggestion pilot specification supplied; actual assistance stays off until assessed/configured/consented. Existing review/edit/discard flow retained. |
| A41 | Test reminders for usefulness and access, not just volume | Reminder pilot specification supplied with delivery, accessibility, resolution and opt-out measures; urgent request correction ships now. |
| A42 | Test optional worker-authored note assistance cautiously | Research option, not implemented: worker-authored note-assistance protocol supplied. No generated clinical notes or automatic shift completion enabled. |
| A43 | Measure usability with participants and workers before expanding features | Real participant/worker usability cohort and measures remain external; concrete moderated tasks, accessible materials and decision log supplied. |
| A44 | Make the endpoint inventory complete and syntax-tolerant | Implemented inventory from actually registered routes during disposable boot, plus pre-dispatch handlers; spacing and independently mounted modules no longer drop routes. |

## Evidence and limits

See docs/TEST-RESULTS.md for executed validation. No live user store, production domain, external mail/payment account or regulator submission was accessed. Browser navigation returned ERR_BLOCKED_BY_CLIENT. The available test runtime is Node 24.19.0; the declared Node 22 runtime still needs staging validation. Independent specialist approval and research pilots are explicitly outstanding above.

## Primary guidance used for the controls

- [NDIS Commission reportable incidents](https://www.ndiscommission.gov.au/rules-and-standards/reportable-incidents-and-incident-management/reportable-incidents): awareness-based timeframes and the five-day form.
- [NDIS pricing arrangements](https://www.ndis.gov.au/providers/pricing-and-payments/pricing/pricing-arrangements): source for the specialist’s effective-date/item review; this release does not certify a new rate schedule.
- [Fair Work SCHADS hours of work](https://www.fairwork.gov.au/find-help-for/disability-support-and-aged-care-services/understanding-schads/hours-of-work-in-the-schads-award): employment rules require more than a booking revenue percentage.

The earlier audit bibliography is preserved in docs/launch-research-sources.json.
