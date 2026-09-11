# The Care Web — v88.2.2 changelog

Date: 11 September 2026. Updates v88.2.1. Earlier fixes and workflow improvements are retained.

## What changed

| Change | What you can now do |
| --- | --- |
| Correct review ownership | Interview, reference and employment checks remain office tasks. They are excluded from applicant follow-ups. Requests that exhaust their reminder limit return to office review. |
| Automatic reviewer assignment | Select available reviewers, their worker/participant roles and a maximum workload. Unowned office-ready files are assigned to the eligible reviewer with the fewest open office files. Set a deadline of 1–20 business days. Existing assignments and manually unassigned files are retained. |
| Claim and overdue controls | Claim an unassigned file with one action. Another reviewer's file cannot be claimed accidentally. An Overdue filter highlights missed office deadlines and the office task list includes follow-up work. |
| One combined checklist | Select current person-owned tasks and open document requests, edit the initial message, and approve one combined request. The system excludes office work and deduplicates matching document items. |
| Bounded automatic follow-ups | Choose 3, 7 or 14 days between reminders and a limit of 0–3 reminders. Each reminder uses only the selected items still outstanding. Completed items drop out; reminders stop when all selected items are complete. Unanswered or undeliverable requests return to the office. |
| Delivery-aware reminders | Pending or disabled email does not consume reminder stages. Items and access are checked again immediately before transport. Routine message preferences and quiet hours apply. Stop follow-ups from the person's file. Existing outbox retries and delivery visibility are retained. |
| Guided review | Start next check opens the next document, screening check, recruitment review or participant plan. After a saved decision, guided review advances to the next check. Final activation still needs a reviewer decision. Next person continues through the filtered queue. |
| Document-reading suggestions in admin | View existing worker-consented extraction suggestions beside the original document: expiry, reference number, issuer, confidence estimate and source text. Confirm or edit the suggested fields, or discard them. Saving fields does not verify the evidence. Changed source files invalidate suggestions. |
| Participant plan comparisons | Compare current plan answers with the last saved office review, or a retained older reviewed plan. New office reviews save a snapshot so the reviewed answers remain available for later comparison. First-time plans clearly state when no comparison is available. |
| Live queue updates | The queue checks for updates every 20 seconds while the page is visible. A changed selected file shows a reload notice; it does not replace the open review or draft. Hidden pages and in-progress saves pause polling. |
| Faster repeat queue loading | The database stores a small queue summary per person. Changes invalidate the affected person, policy changes invalidate the queue, and time-sensitive results refresh at least every five minutes. Unchanged repeat requests reuse summaries; filtering and pagination happen in SQL. |

## Getting started

1. Open **Admin → Verification → Automation settings**. Mark the appropriate reviewers available, choose roles and capacities, set the business-day deadline, and enable automatic assignment. It starts off until reviewer availability is configured.
2. Open a worker or participant and choose **Request missing items**. Review the selected items, message, requested date, reminder interval and maximum count. Approve the checklist once. No earlier open requests are enrolled automatically.
3. Use **Start next check** to review evidence and **Next person** to continue through the queue. Use **Overdue** for office deadlines.
4. For automatic document reading, configure the existing approved provider and processing region in the existing setup. The worker must initiate a consented extraction request. The admin panel then shows its suggestions. No provider credentials or live extraction service were added to the package.

Messages are queued through the existing configured email system. Queued is not the same as delivered. A reminder waits until the previous message was accepted by the transport, then until the configured interval and any requested date have passed. A zero-reminder checklist sends only its initial request and subsequently returns to the office if still unanswered. Routine digests may group it with other updates. Office deadlines count Monday to Friday; public holidays are not configured.

## Retained decisions and data

Identity evidence, screening results, work rights, recruitment outcomes, participant plans and worker activation still require the established reviews. No person is automatically approved because a file was uploaded or an extraction model produced a confident answer. Expiry and booking restrictions continue to apply. Public branding, images, videos, fonts and existing workflow features are preserved.

This package was tested locally; it was not deployed and no real applicant messages were sent.

## Update and validation

- Version: **88.2.2**. Default schema: **88202**.
- Four additive tables: verification queue summaries, reviewer availability, combined follow-ups and plan-review snapshots. One additional case preference preserves explicit manual assignment choices.
- Preserve the existing database, uploaded documents, photos and configuration. Follow **STARTHERE.txt** for the normal update process.
- Small update archives contain changed files only. Extract them, merge their contents into the existing repository root, and replace matching files. Do not upload the ZIP itself or delete the unchanged folders.
- Automated verification: **30 scenarios passed**, including 14 new automation scenarios. The full regression and database upgrade results are recorded in **docs/TEST-RESULTS.md**.
- Browser access to the local preview was blocked with `ERR_BLOCKED_BY_CLIENT`; rendered desktop/mobile layouts, keyboard focus and PDF preview need staging validation. An updated sample preview is included.
- The available test runtime is Node 24.19.0. Repeat the release checks on the declared Node 22 deployment host. Live email and extraction-provider configuration require authorised staging tests.
