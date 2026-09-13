# The Care Web v88.4.1 — participant addresses and visit locations

Participants previously had a suburb field but no dedicated private address or agreed meeting location on a booking. Worker profiles also omitted their declared service areas. This release adds address settings, a location saved separately for each visit and clearer worker coverage information.

## Participant and booking workflow

- Adds **Settings → Address & arrival details** for unit, street, suburb, state, postcode and relevant parking/access instructions. The participant’s profile links to these settings.
- Adds **Where will support start?** to booking creation: **Saved address**, **Another address**, **Community meeting point** or **Confirm later**.
- Saves a separate location for each booking. Later changes to the participant’s default address do not move existing visits.
- Adds a **Support location** panel to booking views and the visit workspace, with explicit changes for eligible upcoming visits and revision checks against stale forms.
- Keeps missing location details visible without adding a browsing, booking or invoice block. Historical bookings start with their available locality and an unconfirmed location rather than an invented street address.
- Explicit upcoming-visit changes queue a worker notice linking to the booking. The notification contains no private street address or arrival instructions. **Confirm location seen** records the assigned accepted worker’s acknowledgement without adding a booking or payment hold.

## Location privacy and worker profiles

- Stores private addresses and booking locations separately from broad user/booking responses.
- Permits the participant, active authorised helpers with booking access and the office to manage relevant details.
- Gives a requested worker only the visit locality. The currently assigned worker can see full location and arrival instructions on accepted/completed visits; unrelated workers and cover previews do not receive them.
- Adds a user-initiated **Directions on Google Maps ↗** link for authorised full-location viewers.
- Shows **Based in** and **Areas I cover** on worker profiles. Worker residential addresses, live GPS tracking and claimed arrival times are not added.
- Retains existing out-of-area checks and their planning-estimate wording.

## Guide and release

`docs/USER-GUIDE.html` is based on the latest guide supplied by the user. Its corrected travel-estimate explanation and Google Routes setup instructions are preserved. New current sections cover address settings, booking locations, worker service areas and the associated access rules. `docs/LOCATION-PRIVACY-v88.4.1.md` records the location workflow and its limits.

The cumulative update applies over **v88.3.4 or v88.4.0** and includes the v88.4.0 payment, invoice, bank-matching, notification and payroll-status work. Merge the changed files into the existing repository according to the update package instructions; preserve the database, uploads and protected environment settings. Do not replace the whole repository with the changed-files ZIP.

Use the final package verification report for the exact automated results and supported upgrade baseline. This changelog does not claim that the deployed interface, real notification delivery or a real meeting address has been verified.
