# Implementation matrix — v88.2.0

All 26 backlog items have source implementations. This matrix distinguishes implementation from live-service validation. Configuration and staging checks are described in `WORKFLOW-OPERATIONS.md` and `TEST-RESULTS.md`. The original acceptance criteria are retained in `workflow-backlog-completed.json`; older R1–R6 receipts are in `history/v88.1.5/`.

| ID | Delivered | Main source | Verification |
| --- | --- | --- | --- |
| J01 | Unified next actions, structured setup and ownership, exact task links. | lib/process-store.js; lib/process-routes.js; public/assets/process-workflows.js | J01/J02, J01/J12; scoped-helper tests |
| J02 | Explicit private lane, unknown funding blocked, reviewed billing setup, original payer snapshots. | server.js; lib/process-finance.js | J01/J02; J21 invoice snapshot |
| J03 | Scope-aware helper APIs, active-person navigation and reminders, save-time access checks. | server.js; lib/process-routes.js; public/index.html | J03; helper without booking scope |
| J04 | Plan CAS revisions, serialized client saves, confirmation flush and preserved conflicts. | server.js; public/index.html | J04; syntax and existing review tests |
| J05 | Async job lock persists until settlement; truthful success/failure ledger. | server.js | J05 deferred/rejected Promise test |
| J06 | Persisted email outbox with dedupe, lease, retries, access and offer rechecks; invoice transaction. | lib/process-store.js; server.js | J06; J21; closure test |
| J07 | Voluntary pause permits eligible accepted shifts and current brief access; safety gates retained. | server.js; lib/plan-access.js | J07; audit permissions |
| J08 | Reviewed stable-ID batches, adjustments, repeatable export, explicit external acknowledgement and cutover. | lib/process-finance.js | J08/J21 |
| J09 | All open tasks searchable/paginated, owner/due persistence and true observed stage-entry time. | lib/process-store.js; lib/process-routes.js; server.js | J09 |
| J10 | Shared confirmed intake with revision check and explicit support-plan prefill. | lib/process-routes.js; public/index.html | J10; frontend rendering |
| J11 | Batch upload tray, per-file result/retry, catalogue purposes, duplicate detection and existing passport reuse. | public/assets/process-workflows.js; server.js | J11; existing document smoke tests |
| J12 | Interview/reference/employment checks with evidence, slots, cancellation and historical rebooking. | lib/process-store.js; lib/process-routes.js | J01/J12; J12; handoff test |
| J13 | Section navigation and next-unanswered flow; current-brief-only worker change summary. | public/index.html; lib/process-assistance.js | J13/J15; existing scoped plan tests |
| J14 | Retained matching/booking schedule preferences and limited revalidated alternative slots. | public/index.html; lib/process-routes.js | J14 |
| J15 | Explicit selected occurrences accepted in one transaction after fresh plan/travel/availability checks. | lib/process-routes.js | J13/J15 atomic conflict test |
| J16 | Book again and saved usual visits; fresh date, eligibility and price review; no copied care notes. | lib/process-routes.js; public/assets/process-workflows.js | J16 |
| J17 | Fresh signed availability-impact review, selected cover only, existing visit preservation. | lib/process-routes.js; public/assets/bookit-review-improvements.js | J17 |
| J18 | One scoped visit workspace with brief, saved note, active time, travel, completion, query and linked incident. | lib/process-routes.js; public/assets/process-workflows.js; server.js | J18; J07; frontend rendering |
| J19 | Review inbox, preferred current authorised reminder recipient, exact visit/person links, query suppression. | server.js; lib/process-store.js; lib/process-routes.js | J19/J20; existing approval smoke tests |
| J20 | Routine digest/quiet times and optional private calendar feeds, stable IDs, update/cancel/revoke. | lib/process-store.js; lib/process-calendar.js | J06; J19/J20; calendar reassignment |
| J21 | Original invoice snapshots, delivery status, held-line view, matched receipts and provider-event checks. | lib/process-finance.js; server.js | Three J21 groups; J08/J21 |
| J22 | Upcoming document/module renewals, affected visits, distinct received/reviewed state. | lib/process-store.js; lib/process-routes.js | J22; frontend renewal panels |
| J23 | Separate first-meeting/first-shift follow-up tasks, concern cases and duplicate-answer protection. | lib/process-store.js; lib/process-routes.js | J23; handoff test |
| J24 | Owned transitions and fresh series-end preview; visits, notes, queries, invoice and helper checklist. | lib/process-assistance.js; public/assets/process-workflows.js | J24; closure and calendar tests |
| J25 | Off-by-default approved extraction with explicit consent, location/provider gates, source evidence and human review. | lib/process-assistance.js | J25 disabled/configuration gate; live provider pilot required |
| J26 | Deduplicated minimal events, return/resume and form outcomes, reporting periods and median/P90 waits. | lib/process-store.js; lib/process-routes.js; public/assets/process-workflows.js | J26; frontend metrics panel |
