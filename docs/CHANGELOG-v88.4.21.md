# v88.4.21 — Calendar postcode search

Entering a four-digit postcode in the popup's visible Search field now requests
carers for that postcode, instead of filtering only the already loaded home-area
list. Other filters remain active, and matching recent carers remain first.
Clearing the search restores the chosen visit area or saved home area. Changed
or stale searches cannot enable a booking from an outdated result set.

The shared area matcher now accepts a bare postcode against a service area that
explicitly contains that postcode, in either direction. For example, 2170 matches
Liverpool NSW 2170. Matching remains based on recorded data: no postcode is
inferred from a suburb-only name, partial numbers do not match and different
fully named suburbs or conflicting states remain distinct.

Demo carers remain excluded from the booking popup. Find workers can display
those profiles with a Demo badge, which explains why the same example carer may
be visible there. Real profiles still need current booking eligibility, selected
day availability, applicable service areas and the selected filters.

Search does not change a saved address or the final booking location. Confirm
that location in the booking form. The user guide explains postcode search,
service-area records and demo visibility.

This cumulative update includes all calendar, email and shift-note fixes through
v88.4.20. Apply over supplied v88.4.17 or updates v88.4.18–20. No live deployment
or external emails/payments were performed.
