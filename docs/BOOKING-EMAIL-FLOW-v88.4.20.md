# Booking-to-payment email review — v88.4.20

Reviewed the supplied source and exercised synthetic accounts, the durable
outbox, local HTTP provider fixtures and the production transport functions.
No live provider credentials, customer accounts or inboxes were available.
This source update has not been deployed.

## Events and recipients

| Event | Recipients and action |
| --- | --- |
| Single or recurring booking requested | Participant and helpers with booking permission receive a receipt; assigned workers review the requests. |
| Accepted or declined | Participant and helpers with booking permission receive the outcome. Normal shift completion no longer invalidates an unsent acceptance receipt for the same accepted arrangement. |
| Changed, reassigned, cancelled or series ended | Affected participant, authorised helpers and workers. A removed worker is told the assignment changed; the new worker reviews the changed request. |
| Regular cover confirmed | Participant, authorised booking helpers and covering worker. |
| Chargeable shift completed | Worker gets a saved submission receipt; selected reviewer(s) get a distinct completion/review notice. Invoice delivery is independent. |
| Meet-and-greet completed | Worker, participant and authorised booking helpers; no chargeable-shift invoice. |
| Approved or questioned | Worker gets the approval or a link to the private question. Existing office query alerts remain. |
| Answer or note addendum | Selected reviewer(s) get a link to the protected record. Payment remains paused until explicit resolution and approval. |
| Review reminder | Selected reviewer(s), after three days and only while that review cycle remains pending. |
| Automatic approval | After seven days without a query: participant, authorised booking helpers and worker, for the current approved cycle. |
| Invoice issued | Recorded payer receives the invoice. Self-managed/private support uses immediate issue with review before payment; plan-managed support uses approval before issue to the plan manager; NDIA uses its claim workflow. |
| Invoice withdrawn/reissued | Original recorded payer receives withdrawal information. Reissue has a new number and delivery identity; historical snapshots are retained. |
| Payment failed | Payer receives one notice for a genuine failed payment attempt. Routine checkout cancellation or expiry alone does not send a failure email. |
| Payment reminder | Recorded payer, while due, approved, unpaused and outstanding; no reminder during processing. |
| Payment received | Recorded payer receives the payment receipt and remaining balance. |
| Worker pay stages | Worker receives relevant prepared/exported/acknowledged updates. These messages do not claim an unverified bank transfer. |

Timesheet review-owner nomination limits completion-review, answer, addendum
and reminder notices to the nominated reviewer. Otherwise, the participant and
helpers with booking permission are eligible. Booking and timesheet opt-outs
remain respected. Booking links open the individual visit. Grouped helper notices open a visit
with the correct participant selected; other grouped and removed-worker notices
open Bookings. Shift links open the exact visit workspace.
Administrators do not receive a copy of every booking by default. New shift
notifications link to private notes and questions without copying their text
or arrival details into email.

## Delivery defects corrected

- Completion no longer relies on an invoice email to notify the reviewer, and
  workers receive a distinct saved receipt. Meet-and-greet completion is covered.
- Booking/shift state transitions and their queued events use transactions;
  a failed queue write does not silently leave the action without its notice.
- Review, reminder, answer, approval and payroll notices are transactional, so
  digest schedules and quiet hours do not delay them.
- Timesheet/payroll messages continue retrying after five failures. Startup
  recovers retained failed payloads and promotes relevant delayed review/payroll
  notices. Current access, preferences and task relevance still apply.
- Provider idempotency keys remain stable across retries, including messages
  that originally omitted an explicit event key. Concurrent outbox wakes share
  a delivery pass, and stale claims cannot bypass a newer retry delay.
- A helper's unrelated account-link change no longer cancels an otherwise
  authorised booking notice. Revoked access, account closure, changed recipient
  address and assignment changes continue to suppress affected messages.
- Related provider failure events share a payment-attempt notification key.
  Stale failure notices and reminders are suppressed after payment/review state
  changes. Invoice-link preparation retains failed-payment or overdue context.

## Verification and practical limits

The release test report records the actual test results. Coverage includes
booking HTTP transitions, worker submission, participant review/query/answer,
nomination and permission changes, queue rollback, retries after restart,
provider rejection and timeout, Resend idempotency, SMTP protocol responses,
invoice funding routes, payment webhooks, receipts, payroll and UI navigation.

The diagnostic label **Accepted by email service** records transport acceptance,
not inbox arrival. Live diagnosis remains **Admin → Settings → Email setup**
and **Admin → Today → Email delivery**. Check provider authentication/configuration,
recipient preferences and spelling, current retry errors, junk folders and
provider delivery/bounce records. Do not resend messages already marked accepted
merely because inbox evidence is absent.

Previously sent or cancelled messages are not replayed. A historical event that
never queued a message is not retrospectively announced. Retained unsent failed
timesheet/payroll messages can retry subject to current relevance checks.
