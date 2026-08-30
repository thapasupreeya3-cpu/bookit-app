BookIt v86.9.0 — the growth release (inactive night care done properly, meet-and-greets, the open-shift feed, worker referrals, the KPI board, concierge onboarding, fee lines, coordinator referrals, group ratios, suburb pages), on top of v86.8.0, the review release: the door shut by default, one worker in one
place at a time, streamed and compressed static files, public pages for search
engines, self-hosted fonts, an admin idle timeout, backups in the repository,
tests and CI. Read STARTHERE.txt — "WHAT CHANGED IN v86.8.0" — before deploying.

THIS IS AN OVERLAY FOR v86.7.2 (commit c986779): only changed and new files. Upload all
of it over the same paths on that commit, then sudo bookit-update. Unchanged files stay.
  server.js  package.json  package-lock.json  lib/  public/index.html
  public/assets/fonts/            (NEW — the page loads its fonts from here)
  scripts/backup.js  scripts/dbq.js  scripts/inventory.js
  tests/clash-tests.js  tests/smoke.js
  docs/api-route-inventory.txt  docs/database-table-inventory.txt  (generated)
  ops/bookit-backup.service  ops/bookit-backup.timer  ops/README.md
  .github/workflows/check.yml  .nvmrc  .env.example   (dotfiles — see STARTHERE for the macOS note)
  STARTHERE.txt  readme.txt

One migration, automatic at boot: ten columns on bookings and the referrals table. SCHEMA_VERSION 86900.
