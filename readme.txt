BookIt v86.8.0 — the review release: the door shut by default, one worker in one
place at a time, streamed and compressed static files, public pages for search
engines, self-hosted fonts, an admin idle timeout, backups in the repository,
tests and CI. Read STARTHERE.txt — "WHAT CHANGED IN v86.8.0" — before deploying.

WHAT'S IN THIS RELEASE (upload all of it over the same paths, then sudo bookit-update):
  server.js  package.json  package-lock.json  lib/  public/index.html
  public/assets/fonts/            (NEW — the page loads its fonts from here)
  scripts/backup.js  scripts/dbq.js  scripts/inventory.js
  tests/clash-tests.js  tests/smoke.js
  docs/api-route-inventory.txt  docs/database-table-inventory.txt  (generated)
  ops/bookit-backup.service  ops/bookit-backup.timer  ops/README.md
  .github/workflows/check.yml     (dotfolder — see STARTHERE for the macOS note)
  STARTHERE.txt  readme.txt

No database work needed. SCHEMA_VERSION stays 86400.
