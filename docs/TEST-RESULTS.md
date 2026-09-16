# v88.4.17 validation

Validation was performed against synthetic accounts and disposable databases, with external services blocked in the new HTTP and upgrade fixtures. No live bookings, emails, invoices or payments were created.

- Full `npm test`: **PASS**, Node **22.23.2**, 135.08 seconds.
- New ongoing routine API scenarios: **11/11**.
- Independent routine, privacy and failure-recovery scenarios: **17/17**.
- Booking price UI: **42/42**; care routine UI: **25/25**; booking submission/retry: **13/13**; service location UI: **21/21**.
- v88.4.16 → v88.4.17 upgrade: **10/10**, including two successful updated server starts, preserved historical prices, paid invoice bytes, request receipts and uploads, and unchanged finite routines.
- Syntax: **157 scripts**, including **4 inline application scripts**, compiled without failures.
- Generated inventory and release documentation checks passed: **418 routes / 113 tables**, schema **88408**.
- The release package verification compares the complete ZIP overlay against the GitHub-verified installed baseline and checks every release file hash.

## Behaviour checked

Ongoing requests continue beyond 26 visits. A long end date is accepted without creating years of requests at once. End dates are inclusive for visit start dates. Weekly/fortnightly calendar dates remain stable across daylight-saving changes; invalid local times remain visible.

The generation ledger prevents duplicate requests after repeat runs or restart, and preserves skipped, cancelled and moved occurrences. Downtime does not fabricate past shifts. Each new request uses current eligibility, permission, conflict and price checks. Closed accounts, revoked helper access, blocked worker relationships and worker review requirements cannot silently generate more visits.

Existing prices remain intact; new visits receive current dated quotes. Inactive sleepover and exact agreed location snapshots remain separate from hourly support. Continued out-of-area requests still require the existing travel checks. Recheck offers a fresh signed confirmation for the exact displayed dates. Changed locations or outstanding dates invalidate stale proof; diary conflicts still block. Background generation does not reuse per-date consent. The native and fallback dialogs name the dates and explain that later dates need fresh confirmation. Finished routine labels also have regression coverage.

One routine's temporary failure does not starve other routines. Failed future dates appear in the selected routine and participant Next actions. An already committed edit returns success and a continuation warning if its later generation fails. Participant de-identification removes private routine addresses and disables extension.

## Limits of verification

The prior browser attempt could not open the local app (`net::ERR_BLOCKED_BY_CLIENT`), so rendered layout and live browser interaction remain unverified. The update has not been deployed. Real email delivery, provider connections and customer payment behaviour were not exercised by this feature update.
