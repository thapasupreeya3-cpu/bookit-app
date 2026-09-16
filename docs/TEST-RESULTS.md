# v88.4.20 validation — booking emails and shift-note workspace

Validated locally on Node **24.19.0**, using synthetic identities, disposable
SQLite databases and local provider fixtures. The deployment runtime remains
Node **22.23.2**; it was not available here. No real customer email, payment or
live deployment was performed.

All test groups in `npm test` passed across the broad run and targeted follow-up
runs. The broad run stopped at one obsolete booking-update expectation: it
expected a missing participant email to silence an authorised helper too. The
assertion now checks that the helper receives the notice while the participant's
in-site confirmation remains available. That group and every remaining group
passed. The final legacy-payment fix was then verified with its three affected
suites; already-passing unrelated groups were not repeated.

Key final results:

- Booking/shift notification unit checks: **30/30**.
- Actual booking HTTP transitions: **22/22**, including rollback when notice
  persistence fails, completion across funding routes, query retries, answers,
  reminders, automatic approval, cover and restart.
- Immediate invoice flow: **13/13**.
- Delivery outbox: **16/16**; production transport functions: **6/6**, including
  Resend provider rejection/timeout and SMTP acceptance/rejection/timeout.
- Email diagnostics over real local HTTP: **10/10**. Provider responses are
  synthetic; success establishes the acceptance path, not inbox delivery.
- Final payment automation: **49/49**; invoice-link mail: **14/14**; payment HTTP:
  **11/11**. Includes old queued failure messages after replacement checkout.
- Payroll notifications: **11/11**; payroll recovery: **3/3**; invoice lifecycle:
  **17/17**; invoice queries: **18/18**.
- Shift workspace: **7/7**; navigation position: **21/21**; admin workflow UI:
  **29/29**. Covers editor order, focus/reveal after navigation and completion,
  requested answers, drafts and stale asynchronous updates.
- Booking acceptance updates: **15/15**; acceptance UI: **20/20**.
- Existing calendar, carer picker, ongoing recurrence, pricing, access, account
  email, approval, billing and remaining regression groups passed.
- Syntax: **163 scripts**, including four inline application scripts, compiled
  without failure. Route/table inventories and generated release documents
  verified: **419 routes**, **113 tables**, schema **88408**.
- User guide navigation anchors and the new workflow sections checked.
- Release verification checks every installed file hash. ZIP overlay verification
  compares the whole installed tree after applying to v88.4.17, v88.4.18 and
  v88.4.19, with unchanged source files retained.

Browser rendering remains unverified: the session browser could not open the
local preview (`net::ERR_BLOCKED_BY_CLIENT`). The UI results above are component
and navigation harness checks, not rendered browser acceptance. Live provider
configuration, recipient preferences and inbox delivery must be checked on the
deployed site; this review cannot establish which caused the reported live issue.

---

# v88.4.19 validation — compact calendar popup

- Existing carer popup checks: 14/14 passed.
- Existing booking calendar checks: 19/19 passed.
- Syntax: 160 scripts compiled; zero failures.
- Independent accessibility review completed; optional visit fields reveal
  themselves before validation and expanded profile content uses the dialog's
  normal scroll area, without a keyboard-inaccessible nested scroll panel.
- No new tests were added for this presentation refinement; existing behavioral
  checks were reused. No backend or pricing changes were made.
- Browser rendering remains unverified because this session's browser cannot
  open the local preview. No live deployment was performed.
- Package verification checks that the cumulative ZIP overlays both the original
  source and the earlier calendar update, with all release hashes matching.

The earlier release evidence below is retained and was not rerun in full for
this layout refinement.

---

# v88.4.18 validation — calendar bookings

Checked locally on Node 24.19.0 using synthetic accounts and disposable SQLite
records. The project's deployment runtime remains Node 22.23.2; it was not
available in this session. No live website was changed.

- Calendar interaction: 19/19.
- Carer popup: 14/14; authenticated carer endpoint: 9/9.
- Care routine UI: 28/28; booking submission/recovery: 13/13.
- Pricing UI: 42/42; care routine HTTP flow: 17/17.
- Ongoing HTTP flow: 12/12; independent ongoing review: 17/17.
- The new five-year cold-restart case creates future occurrences beyond 260
  without manually extending the rule, duplicating visits or altering old quotes.
- Syntax: 160 scripts, including 4 inline scripts; zero compilation failures.
- Generated route/database inventories and release documents verified:
  419 routes, 113 tables; schema unchanged at 88408.

All npm test groups passed across the broad run and follow-up runs. The first
broad run stopped at the pre-existing document verification group after a local
server connection failure (37/51); that group then passed twice in isolation
(51/51 each). Its original server stderr was unavailable, so the transient cause
is unconfirmed. All remaining test groups completed with no failures.

Browser preview of the local test server was blocked by the browser environment
(net::ERR_BLOCKED_BY_CLIENT). Rendered layout was therefore not visually verified.
Native dialog interaction is covered by the component harness, not a browser.
The source ZIP has not been deployed or tested against live user data.

The tests cover participant/helper permissions, newest-connection order, exact
service-area matching, all shared directory filters, time checks, past dates,
keyboard/calendar handoff, stale requests, escaped content, one-off defaults,
ongoing/end-date selection, cancellation and restart continuation.

---

The following is the retained validation record from the supplied v88.4.17;
it is historical evidence, not a claim about the new runtime or release.

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
