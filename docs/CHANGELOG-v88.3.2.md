# The Care Web v88.3.2 — automatic holidays and approval-to-invoice processing

The previous release added finance and holiday review gates that made a routine completed shift wait for office setup. Those gates are removed. The system now calculates applicable NSW holidays and supported time/date price boundaries and starts invoice processing directly after participant approval.

## Changes

- Official NSW state/local holiday snapshots, daily refresh, saved fallback and future statutory state dates. Calendar source failure is a notice, not a billing hold.
- Itemised date/time lines for ordinary supports, including overnight and DST transitions. A Friday evening part and the following Saturday receive their respective categories; ordinary weekday overnight support uses its night category. Appropriate holiday items are selected automatically.
- Corrected weekday sleepover additional active hours to the Saturday minimum category. NSW public holidays also feed business-day deadlines and standby holiday classification.
- Removed blanket A09, reviewed-calendar, exceptional-type and private-ready approval holds. Genuine missing data, disputed timesheets, explicit holds and stale manually edited charges remain visible.
- Participant approval queues invoice creation immediately; existing deemed approvals use the same handoff. The durable billing queue recovers after restart and retries automatically. Background recovery runs every 15 seconds.
- Invoice PDF email is transactional: no digest/quiet-hour delay and no terminal five-attempt limit. Failed invoice delivery continues with bounded backoff. Resend receives a stable idempotency key; SMTP receives a stable message ID.
- Repeated approval is idempotent. Concurrent manual and automatic runs are serialized; issued invoice snapshots and outbox event identities are retained.
- Compact automatic-billing status replaces the setup form. Itemised charges are visible before approval. Delivery and pending-job states remain visible to the office.
- A complete first-party source block register, all-branch appendix, workflow explanations and updated full user guide are included. Existing branding, media, PDF viewer assets, document controls and calendar navigation are retained.

## Apply

Extract **The-Care-Web-v88.3.2-automation-update-only.zip** and merge its contents into the existing **v88.3.0 or v88.3.1** repository root. Replace matching files while keeping other folder contents and runtime data. Redeploy and refresh. The default `/api/version` becomes **88.3.2 / schema 88302**. No source files need deletion. If your host explicitly overrides the schema identifier, update that override too.

**On restart, already-approved unissued visits are eligible for automatic processing.** Explicit holds and disputed timesheets remain excluded. Existing approved amounts are preserved, not retrospectively recalculated. A working email transport is required to deliver queued invoices; this update does not add credentials or access your live accounts. Keep the existing NSW service timezone, `Australia/Sydney`, correctly configured.

Open **Admin → Money → Claims & payments** to see automatic billing. There is no holiday/finance setup checkbox to approve. Run claims & invoices is an optional catch-up action. Check email delivery shows what is queued, retrying or sent. NDIA claim-file preparation is automated; authorised external portal submission remains separate.

## Complete block list and guide

- `docs/block-register/index.html`: searchable explicit source entries, including file, line, trigger and effect.
- `docs/block-register/register.csv` / `.json`: full explicit register.
- `docs/block-register/branches.csv` / `.json`: every conditional/short-circuit, switch and stop/return branch, including nonblocking branches for completeness.
- `docs/BLOCKS-AND-AUTOMATION.md`: remaining decisions by workflow, removed gates and coverage limits.
- `docs/USER-GUIDE.html`: the full guide updated for the recent releases and this automatic workflow.

This is a source-based register, not a claim to have observed every active setting or record on the deployed site. Access controls, actual consent, worker clearance/suitability, disputed delivery, payroll/refund approval and real external submission/payment evidence remain deliberate decisions.

## Validation and limits

The full automated suite passed on **Node 24.19.0**, including **26 billing scenarios** (11 focused checks and 15 API journeys), 42 workflow, 46 verification, 11 Settings, 10 navigation, 17 credential, 13 Next actions, 13 calendar and 22 launch scenarios, plus the existing smoke/review/audit/graphics suites.

Tests include the reported $310.62 Saturday charge, automatic holiday/substitute dates, rate boundaries, DST, actual worker completion → participant approval → invoice/PDF outbox entry, duplicate approval/concurrent runs, recovery after restart, missing payer correction, a source outage, more than five email failures, and retained invoice snapshots. Transport tests use synthetic stubs; they do not prove delivery to a real inbox.

Two synthetic upgrades from v88.3.1 preserved records and uploaded bytes, with passing database integrity and foreign-key checks. The new installed schema has **92 tables and 386 registered routes**. ZIP overlays are checked against both supported baselines.

Chrome refused the local site with **ERR_BLOCKED_BY_CLIENT**, so native browser appearance is unverified. The declared Node 22 runtime, deployed integrations and real operating/clinical/finance acceptance remain staging checks, not invented approvals. Automatic holiday feeds currently cover NSW; local matching uses recorded place names rather than council-boundary geocoding. Non-NSW official feeds and detailed overnight active-period timestamps are not implemented; see the register's calculation limits.

Sources: [NSW public holidays](https://www.nsw.gov.au/about-nsw/public-holidays), [NSW local holidays](https://www.nsw.gov.au/about-nsw/public-holidays/local-public-holidays), [NDIS pricing arrangements/current schedule](https://www.ndis.gov.au/providers/pricing-and-payments/pricing/pricing-arrangements), [NDIS detailed time-band rules in the linked 2025–26 arrangements](https://www.ndis.gov.au/media/8096/download?attachment=), [Resend's 24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys).
