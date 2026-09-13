# The Care Web v88.4.2 — clearer Admin navigation

Office work previously shared broad screens containing unrelated lists and forms. Invoices, payment setup, payroll, records and operational checks were difficult to find. This release gives Admin seven named sections, a tool search and focused pages.

## Navigation and pages

- Adds **Today, People, Bookings, Money, Records, Reports** and **Settings**, with the same navigation across the office overview, verification, payments, workflow and launch/incident pages.
- Adds **Find an admin tool**, with named results, keyboard navigation and a compact expandable menu on smaller screens.
- Separates Invoices, Received payments, Payment exceptions and Payment connections. Invoice rows link directly to **Invoice history & withdrawal** through **Invoice actions**.
- Separates NDIA claims, Unissued charges, Additional charges, Worker pay, Corrections & refunds and Finance evidence.
- Moves referrals and participant creation into People, performance into Reports, group-booking controls into Bookings and business configuration into Settings. Personal account settings remain separate.
- Gives complex tools focused sections, including pay batches/preparation, receipt evidence, charge corrections/refunds, AI suggestions/settings/consent, pay-rate comparison/tiers/settings/history and individual business-settings forms.
- Adds record search, filters where applicable and paged lists. Counts describe loaded records and the existing endpoint limits; pagination does not imply complete historical retrieval.
- Uses focused loading and retry messages. Navigation does not submit an action or change a record.

## Existing workflows preserved

The release reorganises the interface and documentation. It does not change financial rules, backend payment processing, permissions, invoice-approval requirements, withdrawal/reconciliation behaviour, payroll approval or provider confirmation. The prior payment automation and private participant/visit locations remain included.

## Documentation and installation

Updates `docs/USER-GUIDE.html` throughout to use the current office paths, with a new Admin walkthrough and explicit loaded-record limits. `docs/ADMIN-NAVIGATION-v88.4.2.md` lists all current tools, routes and common tasks. The supplied corrected travel-estimate and Google Routes setup section is preserved.

The cumulative changed-files update applies over **v88.3.4, v88.4.0 or v88.4.1**. Merge it into the existing repository; preserve the live database, uploads and protected environment settings. Do not replace a whole repository with a partial update ZIP.

Use the final package verification report for automated results and upgrade checks. Deployed browser appearance, real message delivery and live payment-provider behaviour require their own evidence; this changelog does not claim those checks passed.

## Validation

The full automated suite passed, including 106 new Admin checks. The main Admin renderer was exercised against real responses from a disposable local server. Checks include preserved incident owners, invoice actions, evidence history, task destinations, search/pagination, stale-response protection and explicit loading errors. Browser preview returned `ERR_BLOCKED_BY_CLIENT`; rendered layout remains unverified.
