# v88.4.6 — Profile email and invoice queries

This is a current-update-only ZIP for v88.4.5. It excludes unchanged files and previous update payloads. Merge it into the existing repository and redeploy; it has not been installed on the live website by this work.

## Profile email

- My profile → Your details shows a prominent Email address card with the current address, verification state and Change email action.
- The office can find the same contact details under People → Verification → Participants → the participant's file. An assisted change requires the admin's password, the participant's request or consent, and a recorded reason.
- A current password and confirmation from the new inbox are required. Until then the current address stays active. Pending changes can be checked, cancelled or replaced. Verification links expire after one hour; opening a link does not change the account.
- Confirmation invalidates existing sessions, legacy cookies, and previously issued password-reset or sign-in challenge links. The password and two-step sign-in settings stay in force. Security notices go to the relevant old/new addresses.
- Linked helpers see the selected participant's contact email separately from their own sign-in email. They cannot change another account's address.
- Existing invoice payer details, snapshots, uploads and payment evidence are preserved.
- Personal data exports retain safe delivery metadata and email-change history, but omit queued verification links and internal security hashes. This prevents exports from bypassing new-inbox verification.

## Invoice queries

- Money → Invoices has a direct Review query action for queried invoices. The office can read the history, reply or request a worker response.
- Replies show their actual author in the invoice, visit notes and CSV exports. Existing worker query emails continue to operate.
- Responses move the invoice to Waiting for participant review — payment paused. They do not approve work or resume collection. The participant or authorised reviewer explicitly approves once satisfied, or asks another question.
- Duplicate actions and stale replies are checked. Paid/withdrawn invoice safeguards remain. Charge corrections use the existing invoice and payment review controls.
- Private questions and responses are excluded from public payment links and invoices-only helper access. Response notification emails point to the protected record.
- Unpaid invoices show No payment received. Dates stay together in the office table.

## Installation and data

Only v88.4.5 is the supported base for this ZIP. Schema identifier 88404 adds the account_email_changes table and indexes; existing account addresses do not change during upgrade. RELEASE-FILES.json describes the complete installed source; the ZIP carries only the differences. Older block-register files remain the previous audit snapshot and are not regenerated or bundled in this small update.

See USER-GUIDE.html for steps and TEST-RESULTS.md for verification. No live emails were sent, payment transactions made or website deployment performed. Browser rendering and real inbox delivery remain unverified.
