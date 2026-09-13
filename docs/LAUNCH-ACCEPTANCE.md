# Practical launch checks — v88.4.4

Use **Admin → Settings → Launch checks** on the existing prelaunch website. A second permanent website is not required. Keep separate named office accounts and record what was actually checked.

The page now contains **six practical areas**, with three office tasks and three specialist tasks. It does not require all 44 original audit findings to be approved before bookings or invoices can operate. The original findings include completed source fixes and optional ideas; they remain under collapsed **Audit history**. Their original priority labels are not a current fault detector.

## Six areas to work through

| Area | Practical result to establish | Who helps |
|---|---|---|
| Booking and payment journey | On this website, follow booking, worker completion, review/query, invoice, authorised payment confirmation and receipt. Confirm the intended participant/helper receives the actual emails and alerts. | Office, participant and worker. |
| Care and business arrangements | Confirm actual services, business and applicable registration evidence, worker eligibility, participant consent/agreements, incident/complaint contacts and excluded-support arrangements. Reuse current records. | Business owner and care lead, with adviser input where applicable. |
| Essential tasks on a phone | Participant and worker can complete the main tasks on their own devices. Check keyboard, enlarged text and relevant assistive technology; fix and retry important barriers. | Office with participants/workers; accessibility help as needed. |
| Access, privacy and sign-in | Confirm relationship/role permissions and admin recovery, plus actual data handling, retention, processors and independent security-review evidence. Assess optional AI only if it will be used. | Technical support and privacy/security adviser. |
| Charges and worker pay | Confirm representative agreed charges and a workable payroll process covering actual worked time and the applicable pay components. Reconcile invoice receipts and worker payments separately. | Finance/payroll adviser and office. |
| Recovery and failure alerts | Restore a backup copy into an isolated temporary location, verify records/files and off-instance storage, and confirm who receives and responds to failures. Check deployed capacity against expected launch use. | Technical support or hosting provider. |

These are areas of evidence, not six blanket software approval blocks. Record a limitation or follow-up where work remains. Do not treat an invoice payment as a wage transfer or a saved setting as a successful connection.

## Record a result once

1. Open **What to check** on the area and use its task links.
2. Complete the relevant work, reusing existing records or specialist reports where appropriate.
3. Open **Record your result**, choose the responsible person and result, and record the outcome and evidence reference. Meaningful evidence and explicit confirmation remain required.
4. Leave **Review again by** blank unless another check is needed. A supplied date must be valid; past dates return the area to attention.
5. Save. A new result preserves earlier evidence; it does not approve other areas or alter payroll, payment or booking permissions.

**Evidence recorded** means someone recorded that result. **Follow-up needed** means work remains. **Not applicable** requires the actual reason. The count of recorded areas is a planning aid, not an automatic launch approval.

## Automatic checks and later improvements

**Automatic checks** shows current certificate, writable/free storage, recent local backup, background-job, email-alert and holiday-lookup results. No manual launch sign-off is needed for these monitors. Certificate checks run automatically with retries; hosting handles renewal. A current local backup does not establish an off-instance copy or successful restore. No email alerts does not prove arrival in a real inbox.

A09 price/calendar review records remain historical operating evidence; missing or expired A09 evidence is not an invoice gate. NSW holiday lookup refreshes automatically with a saved fallback. Confirm the actual service location and agreement rather than approving individual holidays.

**Later improvements** contains optional passkeys, document suggestions, reminder experiments and note-assistance research. These pilots do not need approval before launch. Use `RESEARCH-PILOTS.md` only when choosing to evaluate them.

## Overnight examples for the charges check

The booking quote and saved booking price distinguish **Inactive overnight — flat per night** from **Hourly support — worker awake / working**. Inspect every date in a repeating series. Private booking quotes carry a server-signed price key: confirm that a changed price or changed booking detail requires a refreshed quote before any booking is created, without an office sign-off. If an existing booking is moved later, retain the original quote snapshot with its original interval and a changed-times label; do not present it as a current quote for the edited interval.

| Case | Expected current national 1:1 participant charge |
|---|---|
| Inactive night with 0–2 active hours | $311.79 per night; record the actual active hours, including zero. |
| Additional active support on a weekday or Saturday | $103.54 per hour beyond the first 2 active hours. |
| Additional active support on Sunday | $133.50 per hour beyond the first 2 active hours. |
| Additional active support on a public holiday | $163.46 per hour beyond the first 2 active hours. |
| Hourly active overnight | The actual hourly date/time bands in the quote; no flat sleepover rate just because the shift starts at night. |

Use a single-band night and nights crossing Saturday/Sunday, Sunday/Monday and a holiday boundary. If active support exceeds 2 hours and different extra-active bands occur during the booking, the worker must record all active periods with their actual dates/times. Periods must not overlap, must remain within the booking, and must total the active hours. Confirm draft saving/restoration. The first 2 chronological active hours are included for participant billing, then the remaining time uses its actual rate band.

The current app permits a sleepover of 8–10 continuous hours starting before midnight and ending after midnight. A start before 8 pm can be valid; a midnight start is not a sleepover. The 10-hour ceiling is an app booking limit, not an NDIS maximum. Actual participant needs determine whether inactive or active overnight support is suitable.

Check a historical accepted sleepover with an interval allowed by the old bug, such as **00:30–08:30 on the same date**. The worker must still be able to record actual work and complete the shift. The invalid charge must appear for office correction of the actual arrangement before invoicing, without silently guessing or reclassifying it. A valid ordinary sleepover must retain automatic billing. This is an exception for existing invalid bookings, not a new review requirement for every night.

Review worker payroll separately for **all** worked time, applicable components and allowances. The two included participant-billing hours do not remove work from payroll, and legacy allocation estimates do not establish wages paid. Sources: [NDIS Pricing Schedule 2026–27](https://www.ndis.gov.au/media/8703/download?attachment=) and [Commission sleepover guidance](https://www.ndiscommission.gov.au/rules-and-standards/quality-practice/sleepover-shifts).

## Supporting technical and specialist evidence

The following is a reference for the people helping with the six areas. It is not another set of individual owner forms or a requirement to repeat checks already evidenced. Scope browser and capacity work to expected launch use; retain negative-path and recovery evidence where a failure could affect records, care or money. Local Node 22 regression results support code behaviour and do not certify the live website, provider accounts or business arrangements.

| Area | Concrete acceptance task | Owner / required evidence |
|---|---|---|
| Provider scope (A08) | Match certificate, conditions, held groups and marketed services to the actual provider and current platform-registration pathway. Check dates and applicable transition obligations with the regulator/adviser. | Accountable executive: exact certificate/conditions and dated advice. |
| Runtime (A11/A38) | Confirm the deployed runtime against the release record. Local automated checks have passed on Node 22.23.2. Use npm ci --ignore-scripts and npm run check for source verification; confirm deployment and recovery separately. | Operator: version, lockfile, command receipts. |
| Browsers (A11/A18/A19) | Prioritise the current desktop and phone browsers the launch users actually use; include worker, participant, helper and office journeys. Expand the browser matrix as use grows. Login/reset/MFA, Settings sections, menu, Next actions, upload/replace/remove, verification, calendar/visit/return, note retry. | QA: recordings and build/device versions. |
| Reflow and input (A17) | 320 CSS px, 200%/400% zoom, keyboard only, visible focus, menu Escape return, no hidden calendar Sunday; screen-reader names, error announcements, reading order, no colour-only meaning. | Accessibility reviewer with disabled users: task results and retests. |
| Preview fixtures (A19) | One- and multi-page PDF; scanned PDF; image page; rotated page; invalid/password PDF; JPG/PNG; generated HTML consent and support plan; missing file; expired/revoked session. Check original download bytes. | QA: fixture hashes and results; no real sensitive evidence in public test assets. |
| Care and incident (A04/A20) | Backdated awareness, harm/unknown/no-harm, weekends/holidays, missed deadlines, five-day filing, separate final request, duplicate filing and closure refusal. Prepare/independently approve excluded-support arrangement; change plan/time and require rereview. | Safeguarding lead: current procedure, duty coverage, notification-channel drill and fallback. |
| Finance (A09/A10/A25) | Check the actual agreed prices, items, jurisdiction, cancellation/travel/ratio/private-tax treatment and representative overnight cases below. Payroll must separately cover every worked period and applicable minimum engagements, overtime, broken shifts, allowances and leave. Compare independently calculated expected lines. | Finance/payroll specialists: dated authoritative rule references and reconciled fixture workbook. |
| Payments (A14) | Use local/provider test fixtures for failure, duplicate/reordered-event, partial-payment, refund and dispute checks. On this existing website, use only a genuine explicitly authorised transaction to establish live collection evidence. Reconcile actual provider events and the ledger; confirm onward bank settlement separately. | Finance: provider event/transaction references; no real payment assumed. |
| Mail (A13/A15) | Confirm delivery to an authorised real inbox. Use controlled fixtures for bounce/rejection, timeout/retry, digest, urgent request, resolved request suppression, revoked helper, opted-out routine email and exhausted follow-up. Use manual channel if critical delivery fails. | Operations: provider events, inbox evidence, escalation owner and actual contact drill. |
| Recovery (A07/A16) | Back up database and each file-bearing category; missing policy/outside root must fail. Restore a complete off-instance backup into an isolated temporary location, never over the current website; verify counts, bytes, permissions and representative flows. Record actual recovery time/data loss. | Operator: manifest/hash and measured RTO/RPO accepted by owner. |
| Security (A01–A06/A22/A23) | Independent review against current ASVS scope: object permissions, helper revocation, password/MFA recovery, stale sessions, file uploads/previews, injection, exports, CSRF, network egress, secret deployment and audit access. | Independent tester: scoped report and closure evidence. |
| Capacity (A24) | Owner first defines expected simultaneous users, peak uploads and acceptable p95 latency/error rates. Test 1× and 2× agreed traffic: calendar reads, logins, uploads, note saves, review/claim actions. Inject mail timeout, full disk, process restart and backup overlap. | Operator: measured latency/errors/event-loop/CPU/RAM/disk and zero lost/duplicate money, notes or decisions. No scale claim from local tests. |
| Real users (A43) | Small compensated cohort of participants, workers and helpers, including cognitive/vision/motor access needs. Complete onboarding, find missing file, replace one file, respond to request, find visit, recover draft and contact office without prompting. | Product: completion/time/errors/effort, participant feedback, blockers and retest. |


## Release decision

The accountable business owner records the deployed build/hostname, actual service scope, unresolved material issues, agreed continuity coverage and rollback arrangements. Use specialist evidence where applicable and preserve known limitations. Do not manufacture completed results to make the dashboard green.

The checklist records evidence; it does not submit regulator forms, issue legal approval, transfer money, prove a restored backup or open the website to the public. Website access controls remain separate. Avoid destructive demo cleanup or overwriting the running database while carrying out launch checks.
