# v88.4.14 — Booking acceptance notices and opening scene

This current-update-only ZIP applies over v88.4.13. It preserves the worker
readiness fixes and includes no unchanged media or vendor files.

## Booking acceptance

Participants now receive a persistent green notice inside the website when
their worker accepts a new booking. It shows the worker, date and time, with
View booking opening the exact visit workspace from either Calendar or List.
Multiple confirmations stay in one compact panel. The notice stays in view
without moving the page. Dismiss is per signed-in viewer and persists across
sessions; simply fetching or viewing the page does not mark it read.

Currently authorised helpers can see updates for their selected participant.
Access is checked again for reads and acknowledgments. Removed permissions,
closed accounts, cancellation, changed booking details, worker changes and
superseded acceptances cannot leave an actionable old confirmation. Updates
are recorded with the acceptance transaction and do not depend on a valid
email address, email preferences or successful email transport.

The visible, connected site polls every 15 seconds and refreshes on sign-in,
navigation, focus and return to the page. This is an in-site notice, not a
phone/operating-system push notification. Existing confirmation emails remain
independent. Historical accepted bookings are not mass-announced at upgrade.

## Homepage and pricing explanation

Removed the opening park clip and fictional worker/shift confirmation cards.
The six service clips, search, headings and account buttons remain. Existing
media files are retained on disk but not included again in the update ZIP.

The guide explains the current 7:20–10:20 pm example: $49.05 daytime plus
$189.16 evening, totaling $238.21 at the configured rates. It distinguishes
ordinary evening support from an active overnight arrangement. A whole-shift
evening calculation would be $243.21 at the same $81.07 hourly rate.

No rate, charge calculation, support-item mapping or issued invoice changed.
The supplied 2025–26 pricing document distinguishes the agreed charge from its
maximum limit and has specific rules for one worker crossing a rate boundary.
A lower total alone does not certify claim-item mapping. This release does not
add participant overnight-entitlement or individually agreed-rate checks.
September 2026 dollar limits are not independently certified by the older PDF.

## Installation and verification

Startup adds booking_acceptance_updates and booking_acceptance_reads, with
indexes and invalidation triggers. Schema identifier: 88405. Existing data is
retained. Follow UPDATE-INSTRUCTIONS.txt on the existing website.

See TEST-RESULTS.md and the accompanying package verification report for the
checks actually run. The browser returned ERR_BLOCKED_BY_CLIENT for the local
preview; rendered layout remains unverified. This update has not deployed the
site or sent real emails, processed payments, or altered participant prices.
