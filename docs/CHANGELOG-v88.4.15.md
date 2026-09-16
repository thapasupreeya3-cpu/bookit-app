# v88.4.15 — Whole weekday evening pricing

Current-update-only ZIP over v88.4.14. No unchanged media or vendor files.

## Pricing

New ordinary weekday support finishing after 8 pm and by midnight uses the
configured evening rate for its whole continuous weekday interval. The
19:20–22:20 example now has one 3-hour evening line at $81.07, total $243.21.
The configured dollar prices are unchanged; only the evening-rate application
method changes. The applicable evening support item accompanies the line.

Finishing exactly at 8 pm remains daytime. Finishing exactly at midnight is
evening. The existing weekday-night rule takes precedence before 6 am or when
support continues after midnight. Actual weekend, public-holiday and partial
holiday intervals remain separate. Fixed employment/household rates and flat
inactive sleepovers retain their existing treatment.

Quote explanations appear before requesting a booking and in the saved rate
breakdown. Repeating dates show their own explanations. Changed pricing terms
are included in the signed quote key and the interface's refresh comparison.
An outdated quote receives the existing refresh-and-review response.

## Previously booked support

Startup adds bookings.pricing_policy. Existing rows use their earlier method;
a server-owned insert trigger assigns the new method to new records, including
creation paths without a public quote. Repeated startup preserves classification.

Matching recorded quotes preserve their originally displayed lines and amounts
when support is completed or automatically priced for cancellation. An old
$238.21 quote is not silently increased to $243.21. A saved quote for different
booking details is historical; it is not reused as a new agreement. Existing
bookings without a usable snapshot are calculated under the earlier method.

Completed charges, approvals, invoice snapshots and payment history are not
repriced by installation. Deliberate office corrections retain their existing
approval controls. No new blanket finance or holiday-review gate is introduced.

## Scope and verification

Schema identifier: 88406. Existing acceptance notices, homepage changes and
worker task readiness improvements remain. Follow UPDATE-INSTRUCTIONS.txt on
the existing website. The guide includes the new rule and examples without
naming another provider.

This is participant billing logic, not a wage calculation or proof of funding
eligibility. Structured overnight entitlement and individual negotiated-price
checks remain separate outstanding work. Configured September 2026 dollar
prices are unchanged; the older supplied PDF does not certify those prices.

See TEST-RESULTS.md and the package verification report for actual checks.
Rendered browser appearance and real email delivery remain unverified. This
release has not deployed the site or issued real invoices, payments or emails.
