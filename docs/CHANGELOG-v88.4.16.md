# The Care Web v88.4.16 — care routine

Apply this changed-files-only ZIP over **v88.4.15**.

## What changes

- **Bookings → Care routine** brings regular support into one focused view. Participants and authorised helpers can add weekly or fortnightly patterns, inspect actual future weeks and open an individual visit. Different days or workers use separate patterns.
- Select a pattern to see its own details and future visits. Requests, confirmed support and cover issues have distinct labels. Existing change/end and individual-visit controls remain available.
- Recurring requests preview every proposed date using the same server validation and prices as booking creation. Skip dates before sending; the count and total follow the selection. A request creates all selected visits together or reports the problem without partial creation.
- Patterns are limited to 26 proposed dates and stop at the selected end. **Continue this routine** prepares a fresh request with current prices and availability. No automatic indefinite renewal or silent reservation is introduced.
- Duplicate submissions are guarded in the form. Durable participant-scoped request receipts return the same booking IDs after an unchanged retry, without queuing another request notification.
- Existing whole-weekday evening pricing, inactive sleepover pricing, saved historical quotes, acceptance notices and payment workflows remain in place.

## Installation

Merge into your existing v88.4.15 repository and redeploy the same website. The new booking_request_receipts table is additive; schema identifier is **88407**. Keep runtime data, uploaded files and configuration. The ZIP includes the revised guide.

## Verification

See docs/TEST-RESULTS.md and the accompanying package-verification JSON for executed checks. Synthetic HTTP tests block external sends and use disposable records. The local browser preview was blocked with ERR_BLOCKED_BY_CLIENT, so rendered browser appearance remains unverified. This source update has not been deployed and no real booking, email or payment was created.
