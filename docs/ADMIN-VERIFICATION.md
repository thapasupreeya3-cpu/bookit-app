# Admin verification — v88.2.2

Open **Admin → Verification**, or `#/admin/verification`. The existing worker and participant compliance boards also link directly to this workspace.

## What has improved

The office previously loaded many unrelated boards before showing verification. The new workspace requests the queue and selected file concurrently, then keeps that person's document, screening, recruitment, training and plan information together. It uses the site's existing navy, warm neutrals and typography with clearer spacing, larger form controls, restrained status colours and a responsive layout.

| Area | New experience |
| --- | --- |
| Finding work | Separate worker/participant queues, name/email/suburb search, status filters, reviewer filters and pagination |
| Knowing what matters | Office review, waiting on person, ready, active and needs-attention statuses with a specific next action |
| Ownership | Named reviewer, due date and internal handover note on the person's file |
| Reviewing evidence | Document list, image/PDF preview, full-size link, identity/work-rights purpose, dates and previous review evidence |
| Recording decisions | Explicit method, evidence note and confirmation; no default assertion that a source was checked |
| Corrections | Editable common-reason templates, a due date and confirmation before sending a replacement request |
| Worker checks | Separate screening, banning-register, recruitment and training panels |
| Participant review | Current confirmed support-plan preview, version-specific office review and clear booking readiness |
| Review recovery | Fresh-file revision checks, preserved unsaved form values and reload instructions when another reviewer changes the file |
| Evidence trail | Reviewer-attributed activity alongside the existing underlying document and compliance records |

## Daily use

1. Choose **Support workers** or **Participants**. Use **Office review** for actions the office can complete, or **Assigned to me** for your files. Search supports names, email addresses and suburbs. The queue shows 30 people per page; filters and the selected person remain in the URL.
2. Open a person. **Checklist** shows what needs doing and whether it is with the person or the office. Set the reviewer, due date and an internal handover note. Saving this note does not send a message.
3. Open **Worker documents** for workers or **Documents** for participants. Worker evidence is grouped by category; missing types are visible and requests can be preselected. Training-generated records are in **Training**. Details-only rows identify that no file was uploaded. Read the original evidence, select how you checked it, record the evidence and confirm your decision. **Verify and open next document** advances through the remaining evidence without leaving the person's file. Recorded agreements are shown as acceptance records even when they have no attachment.
4. If something needs correcting, expand **Request a correction or replacement**. Pick a suggested reason if useful, edit the wording, and confirm sending. The original evidence remains on file and the existing replacement-request process is used. Open requests are shown before another request can be sent for the same document.
5. For a worker, complete the separate **Screening** and **Recruitment** reviews. The screening form distinguishes outcome, eligible-to-work result, expiry and organisation linkage. Each banning register needs its own recorded result. **Training** displays system-recorded completions and renewals; it does not let an office click manufacture a training result.
6. For a participant, review the confirmed plan in **Support plan**. A newer plan or changed file requires reloading before a decision can be recorded. **Ready to book** describes the existing first-booking requirements; there is no blanket participant-approval button that overrides them.
7. For a worker, **Activate worker** appears only when the new workspace's final readiness check passes. Voluntary pause, an unconfirmed email, missing evidence, missing photo and relevant eligibility restrictions prevent this action. The established activation handler still makes the final eligibility decision. The earlier policy-exception controls remain on the existing compliance board; this workspace does not add an override.

## Important behaviour

- Verifying a document and approving a person to work are separate decisions. An expired document requires an explicit acknowledgement if its review is recorded; this does not make it current or override existing eligibility rules.
- The reviewer must choose a verification method and supply a meaningful note. A file with neither uploaded evidence nor recorded acceptance cannot be verified through this workspace.
- A form is tied to the selected person's current file revision. Other reviews, new evidence, plan changes or assignment changes invalidate an old revision. The server returns a conflict; the form stays visible and offers a reload. Reloading clears the confirmation checkbox and retains the typed draft for comparison.
- Draft values are held in page memory and separated by office account, person, form and document. They are not persisted across a browser refresh or sign-out. Saved decisions and handover notes are persisted.
- A request confirmation queues the existing notification. Delivery remains governed by the existing transport, preferences and outbox; a queued request is not a claim that the recipient received it.
- New review activity displays the latest 80 workspace actions. Existing document evidence and the full compliance records remain available in their original views. Existing administrative document upload, reclassification and other specialised controls remain on the original boards.
- Example accounts are hidden unless **Show example accounts** is selected. The standalone HTML preview contains only synthetic sample files and disables all real mutations.

## Files, upgrade and rollout

The interface is in `public/assets/admin-verification.js` and `.css`; the focused API and decision adapter are in `lib/admin-verification.js`. The adapter calls the existing validation/writer functions through their registered handlers, with added file-revision and subject-ownership checks. It does not issue internal HTTP requests or replace the existing eligibility rules.

Version **88.2.2**, default schema **88202**. Four additional automation tables and a case preference extend the v88.2.1 database from 79 to 83 tables. Back up the database and uploaded files before updating. Preserve existing runtime data and configuration. The earlier 26 workflow improvements and public design/media are retained.

Read `TEST-RESULTS.md` for executed verification and limits. This source was not deployed. The available runtime was Node 24.19.0; repeat the release gate on the declared Node 22 host and validate mobile, keyboard, screen-reader and actual PDF-preview behaviour in staging. Provider messaging remains subject to the existing configuration and live tests.

## Verification automation

Read [CHANGELOG-v88.2.2.md](CHANGELOG-v88.2.2.md) for automatic assignment, guided review, combined checklists, bounded reminders, document suggestions and plan comparisons. Automatic assignment requires choosing available reviewers in the verification workspace. Follow-ups start only after an office-approved checklist. The queue refreshes without replacing the selected review or its drafts.

## PDF viewer (v88.2.4)

PDF evidence opens in the locally bundled page viewer. Use Previous/Next or the page number, zoom, fit width, rotate, and page text where available. Open full size keeps the same viewer in a new tab. Download original saves the unchanged file through its existing permission checks. Missing/denied/expired-session and unreadable-file errors offer a retry or download; an image load failure also displays an explanation. The original upload response remains sandboxed and cannot itself be framed. Only the first-party viewer shell permits same-origin framing.

## HTML previews and compact controls (v88.2.5)

HTML agreement copies and current support plans use an isolated read-only preview. Open expands the viewer into a new tab; Download keeps the original file. PDFs have a compact page/zoom toolbar. Use the three-dot menu for Rotate and Page text. Retry is shown only when a preview fails. Explanatory notes and missing-copy requests start collapsed. Existing verification actions and permissions are unchanged.
