# The Care Web v88.2.12 — calendar layout fix

Built on v88.2.11.

- Fixed the selected-day panel covering Sunday, including the 6th shown in the screenshot. A general table style imposed a 640-pixel minimum width on the calendar, causing it to overflow beneath the adjacent panel. The calendar now overrides that minimum and fits its own column.
- The calendar and selected-day panel wrap according to the available space. On smaller screens (up to 1050 CSS pixels), the panel sits below the calendar.
- Long names, headings and visit details wrap inside the panel.
- Updated the stylesheet version so a normal refresh requests the corrected layout.
- Updated the fictional preview to include the site's general table styles, which were missing from the previous preview.

Booking counts, calendar dates, month/week controls, request badges, file controls and booking actions are unchanged. No database or dependency changes.

## Install

Apply **The-Care-Web-v88.2.12-calendar-layout-fix-only.zip** over v88.2.11. Extract the ZIP and merge its contents into the existing repository root, replacing matching files. Commit and redeploy normally, then refresh the site. `/api/version` should report **88.2.12**. There are no file deletions.

If earlier releases were skipped, use **The-Care-Web-v88.2.12-all-updates-only.zip** instead and follow its instructions. Use one update package only. Preserve live database, uploads and configuration.

## Verification

See `docs/TEST-RESULTS.md` for the executed checks and their limits. Browser access remained unavailable in this session; the fix has not been visually verified on the deployed site. After deploying, check September 2026: Sunday the 6th should be visible and selectable in month view, and the selected-day panel should sit below the grid on smaller screens.
