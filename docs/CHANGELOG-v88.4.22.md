# v88.4.22 — Location orders carers without exclusions

The calendar popup retains every otherwise eligible carer regardless of area.
Location now changes order only: matching public profile suburbs or declared
service areas first, then other known areas by distance, then unresolved areas.
There is no radius limit. Recent connections break ties within the same location
ranking, followed by the selected sort option.

Nearby ordering uses the existing Australian suburb/postcode centroid data.
It does not compare postcode numbers or invent a worker's current position.
Suburb-only profiles can receive a proximity rank from known locality data;
unrecognised or ambiguous locations remain in the list with unknown distance.
No new external service or credential is required.

The compact popup keeps Service and Location visible. Search carers by name is
separate under Filters & visit details. Entering a location cannot act as a text
filter that removes other areas. Clear all filters retains the location priority;
clear Location to return to the saved visit/home area as the ordering reference.

Check this visit still checks the whole time interval and diary conflicts, but
retains out-of-area carers. Viewing or selecting one does not supply travel
consent or change the booking address. The final booking process retains its
existing out-of-area confirmation and worker acceptance rules. Non-location
filters and eligibility checks remain in effect.

The user guide is updated. This cumulative repo-root ZIP includes the previous
calendar, email and shift-note changes through v88.4.21. No live deployment was
performed.
