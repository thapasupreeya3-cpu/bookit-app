# The Care Web v88.2.8 — documents and navigation

Built on v88.2.7. This release replaces the generic bulk upload screen with a worker document workspace and corrects confusing navigation.

## What changed

- **Essential-document checklist:** identifies missing identity evidence, work rights, screening, orientation, first aid, CPR and resume. Each row shows received/awaiting review/verified status. Expired, rejected and details-only evidence is called out. Office requests are displayed with their notes and the correct upload type.
- **Full document dropdown restored:** all 25 existing document types are available, grouped by category, before choosing a file. Identity types show their points. Relevant expiry dates, reference numbers and qualification names appear after selecting the type. Phone photos are resized automatically; PDFs retain the existing 4 MB limit.
- **Individual file actions:** View and Replace are beside each upload. Replacement locks the selected document type and sends the original file ID; the server checks ownership and matching type, saves the new evidence and records the replacement reference. Earlier evidence and verification decisions remain available.
- **Removal:** unverified files can be removed after confirmation. Verified files offer Request removal, which asks for a reason and files an office request with the exact document ID and a reference number. Verified evidence stays in place pending office review.
- **Clear review states:** uploading is not verification. Multiple files of one identity type count once. Platform training completions are identified from actual linked completion records and remain under Training; uploaded certificates remain documents.
- **Reliable uploads:** failed attempts retain the selected file for retry. A successful upload followed by a failed refresh is reported as saved. Duplicate-file detection remains active. Leaving the page or changing accounts during file preparation prevents it being sent.
- **Fewer duplicate editors:** personal details, funding, documents and notification settings have one destination in Settings. Old Next actions links forward to the relevant page, preserving the requested document type. Next actions keeps tasks, application/pay progress, visit tools and renewals. Coordinators retain scoped editors for their selected person.
- **Contact and calendar tools retained:** worker emergency contacts and contact notes are in Profile. Digest, quiet hours and calendar subscriptions are in Emails & notifications. Saving contact notes cannot overwrite newer name, phone or suburb values. Optional document assistance remains available in a collapsed section of Credentials, subject to its existing configuration and consent.
- **Bookings is less crowded:** its duplicate worker upload editor is replaced by a compact link to the document checklist.
- **Predictable scrolling:** Settings and admin navigation start at the top. Delayed section jumps and message updates check the active page. Message search scrolls its thread rather than the whole page; focus restoration avoids scrolling.
- **Refer a friend is back in the avatar menu:** one click opens the existing Refer a worker program. The Earnings link remains available too. The compact role-based header from v88.2.7 is retained.

## Validation and limits

The full `npm run check` gate passed, including 13 document-workspace scenarios, 35 workflow checks, 11 Settings checks, 10 navigation checks and the existing verification suites. See `docs/TEST-RESULTS.md` for the executed results and limits. New tests exercise the shipped document component, navigation guards, legacy links, exact replacement ownership/type checks, evidence retention and current profile data during contact saves.

Browser preview access to the local app was blocked earlier in this session, so visual layout and real-browser behavior are not certified. No live site was accessed or deployed. Production document files, email delivery and payment providers were not exercised. Test data is synthetic. Runtime dependencies and schema are unchanged; server changes are limited to document metadata/replacement validation and contact-save handling, plus canonical task destinations.

## Install the small update

1. Use **The-Care-Web-v88.2.8-credentials-fix-only.zip** over v88.2.7. Extract it and merge the extracted files into the existing repository root, replacing matches. Upload the extracted contents, not the ZIP or an extra enclosing folder.
2. Keep all other existing files, runtime documents, database and configuration. The latest-only package requires no deletions.
3. Commit and redeploy using the existing process. Refresh the site; `/api/version` should report **88.2.8**.
4. Check Settings → Credentials, add a file under a specific type, replace that exact file and confirm the prior version is still on record. Confirm an unverified removal updates the checklist.
5. Check Refer a friend in the avatar menu. Navigate between long/short Settings pages and back from Messages. Check desktop, phone, enlarged text and keyboard navigation.

If previous updates were skipped, use **The-Care-Web-v88.2.8-all-updates-only.zip** instead; its instructions list supported earlier releases and the one obsolete historical log to remove if present. Do not apply both update packages. Compare separately with any newer repository changes that were not supplied here.
