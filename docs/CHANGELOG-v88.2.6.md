# The Care Web — v88.2.6 Settings loading fix

12 September 2026 · Updates v88.2.5.

## Cause

Settings accidentally checked `renderSequence`, a variable local to the admin page. The Settings renderer threw `ReferenceError: renderSequence is not defined` before replacing the initial “Loading…” placeholder. This affected the Settings hub and its normal sections, including worker accounts. The separate Profile branch returned before that line.

The original v88.2.5 code was reproduced in a controlled frontend harness: opening `#/account` as a worker left “Loading…” visible and raised that exact error. The earlier regression suite did not execute this Settings path.

## Changes

- Removed the accidental dependency on admin-page state. Settings now owns its render sequence, so admin activity cannot interrupt it.
- Added a recoverable error message and **Try again** for rendering failures and requests that have not finished within 15 seconds. The Settings navigation remains available when a section fails.
- Added protection against late responses overwriting another section, a signed-out view or a timeout message.
- Awaited the section renderers so failures are handled by the Settings page and the accessible loading state clears when rendering finishes.
- Worker Profile's profile and tier requests run together.
- Settings links with query parameters select the intended section.
- Email settings offer a working Retry action after a failed load. Accounts whose default Settings section is Emails now fetch those preferences on the first visit.
- Added a Settings regression suite using the shipped renderer functions and an isolated server with synthetic accounts and real API responses.

The existing Settings design, document viewer, compact verification controls, eligibility rules and automations are retained. No new dependency, server endpoint or database migration. Existing data and uploaded files are not rewritten.

## Install

Extract `The-Care-Web-v88.2.6-settings-fix-only.zip` and merge its contents into your existing **v88.2.5** repository root. Replace matching files and preserve other folder contents. Upload the extracted files rather than the ZIP itself. Restart/redeploy, then refresh Settings; `/api/version` should report 88.2.6.

If you skipped earlier updates, use the cumulative all-updates ZIP. Preserve the deployed database, uploaded documents, photos and configuration.

## Validation

The full `npm run check` gate, **11 Settings scenarios** and all **46 verification scenarios** passed. Two upgrade boots preserved records and uploaded file bytes. See `TEST-RESULTS.md` and `validation/v88.2.6-*`. The Settings tests execute the actual page and worker-section renderers with real API data, plus controlled load failures, timeout and navigation races. They also check ordinary detail/preference saves and mandatory notification protection.

This environment's browser URL policy blocks local preview testing. No live worker account, deployed site or production data was accessed, and no browser screenshot is claimed. After deployment, open worker Settings and check Availability, Credentials, Earnings, Training, Jobs, Notifications, Accessibility, Security and Help.
