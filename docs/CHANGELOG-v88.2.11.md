# The Care Web v88.2.11 — booking requests and calendar

Built on v88.2.10. Previous Credentials status colours, individual file controls, compact navigation and Next actions refinements are retained.

## Worker request warning

- A small red count appears beside Bookings and on the mobile menu button for future unanswered worker booking requests. Each relevant booking is labelled “Response needed”.
- Opening a request does not dismiss the badge. Accepted, declined, cancelled, voided and already-started requests do not count. Requests currently being handled through the cover process do not count as a direct worker response.
- The count refreshes after booking actions, sign-in and returning to the visible page, and approximately every 30 seconds while the site is visible. It is an in-site indicator, not an operating-system push notification. No new emails or SMS are sent.
- A compact “Go to next request” link takes the worker to the nearest request date, including another month. Clicking it refreshes even when it points to the current URL.

## Calendar for workers and participants

- Bookings has a compact Calendar / List switch. Calendar is the default for workers and participants; the existing office list remains available.
- Month and week views include Previous/Next, Today, Go to date and Refresh. Today is resolved by the server's site date, including after midnight.
- Select a day to see the times, person, service and status of its visits. Open booking or Review request opens the existing controls for that exact record. The selected day/view is remembered while navigating within the same signed-in account.
- Confirmed, requested and completed visits have distinct markers and labels. Cancelled/declined visits can be shown using a checkbox. Status is not communicated by colour alone.
- Overnight visits appear on each occupied date. Exact-midnight endings do not create a visit on the following day. Server-computed end times handle Sydney daylight saving and sleepovers.
- The calendar queries only its visible date range, without the old 400-row list cap. A focused booking request also works for older records outside that cap.
- Calendar records use the existing participant/worker ownership checks. A helper needs active booking permission for the selected participant; revocation takes effect on subsequent reads. Calendar payloads omit care notes, billing details and document contents.
- Keyboard arrow keys select days; Home/End select the week boundary. Controls adapt to narrow screens, and focus is preserved when changing the date/view. Failed or timed-out requests offer retry.
- Existing external calendar subscriptions remain under notification settings. Viewing this calendar does not create or share a subscription.

## Technical scope and validation

Two authenticated, read-only routes are added: `/api/me/booking-alerts` and `/api/bookings/calendar`. The existing `/api/bookings` endpoint accepts an optional scoped `booking` ID. Booking decision, billing, verification and eligibility rules are unchanged. No new schema, runtime dependencies, artwork, media or fonts are required.

Focused tests cover badge lifecycle, participant/helper isolation, revocation, date validation, leap years, daylight saving, overnight carry-in, busy calendars above 400 rows, exact booking links, keyboard/date controls, stale responses and retry. See `docs/TEST-RESULTS.md` for the executed full gate results.

`docs/booking-calendar-preview.html` contains fictional worker and participant examples. Account/booking mutations are disabled in the preview. The preview script and production component were checked in a VM; no real-browser appearance or screen-reader certification is claimed. Local browser access remained blocked in this session. No live site was deployed and no real messages or payment transactions were sent.

## Install and use

Apply **The-Care-Web-v88.2.11-booking-calendar-fix-only.zip** over v88.2.10. Extract it, merge its contents into the existing repository root, replace matching files and redeploy normally. `/api/version` should report **88.2.11**. No files need deletion and there is no schema change from v88.2.10.

If earlier updates were skipped, use **The-Care-Web-v88.2.11-all-updates-only.zip** instead and follow its included instructions. Apply only one update package. Keep live databases, uploads and configuration, and compare separately with newer repository edits not supplied here.

Open Bookings as a worker and participant. Check Calendar/List, a day with visits, an overnight visit, and a worker request badge. Open the request and use the existing acceptance/decline controls. Verify deployed phone/desktop layout and keyboard use.
