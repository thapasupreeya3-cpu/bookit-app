# v88.4.20 — Booking emails and shift-note workspace

Booking and shift events now save their notices alongside the relevant state
change. Completing a chargeable shift sends the worker a saved receipt and the
selected reviewer a completion/review notice, independently of the invoice.
Meet-and-greet completion, approval, questions, answers, addenda, reminders and
automatic approval use the same permission-aware transactional flow. Cover
confirmation and office reassignment include affected authorised helpers.

Booking, timesheet and payroll notices bypass digest schedules and quiet hours
while respecting applicable notification preferences. Timesheet and payroll
delivery continues retrying after five failures; retained failed messages are
recovered and checked for current relevance before sending. Stable provider
keys and coordinated outbox passes protect retries from duplicate dispatch.
Unrelated helper-permission changes no longer cancel a still-authorised notice.

Payment failure notices are deduplicated by payment attempt. Normal checkout
expiry or cancellation does not send a misleading failed-payment email.
Reminders stop while payment is processing or review is reopened. Refreshed
invoice links preserve the purpose of failure and overdue messages.

Next actions opens the worker's visit summary and Record this shift editor
together. Reference panels follow the editor. Completion returns to the saved
visit summary and note, and requested answers appear above the note history.
The user guide documents this layout and the complete notification flow.

This cumulative update contains the compact calendar chooser and ongoing
recurrence improvements from v88.4.18–19. It applies over supplied v88.4.17 or
either earlier calendar update. No live deployment, real email transmission or
payment was performed. Provider acceptance is separate from inbox delivery.
