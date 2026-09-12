# The Care Web v88.2.7 — navigation and usability

This update fixes the worker Credentials link and reduces clutter across the shared header, account menu and document workflow. It builds on v88.2.6, retaining the earlier Settings, PDF/HTML viewer and verification fixes.

## Changes

- **Credentials → Add or replace files** opens the existing dedicated document uploader, with a direct link back to Credentials. It no longer sends workers to Bookings.
- Credentials now shows filenames, view links, review notes and details-only records. PDFs use the protected viewer; JPG/PNG files open the original image.
- Bulk uploads retain successful files, retry only outstanding files and refresh the saved-file list. An unavailable optional document-assistance service no longer prevents manual uploads. Leaving the page or changing accounts stops remaining prepared files from being sent.
- The shared header shows relevant tasks for the signed-in role: three for workers, coordinators and admins; four for participants. Public marketing navigation has four primary choices.
- The worker account menu now contains **seven actions**: My profile, Credentials & checks, Earnings, Settings, Report an incident, Help & contact, Log out. Other roles have five or six. Messages and Accessibility remain directly accessible in the header.
- Pay tiers, pay rates and referrals are grouped under Settings → Earnings. Profile is also available in the Settings list. Existing pages remain available through relevant pages and footer links.
- Smaller header logo, bounded avatar artwork, compact spacing, an earlier mobile-menu breakpoint and a symbol-only logo on small phones reduce crowding. Header contents can wrap instead of overlapping at larger text sizes. Sticky Settings navigation follows the measured header height.
- The mobile menu focuses its close button, keeps keyboard navigation inside the open menu and returns focus when closed. The account menu supports arrow, Home and End keys, closes on focus leaving and closes other header panels when opened.
- Sign-in links now have a matching route. Unknown routes show a recovery page instead of silently opening Home. Login returns to the signed-in workflow; logout returns to Home and clears the selected client in the interface.
- Booking-load failures show a clear message and Try again. Credentials-load failures also offer retry.
- Workflow panels show the current section title and use smaller navigation tabs. Signed-in users no longer see the large footer signup banner.
- Added an accessible main heading to Messages and meaningful headings to confirmation pages. Payment-return wording directs people to their actual invoice status rather than treating the return URL alone as proof of payment. Email-confirmation continuation suits workers as well as participants.

## Validation and limits

The release checks cover syntax, server/API regression suites, workflows, verification, Settings and ten new navigation/upload scenarios. The page audit covers 54 route entries, dynamic route dispatch, literal internal links, static control labels and duplicate IDs. See `docs/TEST-RESULTS.md` and `docs/SITE-USABILITY-REVIEW.md` for the executed results and exact scope.

Browser access to this local app is blocked in this environment. These are code and isolated functional checks, not a claim that every control or viewport has been exercised in a real browser. Confirm the header, menus and upload journey on the deployed site after updating.

## Install

Use `The-Care-Web-v88.2.7-usability-fix-only.zip` over v88.2.6. Extract it, merge the files into the existing repository root, replace matching files, commit and redeploy. Upload the extracted contents, not the ZIP or an extra enclosing folder. No files need deleting for this latest-only update.

If earlier releases were skipped, use the cumulative `The-Care-Web-v88.2.7-all-updates-only.zip` and its included instructions. Do not apply both packages.

No backend schema, permissions, runtime dependencies, stored documents or verification decisions changed. Preserve runtime uploads, database and configuration. `/api/version` should report `88.2.7` after deployment.
