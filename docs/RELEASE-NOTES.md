# The Care Web v88.2.0

11 September 2026. Complete source release based on v88.1.5. This implements the participant, worker and office process backlog J01–J26 and retains the earlier R1–R6 fixes. Existing artwork, videos, fonts and vendor files are retained.

## What changes for participants and helpers

- **Next actions** combines setup, reviews and follow-up with separate person and office responsibilities. Helpers see the selected participant and only permitted tasks and visit information.
- Private payment is an explicit funding choice. Unknown funding still needs confirmation. Office-reviewed private billing setup is required before private bookings.
- Shared details can prefill the support plan after confirmation. Section navigation and revision checks protect saved and unsaved plan text, including multiple editors and slow saves.
- Matching retains schedule choices. Unavailable times offer limited alternatives that are checked again on booking. Book again and usual visits remember preferences without copying old care notes or prices.
- Timesheets have one review inbox, an exact visit workspace and a preferred reminder recipient. First meetings and first shifts produce separate follow-up tasks; concerns become office work.
- Optional quiet hours, routine digests and private calendar subscriptions reduce repeated administration. Changes and endings have a reviewed handover covering visits, outstanding notes, queries, invoices and helper access.

## What changes for workers

- Setup separates missing documents, training and office decisions. The upload tray keeps successful files when another upload fails, detects repeat uploads and explains document purposes.
- Recruitment has explicit interview, references and employment evidence. Workers can book or cancel available interview slots and rebook after a past interview.
- Repeating requests can be reviewed together and selected dates accepted atomically with fresh plan, availability and travel checks.
- Leave shows affected visits before saving and requests cover only for the selected visits. Existing work remains visible. A voluntary profile pause permits eligible accepted work while safety withdrawals and cover restrictions remain enforced.
- The visit workspace contains the permitted brief, changes since the worker's previous acknowledgement, saved note draft, actual active hours, participant transport, completion, questions and a linked incident form.
- Renewals show affected future visits and distinguish a replacement received from an approved replacement. Pay status distinguishes batch preparation, export and a recorded external payment reference.

## Office work and automation

The complete task queue is paginated and searchable, with assigned owners and due dates. Timing begins when a stage is observed ready. Jobs retain their lock until asynchronous work settles and record failures truthfully.

Email uses a durable outbox, retries, deduplication, access/opt-out rechecks and an office exception queue. Invoice creation, its original payer/amount snapshot and queued delivery are committed together. Reconciliation keeps mismatched receipts unpaid; signed Stripe evidence must match the stored checkout session, amount, currency and paid status.

Pay batches use globally stable source-line IDs, reviewed exceptions and adjustments, repeatable CSV exports and a separate external acknowledgement. Scheduled preparation is off until the office confirms the payroll cutover. This code does not submit a bank transfer or operate an external payroll system.

Optional document extraction requires configured processing, office approval and worker consent. Suggested fields show source text and confidence and require human review. It never verifies a clearance. Process reports show task median/P90 waiting times and activity/recovery events by reporting period, without care text.

## Delivery and limits

Default schema **88200**; **360 registered routes**, **77 tables** after boot. The v88.1.5 database has 57 tables; this release adds 20 and additive columns. The two-boot upgrade check retained synthetic pre-existing records, settings and an uploaded-file sample. Do not replace production runtime data with package contents.

This package is source code, not a live deployment. Review `TEST-RESULTS.md` and `WORKFLOW-OPERATIONS.md`. Native browser interaction and external email, calendar clients, Stripe and AI provider round trips still require staging validation. Test results do not certify current regulatory requirements or external payroll calculations. Existing pricing rules are retained; no new tax or wage rates were sourced for this release.
