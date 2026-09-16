# v88.4.18 — Calendar bookings

Clicking a current or future date on the main booking calendar opens a carer
chooser. Cycle through newest connections first and then local carers, with the
same service, day, language, gender, rating, sort, search and interests filters
as Find workers. An optional whole-visit availability check uses the selected
date, start time, duration and locality.

The shared booking form highlights Repeat this booking. One-off remains the
default; weekly and fortnightly can repeat until cancelled or a chosen end date.
The separate Care routine tab is removed. Existing routines can be managed via
the calendar's Manage recurring bookings link.

Ongoing is an indefinite saved rule. Future requests continue automatically;
the limited preview is only the next requests, never the total routine length.
A regression verifies restart continuation five years later, beyond 260 visits.

The new carer endpoint honours participant and helper booking permissions,
uses real public profiles, and excludes blocked or unbookable workers.
Unknown locality asks for a suburb instead of guessing nearby carers.
No pricing rules changed. This source package does not deploy the live website.
