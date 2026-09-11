# Workflow operations — v88.2.0

## Install and configure

1. Back up the existing database, documents, photos and configuration. Preserve runtime paths, secrets and the prior source. Compare any newer repository changes with this package before replacing code.
2. Use the contents of `bookit-app-main` as the project root. Follow `STARTHERE.txt`. Install and run `npm run check` on the declared Node 22 host. The available verification runtime was Node 24.19.0.
3. Boot against a staging copy first. Check `/api/version`: application 88.2.0 and schema 88200. There are no destructive migrations or automatic conversions of old unknown funding to private payment.
4. In **Next actions → Setup**, record the reviewed private billing basis and existing displayed-price tax treatment. Private bookings remain blocked until this is ready. Changing this configuration never rewrites an issued invoice.
5. In the same page, reconcile your external payroll and enter the first date of work not already processed. Enable scheduled draft preparation only after that reconciliation. Older manually prepared lines require individual review for prior payment. This protects the transition from the historical CSV register.
6. Configure the existing email transport and test it with authorised test recipients. The Messages panel states when sending is disabled. Queued means persisted; sent means transport accepted, not proven delivery to an inbox. No bounce status is invented without provider evidence.
7. If document extraction is wanted, configure the existing AI provider/model, approved processing location and credentials. Record document-processing approval in Setup. Each worker must opt in for their document. Keep it off until the provider round trip and review process have been evaluated.

## Automations and human decisions

| Trigger | Automatic work | Human decision |
| --- | --- | --- |
| Signup, setup change, periodic refresh | Recompute person/office tasks and their ready times | Confirm declarations, review evidence and eligibility |
| Pending delivery; every 15 seconds | Lease due messages, recheck access/preferences, retry eligible work | Resolve final failures and inspect ambiguous provider results |
| Routine digest/quiet hours | Delay and group routine notifications; urgent alerts bypass delay | Person chooses preferences; office handles urgent cases |
| Payroll daily job, after cutover setup | Prepare unbatched lines from the last 14 days, starting at cutover | Review exceptions, approve, export, process externally and record reference |
| Existing invoice job | Prepare eligible lines and queue the original invoice atomically | Resolve holds, funding exceptions and payment mismatches |
| Renewal horizon | Add one replacement/review task and identify affected visits | Supply replacement; office verifies it |
| Completed first meeting or first shift | Offer the appropriate next-step task unless complaint/change is open | Choose continuation or request help; nothing is booked automatically |
| Approved document extraction request | Suggest bounded fields with source text and confidence | Accept, modify or reject; separate office verification remains required |
| Workflow activity | Record minimal timing/recovery events and reporting-period summaries | Use measured cohorts before claiming any time saving |

## Delivery recovery

The outbox is in the application database, so include it in backups. Invoice snapshot and queued PDF are retained separately from the current payer profile. Delivery retries use the original invoice number and stable key. A sending lease expires after two minutes; retries are bounded, and failed rows appear in the office queue. Old sent/cancelled payloads are removed after 90 days.

Delivery is **at least once** where the transport cannot provide idempotency: if it accepted a message and the connection failed before acknowledgement, retrying can send it again. The queue prevents duplicate invoice creation but cannot promise exactly-once email. Confirm provider evidence before manually retrying an ambiguous failure. Urgent cover messages are prioritised, bounded by their live offer and expiry, and rechecked against the cover record.

Quiet times use the server's configured local timezone; configure it to match the service operation. The existing application uses Australia/Sydney in tests. A digest summarises the number of routine updates and links back to signed-in work. Attachments are delivered separately. Revoked helper access, opted-out categories and closed accounts suppress queued delivery.

## Pay and invoices

Use **Pay batches** for payment preparation. The old download is labelled **Historical worker-share register**; it is not evidence of an external payment. A source booking, standby allowance or referral can appear in the batch ledger only once. Corrections need reviewed adjustments and a unique reference. An unresolved exception blocks batch approval. A changed source is rechecked. Re-download uses the same line IDs.

Exporting and acknowledging payment are separate actions. Acknowledgement records the office's external reference; it does not move money. Participant payment never marks worker payroll paid. Check wage obligations independently of participant approval; a timesheet query is an exception for review, not an automated decision to withhold wages.

In **Invoice exceptions**, review unissued/held work, original payer and amount, message status and receipt evidence. Record the actual receipt amount, reference and reconciliation evidence. A mismatch remains an exception and does not settle the invoice. Closing the exception records your review only. Partial/combined receipts require reconciliation; the code does not distribute them speculatively. A correction/reversal requires its own evidence. Stripe checkout events only settle a known invoice when the signature check and stored-session/paid-status/currency/amount checks pass; verify this against your provider test account before production.

## Calendar, support changes and privacy

Subscriptions require confirmation and use an unguessable token stored as a hash. They expire after 90 days and can be rotated or revoked. Events contain generic visit titles and timing, not participant names, addresses or care notes. A stable UID and increasing sequence support changes and cancellations; reassignment cancels the old worker's event. Actual refresh speed depends on the calendar client. Revoking a feed prevents future access; remove the subscribed calendar from the client to remove previously downloaded entries.

Changing support opens an owned office case and preserves existing visits. Closing the case requires review of the current future-visit list and resolution of outstanding completion notes and timesheet questions. Record invoice follow-up and helper-access arrangements in the outcome. Ending a series requires a fresh preview and retains the existing cancellation rules. A case closure does not itself revoke a helper or cancel a visit: complete the agreed actions through their explicit existing controls.

The existing office-reviewed account closure now also clears personal intake, preferences, extraction suggestions, task data and calendar membership, cancels/scrubs the person's outbox, and releases interview reservations. Service and financial evidence follow the existing retention/closure process. It is not an automatic purge of every historical record.

## Measurement and rollout

Compare date ranges in **Time and progress**. Task duration begins when the system first observes readiness, not account creation. Active effort uses visible-page interaction intervals and is approximate. Started, resumed, returned, submitted, saved, failed and completed events describe observed activity; a closed tab is not proof that a person abandoned support. There is no historical timing baseline before this release. Task wait cohorts use current/latest task cycles; event counts preserve repeated activity. Do not interpret these as wages, exact working time or a promised speed improvement.

Verify mobile layouts, keyboard focus, screen-reader status messages, multiple-tab plan conflicts, upload retry recovery and real calendar-client cancellation in staging. Run authorised provider tests for mail, Stripe and optional extraction. Back up before deployment. Rollback of source may reintroduce earlier permissions/behaviour; restore source and data through a reviewed recovery plan that accounts for records created since the backup.
