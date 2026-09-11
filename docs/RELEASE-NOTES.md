# The Care Web v88.1.5

11 September 2026 · full source package based on the supplied v88.1.4 archive.

This release fixes the six remaining issue groups in the v88.1.4 follow-up audit. The existing branding, page layout and media are retained.

## What changed

- **Cover acceptance:** a successful review now retains a short-lived, worker-specific review of the current visit and plan. The current-plan access check recognises that review for out-of-area cover. Acceptance rechecks the offer, visit, eligibility, plan and expiry inside the assignment transaction. Changed or expired reviews cannot assign the visit or write confirmation evidence.
- **Travel confirmations:** the warning returns a signed, 15-minute confirmation token bound to the actor, request, visit(s), worker areas and participant location. Confirming saves the exact displayed provider, distance, duration, origin, destination and checked time. A bare boolean cannot waive the warning. Changed details require a new confirmation. Creation, acceptance, occurrence moves, recurring edits and office assignment use the same validation. Confirmation records include actor ID and actual visit details.
- **Register access:** shared registers begin with office-only access. The office grants individual approved workers read, append or edit rights with an expiry. Optional participant scope also requires current access to that participant. Scope changes revoke earlier worker grants. Saved entries, register pages and uploaded register source files use the same permission check. A public audience setting does not override register restrictions.
- **Register recovery:** a failed save retains the working data and edit controls. A conflict shows both versions and offers a three-way merge for safe independent changes or explicit manual recovery for conflicting row edits. Unsaved drafts stay in memory, trigger a leave-page warning and are not placed in localStorage. Read-only users do not see editing controls; append-only users cannot alter earlier rows.
- **Sleepover hours:** booleans, arrays, whitespace, invalid numbers, negative values, excessive hours and non-quarter-hour values are rejected before completion or invoicing. Valid numeric strings remain supported. Values are never silently rounded. The UI explains 15-minute steps and sends the actual entered value, including an empty value, for validation.
- **Release handover:** the package, generated documents, inventories and manifest identify v88.1.5 and the actual v88.1.4 base archive. Historical receipts have been moved to docs/history. The manifest covers the complete package payload rather than an alleged overlay.

## Focused usability improvements

Availability now uses add/remove time controls and native leave calendars, with a weekly preview and an explicit midnight option. The sleepover note field has an accessible label and exact-entry guidance. Review and travel dialogs have accessible names. Homepage examples use neutral illustrative framing without testimonial stars or unsupported claims about real customer feedback.

## Office setup after updating

1. Sign in as the office and open the needed register under `/policies`.
2. Open **Manage access to this register**.
3. For a participant-specific register, select that participant. Confirm all entries in that register concern that participant. Changing scope does not reorganise historical rows.
4. Grant named workers only the rights they need, with an expiry. **Append** allows new entries while keeping old rows intact; **edit** also permits corrections/deletion in the current version. Earlier saved versions remain retained.
5. Use separate registers for different participants. A grant exposes the whole register, so do not grant a mixed historical register to an individual care team. The office can keep such history private and create a separate register through its existing document-publishing workflow.

An existing worker without an explicit grant will no longer see the shared register. This is intentional. Personal forms and the existing participant-specific clinical/document routes retain their own permission rules.

## Database and deployment

Schema identifier **87001** adds `cover_reviews`, `policy_register_settings` and `policy_register_access`. The migration is additive and safe to repeat. Existing register contents, history, settings and files are preserved; no grants are inferred from old free-text rows. Expired grants cease to work immediately. Worker withdrawal or loss of participant access is checked on each scoped request.

Use `STARTHERE.txt`. This is a full source ZIP. Preserve the live database, uploads and secrets when replacing application source. The package contains no runtime database, secrets or installed dependencies. Older application versions have broader register permissions; a rollback must account for that behaviour.

## Verification and limits

`npm run check` passes locally. Additional upgrade and backup/restore tests pass. See `docs/TEST-RESULTS.md` and `validation/` for the executed receipts.

The available runtime here was Node 24.19.0; the repository's declared Node 22 runtime remains a deployment verification gate. Native-browser access to this environment is blocked, so mobile layout, keyboard/screen-reader interaction and full browser save/recovery flows still need staging verification. Live email, payments, AI, cloud backup and Google services were not exercised. The route-provider tests use a local stub. Nothing was pushed or deployed.

Broader performance work such as splitting the large page shell into route-loaded modules remains a separate improvement. No mobile speed score or complete accessibility certification is claimed.
