# The Care Web v88.3.3 — clearer tasks and automatic website checks

The task list previously mixed office work, participant feedback and site maintenance. All rows looked like unassigned office work, and task buttons did not explain where they led.

## Changes

- Three labelled views: **Office actions**, **Waiting on people**, **Website checks**, each with its own count.
- Every task has a visible status, responsibility, next step and a button named for the action.
- **Red !:** urgent or overdue. **Amber →:** action required or due today. **Blue ◷:** waiting. A green empty state means no current action in the selected view.
- Office work is sorted by urgency before pagination. Search uses the displayed subject, title, action and detail; search and pagination retain the active view.
- Participant feedback shows **Waiting on participant** to the office and **Optional feedback** to the participant. It has no office assignment form and does not block booking or billing.
- Website tasks show **The Care Web website**, rather than a misleading administrator name. Office tasks display their owner or **Any office reviewer can start this task**.
- Compact task rows, search controls and action buttons wrap on narrow screens. Labels and icons accompany colour, with visible keyboard focus and forced-colour support.
- The manual certificate-review reminder is replaced by automatic HTTPS certificate monitoring using the configured public APP_URL. Healthy results are refreshed daily; connection failures retry hourly. Three consecutive connection failures raise an alert. Trust/hostname/validity failures alert immediately; expiry within 14 days raises a renewal reminder. Successful recovery automatically clears the alert.
- The operations screen shows the last attempt, last confirmed expiry and next check. Missing APP_URL has a specific hosting-setup instruction. Certificate renewal remains with hosting, and operational alerts do not gate bookings or invoices.
- The user guide and source control register are refreshed for this release.

## Installation

Apply the changed-files ZIP over **v88.3.2**. Extract it and merge its contents into the existing repository root, replacing matching files and preserving the other folder contents. Redeploy and refresh. The ZIP excludes unchanged media, uploaded documents and dependencies. No source deletions or schema change are needed. Version: 88.3.3; schema remains 88302; 386 routes and 92 tables.

## Validation

The complete automated suite passed, including 20 new task/certificate tests and a real API regression for task separation and assignment permissions. Checks cover classification, labels, optional feedback, colour contrast, action links, Sydney date boundaries, pagination, escaping, certificate retry and recovery, unsafe hosts and timeout cleanup. Existing automated billing, verification, document controls, calendars, Settings and navigation suites also passed.

The interactive preview uses fictional records and the production task renderer. The preview browser rejected the local URL with ERR_BLOCKED_BY_CLIENT, so native browser layout and live hosting certificate checks remain unverified. No live site, account, email or payment was changed. Automated certificate checks do not establish continuous public availability or perform certificate renewal.

Technical reference: [Node.js TLS connection and hostname validation](https://nodejs.org/api/tls.html#tlsconnectoptions-callback).
