# The Care Web v88.2.9 — focused Next actions

Built on v88.2.8. This release redesigns the Next actions page itself and preserves the existing Credentials workspace, file actions, compact header and referral shortcut.

## Personal Next actions

- One compact, ordered action list replaces the grid of large cards. A single primary button marks where to start.
- Related document requirements share one checklist action; training modules share one training action. Repeated missing/renewal/request prompts for the same document type are combined while keeping their notes and deadlines available under Details.
- The first three action groups are shown. Additional groups are under Show more. Every overdue or due-today group remains visible, even when this requires more than three rows.
- Deadlines lead the ordering. Visit responses, shift notes and timesheet questions appear ahead of routine setup and later renewals. Calendar-day deadlines use the site date returned by the server.
- Buttons explain the action: Open checklist, Open training, Review request, Write shift note, Answer question, Review timesheet, Review funding or Share feedback.
- Email verification can be requested directly from the task. The feedback says requested, because the existing endpoint does not prove delivery. Coordinators are not offered a resend button for another person's email.
- With the office is collapsed, grouped and separate from personal work. Duplicate review prompts for the same certificate are combined. Worker/participant links open appropriate records instead of an admin-only page or this same task list. Urgent staffing issues remain visible outside the collapsed section.
- Application, pay status, renewals and other workflow panels are accessible under one More tools menu. Other panels have a clear Next actions back link. Scoped coordinator tools are retained.
- Only the next relevant visit appears below the work list. A visit already listed as an action is not repeated. The visit shows its counterpart and whether it is confirmed, requested or currently underway.
- Empty states distinguish no personal actions from reviews still with the office. No artificial completion percentage, dismiss control or checkbox changes the underlying tasks. Refresh list reads the current records.

## Office Next actions

- Compact rows show the task, person, due date and assigned owner. The record link stays visible; details and assignment fields are collapsed.
- Record links open the relevant visit, application or person’s verification file, including the correct participant/worker queue.
- Search, assignment, due-date edits and pagination are retained.
- Opening the office task list fetches its paginated queue once. It no longer fetches the general journey first and then repeats the whole queue synchronisation.

## Data consistency and retained behavior

- Worker prompts now distinguish actual uploaded evidence and linked platform completions from details-only rows. Expired, rejected and superseded evidence does not silently clear an upload prompt.
- Missing resumes appear as a checklist task, without introducing a new activation or booking gate. Training renewals carry their existing expiry date into task prioritisation.
- Task grouping is presentation only: original task IDs, audit history, ownership and automation remain intact. Existing eligibility/approval rules, schema, runtime dependencies, media, fonts and vendor assets are retained.

## Preview and validation

`docs/next-actions-preview.html` is a standalone interactive preview using the shipped action-list component with five synthetic examples and full/phone-width frames. Its links and buttons do not modify an account. The preview covers worker setup, worker visits/renewals, participant setup, waiting on the office and an up-to-date account.

The automated checks cover grouping, duplicate notes, urgent ordering, date boundaries, office links, scoped email behavior, compact office assignment controls, API data consistency and existing workflows. Exact results are in `docs/TEST-RESULTS.md`.

Browser access to the local app was blocked earlier in this session. The preview scripts and sample renderings are checked with a DOM model, not a real browser. Live layout, screen-reader behavior and production integrations still need confirmation. No live site was accessed or deployed, and no real emails, SMS or payments were sent.

## Install

Use **The-Care-Web-v88.2.9-next-actions-fix-only.zip** over v88.2.8. Extract it and merge the extracted contents into the existing repository root, replacing matching files while keeping other files. Do not upload the ZIP or add an extra enclosing folder. Commit and redeploy normally; `/api/version` should report **88.2.9**. No existing files need deleting for the latest-only update.

If previous updates were skipped, use **The-Care-Web-v88.2.9-all-updates-only.zip** instead and follow its included instructions. Do not apply both packages. Preserve runtime documents, database and configuration; compare with any newer repository edits not supplied here.

After deployment, open Next actions as a worker, participant and admin. Confirm useful ordering, expandable groups, direct file/timesheet links, office assignment and the More tools menu at normal and enlarged text sizes.
